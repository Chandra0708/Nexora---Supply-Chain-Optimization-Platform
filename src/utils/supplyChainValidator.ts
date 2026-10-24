import {
  Currency,
  DemandSignal,
  Lane,
  MultiLevelBOMItem,
  NodeType,
  OpenPurchaseOrder,
  Product,
  SupplyChainFixturePayload,
  SupplyNode,
  WorkCenter,
} from '../types/ibp.ts';

export interface SchemaValidationCheck {
  id: string;
  category: 'FOREIGN_KEY' | 'NUMERIC_CONSTRAINT' | 'TOPOLOGY';
  title: string;
  passed: boolean;
  detail: string;
}

export interface SchemaValidationReport {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  checks: SchemaValidationCheck[];
  summary: {
    facilitiesCount: number;
    plantsCount: number;
    dcsCount: number;
    suppliersCount: number;
    customersCount: number;
    itemsCount: number;
    finishedGoodsCount: number;
    assemblyLinesCount: number;
    bomEdgesCount: number;
    openPosCount: number;
    demandOrdersCount: number;
    totalOpenOrdersCount: number;
  };
}

/**
 * Validates a SupplyChainFixturePayload client-side before building the in-memory EKG & MILP model.
 * Enforces Foreign Key Integrity across Nodes, Item Master, BOMs, Work Centers, Open POs, and Demands,
 * as well as mandatory numeric domain constraints (lead times >= 0, capacity hours > 0, unit costs >= 0).
 */
export function validateSupplyChainPayload(
  payload: SupplyChainFixturePayload
): SchemaValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const checks: SchemaValidationCheck[] = [];

  const nodes = payload.nodes || [];
  const products = payload.products || [];
  const bomEdges = payload.bom_edges || [];
  const lanes = payload.lanes || [];
  const workCenters = payload.work_centers || [];
  const demands = payload.demands || [];
  const openPos = payload.open_pos || [];

  const nodeIds = new Set(nodes.map((n) => n.node_id));
  const productIds = new Set(products.map((p) => p.product_id));

  // 1. Master Entity Presence Check
  const hasCoreEntities =
    nodes.length > 0 && products.length > 0 && workCenters.length > 0;
  if (!hasCoreEntities) {
    if (nodes.length === 0)
      errors.push('Missing Facilities/Nodes: At least 1 facility node is required.');
    if (products.length === 0)
      errors.push('Missing Item Master: At least 1 product/item is required.');
    if (workCenters.length === 0)
      errors.push(
        'Missing Assembly Lines / Work Centers: At least 1 finite resource is required.'
      );
  }
  checks.push({
    id: 'CORE_ENTITIES',
    category: 'TOPOLOGY',
    title: 'Core Network Entities Present',
    passed: hasCoreEntities,
    detail: `${nodes.length} Facilities, ${products.length} Items, ${workCenters.length} Assembly Lines`,
  });

  // 2. Foreign Key Integrity: BOM Parent & Child Items in Item Master
  const missingBomItems: string[] = [];
  for (const edge of bomEdges) {
    if (!productIds.has(edge.component_id)) {
      missingBomItems.push(
        `BOM ${edge.bom_id}: child component '${edge.component_id}' not found in Item Master`
      );
    }
    if (!productIds.has(edge.parent_product_id)) {
      missingBomItems.push(
        `BOM ${edge.bom_id}: parent product '${edge.parent_product_id}' not found in Item Master`
      );
    }
  }
  if (missingBomItems.length > 0) {
    errors.push(...missingBomItems);
  }
  checks.push({
    id: 'FK_BOM_ITEMS',
    category: 'FOREIGN_KEY',
    title: 'Multi-Tier BOM → Item Master Referential Integrity',
    passed: missingBomItems.length === 0,
    detail:
      missingBomItems.length === 0
        ? `All ${bomEdges.length} BOM parent/child item links verified in Item Master`
        : `${missingBomItems.length} broken BOM item reference(s)`,
  });

  // 3. Foreign Key Integrity: Open POs (Supplier, Destination Facility, Item Master)
  const missingPoRefs: string[] = [];
  for (const po of openPos) {
    if (!nodeIds.has(po.destination_node_id)) {
      missingPoRefs.push(
        `Open PO ${po.po_id}: destination node '${po.destination_node_id}' not found in Facilities`
      );
    }
    if (po.supplier_id && !nodeIds.has(po.supplier_id)) {
      missingPoRefs.push(
        `Open PO ${po.po_id}: supplier node '${po.supplier_id}' not found in Facilities`
      );
    }
    if (!productIds.has(po.product_id)) {
      missingPoRefs.push(
        `Open PO ${po.po_id}: item '${po.product_id}' not found in Item Master`
      );
    }
  }
  if (missingPoRefs.length > 0) {
    errors.push(...missingPoRefs);
  }
  checks.push({
    id: 'FK_OPEN_POS',
    category: 'FOREIGN_KEY',
    title: 'Open POs → Facilities & Item Master Foreign Keys',
    passed: missingPoRefs.length === 0,
    detail:
      missingPoRefs.length === 0
        ? `All ${openPos.length} Open POs linked to valid Facilities & Items`
        : `${missingPoRefs.length} invalid foreign key reference(s) in Open POs`,
  });

  // 4. Foreign Key Integrity: Work Centers & Transport Lanes -> Facilities
  const missingFacilityRefs: string[] = [];
  for (const wc of workCenters) {
    if (wc.plant_id && !nodeIds.has(wc.plant_id)) {
      missingFacilityRefs.push(
        `Work Center ${wc.resource_id}: plant_id '${wc.plant_id}' not found in Facilities`
      );
    }
    for (const setup of wc.setup_matrix || []) {
      if (!productIds.has(setup.from_product_id)) {
        missingFacilityRefs.push(
          `Work Center ${wc.resource_id} changeover: from_product_id '${setup.from_product_id}' not in Item Master`
        );
      }
      if (!productIds.has(setup.to_product_id)) {
        missingFacilityRefs.push(
          `Work Center ${wc.resource_id} changeover: to_product_id '${setup.to_product_id}' not in Item Master`
        );
      }
    }
  }
  for (const lane of lanes) {
    if (!nodeIds.has(lane.origin_node_id)) {
      missingFacilityRefs.push(
        `Lane ${lane.lane_id}: origin_node_id '${lane.origin_node_id}' not found in Facilities`
      );
    }
    if (!nodeIds.has(lane.destination_node_id)) {
      missingFacilityRefs.push(
        `Lane ${lane.lane_id}: destination_node_id '${lane.destination_node_id}' not found in Facilities`
      );
    }
  }
  for (const dem of demands) {
    if (!productIds.has(dem.product_id)) {
      missingFacilityRefs.push(
        `Demand ${dem.demand_id}: product_id '${dem.product_id}' not found in Item Master`
      );
    }
  }
  if (missingFacilityRefs.length > 0) {
    errors.push(...missingFacilityRefs);
  }
  checks.push({
    id: 'FK_TOPOLOGY_LANES_WC',
    category: 'FOREIGN_KEY',
    title: 'Work Centers, Lanes & Demand Orders → Master Foreign Keys',
    passed: missingFacilityRefs.length === 0,
    detail:
      missingFacilityRefs.length === 0
        ? `Verified ${workCenters.length} lines, ${lanes.length} lanes & ${demands.length} demand signals`
        : `${missingFacilityRefs.length} broken topology reference(s)`,
  });

  // 5. Numeric Constraints: Lead Times >= 0
  const invalidLeadTimes: string[] = [];
  for (const edge of bomEdges) {
    if (
      typeof edge.lead_time_days !== 'number' ||
      Number.isNaN(edge.lead_time_days) ||
      edge.lead_time_days < 0
    ) {
      invalidLeadTimes.push(
        `BOM ${edge.bom_id}: lead_time_days (${edge.lead_time_days}) must be >= 0`
      );
    }
    if (edge.quantity_required <= 0) {
      invalidLeadTimes.push(
        `BOM ${edge.bom_id}: quantity_required (${edge.quantity_required}) must be > 0`
      );
    }
  }
  for (const lane of lanes) {
    if (
      typeof lane.lead_time_buckets !== 'number' ||
      Number.isNaN(lane.lead_time_buckets) ||
      lane.lead_time_buckets < 0
    ) {
      invalidLeadTimes.push(
        `Lane ${lane.lane_id}: lead_time_buckets (${lane.lead_time_buckets}) must be >= 0`
      );
    }
  }
  if (invalidLeadTimes.length > 0) {
    errors.push(...invalidLeadTimes);
  }
  checks.push({
    id: 'NUM_LEAD_TIMES',
    category: 'NUMERIC_CONSTRAINT',
    title: 'Lead Times & BOM Quantities Domain Check (lead_time >= 0)',
    passed: invalidLeadTimes.length === 0,
    detail:
      invalidLeadTimes.length === 0
        ? 'All BOM & transit lane lead times are non-negative (>= 0)'
        : `${invalidLeadTimes.length} invalid lead time or BOM quantity value(s)`,
  });

  // 6. Numeric Constraints: Finite Capacity Hours > 0
  const invalidCapacities: string[] = [];
  for (const wc of workCenters) {
    if (
      typeof wc.capacity_hours_per_bucket !== 'number' ||
      Number.isNaN(wc.capacity_hours_per_bucket) ||
      wc.capacity_hours_per_bucket <= 0
    ) {
      invalidCapacities.push(
        `Work Center ${wc.resource_id}: capacity_hours_per_bucket (${wc.capacity_hours_per_bucket}) must be > 0`
      );
    }
    if (
      typeof wc.run_rate_hours_per_unit !== 'number' ||
      Number.isNaN(wc.run_rate_hours_per_unit) ||
      wc.run_rate_hours_per_unit <= 0
    ) {
      invalidCapacities.push(
        `Work Center ${wc.resource_id}: run_rate_hours_per_unit (${wc.run_rate_hours_per_unit}) must be > 0`
      );
    }
  }
  if (invalidCapacities.length > 0) {
    errors.push(...invalidCapacities);
  }
  checks.push({
    id: 'NUM_CAPACITY_HOURS',
    category: 'NUMERIC_CONSTRAINT',
    title: 'Finite Assembly Line Capacities & Run Rates (capacity_hours > 0)',
    passed: invalidCapacities.length === 0,
    detail:
      invalidCapacities.length === 0
        ? `All ${workCenters.length} assembly lines have positive shift capacity (> 0 hrs)`
        : `${invalidCapacities.length} work center capacity constraint violation(s)`,
  });

  // 7. Numeric Constraints: Unit Costs & Prices >= 0
  const invalidCosts: string[] = [];
  for (const prod of products) {
    const fin = prod.financials;
    if (!fin) {
      invalidCosts.push(`Item ${prod.product_id}: missing financials block`);
      continue;
    }
    if (fin.unit_variable_cost < 0 || Number.isNaN(fin.unit_variable_cost)) {
      invalidCosts.push(
        `Item ${prod.product_id}: unit_variable_cost (${fin.unit_variable_cost}) must be >= 0`
      );
    }
    if (fin.unit_sales_price < 0 || Number.isNaN(fin.unit_sales_price)) {
      invalidCosts.push(
        `Item ${prod.product_id}: unit_sales_price (${fin.unit_sales_price}) must be >= 0`
      );
    }
  }
  for (const po of openPos) {
    if (po.unit_price_usd < 0 || Number.isNaN(po.unit_price_usd)) {
      invalidCosts.push(
        `Open PO ${po.po_id}: unit_price_usd (${po.unit_price_usd}) must be >= 0`
      );
    }
    if (po.ordered_qty <= 0 || Number.isNaN(po.ordered_qty)) {
      invalidCosts.push(
        `Open PO ${po.po_id}: ordered_qty (${po.ordered_qty}) must be > 0`
      );
    }
  }
  if (invalidCosts.length > 0) {
    errors.push(...invalidCosts);
  }
  checks.push({
    id: 'NUM_UNIT_COSTS',
    category: 'NUMERIC_CONSTRAINT',
    title: 'Commercial & Financial Unit Cost Domain (unit_cost >= 0)',
    passed: invalidCosts.length === 0,
    detail:
      invalidCosts.length === 0
        ? `Verified non-negative unit costs & prices across ${products.length} items and ${openPos.length} POs`
        : `${invalidCosts.length} unit cost/price violation(s)`,
  });

  const plantsCount = nodes.filter((n) => n.node_type === NodeType.PLANT).length;
  const dcsCount = nodes.filter(
    (n) => n.node_type === NodeType.DISTRIBUTION_CENTER
  ).length;
  const suppliersCount = nodes.filter(
    (n) => n.node_type === NodeType.SUPPLIER
  ).length;
  const customersCount = nodes.filter(
    (n) => n.node_type === NodeType.CUSTOMER
  ).length;
  const finishedGoodsCount = products.filter(
    (p) => p.tier === 'FINISHED_GOOD'
  ).length;

  return {
    isValid: errors.length === 0 && hasCoreEntities,
    errors,
    warnings,
    checks,
    summary: {
      facilitiesCount: nodes.length,
      plantsCount,
      dcsCount,
      suppliersCount,
      customersCount,
      itemsCount: products.length,
      finishedGoodsCount,
      assemblyLinesCount: workCenters.length,
      bomEdgesCount: bomEdges.length,
      openPosCount: openPos.length,
      demandOrdersCount: demands.length,
      totalOpenOrdersCount: openPos.length + demands.length,
    },
  };
}

/**
 * Parses CSV files dropped as a bundle or individually and merges them into an existing SupplyChainFixturePayload.
 */
export function parseCsvIntoPayload(
  filename: string,
  csvText: string,
  basePayload: SupplyChainFixturePayload
): SupplyChainFixturePayload {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return basePayload;

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const rows = lines.slice(1).map((line) => {
    const cols = line.split(',').map((c) => c.trim());
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = cols[i] ?? '';
    });
    return obj;
  });

  const next: SupplyChainFixturePayload = { ...basePayload };
  const lowerName = filename.toLowerCase();

  // Detect table type by header columns or filename
  if (headers.includes('node_id') && headers.includes('node_type')) {
    const parsedNodes: SupplyNode[] = rows.map((r, i) => ({
      node_id: r.node_id || `NODE_${i + 1}`,
      name: r.name || r.node_id || `Facility ${i + 1}`,
      node_type: (r.node_type as NodeType) || NodeType.PLANT,
      region: r.region || 'NA-East',
      currency: (r.currency as Currency) || Currency.USD,
      working_capital_limit_usd: Number(r.working_capital_limit_usd || 1500000),
      storage_capacity_m3: Number(r.storage_capacity_m3 || 2000),
    }));
    next.nodes = parsedNodes;
  } else if (headers.includes('product_id') && headers.includes('tier')) {
    const parsedProducts: Product[] = rows.map((r, i) => ({
      product_id: r.product_id || `SKU_${i + 1}`,
      name: r.name || r.product_id || `Item ${i + 1}`,
      family: r.family || 'Core Portfolio',
      tier:
        (r.tier as Product['tier']) ||
        (r.product_id?.startsWith('RAW_')
          ? 'RAW_MATERIAL'
          : r.product_id?.startsWith('SUB_')
          ? 'SUB_ASSEMBLY'
          : 'FINISHED_GOOD'),
      unit_of_measure: r.unit_of_measure || 'units',
      shelf_life_buckets: Number(r.shelf_life_buckets || 6),
      storage_footprint_m3: Number(r.storage_footprint_m3 || 0.25),
      batch_size_min: Number(r.batch_size_min || 100),
      financials: {
        unit_sales_price: Number(r.unit_sales_price || 150),
        unit_variable_cost: Number(r.unit_variable_cost || 42),
        holding_cost_rate_annual: Number(r.holding_cost_rate_annual || 0.2),
        currency: (r.currency as Currency) || Currency.USD,
        landed_duty_pct: Number(r.landed_duty_pct || 0.03),
      },
    }));
    next.products = parsedProducts;
  } else if (
    headers.includes('component_id') &&
    headers.includes('parent_product_id')
  ) {
    const parsedBoms: MultiLevelBOMItem[] = rows.map((r, i) => ({
      bom_id: r.bom_id || `BOM_${i + 1}`,
      component_id: r.component_id,
      parent_product_id: r.parent_product_id,
      quantity_required: Number(r.quantity_required || 1),
      scrap_factor: Number(r.scrap_factor || 0.02),
      lead_time_days: Number(r.lead_time_days || 5),
    }));
    next.bom_edges = parsedBoms;
  } else if (
    headers.includes('resource_id') &&
    headers.includes('capacity_hours_per_bucket')
  ) {
    const parsedWcs: WorkCenter[] = rows.map((r, i) => ({
      resource_id: r.resource_id || `WC_LINE_${i + 1}`,
      name: r.name || r.resource_id || `Assembly Line ${i + 1}`,
      plant_id: r.plant_id || next.nodes?.[0]?.node_id || 'PLANT_MAIN',
      capacity_hours_per_bucket: Number(r.capacity_hours_per_bucket || 120),
      overtime_cost_per_hour: Number(r.overtime_cost_per_hour || 180),
      max_overtime_hours: Number(r.max_overtime_hours || 36),
      run_rate_hours_per_unit: Number(r.run_rate_hours_per_unit || 0.14),
      setup_matrix: [],
    }));
    next.work_centers = parsedWcs;
  } else if (headers.includes('po_id') && headers.includes('ordered_qty')) {
    const parsedPos: OpenPurchaseOrder[] = rows.map((r, i) => ({
      po_id: r.po_id || `PO-${1000 + i}`,
      supplier_id: r.supplier_id || '',
      product_id: r.product_id || '',
      destination_node_id: r.destination_node_id || '',
      scheduled_bucket: Number(r.scheduled_bucket || 1),
      scheduled_bucket_label:
        r.scheduled_bucket_label || `W${43 + Number(r.scheduled_bucket || 1)}`,
      ordered_qty: Number(r.ordered_qty || 100),
      unit_price_usd: Number(r.unit_price_usd || 25),
      status:
        (r.status as OpenPurchaseOrder['status']) || 'CONFIRMED',
    }));
    next.open_pos = parsedPos;
  } else if (
    headers.includes('demand_id') ||
    (headers.includes('customer_id') && headers.includes('baseline_units'))
  ) {
    const parsedDemands: DemandSignal[] = rows.map((r, i) => {
      const baseUnits = Number(r.baseline_units || 300);
      const basePrice = Number(r.baseline_price || 150);
      const currPrice = Number(r.current_price || basePrice);
      const bucket = Number(r.bucket || 1);
      return {
        demand_id: r.demand_id || `DEM_${i + 1}`,
        customer_id: r.customer_id || '',
        customer_name: r.customer_name || r.customer_id || 'Enterprise Customer',
        product_id: r.product_id || '',
        bucket,
        bucket_label: r.bucket_label || `W${43 + bucket} · Nov`,
        baseline_units: baseUnits,
        sensed_units: Number(r.sensed_units || baseUnits),
        drivers: {
          promo_uplift_pct: Number(r.promo_uplift_pct || 0.1),
          price_elasticity: Number(r.price_elasticity || -1.1),
          baseline_price: basePrice,
          current_price: currPrice,
          macro_gdp_factor: Number(r.macro_gdp_factor || 1.02),
          pos_sell_through_index: Number(r.pos_sell_through_index || 1.04),
          weather_index: Number(r.weather_index || 1.01),
        },
        unmet_penalty_per_unit: Number(r.unmet_penalty_per_unit || 500),
      };
    });
    next.demands = parsedDemands;
  } else if (
    headers.includes('origin_node_id') &&
    headers.includes('destination_node_id')
  ) {
    const parsedLanes: Lane[] = rows.map((r, i) => ({
      lane_id: r.lane_id || `LANE_${i + 1}`,
      origin_node_id: r.origin_node_id,
      destination_node_id: r.destination_node_id,
      mode: (r.mode as Lane['mode']) || 'TRUCK',
      lead_time_buckets: Number(r.lead_time_buckets || 1),
      transit_cost_per_unit: Number(r.transit_cost_per_unit || 4.5),
      max_capacity_units: Number(r.max_capacity_units || 5000),
    }));
    next.lanes = parsedLanes;
  } else if (
    lowerName.includes('inventory') ||
    (headers.includes('product_id') && headers.includes('on_hand_qty'))
  ) {
    const inv: Record<string, number> = { ...(next.initial_inventory || {}) };
    rows.forEach((r) => {
      if (r.product_id) {
        inv[r.product_id] = Number(r.on_hand_qty || r.quantity || 0);
      }
    });
    next.initial_inventory = inv;
  }

  return next;
}

/**
 * Generates a structured JSON template for new companies onboarding onto UnisonIBP.
 */
export function generateBlankJsonTemplate(companyName: string): string {
  const template: SupplyChainFixturePayload = {
    company_name: companyName || 'Your Enterprise Supply Chain Network',
    nodes: [
      {
        node_id: 'SUP_TIER1_RAW',
        name: 'Tier-1 Raw Material Supplier',
        node_type: NodeType.SUPPLIER,
        region: 'EU-Central',
        currency: Currency.EUR,
        working_capital_limit_usd: 1500000,
        storage_capacity_m3: 3000,
      },
      {
        node_id: 'PLANT_PRIMARY_MFG',
        name: 'Primary Manufacturing & Packaging Plant',
        node_type: NodeType.PLANT,
        region: 'US-East',
        currency: Currency.USD,
        working_capital_limit_usd: 4500000,
        storage_capacity_m3: 5000,
      },
      {
        node_id: 'DC_REGIONAL_HUB',
        name: 'North America Distribution Hub',
        node_type: NodeType.DISTRIBUTION_CENTER,
        region: 'US-Midwest',
        currency: Currency.USD,
        working_capital_limit_usd: 2000000,
        storage_capacity_m3: 4000,
      },
      {
        node_id: 'CUST_KEY_ACCOUNT',
        name: 'National Retail & Clinical Account',
        node_type: NodeType.CUSTOMER,
        region: 'US-National',
        currency: Currency.USD,
        working_capital_limit_usd: 0,
        storage_capacity_m3: 1000,
      },
    ],
    products: [
      {
        product_id: 'RAW_ACTIVE_COMPOUND',
        name: 'Active Base Compound (Raw Material)',
        family: 'Raw Inputs',
        tier: 'RAW_MATERIAL',
        shelf_life_buckets: 12,
        storage_footprint_m3: 0.1,
        batch_size_min: 500,
        financials: {
          unit_sales_price: 25,
          unit_variable_cost: 18,
          holding_cost_rate_annual: 0.18,
          currency: Currency.EUR,
          landed_duty_pct: 0.04,
        },
      },
      {
        product_id: 'SKU_CORE_PRODUCT_A',
        name: 'Core Finished Product A (50mg)',
        family: 'Primary Line',
        tier: 'FINISHED_GOOD',
        shelf_life_buckets: 8,
        storage_footprint_m3: 0.25,
        batch_size_min: 100,
        financials: {
          unit_sales_price: 145,
          unit_variable_cost: 38,
          holding_cost_rate_annual: 0.2,
          currency: Currency.USD,
          landed_duty_pct: 0.02,
        },
      },
      {
        product_id: 'SKU_CORE_PRODUCT_B',
        name: 'Core Finished Product B (100mg)',
        family: 'Primary Line',
        tier: 'FINISHED_GOOD',
        shelf_life_buckets: 8,
        storage_footprint_m3: 0.3,
        batch_size_min: 100,
        financials: {
          unit_sales_price: 195,
          unit_variable_cost: 52,
          holding_cost_rate_annual: 0.2,
          currency: Currency.USD,
          landed_duty_pct: 0.02,
        },
      },
    ],
    bom_edges: [
      {
        bom_id: 'BOM_EDGE_01',
        component_id: 'RAW_ACTIVE_COMPOUND',
        parent_product_id: 'SKU_CORE_PRODUCT_A',
        quantity_required: 1.5,
        scrap_factor: 0.02,
        lead_time_days: 5,
      },
      {
        bom_id: 'BOM_EDGE_02',
        component_id: 'RAW_ACTIVE_COMPOUND',
        parent_product_id: 'SKU_CORE_PRODUCT_B',
        quantity_required: 2.0,
        scrap_factor: 0.03,
        lead_time_days: 5,
      },
    ],
    lanes: [
      {
        lane_id: 'LANE_SUP_TO_PLANT',
        origin_node_id: 'SUP_TIER1_RAW',
        destination_node_id: 'PLANT_PRIMARY_MFG',
        mode: 'OCEAN',
        lead_time_buckets: 1,
        transit_cost_per_unit: 3.5,
        max_capacity_units: 6000,
      },
      {
        lane_id: 'LANE_PLANT_TO_DC',
        origin_node_id: 'PLANT_PRIMARY_MFG',
        destination_node_id: 'DC_REGIONAL_HUB',
        mode: 'TRUCK',
        lead_time_buckets: 1,
        transit_cost_per_unit: 2.2,
        max_capacity_units: 5000,
      },
      {
        lane_id: 'LANE_DC_TO_CUST',
        origin_node_id: 'DC_REGIONAL_HUB',
        destination_node_id: 'CUST_KEY_ACCOUNT',
        mode: 'TRUCK',
        lead_time_buckets: 1,
        transit_cost_per_unit: 1.8,
        max_capacity_units: 5000,
      },
    ],
    work_centers: [
      {
        resource_id: 'WC_ASSEMBLY_LINE_1',
        name: 'High-Speed Automated Packaging Line 1',
        plant_id: 'PLANT_PRIMARY_MFG',
        capacity_hours_per_bucket: 120,
        overtime_cost_per_hour: 175,
        max_overtime_hours: 36,
        run_rate_hours_per_unit: 0.14,
        setup_matrix: [
          {
            from_product_id: 'SKU_CORE_PRODUCT_A',
            to_product_id: 'SKU_CORE_PRODUCT_B',
            setup_time_hours: 4.5,
            setup_cost: 680,
            changeover_type: 'Dose Calibration & Tooling Swap',
          },
          {
            from_product_id: 'SKU_CORE_PRODUCT_B',
            to_product_id: 'SKU_CORE_PRODUCT_A',
            setup_time_hours: 6.0,
            setup_cost: 920,
            changeover_type: 'Full Purge & Sanitization',
          },
        ],
      },
    ],
    initial_inventory: {
      RAW_ACTIVE_COMPOUND: 900,
      SKU_CORE_PRODUCT_A: 180,
      SKU_CORE_PRODUCT_B: 140,
    },
    open_pos: [
      {
        po_id: 'PO-2026-101',
        supplier_id: 'SUP_TIER1_RAW',
        product_id: 'RAW_ACTIVE_COMPOUND',
        destination_node_id: 'PLANT_PRIMARY_MFG',
        scheduled_bucket: 1,
        scheduled_bucket_label: 'W44 · Nov 02',
        ordered_qty: 1000,
        unit_price_usd: 18,
        status: 'CONFIRMED',
      },
    ],
    demands: [
      {
        demand_id: 'DEM_W44_A',
        customer_id: 'CUST_KEY_ACCOUNT',
        customer_name: 'National Retail & Clinical Account',
        product_id: 'SKU_CORE_PRODUCT_A',
        bucket: 1,
        bucket_label: 'W44 · Nov 02',
        baseline_units: 420,
        sensed_units: 460,
        drivers: {
          promo_uplift_pct: 0.1,
          price_elasticity: -1.2,
          baseline_price: 145,
          current_price: 145,
          macro_gdp_factor: 1.02,
          pos_sell_through_index: 1.04,
          weather_index: 1.01,
        },
        unmet_penalty_per_unit: 450,
      },
      {
        demand_id: 'DEM_W45_B',
        customer_id: 'CUST_KEY_ACCOUNT',
        customer_name: 'National Retail & Clinical Account',
        product_id: 'SKU_CORE_PRODUCT_B',
        bucket: 2,
        bucket_label: 'W45 · Nov 09',
        baseline_units: 380,
        sensed_units: 415,
        drivers: {
          promo_uplift_pct: 0.08,
          price_elasticity: -1.1,
          baseline_price: 195,
          current_price: 195,
          macro_gdp_factor: 1.02,
          pos_sell_through_index: 1.03,
          weather_index: 1.01,
        },
        unmet_penalty_per_unit: 520,
      },
    ],
  };

  return JSON.stringify(template, null, 2);
}

/**
 * Generates a downloadable multi-table CSV template guide file.
 */
export function generateBlankCsvTemplateBundle(): string {
  return [
    '# NEXORA CSV BUNDLE TEMPLATE (Save each section as a separate .csv file or upload supply_chain_test_fixture.json)',
    '',
    '--- facilities.csv ---',
    'node_id,name,node_type,region,currency,working_capital_limit_usd,storage_capacity_m3',
    'SUP_TIER1_RAW,Tier-1 Raw Material Supplier,SUPPLIER,EU-Central,EUR,1500000,3000',
    'PLANT_PRIMARY_MFG,Primary Manufacturing Plant,PLANT,US-East,USD,4500000,5000',
    'DC_REGIONAL_HUB,North America Distribution Hub,DISTRIBUTION_CENTER,US-Midwest,USD,2000000,4000',
    'CUST_KEY_ACCOUNT,National Clinical Account,CUSTOMER,US-National,USD,0,1000',
    '',
    '--- items.csv ---',
    'product_id,name,family,tier,shelf_life_buckets,storage_footprint_m3,batch_size_min,unit_sales_price,unit_variable_cost,currency',
    'RAW_ACTIVE_COMPOUND,Active Base Compound,Raw Inputs,RAW_MATERIAL,12,0.10,500,25,18,EUR',
    'SKU_CORE_PRODUCT_A,Core Finished Product A 50mg,Primary Line,FINISHED_GOOD,8,0.25,100,145,38,USD',
    'SKU_CORE_PRODUCT_B,Core Finished Product B 100mg,Primary Line,FINISHED_GOOD,8,0.30,100,195,52,USD',
    '',
    '--- bom.csv ---',
    'bom_id,component_id,parent_product_id,quantity_required,scrap_factor,lead_time_days',
    'BOM_EDGE_01,RAW_ACTIVE_COMPOUND,SKU_CORE_PRODUCT_A,1.5,0.02,5',
    'BOM_EDGE_02,RAW_ACTIVE_COMPOUND,SKU_CORE_PRODUCT_B,2.0,0.03,5',
    '',
    '--- work_centers.csv ---',
    'resource_id,name,plant_id,capacity_hours_per_bucket,overtime_cost_per_hour,max_overtime_hours,run_rate_hours_per_unit',
    'WC_ASSEMBLY_LINE_1,High-Speed Packaging Line 1,PLANT_PRIMARY_MFG,120,175,36,0.14',
    '',
    '--- open_pos.csv ---',
    'po_id,supplier_id,product_id,destination_node_id,scheduled_bucket,ordered_qty,unit_price_usd,status',
    'PO-2026-101,SUP_TIER1_RAW,RAW_ACTIVE_COMPOUND,PLANT_PRIMARY_MFG,1,1000,18,CONFIRMED',
    '',
    '--- demand_orders.csv ---',
    'demand_id,customer_id,customer_name,product_id,bucket,baseline_units,sensed_units,baseline_price,current_price,unmet_penalty_per_unit',
    'DEM_W44_A,CUST_KEY_ACCOUNT,National Clinical Account,SKU_CORE_PRODUCT_A,1,420,460,145,145,450',
  ].join('\n');
}
