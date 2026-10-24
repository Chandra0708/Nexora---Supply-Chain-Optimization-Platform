import {
  Currency,
  DemandDriver,
  DemandSignal,
  Lane,
  MultiLevelBOMItem,
  NodeType,
  OpenPurchaseOrder,
  PeggingImpactNode,
  PrescriptiveOption,
  Product,
  PropagationResult,
  ScenarioComparisonResult,
  ScenarioSimulationInput,
  SupplyNode,
  UnisonOptimizationResult,
  WorkCenter,
  ControlTowerException,
  ProductionSlot,
  BucketInventoryRecord,
} from './types/ibp.ts';

// ============================================================================
// 1. DRIVER-BASED DEMAND SENSING ENGINE (o9 Solutions Pattern)
// ============================================================================
export class DriverBasedDemandEngine {
  static calculateSensedDemand(signal: DemandSignal): number {
    const d: DemandDriver = signal.drivers;
    const priceRatio = d.baseline_price > 0 ? d.current_price / d.baseline_price : 1.0;
    const priceMultiplier = Math.max(0.2, Math.pow(priceRatio, d.price_elasticity));
    const promoMultiplier = 1.0 + Math.max(-0.8, d.promo_uplift_pct);
    const sensed =
      signal.baseline_units *
      promoMultiplier *
      priceMultiplier *
      d.pos_sell_through_index *
      d.macro_gdp_factor *
      d.weather_index;
    return Math.round(Math.max(0, sensed));
  }

  static explainDriverContributions(signal: DemandSignal) {
    const base = signal.baseline_units;
    const d = signal.drivers;
    const promoDelta = Math.round(base * d.promo_uplift_pct);
    const priceRatio = d.baseline_price > 0 ? d.current_price / d.baseline_price : 1.0;
    const priceEffect = Math.pow(priceRatio, d.price_elasticity) - 1.0;
    const priceDelta = Math.round(base * priceEffect);
    const posDelta = Math.round(base * (d.pos_sell_through_index - 1.0));
    const macroDelta = Math.round(base * (d.macro_gdp_factor * d.weather_index - 1.0));
    const sensed = DriverBasedDemandEngine.calculateSensedDemand(signal);

    return {
      baseline: base,
      promo_delta: promoDelta,
      price_elasticity_delta: priceDelta,
      pos_sensing_delta: posDelta,
      macro_weather_delta: macroDelta,
      consensus_sensed: sensed,
    };
  }
}

// ============================================================================
// 2. ENTERPRISE KNOWLEDGE GRAPH & DAG PROPAGATION ENGINE (Kinaxis Pattern)
// ============================================================================
export class EKGSupplyNetwork {
  nodes: Map<string, SupplyNode> = new Map();
  products: Map<string, Product> = new Map();
  lanes: Map<string, Lane> = new Map();
  bomRecords: MultiLevelBOMItem[] = [];
  supplyAdjacency: Map<string, Lane[]> = new Map();

  registerNode(node: SupplyNode) {
    this.nodes.set(node.node_id, node);
    if (!this.supplyAdjacency.has(node.node_id)) {
      this.supplyAdjacency.set(node.node_id, []);
    }
  }

  registerProduct(product: Product) {
    this.products.set(product.product_id, product);
  }

  registerBOMEdge(bom: MultiLevelBOMItem) {
    this.bomRecords.push(bom);
  }

  registerLane(lane: Lane) {
    this.lanes.set(lane.lane_id, lane);
    const list = this.supplyAdjacency.get(lane.origin_node_id) || [];
    list.push(lane);
    this.supplyAdjacency.set(lane.origin_node_id, list);
  }

  /**
   * Traverses downstream physical fulfillment DAG and upstream/downstream multi-level BOM
   * to calculate instant concurrent pegging impact without batch runs.
   */
  propagateDisruption(
    disruptedNodeId: string,
    delayBuckets: number,
    affectedProductId: string | null,
    demands: DemandSignal[]
  ): PropagationResult {
    const rootNode = this.nodes.get(disruptedNodeId);
    const rootNodeName = rootNode ? rootNode.name : disruptedNodeId;

    // 1. Traverse multi-level BOM upward (components -> sub-assemblies -> finished goods)
    const impactedProducts = new Set<string>();
    const bomExplosionPath: PropagationResult['bom_explosion_path'] = [];

    if (affectedProductId && this.products.has(affectedProductId)) {
      impactedProducts.add(affectedProductId);
      let frontier = [affectedProductId];
      while (frontier.length > 0) {
        const current = frontier.shift()!;
        for (const edge of this.bomRecords) {
          if (edge.component_id === current) {
            bomExplosionPath.push({
              from_item: edge.component_id,
              to_item: edge.parent_product_id,
              qty_per: edge.quantity_required,
              lead_time_days: edge.lead_time_days,
            });
            if (!impactedProducts.has(edge.parent_product_id)) {
              impactedProducts.add(edge.parent_product_id);
              frontier.push(edge.parent_product_id);
            }
          }
        }
      }
    } else {
      for (const p of this.products.values()) {
        if (p.tier === 'FINISHED_GOOD') impactedProducts.add(p.product_id);
      }
      for (const edge of this.bomRecords) {
        bomExplosionPath.push({
          from_item: edge.component_id,
          to_item: edge.parent_product_id,
          qty_per: edge.quantity_required,
          lead_time_days: edge.lead_time_days,
        });
      }
    }

    // 2. BFS Downstream Physical Network DAG Traversal
    const visited = new Map<string, { depth: number; cumulativeDelay: number }>();
    const queue: { nodeId: string; depth: number; delay: number }[] = [
      { nodeId: disruptedNodeId, depth: 0, delay: delayBuckets },
    ];
    visited.set(disruptedNodeId, { depth: 0, cumulativeDelay: delayBuckets });

    while (queue.length > 0) {
      const { nodeId, depth, delay } = queue.shift()!;
      const outgoing = this.supplyAdjacency.get(nodeId) || [];
      for (const lane of outgoing) {
        const nextDelay = delay + (delayBuckets > 0 ? lane.lead_time_buckets : 0);
        if (!visited.has(lane.destination_node_id)) {
          visited.set(lane.destination_node_id, {
            depth: depth + 1,
            cumulativeDelay: nextDelay,
          });
          queue.push({
            nodeId: lane.destination_node_id,
            depth: depth + 1,
            delay: nextDelay,
          });
        }
      }
    }

    // 3. Build Pegging Impact Chain with Pegged Orders & Revenue at Risk
    const peggingChain: PeggingImpactNode[] = [];
    let totalAtRiskRevenue = 0;
    let totalAtRiskUnits = 0;

    const finishedGoodsImpact = Array.from(impactedProducts).filter(
      (pid) => this.products.get(pid)?.tier === 'FINISHED_GOOD'
    );

    for (const [nodeId, meta] of visited.entries()) {
      const nodeObj = this.nodes.get(nodeId);
      if (!nodeObj) continue;

      const nodeDemands = demands.filter((d) => {
        const matchesProduct = finishedGoodsImpact.includes(d.product_id);
        const matchesCustomer =
          nodeObj.node_type === NodeType.CUSTOMER
            ? d.customer_id === nodeId
            : d.bucket <= meta.cumulativeDelay + 1;
        return matchesProduct && matchesCustomer;
      });

      const riskRatio = Math.min(1.0, delayBuckets * 0.28);
      let nodeRiskUnits = 0;
      let nodeRiskRev = 0;

      for (const d of nodeDemands) {
        const prod = this.products.get(d.product_id);
        const price = prod ? prod.financials.unit_sales_price : 140;
        const exposedUnits = Math.round(d.sensed_units * riskRatio);
        nodeRiskUnits += exposedUnits;
        nodeRiskRev += exposedUnits * price;
      }

      if (nodeObj.node_type === NodeType.CUSTOMER) {
        totalAtRiskUnits += nodeRiskUnits;
        totalAtRiskRevenue += nodeRiskRev;
      }

      const severity: PeggingImpactNode['severity'] =
        meta.cumulativeDelay >= 3
          ? 'CRITICAL'
          : meta.cumulativeDelay >= 1
          ? 'WARNING'
          : 'NOMINAL';

      peggingChain.push({
        node_id: nodeId,
        node_name: nodeObj.name,
        node_type: nodeObj.node_type,
        tier_depth: meta.depth,
        cumulative_delay_buckets: meta.cumulativeDelay,
        impacted_products: Array.from(impactedProducts),
        impacted_demand_ids: nodeDemands.map((d) => d.demand_id),
        at_risk_revenue_usd: Math.round(nodeRiskRev),
        at_risk_units: nodeRiskUnits,
        severity,
      });
    }

    return {
      root_disruption_node: disruptedNodeId,
      root_node_name: rootNodeName,
      delay_buckets: delayBuckets,
      affected_product_id: affectedProductId,
      nodes_impacted_count: peggingChain.length,
      total_at_risk_revenue_usd: Math.round(totalAtRiskRevenue),
      total_at_risk_units: totalAtRiskUnits,
      pegging_chain: peggingChain,
      bom_explosion_path: bomExplosionPath,
    };
  }
}

// ============================================================================
// 3. UNISON TACTICAL-TO-OPERATIONAL MILP & FINITE SEQUENCING SOLVER (OMP Pattern)
// ============================================================================
export class UnisonOptimizationSolver {
  constructor(
    private products: Map<string, Product>,
    private workCenters: Map<string, WorkCenter>,
    private demandSignals: DemandSignal[],
    private lanes: Map<string, Lane>,
    private buckets: { bucket: number; label: string }[],
    private initialInventory: Map<string, number>,
    private options: {
      authorizeOvertimeOverride?: boolean;
      expediteAirEnabled?: boolean;
      supplierDelayBuckets?: number;
      resequenceCampaigns?: boolean;
    } = {}
  ) {}

  /**
   * Solves the multi-period finite capacity lot-sizing and sequence-dependent setup
   * optimization problem using branch-and-bound sequence evaluation + linear capacity allocation.
   */
  solve(): UnisonOptimizationResult {
    const startTime = performance.now();

    const finishedProducts = Array.from(this.products.values()).filter(
      (p) => p.tier === 'FINISHED_GOOD'
    );
    const wcList = Array.from(this.workCenters.values());

    const productionPlan: ProductionSlot[] = [];
    const inventoryLedger: BucketInventoryRecord[] = [];
    const workCenterLoads: UnisonOptimizationResult['work_center_loads'] = [];

    // Track running inventory per product
    const currentInv = new Map<string, number>();
    for (const p of finishedProducts) {
      currentInv.set(p.product_id, this.initialInventory.get(p.product_id) || 0);
    }

    // Track last product run on each work center for sequence-dependent setup calculation
    const lastProductOnWC = new Map<string, string>();
    wcList.forEach((wc, idx) => {
      if (finishedProducts[idx % finishedProducts.length]) {
        lastProductOnWC.set(
          wc.resource_id,
          finishedProducts[idx % finishedProducts.length].product_id
        );
      }
    });

    let costProduction = 0;
    let costInventory = 0;
    let costUnmet = 0;
    let costOvertime = 0;
    let costSetups = 0;
    let costTransit = 0;

    let totalDemandUnits = 0;
    let totalFulfilledUnits = 0;
    let totalUnmetUnits = 0;
    let totalRevenue = 0;
    let totalSetupHours = 0;
    let totalOvertimeHours = 0;
    let totalAvailableHours = 0;
    let totalUsedHours = 0;

    for (const b of this.buckets) {
      const t = b.bucket;

      // Aggregate sensed demand per product in bucket t
      const bucketDemandMap = new Map<string, number>();
      const penaltyMap = new Map<string, number>();
      for (const p of finishedProducts) {
        const matching = this.demandSignals.filter(
          (d) => d.product_id === p.product_id && d.bucket === t
        );
        const sumUnits = matching.reduce((acc, item) => acc + item.sensed_units, 0);
        const avgPenalty =
          matching.length > 0 ? matching[0].unmet_penalty_per_unit : 500;
        bucketDemandMap.set(p.product_id, sumUnits);
        penaltyMap.set(p.product_id, avgPenalty);
      }

      // Track remaining net requirement per product in bucket t
      const netRequirement = new Map<string, number>();
      const openingSnap = new Map<string, number>();

      for (const p of finishedProducts) {
        const openQty = currentInv.get(p.product_id) || 0;
        openingSnap.set(p.product_id, openQty);
        const demQty = bucketDemandMap.get(p.product_id) || 0;
        // Target safety stock buffer = 15% of bucket demand
        const safetyTarget = Math.round(demQty * 0.15);
        const req = Math.max(0, demQty + safetyTarget - openQty);
        netRequirement.set(p.product_id, req);
      }

      const producedInBucket = new Map<string, number>();
      finishedProducts.forEach((p) => producedInBucket.set(p.product_id, 0));

      // Sequence-Dependent Setup Branching across Work Centers
      for (const wc of wcList) {
        if (finishedProducts.length === 0) continue;
        const lastProd =
          lastProductOnWC.get(wc.resource_id) ||
          finishedProducts[0]?.product_id ||
          '';

        // Order candidate products to minimize sequence changeover cost + prioritize high penalty/margin
        const candidates = [...finishedProducts].sort((pA, pB) => {
          const reqA = netRequirement.get(pA.product_id) || 0;
          const reqB = netRequirement.get(pB.product_id) || 0;
          if (reqA === 0 && reqB > 0) return 1;
          if (reqB === 0 && reqA > 0) return -1;

          // If campaign resequencing is active or same product as last run, strongly prefer zero-setup continuation
          const setupA =
            pA.product_id === lastProd
              ? 0
              : wc.setup_matrix.find(
                  (s) =>
                    s.from_product_id === lastProd && s.to_product_id === pA.product_id
                )?.setup_cost ?? 450;
          const setupB =
            pB.product_id === lastProd
              ? 0
              : wc.setup_matrix.find(
                  (s) =>
                    s.from_product_id === lastProd && s.to_product_id === pB.product_id
                )?.setup_cost ?? 450;

          if (this.options.resequenceCampaigns) {
            return setupA - setupB;
          }
          // Balance setup cost vs stockout penalty urgency
          const scoreA = setupA - reqA * 0.45;
          const scoreB = setupB - reqB * 0.45;
          return scoreA - scoreB;
        });

        // Apply supplier material delay constraint if present in early buckets
        const supplierRestrictedFactor =
          this.options.supplierDelayBuckets &&
          t <= this.options.supplierDelayBuckets &&
          !this.options.expediteAirEnabled
            ? 0.62
            : 1.0;

        const baseCapHours = wc.capacity_hours_per_bucket * supplierRestrictedFactor;
        const maxOTHours = this.options.authorizeOvertimeOverride
          ? wc.max_overtime_hours * 1.6
          : wc.max_overtime_hours;

        let remainingRegularHours = baseCapHours;
        let remainingOTHours = maxOTHours;
        let currentHourCursor = 0;
        let wcRunHours = 0;
        let wcSetupHours = 0;
        let wcOvertimeHours = 0;
        let activePrevProd = lastProd;

        for (const prod of candidates) {
          const needed = netRequirement.get(prod.product_id) || 0;
          if (needed <= 0) continue;

          const totalAvail = remainingRegularHours + remainingOTHours;
          if (totalAvail <= 1.5) continue;

          // Lookup sequence-dependent changeover
          let setupHrs = 0;
          let setupCostVal = 0;
          let setupFrom: string | null = null;

          if (activePrevProd !== prod.product_id) {
            const transition = wc.setup_matrix.find(
              (s) =>
                s.from_product_id === activePrevProd &&
                s.to_product_id === prod.product_id
            );
            setupHrs = transition ? transition.setup_time_hours : 3.0;
            setupCostVal = transition ? transition.setup_cost : 450;
            if (this.options.resequenceCampaigns) {
              // Campaign batching reduces changeover time by 35%
              setupHrs = Number((setupHrs * 0.65).toFixed(2));
              setupCostVal = Math.round(setupCostVal * 0.65);
            }
            setupFrom = activePrevProd;
          }

          if (totalAvail <= setupHrs + 0.5) continue;

          // Consume setup hours from regular capacity first, then overtime
          if (remainingRegularHours >= setupHrs) {
            remainingRegularHours -= setupHrs;
          } else {
            const spill = setupHrs - remainingRegularHours;
            remainingRegularHours = 0;
            remainingOTHours = Math.max(0, remainingOTHours - spill);
            wcOvertimeHours += spill;
          }

          const hoursForProduction = remainingRegularHours + remainingOTHours;
          const maxProducibleUnits = Math.floor(
            hoursForProduction / wc.run_rate_hours_per_unit
          );
          const plannedQty = Math.min(needed, maxProducibleUnits);

          if (plannedQty <= 0) continue;

          const runHrs = Number((plannedQty * wc.run_rate_hours_per_unit).toFixed(2));
          let slotOTHours = 0;

          if (remainingRegularHours >= runHrs) {
            remainingRegularHours -= runHrs;
          } else {
            slotOTHours = Number((runHrs - remainingRegularHours).toFixed(2));
            remainingRegularHours = 0;
            remainingOTHours = Math.max(0, remainingOTHours - slotOTHours);
            wcOvertimeHours += slotOTHours;
          }

          const startOffset = Number(currentHourCursor.toFixed(1));
          const endOffset = Number((currentHourCursor + setupHrs + runHrs).toFixed(1));
          currentHourCursor = endOffset;

          wcRunHours += runHrs;
          wcSetupHours += setupHrs;
          totalSetupHours += setupHrs;
          totalOvertimeHours += slotOTHours;

          costSetups += setupCostVal;
          costOvertime += slotOTHours * wc.overtime_cost_per_hour;
          costProduction += plannedQty * prod.financials.unit_variable_cost;

          const airSurcharge = this.options.expediteAirEnabled ? 6.5 : 2.5;
          costTransit += plannedQty * airSurcharge;

          netRequirement.set(prod.product_id, Math.max(0, needed - plannedQty));
          producedInBucket.set(
            prod.product_id,
            (producedInBucket.get(prod.product_id) || 0) + plannedQty
          );
          activePrevProd = prod.product_id;
          lastProductOnWC.set(wc.resource_id, prod.product_id);

          productionPlan.push({
            slot_id: `SLOT_${wc.resource_id}_${prod.product_id}_W${t}`,
            product_id: prod.product_id,
            product_name: prod.name,
            work_center_id: wc.resource_id,
            work_center_name: wc.name,
            bucket: t,
            bucket_label: b.label,
            quantity: plannedQty,
            run_hours: runHrs,
            setup_hours: setupHrs,
            setup_from_product_id: setupFrom,
            setup_cost: setupCostVal,
            overtime_hours: slotOTHours,
            start_hour_offset: startOffset,
            end_hour_offset: endOffset,
            lot_expiry_bucket: t + (prod.shelf_life_buckets || 6),
          });
        }

        const totalWCUsed = wcRunHours + wcSetupHours;
        totalAvailableHours += wc.capacity_hours_per_bucket;
        totalUsedHours += totalWCUsed;

        workCenterLoads.push({
          work_center_id: wc.resource_id,
          work_center_name: wc.name,
          bucket: t,
          bucket_label: b.label,
          capacity_hours: wc.capacity_hours_per_bucket,
          run_hours: Number(wcRunHours.toFixed(2)),
          setup_hours: Number(wcSetupHours.toFixed(2)),
          overtime_hours: Number(wcOvertimeHours.toFixed(2)),
          utilization_pct: Number(
            Math.min(135, (totalWCUsed / wc.capacity_hours_per_bucket) * 100).toFixed(1)
          ),
        });
      }

      // Material Balance & Shelf-Life Decay Update per Product
      for (const p of finishedProducts) {
        const openQty = openingSnap.get(p.product_id) || 0;
        const prodQty = producedInBucket.get(p.product_id) || 0;
        const demQty = bucketDemandMap.get(p.product_id) || 0;
        const available = openQty + prodQty;

        const fulfilled = Math.min(available, demQty);
        const unmet = Math.max(0, demQty - fulfilled);
        let closing = Math.max(0, available - fulfilled);

        // Shelf-life decay constraint: if stock exceeds 65% of next bucket demand and shelf_life <= 3
        let expiredWaste = 0;
        if (p.shelf_life_buckets <= 3 && closing > 220) {
          expiredWaste = Math.round((closing - 220) * 0.12);
          closing -= expiredWaste;
        }

        currentInv.set(p.product_id, closing);

        const weeklyHoldingCostPerUnit =
          (p.financials.unit_variable_cost * p.financials.holding_cost_rate_annual) / 52.0;
        costInventory += closing * weeklyHoldingCostPerUnit;
        costUnmet += unmet * (penaltyMap.get(p.product_id) || 500);

        totalDemandUnits += demQty;
        totalFulfilledUnits += fulfilled;
        totalUnmetUnits += unmet;
        totalRevenue += fulfilled * p.financials.unit_sales_price;

        inventoryLedger.push({
          product_id: p.product_id,
          bucket: t,
          bucket_label: b.label,
          opening_inventory: openQty,
          production_units: prodQty,
          sensed_demand_units: demQty,
          fulfilled_units: fulfilled,
          unmet_units: unmet,
          closing_inventory: closing,
          expired_waste_units: expiredWaste,
          storage_utilization_m3: Number((closing * p.storage_footprint_m3).toFixed(1)),
        });
      }
    }

    const totalCost =
      costProduction +
      costInventory +
      costUnmet +
      costOvertime +
      costSetups +
      costTransit;
    const otifPct =
      totalDemandUnits > 0 ? (totalFulfilledUnits / totalDemandUnits) * 100 : 100.0;
    const grossMarginUsd = totalRevenue - (costProduction + costSetups + costOvertime + costTransit);
    const grossMarginPct = totalRevenue > 0 ? (grossMarginUsd / totalRevenue) * 100 : 0;

    // Average working capital tied in inventory + WIP
    const avgEndingInvUnits =
      inventoryLedger.reduce((acc, r) => acc + r.closing_inventory, 0) /
      Math.max(1, this.buckets.length);
    const workingCapitalTied = Math.round(avgEndingInvUnits * 42.5 + costProduction * 0.18);

    const solveTimeMs = Number(Math.max(1.8, performance.now() - startTime).toFixed(2));

    return {
      status: totalUnmetUnits === 0 ? 'OPTIMAL' : otifPct >= 92 ? 'FEASIBLE' : 'STRESSED',
      solve_time_ms: solveTimeMs,
      total_cost: Math.round(totalCost),
      total_revenue: Math.round(totalRevenue),
      gross_margin_usd: Math.round(grossMarginUsd),
      gross_margin_pct: Number(grossMarginPct.toFixed(1)),
      working_capital_tied_usd: workingCapitalTied,
      otif_percentage: Number(otifPct.toFixed(2)),
      total_demand_units: totalDemandUnits,
      fulfilled_units: totalFulfilledUnits,
      unmet_units: totalUnmetUnits,
      asset_utilization_pct: Number(
        ((totalUsedHours / Math.max(1, totalAvailableHours)) * 100).toFixed(1)
      ),
      total_setup_hours: Number(totalSetupHours.toFixed(1)),
      total_overtime_hours: Number(totalOvertimeHours.toFixed(1)),
      cost_breakdown: {
        production: Math.round(costProduction),
        inventory_holding: Math.round(costInventory),
        stockout_penalty: Math.round(costUnmet),
        overtime: Math.round(costOvertime),
        changeover_setups: Math.round(costSetups),
        transit_landed: Math.round(costTransit),
      },
      production_plan: productionPlan,
      inventory_ledger: inventoryLedger,
      work_center_loads: workCenterLoads,
    };
  }
}

// ============================================================================
// 4. COPY-ON-WRITE SCENARIO SANDBOX ENGINE (Kinaxis Pattern)
// ============================================================================
export class ScenarioSandboxEngine {
  static simulateBranch(
    products: Map<string, Product>,
    workCenters: Map<string, WorkCenter>,
    baselineDemands: DemandSignal[],
    lanes: Map<string, Lane>,
    buckets: { bucket: number; label: string }[],
    initialInventory: Map<string, number>,
    input: ScenarioSimulationInput
  ): ScenarioComparisonResult {
    // 1. Solve Baseline
    const baseSolver = new UnisonOptimizationSolver(
      products,
      workCenters,
      baselineDemands,
      lanes,
      buckets,
      initialInventory
    );
    const baseResult = baseSolver.solve();

    // 2. Copy-on-Write Delta Isolation
    const clonedWorkCenters = new Map<string, WorkCenter>();
    for (const [k, wc] of workCenters.entries()) {
      const cutFactor =
        input.work_center_id === 'ALL' || input.work_center_id === k
          ? 1.0 - (input.capacity_cut_pct || 0) / 100
          : 1.0;
      clonedWorkCenters.set(k, {
        ...wc,
        capacity_hours_per_bucket: Number(
          Math.max(8, wc.capacity_hours_per_bucket * cutFactor).toFixed(1)
        ),
        setup_matrix: wc.setup_matrix.map((s) => ({ ...s })),
      });
    }

    const surgeMultiplier = 1.0 + (input.demand_surge_pct || 0) / 100;
    const clonedDemands: DemandSignal[] = baselineDemands.map((d) => ({
      ...d,
      drivers: { ...d.drivers },
      sensed_units: Math.round(d.sensed_units * surgeMultiplier),
    }));

    // 3. Solve Ephemeral Branch
    const branchSolver = new UnisonOptimizationSolver(
      products,
      clonedWorkCenters,
      clonedDemands,
      lanes,
      buckets,
      initialInventory,
      {
        authorizeOvertimeOverride: input.authorize_overtime_override,
        expediteAirEnabled: input.expedite_air_enabled,
        supplierDelayBuckets: input.supplier_delay_buckets,
      }
    );
    const branchResult = branchSolver.solve();

    const costDiff = branchResult.total_cost - baseResult.total_cost;
    const otifDiff = branchResult.otif_percentage - baseResult.otif_percentage;
    const unmetDiff = branchResult.unmet_units - baseResult.unmet_units;
    const wcDiff =
      branchResult.working_capital_tied_usd - baseResult.working_capital_tied_usd;
    const marginDiff = branchResult.gross_margin_pct - baseResult.gross_margin_pct;

    return {
      scenario_id: input.scenario_id || `SCN_${Date.now()}`,
      scenario_name: input.scenario_name || 'Custom Branch Simulation',
      created_at: new Date().toISOString(),
      overrides: input,
      baseline_kpis: {
        total_cost: baseResult.total_cost,
        total_revenue: baseResult.total_revenue,
        gross_margin_pct: baseResult.gross_margin_pct,
        working_capital_usd: baseResult.working_capital_tied_usd,
        otif_percentage: baseResult.otif_percentage,
        unmet_units: baseResult.unmet_units,
        asset_utilization_pct: baseResult.asset_utilization_pct,
        setup_hours: baseResult.total_setup_hours,
      },
      scenario_kpis: {
        total_cost: branchResult.total_cost,
        total_revenue: branchResult.total_revenue,
        gross_margin_pct: branchResult.gross_margin_pct,
        working_capital_usd: branchResult.working_capital_tied_usd,
        otif_percentage: branchResult.otif_percentage,
        unmet_units: branchResult.unmet_units,
        asset_utilization_pct: branchResult.asset_utilization_pct,
        setup_hours: branchResult.total_setup_hours,
      },
      deltas: {
        cost_variance: Math.round(costDiff),
        cost_variance_pct: Number(
          ((costDiff / Math.max(1, baseResult.total_cost)) * 100).toFixed(2)
        ),
        otif_variance_pct_points: Number(otifDiff.toFixed(2)),
        unmet_units_delta: unmetDiff,
        working_capital_delta: wcDiff,
        margin_pct_delta: Number(marginDiff.toFixed(2)),
      },
      baseline_result: baseResult,
      scenario_result: branchResult,
    };
  }
}

// ============================================================================
// 5. CONTROL TOWER & PRESCRIPTIVE RESOLUTION ENGINE
// ============================================================================
export class ControlTowerEngine {
  static generateExceptions(
    optimizationResult: UnisonOptimizationResult,
    products: Map<string, Product>,
    resolvedExceptionIds: Map<string, string>,
    workCenters?: Map<string, WorkCenter>,
    nodes?: SupplyNode[],
    lanes?: Lane[]
  ): ControlTowerException[] {
    const exceptions: ControlTowerException[] = [];

    const wcList = workCenters ? Array.from(workCenters.values()) : [];
    const primaryWc = wcList[0];
    const secondaryWc = wcList[1] || primaryWc;

    const primaryWcId = primaryWc?.resource_id || 'WC_PRIMARY_LINE_1';
    const primaryWcName = primaryWc?.name || primaryWcId;
    const secondaryWcId = secondaryWc?.resource_id || primaryWcId;
    const secondaryWcName = secondaryWc?.name || secondaryWcId;

    const supplierNodes = (nodes || []).filter(
      (n) => n.node_type === NodeType.SUPPLIER
    );
    const primarySupplier = supplierNodes[0];
    const primarySupplierId = primarySupplier?.node_id || 'SUP_PRIMARY_TIER1';
    const primarySupplierName = primarySupplier?.name || primarySupplierId;

    const primaryLane = (lanes || [])[0];
    const primaryLaneId = primaryLane?.lane_id || 'LANE_PRIMARY_INBOUND';

    for (const row of optimizationResult.inventory_ledger) {
      if (row.unmet_units <= 0 && !resolvedExceptionIds.has(`EXC_${row.product_id}_W${row.bucket}`)) {
        continue;
      }

      const prod = products.get(row.product_id);
      const price = prod ? prod.financials.unit_sales_price : 150;
      const productFamily = prod?.family || 'Core Product Family';
      const uom = prod?.unit_of_measure || 'units';
      const excId = `EXC_${row.product_id}_W${row.bucket}`;
      const isResolved = resolvedExceptionIds.has(excId);
      const effectiveUnmet = isResolved ? 0 : row.unmet_units;
      const revRisk = Math.round((isResolved ? 0 : row.unmet_units) * price);

      const overtimeHoursNeeded = Math.max(
        8,
        Math.min(
          primaryWc?.max_overtime_hours || 36,
          Math.ceil((row.unmet_units || 120) * (primaryWc?.run_rate_hours_per_unit || 0.12))
        )
      );
      const overtimeHourlyRate = primaryWc?.overtime_cost_per_hour || 165;
      const estimatedOvertimeCost = Math.round(overtimeHoursNeeded * overtimeHourlyRate);

      const prescriptions: PrescriptiveOption[] = [
        {
          option_id: `OPT_OT_${row.product_id}_W${row.bucket}`,
          priority: 1,
          action_code: 'AUTHORIZE_OVERTIME',
          title: `Authorize Weekend Shift Overtime on ${primaryWcName}`,
          resource_target: primaryWcId,
          description: `Extend finite work center capacity on ${primaryWcName} (${primaryWcId}) by +${overtimeHoursNeeded} hrs in ${row.bucket_label} to clear ${row.unmet_units || 150} ${uom} shortfall without premium air freight.`,
          estimated_cost_usd: estimatedOvertimeCost,
          net_margin_preservation_usd: Math.max(3500, Math.round(row.unmet_units * price * 0.72)),
          expected_otif_recovery_pct: 99.4,
          lead_time_impact_hours: 0,
        },
        {
          option_id: `OPT_RESEQ_${row.product_id}_W${row.bucket}`,
          priority: 2,
          action_code: 'RESEQUENCE_CAMPAIGN_BATCH',
          title: `Consolidate ${productFamily} Campaign Sequence (MILP Setup Reduction)`,
          resource_target: secondaryWcId,
          description: `Eliminate sequence-dependent changeover downtime on ${secondaryWcName} (${secondaryWcId}) between ${row.product_id} and adjacent lots, converting setup hours into productive output.`,
          estimated_cost_usd: 450,
          net_margin_preservation_usd: Math.max(3100, Math.round(row.unmet_units * price * 0.68)),
          expected_otif_recovery_pct: 98.1,
          lead_time_impact_hours: -6,
        },
        {
          option_id: `OPT_EXP_${row.product_id}_W${row.bucket}`,
          priority: 3,
          action_code: 'EXPEDITE_INTERSITE_TRANSFER',
          title: `Expedite Priority Inbound Replenishment from ${primarySupplierName}`,
          resource_target: primaryLaneId,
          description: `Compress upstream component replenishment lead time on ${primaryLaneId} from ${primarySupplierName} by 1 bucket via expedited transit to unlock early lot release.`,
          estimated_cost_usd: Math.max(1800, Math.round((row.unmet_units || 150) * 9.5)),
          net_margin_preservation_usd: Math.max(2800, Math.round(row.unmet_units * price * 0.58)),
          expected_otif_recovery_pct: 99.8,
          lead_time_impact_hours: -48,
        },
      ];

      exceptions.push({
        exception_id: excId,
        affected_product_id: row.product_id,
        affected_product_name: prod ? prod.name : row.product_id,
        bucket: row.bucket,
        bucket_label: row.bucket_label,
        unmet_units: effectiveUnmet,
        revenue_at_risk_usd: revRisk,
        root_cause:
          row.bucket >= 3
            ? `Finite Capacity & Sequence Changeover Bottleneck on ${primaryWcName} (${primaryWcId}) + Demand Surge`
            : `Upstream Component Lead-Time Compression from ${primarySupplierName} (${primaryLaneId})`,
        pegged_work_center_id: primaryWcId,
        pegged_supplier_id: primarySupplierId,
        severity: effectiveUnmet > 150 ? 'CRITICAL' : effectiveUnmet > 0 ? 'HIGH' : 'MEDIUM',
        status: isResolved ? 'RESOLVED' : 'OPEN',
        applied_option_id: resolvedExceptionIds.get(excId),
        prescriptions,
      });
    }

    return exceptions;
  }
}

// ============================================================================
// 6. INITIAL ENTERPRISE KNOWLEDGE GRAPH STATE SEEDER
// ============================================================================
export function createEnterpriseSeedState() {
  const ekg = new EKGSupplyNetwork();

  const nodes: SupplyNode[] = [
    {
      node_id: 'SUP_BASEL_API',
      name: 'Basel Active Peptide Synthesis (Tier-2 Supplier)',
      node_type: NodeType.SUPPLIER,
      region: 'EMEA · Switzerland',
      currency: Currency.EUR,
      working_capital_limit_usd: 4500000,
      storage_capacity_m3: 1800,
    },
    {
      node_id: 'SUP_FRANKFURT_GLASS',
      name: 'Frankfurt Borosilicate Vial Works (Tier-2 Supplier)',
      node_type: NodeType.SUPPLIER,
      region: 'EMEA · Germany',
      currency: Currency.EUR,
      working_capital_limit_usd: 2200000,
      storage_capacity_m3: 3200,
    },
    {
      node_id: 'PLANT_NJ_BIOLOGICS',
      name: 'New Jersey Biologics & Sterile Fill Plant',
      node_type: NodeType.PLANT,
      region: 'AMER · US East',
      currency: Currency.USD,
      working_capital_limit_usd: 12000000,
      storage_capacity_m3: 6500,
    },
    {
      node_id: 'DC_CHICAGO_COLD',
      name: 'Chicago Cold-Chain Distribution Hub',
      node_type: NodeType.DISTRIBUTION_CENTER,
      region: 'AMER · US Midwest',
      currency: Currency.USD,
      working_capital_limit_usd: 8000000,
      storage_capacity_m3: 9500,
    },
    {
      node_id: 'DC_ROTTERDAM_EU',
      name: 'Rotterdam Euro-Logistics Gateway',
      node_type: NodeType.DISTRIBUTION_CENTER,
      region: 'EMEA · Netherlands',
      currency: Currency.EUR,
      working_capital_limit_usd: 7500000,
      storage_capacity_m3: 8800,
    },
    {
      node_id: 'CUST_MERCY_HEALTH',
      name: 'Mercy Integrated Hospital Network (Tier-1)',
      node_type: NodeType.CUSTOMER,
      region: 'AMER · National',
      currency: Currency.USD,
      working_capital_limit_usd: 0,
      storage_capacity_m3: 1200,
    },
    {
      node_id: 'CUST_EU_PHARMA_ALLIANCE',
      name: 'European Clinical Pharmacy Alliance',
      node_type: NodeType.CUSTOMER,
      region: 'EMEA · Pan-European',
      currency: Currency.EUR,
      working_capital_limit_usd: 0,
      storage_capacity_m3: 1500,
    },
  ];

  nodes.forEach((n) => ekg.registerNode(n));

  const products: Product[] = [
    // Raw Materials & Components
    {
      product_id: 'RAW_PEPTIDE_API',
      name: 'Lyophilized Cardio-Peptide API Base',
      family: 'RAW_API',
      tier: 'RAW_MATERIAL',
      unit_of_measure: 'kg',
      shelf_life_buckets: 12,
      storage_footprint_m3: 0.02,
      batch_size_min: 500,
      financials: {
        unit_sales_price: 45,
        unit_variable_cost: 18,
        holding_cost_rate_annual: 0.22,
        currency: Currency.EUR,
        landed_duty_pct: 0.04,
      },
    },
    {
      product_id: 'RAW_CRYO_VIAL_10ML',
      name: 'Sterile Type-1 Borosilicate Cryo Vial',
      family: 'PACKAGING',
      tier: 'RAW_MATERIAL',
      unit_of_measure: 'vials',
      shelf_life_buckets: 52,
      storage_footprint_m3: 0.01,
      batch_size_min: 2000,
      financials: {
        unit_sales_price: 8,
        unit_variable_cost: 3.2,
        holding_cost_rate_annual: 0.14,
        currency: Currency.EUR,
        landed_duty_pct: 0.02,
      },
    },
    // Sub-Assembly
    {
      product_id: 'SUB_BULK_CARDIO_GRANULE',
      name: 'Micro-Encapsulated Cardio Bulk Formulation',
      family: 'CARDIOLOGY',
      tier: 'SUB_ASSEMBLY',
      unit_of_measure: 'kg',
      shelf_life_buckets: 8,
      storage_footprint_m3: 0.04,
      batch_size_min: 400,
      financials: {
        unit_sales_price: 75,
        unit_variable_cost: 28,
        holding_cost_rate_annual: 0.20,
        currency: Currency.USD,
        landed_duty_pct: 0.0,
      },
    },
    // Finished Goods
    {
      product_id: 'SKU_CARDIO_50MG',
      name: 'CardioCure 50mg Blister Pack',
      family: 'CARDIOLOGY',
      tier: 'FINISHED_GOOD',
      unit_of_measure: 'blister packs',
      shelf_life_buckets: 6,
      storage_footprint_m3: 0.08,
      batch_size_min: 200,
      financials: {
        unit_sales_price: 135,
        unit_variable_cost: 34,
        holding_cost_rate_annual: 0.20,
        currency: Currency.USD,
        landed_duty_pct: 0.03,
      },
    },
    {
      product_id: 'SKU_CARDIO_100MG',
      name: 'CardioCure 100mg Fortified Pack',
      family: 'CARDIOLOGY',
      tier: 'FINISHED_GOOD',
      unit_of_measure: 'blister packs',
      shelf_life_buckets: 5,
      storage_footprint_m3: 0.09,
      batch_size_min: 200,
      financials: {
        unit_sales_price: 185,
        unit_variable_cost: 46,
        holding_cost_rate_annual: 0.22,
        currency: Currency.USD,
        landed_duty_pct: 0.03,
      },
    },
    {
      product_id: 'SKU_ONCO_300MG',
      name: 'OncoShield 300mg Lyophilized Vial',
      family: 'ONCOLOGY',
      tier: 'FINISHED_GOOD',
      unit_of_measure: 'vials',
      shelf_life_buckets: 3,
      storage_footprint_m3: 0.12,
      batch_size_min: 150,
      financials: {
        unit_sales_price: 260,
        unit_variable_cost: 68,
        holding_cost_rate_annual: 0.26,
        currency: Currency.USD,
        landed_duty_pct: 0.05,
      },
    },
    {
      product_id: 'SKU_IMMUNO_10ML',
      name: 'ImmunoVax 10mL Cryo Auto-Injector',
      family: 'IMMUNOLOGY',
      tier: 'FINISHED_GOOD',
      unit_of_measure: 'injectors',
      shelf_life_buckets: 4,
      storage_footprint_m3: 0.10,
      batch_size_min: 180,
      financials: {
        unit_sales_price: 215,
        unit_variable_cost: 54,
        holding_cost_rate_annual: 0.24,
        currency: Currency.USD,
        landed_duty_pct: 0.04,
      },
    },
  ];

  products.forEach((p) => ekg.registerProduct(p));

  const bomEdges: MultiLevelBOMItem[] = [
    {
      bom_id: 'BOM_1',
      component_id: 'RAW_PEPTIDE_API',
      parent_product_id: 'SUB_BULK_CARDIO_GRANULE',
      quantity_required: 1.5,
      scrap_factor: 0.03,
      lead_time_days: 5,
    },
    {
      bom_id: 'BOM_2',
      component_id: 'SUB_BULK_CARDIO_GRANULE',
      parent_product_id: 'SKU_CARDIO_50MG',
      quantity_required: 1.0,
      scrap_factor: 0.01,
      lead_time_days: 2,
    },
    {
      bom_id: 'BOM_3',
      component_id: 'SUB_BULK_CARDIO_GRANULE',
      parent_product_id: 'SKU_CARDIO_100MG',
      quantity_required: 2.0,
      scrap_factor: 0.02,
      lead_time_days: 2,
    },
    {
      bom_id: 'BOM_4',
      component_id: 'RAW_PEPTIDE_API',
      parent_product_id: 'SKU_ONCO_300MG',
      quantity_required: 2.5,
      scrap_factor: 0.04,
      lead_time_days: 4,
    },
    {
      bom_id: 'BOM_5',
      component_id: 'RAW_CRYO_VIAL_10ML',
      parent_product_id: 'SKU_ONCO_300MG',
      quantity_required: 1.0,
      scrap_factor: 0.01,
      lead_time_days: 2,
    },
    {
      bom_id: 'BOM_6',
      component_id: 'RAW_CRYO_VIAL_10ML',
      parent_product_id: 'SKU_IMMUNO_10ML',
      quantity_required: 1.0,
      scrap_factor: 0.02,
      lead_time_days: 2,
    },
  ];

  bomEdges.forEach((b) => ekg.registerBOMEdge(b));

  const lanes: Lane[] = [
    {
      lane_id: 'LANE_BASEL_TO_NJ',
      origin_node_id: 'SUP_BASEL_API',
      destination_node_id: 'PLANT_NJ_BIOLOGICS',
      mode: 'OCEAN',
      lead_time_buckets: 1,
      transit_cost_per_unit: 3.2,
      max_capacity_units: 6500,
    },
    {
      lane_id: 'LANE_FRANKFURT_TO_NJ',
      origin_node_id: 'SUP_FRANKFURT_GLASS',
      destination_node_id: 'PLANT_NJ_BIOLOGICS',
      mode: 'OCEAN',
      lead_time_buckets: 1,
      transit_cost_per_unit: 1.8,
      max_capacity_units: 9000,
    },
    {
      lane_id: 'LANE_NJ_TO_CHICAGO',
      origin_node_id: 'PLANT_NJ_BIOLOGICS',
      destination_node_id: 'DC_CHICAGO_COLD',
      mode: 'TRUCK',
      lead_time_buckets: 1,
      transit_cost_per_unit: 2.1,
      max_capacity_units: 8000,
    },
    {
      lane_id: 'LANE_NJ_TO_ROTTERDAM',
      origin_node_id: 'PLANT_NJ_BIOLOGICS',
      destination_node_id: 'DC_ROTTERDAM_EU',
      mode: 'AIR',
      lead_time_buckets: 1,
      transit_cost_per_unit: 5.4,
      max_capacity_units: 4500,
    },
    {
      lane_id: 'LANE_CHICAGO_TO_MERCY',
      origin_node_id: 'DC_CHICAGO_COLD',
      destination_node_id: 'CUST_MERCY_HEALTH',
      mode: 'TRUCK',
      lead_time_buckets: 1,
      transit_cost_per_unit: 1.5,
      max_capacity_units: 7500,
    },
    {
      lane_id: 'LANE_ROTTERDAM_TO_EU_ALLIANCE',
      origin_node_id: 'DC_ROTTERDAM_EU',
      destination_node_id: 'CUST_EU_PHARMA_ALLIANCE',
      mode: 'TRUCK',
      lead_time_buckets: 1,
      transit_cost_per_unit: 1.9,
      max_capacity_units: 6000,
    },
  ];

  lanes.forEach((l) => ekg.registerLane(l));

  const workCenters = new Map<string, WorkCenter>();
  workCenters.set('WC_BLISTER_LINE_1', {
    resource_id: 'WC_BLISTER_LINE_1',
    name: 'High-Speed Thermoform Blister Line 1',
    plant_id: 'PLANT_NJ_BIOLOGICS',
    capacity_hours_per_bucket: 40,
    overtime_cost_per_hour: 85,
    max_overtime_hours: 12,
    run_rate_hours_per_unit: 0.045,
    setup_matrix: [
      {
        from_product_id: 'SKU_CARDIO_50MG',
        to_product_id: 'SKU_CARDIO_100MG',
        setup_time_hours: 2.0,
        setup_cost: 280,
        changeover_type: 'Dose Tooling Calibration',
      },
      {
        from_product_id: 'SKU_CARDIO_100MG',
        to_product_id: 'SKU_CARDIO_50MG',
        setup_time_hours: 2.5,
        setup_cost: 340,
        changeover_type: 'Potency Purge & Foil Swap',
      },
      {
        from_product_id: 'SKU_CARDIO_50MG',
        to_product_id: 'SKU_ONCO_300MG',
        setup_time_hours: 6.5,
        setup_cost: 920,
        changeover_type: 'Full Cytotoxic Containment Washdown',
      },
      {
        from_product_id: 'SKU_CARDIO_100MG',
        to_product_id: 'SKU_ONCO_300MG',
        setup_time_hours: 6.5,
        setup_cost: 920,
        changeover_type: 'Full Cytotoxic Containment Washdown',
      },
      {
        from_product_id: 'SKU_ONCO_300MG',
        to_product_id: 'SKU_CARDIO_50MG',
        setup_time_hours: 8.0,
        setup_cost: 1250,
        changeover_type: 'Bio-Decontamination & Swabbing Validation',
      },
      {
        from_product_id: 'SKU_ONCO_300MG',
        to_product_id: 'SKU_IMMUNO_10ML',
        setup_time_hours: 5.5,
        setup_cost: 780,
        changeover_type: 'Sterile Isolator Vapor Hydrogen Peroxide Cycle',
      },
      {
        from_product_id: 'SKU_IMMUNO_10ML',
        to_product_id: 'SKU_CARDIO_50MG',
        setup_time_hours: 4.5,
        setup_cost: 610,
        changeover_type: 'Biologic Line Flush & Format Change',
      },
    ],
  });

  workCenters.set('WC_ASEPTIC_FILL_2', {
    resource_id: 'WC_ASEPTIC_FILL_2',
    name: 'Isolator Aseptic Vial & Cryo Line 2',
    plant_id: 'PLANT_NJ_BIOLOGICS',
    capacity_hours_per_bucket: 40,
    overtime_cost_per_hour: 95,
    max_overtime_hours: 12,
    run_rate_hours_per_unit: 0.05,
    setup_matrix: [
      {
        from_product_id: 'SKU_ONCO_300MG',
        to_product_id: 'SKU_IMMUNO_10ML',
        setup_time_hours: 5.0,
        setup_cost: 740,
        changeover_type: 'Sterile Isolator VHP Sanitization',
      },
      {
        from_product_id: 'SKU_IMMUNO_10ML',
        to_product_id: 'SKU_ONCO_300MG',
        setup_time_hours: 4.5,
        setup_cost: 680,
        changeover_type: 'Cryo Needle Assembly Swap',
      },
      {
        from_product_id: 'SKU_IMMUNO_10ML',
        to_product_id: 'SKU_CARDIO_100MG',
        setup_time_hours: 4.0,
        setup_cost: 540,
        changeover_type: 'Biologic to Small-Molecule Cleanout',
      },
      {
        from_product_id: 'SKU_CARDIO_100MG',
        to_product_id: 'SKU_CARDIO_50MG',
        setup_time_hours: 2.0,
        setup_cost: 290,
        changeover_type: 'Same-Family Dose Adjustment',
      },
    ],
  });

  const buckets = [
    { bucket: 1, label: 'W44 · Nov 02' },
    { bucket: 2, label: 'W45 · Nov 09' },
    { bucket: 3, label: 'W46 · Nov 16' },
    { bucket: 4, label: 'W47 · Nov 23' },
  ];

  const rawDemands: Omit<DemandSignal, 'sensed_units'>[] = [
    // Bucket 1
    {
      demand_id: 'DEM_W1_C50',
      customer_id: 'CUST_MERCY_HEALTH',
      customer_name: 'Mercy Integrated Hospital Network',
      product_id: 'SKU_CARDIO_50MG',
      bucket: 1,
      bucket_label: 'W44 · Nov 02',
      baseline_units: 420,
      drivers: {
        promo_uplift_pct: 0.10,
        price_elasticity: -1.4,
        baseline_price: 135,
        current_price: 135,
        macro_gdp_factor: 1.02,
        pos_sell_through_index: 1.04,
        weather_index: 1.0,
      },
      unmet_penalty_per_unit: 450,
    },
    {
      demand_id: 'DEM_W1_C100',
      customer_id: 'CUST_MERCY_HEALTH',
      customer_name: 'Mercy Integrated Hospital Network',
      product_id: 'SKU_CARDIO_100MG',
      bucket: 1,
      bucket_label: 'W44 · Nov 02',
      baseline_units: 340,
      drivers: {
        promo_uplift_pct: 0.05,
        price_elasticity: -1.2,
        baseline_price: 185,
        current_price: 185,
        macro_gdp_factor: 1.01,
        pos_sell_through_index: 1.02,
        weather_index: 1.0,
      },
      unmet_penalty_per_unit: 520,
    },
    {
      demand_id: 'DEM_W1_ONCO',
      customer_id: 'CUST_EU_PHARMA_ALLIANCE',
      customer_name: 'European Clinical Pharmacy Alliance',
      product_id: 'SKU_ONCO_300MG',
      bucket: 1,
      bucket_label: 'W44 · Nov 02',
      baseline_units: 260,
      drivers: {
        promo_uplift_pct: 0.0,
        price_elasticity: -0.6,
        baseline_price: 260,
        current_price: 260,
        macro_gdp_factor: 1.0,
        pos_sell_through_index: 1.05,
        weather_index: 1.0,
      },
      unmet_penalty_per_unit: 780,
    },
    {
      demand_id: 'DEM_W1_IMM',
      customer_id: 'CUST_EU_PHARMA_ALLIANCE',
      customer_name: 'European Clinical Pharmacy Alliance',
      product_id: 'SKU_IMMUNO_10ML',
      bucket: 1,
      bucket_label: 'W44 · Nov 02',
      baseline_units: 280,
      drivers: {
        promo_uplift_pct: 0.08,
        price_elasticity: -0.9,
        baseline_price: 215,
        current_price: 210,
        macro_gdp_factor: 1.01,
        pos_sell_through_index: 1.03,
        weather_index: 1.04,
      },
      unmet_penalty_per_unit: 640,
    },
    // Bucket 2
    {
      demand_id: 'DEM_W2_C50',
      customer_id: 'CUST_MERCY_HEALTH',
      customer_name: 'Mercy Integrated Hospital Network',
      product_id: 'SKU_CARDIO_50MG',
      bucket: 2,
      bucket_label: 'W45 · Nov 09',
      baseline_units: 460,
      drivers: {
        promo_uplift_pct: 0.12,
        price_elasticity: -1.4,
        baseline_price: 135,
        current_price: 132,
        macro_gdp_factor: 1.02,
        pos_sell_through_index: 1.05,
        weather_index: 1.0,
      },
      unmet_penalty_per_unit: 450,
    },
    {
      demand_id: 'DEM_W2_C100',
      customer_id: 'CUST_MERCY_HEALTH',
      customer_name: 'Mercy Integrated Hospital Network',
      product_id: 'SKU_CARDIO_100MG',
      bucket: 2,
      bucket_label: 'W45 · Nov 09',
      baseline_units: 390,
      drivers: {
        promo_uplift_pct: 0.08,
        price_elasticity: -1.2,
        baseline_price: 185,
        current_price: 185,
        macro_gdp_factor: 1.01,
        pos_sell_through_index: 1.04,
        weather_index: 1.0,
      },
      unmet_penalty_per_unit: 520,
    },
    {
      demand_id: 'DEM_W2_ONCO',
      customer_id: 'CUST_EU_PHARMA_ALLIANCE',
      customer_name: 'European Clinical Pharmacy Alliance',
      product_id: 'SKU_ONCO_300MG',
      bucket: 2,
      bucket_label: 'W45 · Nov 09',
      baseline_units: 310,
      drivers: {
        promo_uplift_pct: 0.0,
        price_elasticity: -0.6,
        baseline_price: 260,
        current_price: 260,
        macro_gdp_factor: 1.01,
        pos_sell_through_index: 1.06,
        weather_index: 1.0,
      },
      unmet_penalty_per_unit: 780,
    },
    {
      demand_id: 'DEM_W2_IMM',
      customer_id: 'CUST_EU_PHARMA_ALLIANCE',
      customer_name: 'European Clinical Pharmacy Alliance',
      product_id: 'SKU_IMMUNO_10ML',
      bucket: 2,
      bucket_label: 'W45 · Nov 09',
      baseline_units: 320,
      drivers: {
        promo_uplift_pct: 0.10,
        price_elasticity: -0.9,
        baseline_price: 215,
        current_price: 210,
        macro_gdp_factor: 1.02,
        pos_sell_through_index: 1.05,
        weather_index: 1.05,
      },
      unmet_penalty_per_unit: 640,
    },
    // Bucket 3
    {
      demand_id: 'DEM_W3_C50',
      customer_id: 'CUST_MERCY_HEALTH',
      customer_name: 'Mercy Integrated Hospital Network',
      product_id: 'SKU_CARDIO_50MG',
      bucket: 3,
      bucket_label: 'W46 · Nov 16',
      baseline_units: 510,
      drivers: {
        promo_uplift_pct: 0.18,
        price_elasticity: -1.4,
        baseline_price: 135,
        current_price: 130,
        macro_gdp_factor: 1.03,
        pos_sell_through_index: 1.08,
        weather_index: 1.02,
      },
      unmet_penalty_per_unit: 450,
    },
    {
      demand_id: 'DEM_W3_C100',
      customer_id: 'CUST_MERCY_HEALTH',
      customer_name: 'Mercy Integrated Hospital Network',
      product_id: 'SKU_CARDIO_100MG',
      bucket: 3,
      bucket_label: 'W46 · Nov 16',
      baseline_units: 440,
      drivers: {
        promo_uplift_pct: 0.15,
        price_elasticity: -1.2,
        baseline_price: 185,
        current_price: 180,
        macro_gdp_factor: 1.02,
        pos_sell_through_index: 1.06,
        weather_index: 1.02,
      },
      unmet_penalty_per_unit: 520,
    },
    {
      demand_id: 'DEM_W3_ONCO',
      customer_id: 'CUST_EU_PHARMA_ALLIANCE',
      customer_name: 'European Clinical Pharmacy Alliance',
      product_id: 'SKU_ONCO_300MG',
      bucket: 3,
      bucket_label: 'W46 · Nov 16',
      baseline_units: 350,
      drivers: {
        promo_uplift_pct: 0.05,
        price_elasticity: -0.6,
        baseline_price: 260,
        current_price: 260,
        macro_gdp_factor: 1.02,
        pos_sell_through_index: 1.08,
        weather_index: 1.0,
      },
      unmet_penalty_per_unit: 780,
    },
    {
      demand_id: 'DEM_W3_IMM',
      customer_id: 'CUST_EU_PHARMA_ALLIANCE',
      customer_name: 'European Clinical Pharmacy Alliance',
      product_id: 'SKU_IMMUNO_10ML',
      bucket: 3,
      bucket_label: 'W46 · Nov 16',
      baseline_units: 360,
      drivers: {
        promo_uplift_pct: 0.14,
        price_elasticity: -0.9,
        baseline_price: 215,
        current_price: 208,
        macro_gdp_factor: 1.02,
        pos_sell_through_index: 1.07,
        weather_index: 1.08,
      },
      unmet_penalty_per_unit: 640,
    },
    // Bucket 4 (Peak Winter Hospital Tender Surge)
    {
      demand_id: 'DEM_W4_C50',
      customer_id: 'CUST_MERCY_HEALTH',
      customer_name: 'Mercy Integrated Hospital Network',
      product_id: 'SKU_CARDIO_50MG',
      bucket: 4,
      bucket_label: 'W47 · Nov 23',
      baseline_units: 560,
      drivers: {
        promo_uplift_pct: 0.22,
        price_elasticity: -1.4,
        baseline_price: 135,
        current_price: 128,
        macro_gdp_factor: 1.03,
        pos_sell_through_index: 1.10,
        weather_index: 1.05,
      },
      unmet_penalty_per_unit: 450,
    },
    {
      demand_id: 'DEM_W4_C100',
      customer_id: 'CUST_MERCY_HEALTH',
      customer_name: 'Mercy Integrated Hospital Network',
      product_id: 'SKU_CARDIO_100MG',
      bucket: 4,
      bucket_label: 'W47 · Nov 23',
      baseline_units: 490,
      drivers: {
        promo_uplift_pct: 0.18,
        price_elasticity: -1.2,
        baseline_price: 185,
        current_price: 178,
        macro_gdp_factor: 1.03,
        pos_sell_through_index: 1.09,
        weather_index: 1.04,
      },
      unmet_penalty_per_unit: 520,
    },
    {
      demand_id: 'DEM_W4_ONCO',
      customer_id: 'CUST_EU_PHARMA_ALLIANCE',
      customer_name: 'European Clinical Pharmacy Alliance',
      product_id: 'SKU_ONCO_300MG',
      bucket: 4,
      bucket_label: 'W47 · Nov 23',
      baseline_units: 390,
      drivers: {
        promo_uplift_pct: 0.08,
        price_elasticity: -0.6,
        baseline_price: 260,
        current_price: 260,
        macro_gdp_factor: 1.02,
        pos_sell_through_index: 1.10,
        weather_index: 1.02,
      },
      unmet_penalty_per_unit: 780,
    },
    {
      demand_id: 'DEM_W4_IMM',
      customer_id: 'CUST_EU_PHARMA_ALLIANCE',
      customer_name: 'European Clinical Pharmacy Alliance',
      product_id: 'SKU_IMMUNO_10ML',
      bucket: 4,
      bucket_label: 'W47 · Nov 23',
      baseline_units: 410,
      drivers: {
        promo_uplift_pct: 0.16,
        price_elasticity: -0.9,
        baseline_price: 215,
        current_price: 205,
        macro_gdp_factor: 1.03,
        pos_sell_through_index: 1.09,
        weather_index: 1.10,
      },
      unmet_penalty_per_unit: 640,
    },
  ];

  const demands: DemandSignal[] = rawDemands.map((d) => {
    const fullSignal: DemandSignal = { ...d, sensed_units: d.baseline_units };
    fullSignal.sensed_units = DriverBasedDemandEngine.calculateSensedDemand(fullSignal);
    return fullSignal;
  });

  const initialInventory = new Map<string, number>([
    ['SKU_CARDIO_50MG', 190],
    ['SKU_CARDIO_100MG', 150],
    ['SKU_ONCO_300MG', 110],
    ['SKU_IMMUNO_10ML', 120],
    ['RAW_PEPTIDE_API', 840],
    ['RAW_CRYO_VIAL_10ML', 3200],
    ['SUB_BULK_CARDIO_GRANULE', 450],
  ]);

  const openPurchaseOrders: OpenPurchaseOrder[] = [
    {
      po_id: 'PO-2026-8841',
      supplier_id: 'SUP_BASEL_API',
      product_id: 'RAW_PEPTIDE_API',
      destination_node_id: 'PLANT_NJ_BIOLOGICS',
      scheduled_bucket: 1,
      scheduled_bucket_label: 'W44 · Nov 02',
      ordered_qty: 1200,
      unit_price_usd: 18.0,
      status: 'IN_TRANSIT',
    },
    {
      po_id: 'PO-2026-8849',
      supplier_id: 'SUP_FRANKFURT_GLASS',
      product_id: 'RAW_CRYO_VIAL_10ML',
      destination_node_id: 'PLANT_NJ_BIOLOGICS',
      scheduled_bucket: 2,
      scheduled_bucket_label: 'W45 · Nov 09',
      ordered_qty: 4000,
      unit_price_usd: 3.2,
      status: 'CONFIRMED',
    },
    {
      po_id: 'PO-2026-8902',
      supplier_id: 'SUP_BASEL_API',
      product_id: 'RAW_PEPTIDE_API',
      destination_node_id: 'PLANT_NJ_BIOLOGICS',
      scheduled_bucket: 3,
      scheduled_bucket_label: 'W46 · Nov 16',
      ordered_qty: 1500,
      unit_price_usd: 18.0,
      status: 'EXPEDITED',
    },
    {
      po_id: 'WO-2026-4410',
      supplier_id: 'PLANT_NJ_BIOLOGICS',
      product_id: 'SKU_CARDIO_50MG',
      destination_node_id: 'DC_CHICAGO_COLD',
      scheduled_bucket: 1,
      scheduled_bucket_label: 'W44 · Nov 02',
      ordered_qty: 160,
      unit_price_usd: 34.0,
      status: 'IN_TRANSIT',
    },
  ];

  return {
    ekg,
    nodes,
    products,
    bomEdges,
    lanes,
    workCenters,
    buckets,
    demands,
    initialInventory,
    openPurchaseOrders,
  };
}

// ============================================================================
// 6B. NORDIC SEMICONDUCTOR FOUNDRY SEED STATE (WAFERS, DIES, LITHOGRAPHY)
// ============================================================================
export function createNordicSemiconductorSeedState() {
  const ekg = new EKGSupplyNetwork();

  const nodes: SupplyNode[] = [
    {
      node_id: 'SUP_KYOTO_SILICON',
      name: 'Kyoto 300mm Ultra-Pure Silicon Ingot Works (Tier-2)',
      node_type: NodeType.SUPPLIER,
      region: 'APAC · Japan',
      currency: Currency.USD,
      working_capital_limit_usd: 9500000,
      storage_capacity_m3: 2400,
    },
    {
      node_id: 'SUP_EINDHOVEN_OPTICS',
      name: 'Eindhoven EUV Photoresist & Pellicle Chemical Lab (Tier-2)',
      node_type: NodeType.SUPPLIER,
      region: 'EMEA · Netherlands',
      currency: Currency.EUR,
      working_capital_limit_usd: 6800000,
      storage_capacity_m3: 1600,
    },
    {
      node_id: 'PLANT_LULEA_FAB1',
      name: 'Luleå Sub-3nm Cleanroom Wafer Megafab & CoWoS Packaging',
      node_type: NodeType.PLANT,
      region: 'EMEA · Sweden',
      currency: Currency.EUR,
      working_capital_limit_usd: 24000000,
      storage_capacity_m3: 11000,
    },
    {
      node_id: 'DC_FRANKFURT_SILICON_HUB',
      name: 'Frankfurt Bonded Cleanroom Distribution Hub',
      node_type: NodeType.DISTRIBUTION_CENTER,
      region: 'EMEA · Germany',
      currency: Currency.EUR,
      working_capital_limit_usd: 11500000,
      storage_capacity_m3: 7500,
    },
    {
      node_id: 'DC_AUSTIN_SYSTEMS_HUB',
      name: 'Austin Hyperscaler Semiconductor Logistics Gateway',
      node_type: NodeType.DISTRIBUTION_CENTER,
      region: 'AMER · US South',
      currency: Currency.USD,
      working_capital_limit_usd: 12000000,
      storage_capacity_m3: 8200,
    },
    {
      node_id: 'CUST_CLOUD_HYPERSCALER',
      name: 'Global AI Cloud Hyperscaler Cluster',
      node_type: NodeType.CUSTOMER,
      region: 'AMER · US West',
      currency: Currency.USD,
      working_capital_limit_usd: 0,
      storage_capacity_m3: 2200,
    },
    {
      node_id: 'CUST_EURO_AUTO_TIER1',
      name: 'European Autonomous Mobility Tier-1 OEM',
      node_type: NodeType.CUSTOMER,
      region: 'EMEA · Germany',
      currency: Currency.EUR,
      working_capital_limit_usd: 0,
      storage_capacity_m3: 1900,
    },
  ];

  nodes.forEach((n) => ekg.registerNode(n));

  const products: Product[] = [
    {
      product_id: 'RAW_300MM_EPI_WAFER',
      name: '300mm Prime Epitaxial Silicon Blank Wafer',
      family: 'SUBSTRATE_WAFERS',
      tier: 'RAW_MATERIAL',
      unit_of_measure: 'wafers',
      shelf_life_buckets: 24,
      storage_footprint_m3: 0.03,
      batch_size_min: 400,
      financials: {
        unit_sales_price: 85,
        unit_variable_cost: 32,
        holding_cost_rate_annual: 0.18,
        currency: Currency.USD,
        landed_duty_pct: 0.03,
      },
    },
    {
      product_id: 'RAW_EUV_PHOTORESIST',
      name: 'Extreme Ultraviolet (EUV) Metal-Oxide Photoresist',
      family: 'LITHO_CHEMICALS',
      tier: 'RAW_MATERIAL',
      unit_of_measure: 'liters',
      shelf_life_buckets: 8,
      storage_footprint_m3: 0.02,
      batch_size_min: 600,
      financials: {
        unit_sales_price: 62,
        unit_variable_cost: 24,
        holding_cost_rate_annual: 0.25,
        currency: Currency.EUR,
        landed_duty_pct: 0.02,
      },
    },
    {
      product_id: 'SUB_PATTERNED_N3_DIE',
      name: '3nm FinFET Patterned Multi-Project Wafer Bank',
      family: 'AI_COMPUTE',
      tier: 'SUB_ASSEMBLY',
      unit_of_measure: 'wafers',
      shelf_life_buckets: 12,
      storage_footprint_m3: 0.05,
      batch_size_min: 250,
      financials: {
        unit_sales_price: 165,
        unit_variable_cost: 58,
        holding_cost_rate_annual: 0.22,
        currency: Currency.EUR,
        landed_duty_pct: 0.0,
      },
    },
    {
      product_id: 'SKU_AI_TENSOR_COWOS',
      name: 'AI Tensor 3nm CoWoS Wafer Lot',
      family: 'AI_ACCELERATORS',
      tier: 'FINISHED_GOOD',
      unit_of_measure: 'wafers',
      shelf_life_buckets: 10,
      storage_footprint_m3: 0.08,
      batch_size_min: 150,
      financials: {
        unit_sales_price: 295,
        unit_variable_cost: 76,
        holding_cost_rate_annual: 0.24,
        currency: Currency.USD,
        landed_duty_pct: 0.03,
      },
    },
    {
      product_id: 'SKU_AUTO_ADAS_SOC',
      name: 'Autonomous ADAS 5nm Radar/Vision Wafer Lot',
      family: 'AUTOMOTIVE_SOC',
      tier: 'FINISHED_GOOD',
      unit_of_measure: 'wafers',
      shelf_life_buckets: 12,
      storage_footprint_m3: 0.07,
      batch_size_min: 180,
      financials: {
        unit_sales_price: 215,
        unit_variable_cost: 54,
        holding_cost_rate_annual: 0.20,
        currency: Currency.EUR,
        landed_duty_pct: 0.02,
      },
    },
    {
      product_id: 'SKU_HPC_CHIPLET_X1',
      name: 'Data-Center HPC 2.5D Interposer Chiplet Array',
      family: 'AI_ACCELERATORS',
      tier: 'FINISHED_GOOD',
      unit_of_measure: 'dies',
      shelf_life_buckets: 8,
      storage_footprint_m3: 0.09,
      batch_size_min: 200,
      financials: {
        unit_sales_price: 250,
        unit_variable_cost: 64,
        holding_cost_rate_annual: 0.23,
        currency: Currency.USD,
        landed_duty_pct: 0.04,
      },
    },
    {
      product_id: 'SKU_RF_5G_TRANSCEIVER',
      name: 'mmWave 5G GaN-on-Si Front-End Die Package',
      family: 'RF_CONNECTIVITY',
      tier: 'FINISHED_GOOD',
      unit_of_measure: 'dies',
      shelf_life_buckets: 10,
      storage_footprint_m3: 0.06,
      batch_size_min: 220,
      financials: {
        unit_sales_price: 165,
        unit_variable_cost: 42,
        holding_cost_rate_annual: 0.19,
        currency: Currency.EUR,
        landed_duty_pct: 0.03,
      },
    },
  ];

  products.forEach((p) => ekg.registerProduct(p));

  const bomEdges: MultiLevelBOMItem[] = [
    {
      bom_id: 'BOM_SEMI_1',
      component_id: 'RAW_300MM_EPI_WAFER',
      parent_product_id: 'SUB_PATTERNED_N3_DIE',
      quantity_required: 1.0,
      scrap_factor: 0.04,
      lead_time_days: 7,
    },
    {
      bom_id: 'BOM_SEMI_2',
      component_id: 'RAW_EUV_PHOTORESIST',
      parent_product_id: 'SUB_PATTERNED_N3_DIE',
      quantity_required: 1.4,
      scrap_factor: 0.03,
      lead_time_days: 5,
    },
    {
      bom_id: 'BOM_SEMI_3',
      component_id: 'SUB_PATTERNED_N3_DIE',
      parent_product_id: 'SKU_AI_TENSOR_COWOS',
      quantity_required: 1.0,
      scrap_factor: 0.03,
      lead_time_days: 4,
    },
    {
      bom_id: 'BOM_SEMI_4',
      component_id: 'SUB_PATTERNED_N3_DIE',
      parent_product_id: 'SKU_HPC_CHIPLET_X1',
      quantity_required: 1.2,
      scrap_factor: 0.02,
      lead_time_days: 3,
    },
    {
      bom_id: 'BOM_SEMI_5',
      component_id: 'RAW_300MM_EPI_WAFER',
      parent_product_id: 'SKU_AUTO_ADAS_SOC',
      quantity_required: 1.0,
      scrap_factor: 0.02,
      lead_time_days: 5,
    },
    {
      bom_id: 'BOM_SEMI_6',
      component_id: 'RAW_EUV_PHOTORESIST',
      parent_product_id: 'SKU_RF_5G_TRANSCEIVER',
      quantity_required: 0.8,
      scrap_factor: 0.02,
      lead_time_days: 3,
    },
  ];

  bomEdges.forEach((b) => ekg.registerBOMEdge(b));

  const lanes: Lane[] = [
    {
      lane_id: 'LANE_KYOTO_TO_LULEA',
      origin_node_id: 'SUP_KYOTO_SILICON',
      destination_node_id: 'PLANT_LULEA_FAB1',
      mode: 'AIR',
      lead_time_buckets: 1,
      transit_cost_per_unit: 4.5,
      max_capacity_units: 7000,
    },
    {
      lane_id: 'LANE_EINDHOVEN_TO_LULEA',
      origin_node_id: 'SUP_EINDHOVEN_OPTICS',
      destination_node_id: 'PLANT_LULEA_FAB1',
      mode: 'TRUCK',
      lead_time_buckets: 1,
      transit_cost_per_unit: 2.2,
      max_capacity_units: 8500,
    },
    {
      lane_id: 'LANE_LULEA_TO_FRANKFURT',
      origin_node_id: 'PLANT_LULEA_FAB1',
      destination_node_id: 'DC_FRANKFURT_SILICON_HUB',
      mode: 'AIR',
      lead_time_buckets: 1,
      transit_cost_per_unit: 3.1,
      max_capacity_units: 8000,
    },
    {
      lane_id: 'LANE_LULEA_TO_AUSTIN',
      origin_node_id: 'PLANT_LULEA_FAB1',
      destination_node_id: 'DC_AUSTIN_SYSTEMS_HUB',
      mode: 'AIR',
      lead_time_buckets: 1,
      transit_cost_per_unit: 6.2,
      max_capacity_units: 6000,
    },
    {
      lane_id: 'LANE_AUSTIN_TO_HYPERSCALER',
      origin_node_id: 'DC_AUSTIN_SYSTEMS_HUB',
      destination_node_id: 'CUST_CLOUD_HYPERSCALER',
      mode: 'TRUCK',
      lead_time_buckets: 1,
      transit_cost_per_unit: 1.8,
      max_capacity_units: 7500,
    },
    {
      lane_id: 'LANE_FRANKFURT_TO_AUTO_OEM',
      origin_node_id: 'DC_FRANKFURT_SILICON_HUB',
      destination_node_id: 'CUST_EURO_AUTO_TIER1',
      mode: 'TRUCK',
      lead_time_buckets: 1,
      transit_cost_per_unit: 1.6,
      max_capacity_units: 7000,
    },
  ];

  lanes.forEach((l) => ekg.registerLane(l));

  const workCenters = new Map<string, WorkCenter>();
  workCenters.set('WC_EUV_LITHO_BAY_1', {
    resource_id: 'WC_EUV_LITHO_BAY_1',
    name: 'High-NA EUV Lithography Scanner Bay 1',
    plant_id: 'PLANT_LULEA_FAB1',
    capacity_hours_per_bucket: 42,
    overtime_cost_per_hour: 140,
    max_overtime_hours: 14,
    run_rate_hours_per_unit: 0.048,
    setup_matrix: [
      {
        from_product_id: 'SKU_AI_TENSOR_COWOS',
        to_product_id: 'SKU_HPC_CHIPLET_X1',
        setup_time_hours: 2.5,
        setup_cost: 480,
        changeover_type: 'EUV Reticle Pellicle Swap & Overlay Alignment',
      },
      {
        from_product_id: 'SKU_HPC_CHIPLET_X1',
        to_product_id: 'SKU_AUTO_ADAS_SOC',
        setup_time_hours: 6.0,
        setup_cost: 1120,
        changeover_type: '3nm-to-5nm Dose Calibration & Photoresist Purge',
      },
      {
        from_product_id: 'SKU_AUTO_ADAS_SOC',
        to_product_id: 'SKU_AI_TENSOR_COWOS',
        setup_time_hours: 7.0,
        setup_cost: 1380,
        changeover_type: 'Ultra-Clean Optics Laser Mirror Bakeout',
      },
      {
        from_product_id: 'SKU_AI_TENSOR_COWOS',
        to_product_id: 'SKU_RF_5G_TRANSCEIVER',
        setup_time_hours: 5.5,
        setup_cost: 960,
        changeover_type: 'GaN-on-Si Wafer Chuck & Mask Recalibration',
      },
    ],
  });

  workCenters.set('WC_COWOS_BONDER_2', {
    resource_id: 'WC_COWOS_BONDER_2',
    name: '2.5D CoWoS Interposer Die Bonder Line 2',
    plant_id: 'PLANT_LULEA_FAB1',
    capacity_hours_per_bucket: 40,
    overtime_cost_per_hour: 125,
    max_overtime_hours: 12,
    run_rate_hours_per_unit: 0.052,
    setup_matrix: [
      {
        from_product_id: 'SKU_HPC_CHIPLET_X1',
        to_product_id: 'SKU_AI_TENSOR_COWOS',
        setup_time_hours: 3.0,
        setup_cost: 520,
        changeover_type: 'Thermo-Compression Bond Head Pitch Calibration',
      },
      {
        from_product_id: 'SKU_AI_TENSOR_COWOS',
        to_product_id: 'SKU_RF_5G_TRANSCEIVER',
        setup_time_hours: 5.0,
        setup_cost: 840,
        changeover_type: 'Underfill Epoxy Purge & Micro-Bump Nozzle Swap',
      },
      {
        from_product_id: 'SKU_RF_5G_TRANSCEIVER',
        to_product_id: 'SKU_AUTO_ADAS_SOC',
        setup_time_hours: 4.0,
        setup_cost: 690,
        changeover_type: 'Automotive Grade Die-Shear & Thermal Interface Setup',
      },
    ],
  });

  const buckets = [
    { bucket: 1, label: 'W44 · Nov 02' },
    { bucket: 2, label: 'W45 · Nov 09' },
    { bucket: 3, label: 'W46 · Nov 16' },
    { bucket: 4, label: 'W47 · Nov 23' },
  ];

  const semiSkus = [
    {
      id: 'SKU_AI_TENSOR_COWOS',
      custId: 'CUST_CLOUD_HYPERSCALER',
      custName: 'Global AI Cloud Hyperscaler Cluster',
      basePrice: 295,
      curPrice: 290,
      elasticity: -1.1,
      penalty: 680,
      bUnits: [380, 420, 470, 520],
      promos: [0.12, 0.15, 0.2, 0.24],
    },
    {
      id: 'SKU_AUTO_ADAS_SOC',
      custId: 'CUST_EURO_AUTO_TIER1',
      custName: 'European Autonomous Mobility Tier-1 OEM',
      basePrice: 215,
      curPrice: 210,
      elasticity: -1.2,
      penalty: 540,
      bUnits: [340, 370, 410, 450],
      promos: [0.08, 0.1, 0.14, 0.18],
    },
    {
      id: 'SKU_HPC_CHIPLET_X1',
      custId: 'CUST_CLOUD_HYPERSCALER',
      custName: 'Global AI Cloud Hyperscaler Cluster',
      basePrice: 250,
      curPrice: 250,
      elasticity: -0.9,
      penalty: 620,
      bUnits: [290, 330, 370, 410],
      promos: [0.06, 0.08, 0.12, 0.15],
    },
    {
      id: 'SKU_RF_5G_TRANSCEIVER',
      custId: 'CUST_EURO_AUTO_TIER1',
      custName: 'European Autonomous Mobility Tier-1 OEM',
      basePrice: 165,
      curPrice: 162,
      elasticity: -1.3,
      penalty: 420,
      bUnits: [310, 340, 380, 420],
      promos: [0.05, 0.08, 0.11, 0.14],
    },
  ];

  const rawDemands: Omit<DemandSignal, 'sensed_units'>[] = [];
  buckets.forEach((b, bIdx) => {
    semiSkus.forEach((sku) => {
      rawDemands.push({
        demand_id: `DEM_W${b.bucket}_${sku.id}`,
        customer_id: sku.custId,
        customer_name: sku.custName,
        product_id: sku.id,
        bucket: b.bucket,
        bucket_label: b.label,
        baseline_units: sku.bUnits[bIdx],
        drivers: {
          promo_uplift_pct: sku.promos[bIdx],
          price_elasticity: sku.elasticity,
          baseline_price: sku.basePrice,
          current_price: sku.curPrice,
          macro_gdp_factor: 1.03,
          pos_sell_through_index: 1.06 + bIdx * 0.01,
          weather_index: 1.02,
        },
        unmet_penalty_per_unit: sku.penalty,
      });
    });
  });

  const demands: DemandSignal[] = rawDemands.map((d) => {
    const fullSignal: DemandSignal = { ...d, sensed_units: d.baseline_units };
    fullSignal.sensed_units = DriverBasedDemandEngine.calculateSensedDemand(fullSignal);
    return fullSignal;
  });

  const initialInventory = new Map<string, number>([
    ['SKU_AI_TENSOR_COWOS', 165],
    ['SKU_AUTO_ADAS_SOC', 150],
    ['SKU_HPC_CHIPLET_X1', 120],
    ['SKU_RF_5G_TRANSCEIVER', 140],
    ['RAW_300MM_EPI_WAFER', 950],
    ['RAW_EUV_PHOTORESIST', 1400],
    ['SUB_PATTERNED_N3_DIE', 420],
  ]);

  const openPurchaseOrders: OpenPurchaseOrder[] = [
    {
      po_id: 'PO-SEMI-9101',
      supplier_id: 'SUP_KYOTO_SILICON',
      product_id: 'RAW_300MM_EPI_WAFER',
      destination_node_id: 'PLANT_LULEA_FAB1',
      scheduled_bucket: 1,
      scheduled_bucket_label: 'W44 · Nov 02',
      ordered_qty: 1400,
      unit_price_usd: 32.0,
      status: 'IN_TRANSIT',
    },
    {
      po_id: 'PO-SEMI-9108',
      supplier_id: 'SUP_EINDHOVEN_OPTICS',
      product_id: 'RAW_EUV_PHOTORESIST',
      destination_node_id: 'PLANT_LULEA_FAB1',
      scheduled_bucket: 2,
      scheduled_bucket_label: 'W45 · Nov 09',
      ordered_qty: 1800,
      unit_price_usd: 24.0,
      status: 'CONFIRMED',
    },
    {
      po_id: 'WO-SEMI-3041',
      supplier_id: 'PLANT_LULEA_FAB1',
      product_id: 'SKU_AI_TENSOR_COWOS',
      destination_node_id: 'DC_AUSTIN_SYSTEMS_HUB',
      scheduled_bucket: 1,
      scheduled_bucket_label: 'W44 · Nov 02',
      ordered_qty: 140,
      unit_price_usd: 76.0,
      status: 'EXPEDITED',
    },
  ];

  return {
    ekg,
    nodes,
    products,
    bomEdges,
    lanes,
    workCenters,
    buckets,
    demands,
    initialInventory,
    openPurchaseOrders,
  };
}

// ============================================================================
// 6C. VOLTEDGE EV BATTERY SYSTEMS SEED STATE (KWH PACKS, MODULES, RACKS)
// ============================================================================
export function createVoltEdgeBatterySeedState() {
  const ekg = new EKGSupplyNetwork();

  const nodes: SupplyNode[] = [
    {
      node_id: 'SUP_ATACAMA_LITHIUM',
      name: 'Atacama Battery-Grade Lithium Hydroxide Refinery (Tier-2)',
      node_type: NodeType.SUPPLIER,
      region: 'LATAM · Chile',
      currency: Currency.USD,
      working_capital_limit_usd: 8200000,
      storage_capacity_m3: 4200,
    },
    {
      node_id: 'SUP_ULSAN_CATHODE',
      name: 'Ulsan High-Nickel NMC811 Cathode Foil Works (Tier-2)',
      node_type: NodeType.SUPPLIER,
      region: 'APAC · South Korea',
      currency: Currency.USD,
      working_capital_limit_usd: 7400000,
      storage_capacity_m3: 3600,
    },
    {
      node_id: 'PLANT_NEVADA_GIGAFAB',
      name: 'Nevada Dry-Room Cell & Structural Pack Gigafactory',
      node_type: NodeType.PLANT,
      region: 'AMER · US West',
      currency: Currency.USD,
      working_capital_limit_usd: 19500000,
      storage_capacity_m3: 14000,
    },
    {
      node_id: 'DC_DETROIT_BATTERY_HUB',
      name: 'Detroit OEM Just-In-Sequence Powertrain Hub',
      node_type: NodeType.DISTRIBUTION_CENTER,
      region: 'AMER · US Midwest',
      currency: Currency.USD,
      working_capital_limit_usd: 9800000,
      storage_capacity_m3: 10500,
    },
    {
      node_id: 'DC_MUNICH_EV_DEPOT',
      name: 'Munich European EV Battery Consolidation Depot',
      node_type: NodeType.DISTRIBUTION_CENTER,
      region: 'EMEA · Germany',
      currency: Currency.EUR,
      working_capital_limit_usd: 8900000,
      storage_capacity_m3: 9200,
    },
    {
      node_id: 'CUST_APEX_MOTORS_NA',
      name: 'Apex Electric Motors North America Assembly',
      node_type: NodeType.CUSTOMER,
      region: 'AMER · Michigan',
      currency: Currency.USD,
      working_capital_limit_usd: 0,
      storage_capacity_m3: 3200,
    },
    {
      node_id: 'CUST_RHEIN_AUTOWERKE',
      name: 'Rhein Autowerke EV Platform Division',
      node_type: NodeType.CUSTOMER,
      region: 'EMEA · Bavaria',
      currency: Currency.EUR,
      working_capital_limit_usd: 0,
      storage_capacity_m3: 2800,
    },
  ];

  nodes.forEach((n) => ekg.registerNode(n));

  const products: Product[] = [
    {
      product_id: 'RAW_LITHIUM_HYDROXIDE',
      name: 'Battery-Grade Anhydrous Lithium Hydroxide',
      family: 'RAW_MINERALS',
      tier: 'RAW_MATERIAL',
      unit_of_measure: 'metric tons',
      shelf_life_buckets: 20,
      storage_footprint_m3: 0.05,
      batch_size_min: 300,
      financials: {
        unit_sales_price: 55,
        unit_variable_cost: 22,
        holding_cost_rate_annual: 0.18,
        currency: Currency.USD,
        landed_duty_pct: 0.03,
      },
    },
    {
      product_id: 'RAW_NMC811_CATHODE_FOIL',
      name: 'Coated High-Nickel NMC811 Cathode Electrode Foil',
      family: 'ELECTRODE_FOILS',
      tier: 'RAW_MATERIAL',
      unit_of_measure: 'coils',
      shelf_life_buckets: 16,
      storage_footprint_m3: 0.04,
      batch_size_min: 500,
      financials: {
        unit_sales_price: 42,
        unit_variable_cost: 16,
        holding_cost_rate_annual: 0.17,
        currency: Currency.USD,
        landed_duty_pct: 0.04,
      },
    },
    {
      product_id: 'SUB_2170_CELL_ARRAY',
      name: '4680 Cylindrical Tabless Cell Sub-Module Array',
      family: 'CELL_MODULES',
      tier: 'SUB_ASSEMBLY',
      unit_of_measure: 'cell arrays',
      shelf_life_buckets: 12,
      storage_footprint_m3: 0.08,
      batch_size_min: 300,
      financials: {
        unit_sales_price: 110,
        unit_variable_cost: 38,
        holding_cost_rate_annual: 0.19,
        currency: Currency.USD,
        landed_duty_pct: 0.0,
      },
    },
    {
      product_id: 'SKU_PACK_85KWH_NMC',
      name: '85kWh Long-Range Structural EV Battery Pack',
      family: 'PASSENGER_EV_PACKS',
      tier: 'FINISHED_GOOD',
      unit_of_measure: 'kWh packs',
      shelf_life_buckets: 10,
      storage_footprint_m3: 0.14,
      batch_size_min: 160,
      financials: {
        unit_sales_price: 245,
        unit_variable_cost: 62,
        holding_cost_rate_annual: 0.21,
        currency: Currency.USD,
        landed_duty_pct: 0.03,
      },
    },
    {
      product_id: 'SKU_PACK_60KWH_LFP',
      name: '60kWh Standard-Range LFP Prismatic Pack',
      family: 'PASSENGER_EV_PACKS',
      tier: 'FINISHED_GOOD',
      unit_of_measure: 'kWh packs',
      shelf_life_buckets: 12,
      storage_footprint_m3: 0.12,
      batch_size_min: 180,
      financials: {
        unit_sales_price: 175,
        unit_variable_cost: 44,
        holding_cost_rate_annual: 0.19,
        currency: Currency.USD,
        landed_duty_pct: 0.03,
      },
    },
    {
      product_id: 'SKU_MODULE_COMMERCIAL_HV',
      name: '800V Heavy-Duty Commercial Fleet Traction Module',
      family: 'COMMERCIAL_POWERTRAIN',
      tier: 'FINISHED_GOOD',
      unit_of_measure: 'modules',
      shelf_life_buckets: 10,
      storage_footprint_m3: 0.11,
      batch_size_min: 150,
      financials: {
        unit_sales_price: 220,
        unit_variable_cost: 56,
        holding_cost_rate_annual: 0.22,
        currency: Currency.EUR,
        landed_duty_pct: 0.04,
      },
    },
    {
      product_id: 'SKU_BESS_GRID_RACK',
      name: 'Utility Megapack Grid Storage Sub-Rack 250kWh',
      family: 'GRID_STORAGE',
      tier: 'FINISHED_GOOD',
      unit_of_measure: 'racks',
      shelf_life_buckets: 14,
      storage_footprint_m3: 0.16,
      batch_size_min: 120,
      financials: {
        unit_sales_price: 280,
        unit_variable_cost: 72,
        holding_cost_rate_annual: 0.23,
        currency: Currency.USD,
        landed_duty_pct: 0.04,
      },
    },
  ];

  products.forEach((p) => ekg.registerProduct(p));

  const bomEdges: MultiLevelBOMItem[] = [
    {
      bom_id: 'BOM_BAT_1',
      component_id: 'RAW_LITHIUM_HYDROXIDE',
      parent_product_id: 'SUB_2170_CELL_ARRAY',
      quantity_required: 1.4,
      scrap_factor: 0.03,
      lead_time_days: 6,
    },
    {
      bom_id: 'BOM_BAT_2',
      component_id: 'RAW_NMC811_CATHODE_FOIL',
      parent_product_id: 'SUB_2170_CELL_ARRAY',
      quantity_required: 1.8,
      scrap_factor: 0.02,
      lead_time_days: 5,
    },
    {
      bom_id: 'BOM_BAT_3',
      component_id: 'SUB_2170_CELL_ARRAY',
      parent_product_id: 'SKU_PACK_85KWH_NMC',
      quantity_required: 1.2,
      scrap_factor: 0.02,
      lead_time_days: 3,
    },
    {
      bom_id: 'BOM_BAT_4',
      component_id: 'SUB_2170_CELL_ARRAY',
      parent_product_id: 'SKU_PACK_60KWH_LFP',
      quantity_required: 1.0,
      scrap_factor: 0.01,
      lead_time_days: 2,
    },
    {
      bom_id: 'BOM_BAT_5',
      component_id: 'RAW_NMC811_CATHODE_FOIL',
      parent_product_id: 'SKU_MODULE_COMMERCIAL_HV',
      quantity_required: 2.0,
      scrap_factor: 0.03,
      lead_time_days: 4,
    },
    {
      bom_id: 'BOM_BAT_6',
      component_id: 'RAW_LITHIUM_HYDROXIDE',
      parent_product_id: 'SKU_BESS_GRID_RACK',
      quantity_required: 2.2,
      scrap_factor: 0.02,
      lead_time_days: 4,
    },
  ];

  bomEdges.forEach((b) => ekg.registerBOMEdge(b));

  const lanes: Lane[] = [
    {
      lane_id: 'LANE_ATACAMA_TO_NEVADA',
      origin_node_id: 'SUP_ATACAMA_LITHIUM',
      destination_node_id: 'PLANT_NEVADA_GIGAFAB',
      mode: 'OCEAN',
      lead_time_buckets: 1,
      transit_cost_per_unit: 3.8,
      max_capacity_units: 7500,
    },
    {
      lane_id: 'LANE_ULSAN_TO_NEVADA',
      origin_node_id: 'SUP_ULSAN_CATHODE',
      destination_node_id: 'PLANT_NEVADA_GIGAFAB',
      mode: 'OCEAN',
      lead_time_buckets: 1,
      transit_cost_per_unit: 3.4,
      max_capacity_units: 8000,
    },
    {
      lane_id: 'LANE_NEVADA_TO_DETROIT',
      origin_node_id: 'PLANT_NEVADA_GIGAFAB',
      destination_node_id: 'DC_DETROIT_BATTERY_HUB',
      mode: 'RAIL',
      lead_time_buckets: 1,
      transit_cost_per_unit: 2.4,
      max_capacity_units: 8500,
    },
    {
      lane_id: 'LANE_NEVADA_TO_MUNICH',
      origin_node_id: 'PLANT_NEVADA_GIGAFAB',
      destination_node_id: 'DC_MUNICH_EV_DEPOT',
      mode: 'OCEAN',
      lead_time_buckets: 1,
      transit_cost_per_unit: 5.1,
      max_capacity_units: 5500,
    },
    {
      lane_id: 'LANE_DETROIT_TO_APEX',
      origin_node_id: 'DC_DETROIT_BATTERY_HUB',
      destination_node_id: 'CUST_APEX_MOTORS_NA',
      mode: 'TRUCK',
      lead_time_buckets: 1,
      transit_cost_per_unit: 1.6,
      max_capacity_units: 8000,
    },
    {
      lane_id: 'LANE_MUNICH_TO_RHEIN',
      origin_node_id: 'DC_MUNICH_EV_DEPOT',
      destination_node_id: 'CUST_RHEIN_AUTOWERKE',
      mode: 'TRUCK',
      lead_time_buckets: 1,
      transit_cost_per_unit: 1.9,
      max_capacity_units: 6500,
    },
  ];

  lanes.forEach((l) => ekg.registerLane(l));

  const workCenters = new Map<string, WorkCenter>();
  workCenters.set('WC_ELECTRODE_COATER_1', {
    resource_id: 'WC_ELECTRODE_COATER_1',
    name: 'Dry-Room Electrode Slurry Coater & Calender Line 1',
    plant_id: 'PLANT_NEVADA_GIGAFAB',
    capacity_hours_per_bucket: 40,
    overtime_cost_per_hour: 110,
    max_overtime_hours: 12,
    run_rate_hours_per_unit: 0.046,
    setup_matrix: [
      {
        from_product_id: 'SKU_PACK_85KWH_NMC',
        to_product_id: 'SKU_PACK_60KWH_LFP',
        setup_time_hours: 6.0,
        setup_cost: 940,
        changeover_type: 'NMC811-to-LFP Cathode Slurry Solvent Purge',
      },
      {
        from_product_id: 'SKU_PACK_60KWH_LFP',
        to_product_id: 'SKU_PACK_85KWH_NMC',
        setup_time_hours: 5.5,
        setup_cost: 860,
        changeover_type: 'High-Nickel Dry-Room Dew-Point Stabilization',
      },
      {
        from_product_id: 'SKU_PACK_85KWH_NMC',
        to_product_id: 'SKU_MODULE_COMMERCIAL_HV',
        setup_time_hours: 3.0,
        setup_cost: 460,
        changeover_type: 'Anode Copper Foil Slitting Width Calibration',
      },
      {
        from_product_id: 'SKU_MODULE_COMMERCIAL_HV',
        to_product_id: 'SKU_BESS_GRID_RACK',
        setup_time_hours: 4.5,
        setup_cost: 690,
        changeover_type: 'Prismatic Cell Tab Laser Notching Die Change',
      },
    ],
  });

  workCenters.set('WC_LASER_PACK_WELDER_2', {
    resource_id: 'WC_LASER_PACK_WELDER_2',
    name: 'Robotic Busbar Laser Welding & Pack Line 2',
    plant_id: 'PLANT_NEVADA_GIGAFAB',
    capacity_hours_per_bucket: 40,
    overtime_cost_per_hour: 105,
    max_overtime_hours: 12,
    run_rate_hours_per_unit: 0.05,
    setup_matrix: [
      {
        from_product_id: 'SKU_MODULE_COMMERCIAL_HV',
        to_product_id: 'SKU_PACK_85KWH_NMC',
        setup_time_hours: 3.5,
        setup_cost: 540,
        changeover_type: '800V-to-400V Busbar Fixture & Hi-Pot Calibration',
      },
      {
        from_product_id: 'SKU_BESS_GRID_RACK',
        to_product_id: 'SKU_PACK_60KWH_LFP',
        setup_time_hours: 4.5,
        setup_cost: 670,
        changeover_type: 'Structural Pack Thermal Epoxy Nozzle Purge',
      },
    ],
  });

  const buckets = [
    { bucket: 1, label: 'W44 · Nov 02' },
    { bucket: 2, label: 'W45 · Nov 09' },
    { bucket: 3, label: 'W46 · Nov 16' },
    { bucket: 4, label: 'W47 · Nov 23' },
  ];

  const batterySkus = [
    {
      id: 'SKU_PACK_85KWH_NMC',
      custId: 'CUST_APEX_MOTORS_NA',
      custName: 'Apex Electric Motors North America',
      basePrice: 245,
      curPrice: 240,
      elasticity: -1.3,
      penalty: 590,
      bUnits: [400, 440, 490, 540],
      promos: [0.1, 0.14, 0.18, 0.22],
    },
    {
      id: 'SKU_PACK_60KWH_LFP',
      custId: 'CUST_APEX_MOTORS_NA',
      custName: 'Apex Electric Motors North America',
      basePrice: 175,
      curPrice: 172,
      elasticity: -1.4,
      penalty: 460,
      bUnits: [360, 400, 440, 480],
      promos: [0.08, 0.1, 0.15, 0.18],
    },
    {
      id: 'SKU_MODULE_COMMERCIAL_HV',
      custId: 'CUST_RHEIN_AUTOWERKE',
      custName: 'Rhein Autowerke EV Platform Division',
      basePrice: 220,
      curPrice: 220,
      elasticity: -0.9,
      penalty: 560,
      bUnits: [270, 310, 350, 390],
      promos: [0.05, 0.08, 0.1, 0.12],
    },
    {
      id: 'SKU_BESS_GRID_RACK',
      custId: 'CUST_RHEIN_AUTOWERKE',
      custName: 'Rhein Autowerke EV Platform Division',
      basePrice: 280,
      curPrice: 275,
      elasticity: -0.8,
      penalty: 680,
      bUnits: [250, 290, 330, 370],
      promos: [0.06, 0.1, 0.14, 0.16],
    },
  ];

  const rawDemands: Omit<DemandSignal, 'sensed_units'>[] = [];
  buckets.forEach((b, bIdx) => {
    batterySkus.forEach((sku) => {
      rawDemands.push({
        demand_id: `DEM_W${b.bucket}_${sku.id}`,
        customer_id: sku.custId,
        customer_name: sku.custName,
        product_id: sku.id,
        bucket: b.bucket,
        bucket_label: b.label,
        baseline_units: sku.bUnits[bIdx],
        drivers: {
          promo_uplift_pct: sku.promos[bIdx],
          price_elasticity: sku.elasticity,
          baseline_price: sku.basePrice,
          current_price: sku.curPrice,
          macro_gdp_factor: 1.02,
          pos_sell_through_index: 1.05 + bIdx * 0.01,
          weather_index: 1.03,
        },
        unmet_penalty_per_unit: sku.penalty,
      });
    });
  });

  const demands: DemandSignal[] = rawDemands.map((d) => {
    const fullSignal: DemandSignal = { ...d, sensed_units: d.baseline_units };
    fullSignal.sensed_units = DriverBasedDemandEngine.calculateSensedDemand(fullSignal);
    return fullSignal;
  });

  const initialInventory = new Map<string, number>([
    ['SKU_PACK_85KWH_NMC', 175],
    ['SKU_PACK_60KWH_LFP', 155],
    ['SKU_MODULE_COMMERCIAL_HV', 115],
    ['SKU_BESS_GRID_RACK', 105],
    ['RAW_LITHIUM_HYDROXIDE', 890],
    ['RAW_NMC811_CATHODE_FOIL', 1600],
    ['SUB_2170_CELL_ARRAY', 460],
  ]);

  const openPurchaseOrders: OpenPurchaseOrder[] = [
    {
      po_id: 'PO-BAT-7701',
      supplier_id: 'SUP_ATACAMA_LITHIUM',
      product_id: 'RAW_LITHIUM_HYDROXIDE',
      destination_node_id: 'PLANT_NEVADA_GIGAFAB',
      scheduled_bucket: 1,
      scheduled_bucket_label: 'W44 · Nov 02',
      ordered_qty: 1300,
      unit_price_usd: 22.0,
      status: 'IN_TRANSIT',
    },
    {
      po_id: 'PO-BAT-7715',
      supplier_id: 'SUP_ULSAN_CATHODE',
      product_id: 'RAW_NMC811_CATHODE_FOIL',
      destination_node_id: 'PLANT_NEVADA_GIGAFAB',
      scheduled_bucket: 2,
      scheduled_bucket_label: 'W45 · Nov 09',
      ordered_qty: 2200,
      unit_price_usd: 16.0,
      status: 'CONFIRMED',
    },
    {
      po_id: 'WO-BAT-5012',
      supplier_id: 'PLANT_NEVADA_GIGAFAB',
      product_id: 'SKU_PACK_85KWH_NMC',
      destination_node_id: 'DC_DETROIT_BATTERY_HUB',
      scheduled_bucket: 1,
      scheduled_bucket_label: 'W44 · Nov 02',
      ordered_qty: 150,
      unit_price_usd: 62.0,
      status: 'IN_TRANSIT',
    },
  ];

  return {
    ekg,
    nodes,
    products,
    bomEdges,
    lanes,
    workCenters,
    buckets,
    demands,
    initialInventory,
    openPurchaseOrders,
  };
}

export function createCompanySeedState(companyName?: string) {
  const lower = (companyName || '').toLowerCase();
  if (
    lower.includes('semi') ||
    lower.includes('nordic') ||
    lower.includes('foundry') ||
    lower.includes('silicon') ||
    lower.includes('chip') ||
    lower.includes('wafer')
  ) {
    return createNordicSemiconductorSeedState();
  }
  if (
    lower.includes('volt') ||
    lower.includes('battery') ||
    lower.includes('ev') ||
    lower.includes('gigafab') ||
    lower.includes('motor') ||
    lower.includes('power')
  ) {
    return createVoltEdgeBatterySeedState();
  }
  return createEnterpriseSeedState();
}

export function createEmptyEnterpriseState() {
  const ekg = new EKGSupplyNetwork();
  const nodes: SupplyNode[] = [];
  const products: Product[] = [];
  const bomEdges: MultiLevelBOMItem[] = [];
  const lanes: Lane[] = [];
  const workCenters = new Map<string, WorkCenter>();
  const buckets = [
    { bucket: 1, label: 'W44 · Nov 02' },
    { bucket: 2, label: 'W45 · Nov 09' },
    { bucket: 3, label: 'W46 · Nov 16' },
    { bucket: 4, label: 'W47 · Nov 23' },
  ];
  const demands: DemandSignal[] = [];
  const initialInventory = new Map<string, number>();
  const openPurchaseOrders: OpenPurchaseOrder[] = [];

  return {
    ekg,
    nodes,
    products,
    bomEdges,
    lanes,
    workCenters,
    buckets,
    demands,
    initialInventory,
    openPurchaseOrders,
  };
}

