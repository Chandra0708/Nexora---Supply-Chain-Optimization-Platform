import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  ControlTowerEngine,
  createCompanySeedState,
  createEmptyEnterpriseState,
  createEnterpriseSeedState,
  DriverBasedDemandEngine,
  EKGSupplyNetwork,
  ScenarioSandboxEngine,
  UnisonOptimizationSolver,
} from './src/engine.ts';
import {
  MultiLevelBOMItem,
  NodeType,
  OpenPurchaseOrder,
  ScenarioComparisonResult,
  ScenarioSimulationInput,
  SupplyChainFixturePayload,
  SupplyNode,
  UserSession,
  WorkCenter,
} from './src/types/ibp.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // Initialize In-Memory Enterprise Knowledge Graph in CLEAN / EMPTY State
  let state = createEmptyEnterpriseState();
  let companyName = '';
  let userSession: UserSession | null = null;
  let isInitialized = false;
  const resolvedExceptions = new Map<string, string>(); // exception_id -> applied_option_id
  let activeOptimizationOptions: {
    authorizeOvertimeOverride?: boolean;
    expediteAirEnabled?: boolean;
    supplierDelayBuckets?: number;
    resequenceCampaigns?: boolean;
  } = {};

  // Saved Copy-on-Write Scenario Branches
  const savedScenarios: ScenarioComparisonResult[] = [];

  const rebuildDefaultScenarios = () => {
    savedScenarios.length = 0;
    if (state.products.length === 0 || state.workCenters.size === 0) {
      return;
    }
    const wcList = Array.from(state.workCenters.values());
    const firstWc = wcList[0];
    const secondWc = wcList[1] || firstWc;
    const firstWcId = firstWc?.resource_id || 'WC_BLISTER_LINE_1';
    const secondWcId = secondWc?.resource_id || firstWcId;

    const primarySupplier = state.nodes.find(
      (n) => n.node_type === NodeType.SUPPLIER
    );
    const supplierShort = primarySupplier
      ? primarySupplier.name.split('(')[0].trim().split(' ').slice(0, 3).join(' ')
      : 'Tier-1 Supplier';
    const secondWcShort = secondWc
      ? secondWc.name.split(' ').slice(0, 4).join(' ')
      : secondWcId;
    const primaryCustomer = state.nodes.find(
      (n) => n.node_type === NodeType.CUSTOMER
    );
    const customerShort = primaryCustomer
      ? primaryCustomer.name.split('(')[0].trim().split(' ').slice(0, 3).join(' ')
      : 'Commercial Account';

    const seedBranch1 = ScenarioSandboxEngine.simulateBranch(
      state.ekg.products,
      state.workCenters,
      state.demands,
      state.ekg.lanes,
      state.buckets,
      state.initialInventory,
      {
        scenario_id: 'SCN_PORT_STRIKE_SURGE',
        scenario_name: `${supplierShort} Delay + 20% Peak Demand Surge`,
        demand_surge_pct: 20,
        capacity_cut_pct: 15,
        work_center_id: firstWcId,
        supplier_delay_buckets: 2,
        expedite_air_enabled: false,
        authorize_overtime_override: false,
      }
    );
    const seedBranch2 = ScenarioSandboxEngine.simulateBranch(
      state.ekg.products,
      state.workCenters,
      state.demands,
      state.ekg.lanes,
      state.buckets,
      state.initialInventory,
      {
        scenario_id: 'SCN_RECOVERY_PLAYBOOK',
        scenario_name: `${supplierShort} Delay + 20% Surge (With Overtime & Air Expedite)`,
        demand_surge_pct: 20,
        capacity_cut_pct: 15,
        work_center_id: firstWcId,
        supplier_delay_buckets: 2,
        expedite_air_enabled: true,
        authorize_overtime_override: true,
      }
    );
    const seedBranch3 = ScenarioSandboxEngine.simulateBranch(
      state.ekg.products,
      state.workCenters,
      state.demands,
      state.ekg.lanes,
      state.buckets,
      state.initialInventory,
      {
        scenario_id: 'SCN_STERILE_ISOLATOR_OUTAGE',
        scenario_name: `${secondWcShort} Outage (-30% Cap) + Weekend Overtime`,
        demand_surge_pct: 10,
        capacity_cut_pct: 30,
        work_center_id: secondWcId,
        supplier_delay_buckets: 0,
        expedite_air_enabled: false,
        authorize_overtime_override: true,
      }
    );
    const seedBranch4 = ScenarioSandboxEngine.simulateBranch(
      state.ekg.products,
      state.workCenters,
      state.demands,
      state.ekg.lanes,
      state.buckets,
      state.initialInventory,
      {
        scenario_id: 'SCN_EU_TENDER_EXPANSION',
        scenario_name: `${customerShort} Upside (+35% Demand + Air Charter)`,
        demand_surge_pct: 35,
        capacity_cut_pct: 0,
        work_center_id: 'ALL',
        supplier_delay_buckets: 1,
        expedite_air_enabled: true,
        authorize_overtime_override: true,
      }
    );
    savedScenarios.push(seedBranch1, seedBranch2, seedBranch3, seedBranch4);
  };

  const buildWorkspaceResponse = () => {
    const effectiveInventory = new Map<string, number>(state.initialInventory);
    const openPosList = Array.isArray(state.openPurchaseOrders)
      ? state.openPurchaseOrders
      : [];
    for (const po of openPosList) {
      if (
        po.scheduled_bucket === 1 &&
        state.ekg.products.get(po.product_id)?.tier === 'FINISHED_GOOD'
      ) {
        effectiveInventory.set(
          po.product_id,
          (effectiveInventory.get(po.product_id) || 0) + po.ordered_qty
        );
      }
    }

    const solver = new UnisonOptimizationSolver(
      state.ekg.products,
      state.workCenters,
      state.demands,
      state.ekg.lanes,
      state.buckets,
      effectiveInventory,
      activeOptimizationOptions
    );
    const currentPlan = solver.solve();
    const exceptions = ControlTowerEngine.generateExceptions(
      currentPlan,
      state.ekg.products,
      resolvedExceptions,
      state.workCenters,
      state.nodes,
      state.lanes
    );
    const defaultRootNode = state.nodes[0]?.node_id || '';
    const defaultPropagation = defaultRootNode
      ? state.ekg.propagateDisruption(
          defaultRootNode,
          2,
          state.products[0]?.product_id || null,
          state.demands
        )
      : {
          root_disruption_node: '',
          root_node_name: '',
          delay_buckets: 0,
          affected_product_id: null,
          nodes_impacted_count: 0,
          total_at_risk_revenue_usd: 0,
          total_at_risk_units: 0,
          pegging_chain: [],
          bom_explosion_path: [],
        };

    const initialInventoryObj: Record<string, number> = {};
    for (const [k, v] of state.initialInventory.entries()) {
      initialInventoryObj[k] = v;
    }

    return {
      status: 'SUCCESS',
      is_initialized: isInitialized,
      user_session: userSession,
      company_name: companyName || userSession?.company_name || 'Unconfigured Workspace',
      nodes: state.nodes,
      products: state.products,
      bom_edges: state.bomEdges,
      lanes: state.lanes,
      work_centers: Array.from(state.workCenters.values()),
      buckets: state.buckets,
      demands: state.demands,
      initial_inventory: initialInventoryObj,
      open_pos: openPosList,
      active_options: activeOptimizationOptions,
      current_plan: currentPlan,
      exceptions,
      default_propagation: defaultPropagation,
      saved_scenarios: savedScenarios,
    };
  };

  // ============================================================================
  // API ENDPOINTS
  // ============================================================================

  // 0. Full Workspace State Snapshot
  app.get('/api/v1/state', (_req, res) => {
    res.json(buildWorkspaceResponse());
  });

  // 0a. Enterprise Session Login (Initializes CLEAN / EMPTY Planning State)
  app.post('/api/v1/session/login', (req, res) => {
    const {
      company_name = 'Apex Global Manufacturing',
      work_email = 'planner@enterprise.io',
      role = 'Supply Chain Planner',
    } = req.body || {};

    userSession = {
      company_name: String(company_name).trim(),
      work_email: String(work_email).trim(),
      role:
        role === 'Operations Lead' ? 'Operations Lead' : 'Supply Chain Planner',
      authenticated_at: new Date().toISOString(),
    };
    companyName = userSession.company_name;

    // Initialize clean / empty planning engine state upon login
    state = createEmptyEnterpriseState();
    isInitialized = false;
    resolvedExceptions.clear();
    activeOptimizationOptions = {};
    savedScenarios.length = 0;

    res.json(buildWorkspaceResponse());
  });

  // 0b. Logout / Switch Organization
  app.post('/api/v1/session/logout', (_req, res) => {
    userSession = null;
    companyName = '';
    state = createEmptyEnterpriseState();
    isInitialized = false;
    resolvedExceptions.clear();
    activeOptimizationOptions = {};
    savedScenarios.length = 0;

    res.json(buildWorkspaceResponse());
  });

  // 0c. Clear Workspace Data (Return to Clean Onboarding Screen)
  app.post('/api/v1/workspace/clear', (_req, res) => {
    state = createEmptyEnterpriseState();
    isInitialized = false;
    resolvedExceptions.clear();
    activeOptimizationOptions = {};
    savedScenarios.length = 0;

    res.json(buildWorkspaceResponse());
  });

  // 0d. Fetch Demo Sandbox Fixture Payload (dynamically tailored to the active company)
  app.get('/api/v1/demo-fixture', (req, res) => {
    const requestedCompany =
      (typeof req.query.company === 'string' && req.query.company.trim()) ||
      userSession?.company_name ||
      companyName ||
      'AstraBio Cold-Chain Therapeutics';
    const seed = createCompanySeedState(requestedCompany);
    const initialInventoryObj: Record<string, number> = {};
    for (const [k, v] of seed.initialInventory.entries()) {
      initialInventoryObj[k] = v;
    }
    const fixture: SupplyChainFixturePayload = {
      company_name: requestedCompany,
      nodes: seed.nodes,
      products: seed.products,
      bom_edges: seed.bomEdges,
      lanes: seed.lanes,
      work_centers: Array.from(seed.workCenters.values()),
      demands: seed.demands,
      initial_inventory: initialInventoryObj,
      open_pos: seed.openPurchaseOrders,
    };
    res.json(fixture);
  });

  // 1. Kinaxis-Style Real-Time DAG Disruption Propagation
  app.post('/api/v1/plan/propagate', (req, res) => {
    const {
      disrupted_node_id = state.nodes[0]?.node_id || 'SUP_BASEL_API',
      delay_buckets = 2,
      product_id = null,
    } = req.body || {};

    const propagationResult = state.ekg.propagateDisruption(
      disrupted_node_id,
      Number(delay_buckets),
      product_id || null,
      state.demands
    );

    res.json({
      status: 'SUCCESS',
      propagation_result: propagationResult,
    });
  });

  // 2. o9-Style Multivariate Driver-Based Demand Sensing Update
  app.post('/api/v1/demand/sense', (req, res) => {
    const {
      product_id,
      promo_uplift_pct,
      current_price,
      pos_sell_through_index,
      macro_gdp_factor,
      weather_index,
    } = req.body || {};

    state.demands = state.demands.map((sig) => {
      if (product_id && product_id !== 'ALL' && sig.product_id !== product_id) {
        return sig;
      }
      const updatedDrivers = {
        ...sig.drivers,
        promo_uplift_pct:
          promo_uplift_pct !== undefined
            ? Number(promo_uplift_pct)
            : sig.drivers.promo_uplift_pct,
        current_price:
          current_price !== undefined ? Number(current_price) : sig.drivers.current_price,
        pos_sell_through_index:
          pos_sell_through_index !== undefined
            ? Number(pos_sell_through_index)
            : sig.drivers.pos_sell_through_index,
        macro_gdp_factor:
          macro_gdp_factor !== undefined
            ? Number(macro_gdp_factor)
            : sig.drivers.macro_gdp_factor,
        weather_index:
          weather_index !== undefined ? Number(weather_index) : sig.drivers.weather_index,
      };
      const updatedSignal = { ...sig, drivers: updatedDrivers };
      updatedSignal.sensed_units =
        DriverBasedDemandEngine.calculateSensedDemand(updatedSignal);
      return updatedSignal;
    });

    res.json(buildWorkspaceResponse());
  });

  // 3. OMP-Style Unison Tactical-to-Operational Finite MILP Schedule
  app.post('/api/v1/optimize/unison', (req, res) => {
    const {
      authorize_overtime_override,
      expedite_air_enabled,
      resequence_campaigns,
      supplier_delay_buckets,
    } = req.body || {};

    if (authorize_overtime_override !== undefined) {
      activeOptimizationOptions.authorizeOvertimeOverride = Boolean(
        authorize_overtime_override
      );
    }
    if (expedite_air_enabled !== undefined) {
      activeOptimizationOptions.expediteAirEnabled = Boolean(expedite_air_enabled);
    }
    if (resequence_campaigns !== undefined) {
      activeOptimizationOptions.resequenceCampaigns = Boolean(resequence_campaigns);
    }
    if (supplier_delay_buckets !== undefined) {
      activeOptimizationOptions.supplierDelayBuckets = Number(supplier_delay_buckets);
    }

    const snap = buildWorkspaceResponse();
    res.json({
      status: 'SUCCESS',
      active_options: snap.active_options,
      results: snap.current_plan,
      exceptions: snap.exceptions,
    });
  });

  // 4. Kinaxis-Style Copy-on-Write Scenario Simulation
  app.post('/api/v1/scenarios/simulate', (req, res) => {
    const payload: ScenarioSimulationInput = {
      scenario_name: req.body?.scenario_name || 'What-If Branch Simulation',
      demand_surge_pct: Number(req.body?.demand_surge_pct ?? 15),
      capacity_cut_pct: Number(req.body?.capacity_cut_pct ?? 10),
      work_center_id: req.body?.work_center_id || 'WC_BLISTER_LINE_1',
      supplier_delay_buckets: Number(req.body?.supplier_delay_buckets ?? 1),
      expedite_air_enabled: Boolean(req.body?.expedite_air_enabled ?? false),
      authorize_overtime_override: Boolean(req.body?.authorize_overtime_override ?? false),
    };

    const comparison = ScenarioSandboxEngine.simulateBranch(
      state.ekg.products,
      state.workCenters,
      state.demands,
      state.ekg.lanes,
      state.buckets,
      state.initialInventory,
      payload
    );

    savedScenarios.unshift(comparison);
    if (savedScenarios.length > 8) savedScenarios.pop();

    res.json({
      status: 'SUCCESS',
      scenario_analysis: comparison,
      saved_scenarios: savedScenarios,
    });
  });

  // Merge a Scenario Branch into Active Baseline
  app.post('/api/v1/scenarios/merge', (req, res) => {
    const { scenario_id } = req.body || {};
    const found = savedScenarios.find((s) => s.scenario_id === scenario_id);
    if (!found) {
      res.status(404).json({ status: 'ERROR', message: 'Scenario branch not found' });
      return;
    }

    const overrides = found.overrides;
    const surgeMultiplier = 1.0 + (overrides.demand_surge_pct || 0) / 100;
    state.demands = state.demands.map((d) => ({
      ...d,
      sensed_units: Math.round(d.sensed_units * surgeMultiplier),
    }));

    activeOptimizationOptions = {
      authorizeOvertimeOverride: overrides.authorize_overtime_override,
      expediteAirEnabled: overrides.expedite_air_enabled,
      supplierDelayBuckets: overrides.supplier_delay_buckets,
    };

    res.json(buildWorkspaceResponse());
  });

  // 5. Control Tower Exceptions & Prescriptive Resolution Execution
  app.get('/api/v1/control-tower/exceptions', (_req, res) => {
    const snap = buildWorkspaceResponse();
    res.json({
      status: 'SUCCESS',
      exceptions_count: snap.exceptions.filter((r) => r.status === 'OPEN').length,
      resolutions: snap.exceptions,
    });
  });

  app.post('/api/v1/control-tower/resolve', (req, res) => {
    const { exception_id, option_id, action_code } = req.body || {};

    if (exception_id && option_id) {
      resolvedExceptions.set(exception_id, option_id);
    }

    if (action_code === 'AUTHORIZE_OVERTIME') {
      activeOptimizationOptions.authorizeOvertimeOverride = true;
    } else if (action_code === 'EXPEDITE_INTERSITE_TRANSFER') {
      activeOptimizationOptions.expediteAirEnabled = true;
    } else if (action_code === 'RESEQUENCE_CAMPAIGN_BATCH') {
      activeOptimizationOptions.resequenceCampaigns = true;
    }

    res.json(buildWorkspaceResponse());
  });

  // ============================================================================
  // 6. MASTER DATA & CONFIGURATION ENDPOINTS (Import Fixture & Live Table Edits)
  // ============================================================================

  // Import full or partial JSON/CSV fixture payload
  app.post('/api/v1/master-data/import', (req, res) => {
    const payload: SupplyChainFixturePayload = req.body || {};

    if (payload.company_name) {
      companyName = payload.company_name;
    }
    if (Array.isArray(payload.nodes) && payload.nodes.length > 0) {
      state.nodes = payload.nodes;
    }
    if (Array.isArray(payload.products) && payload.products.length > 0) {
      state.products = payload.products;
    }
    if (Array.isArray(payload.bom_edges) && payload.bom_edges.length > 0) {
      state.bomEdges = payload.bom_edges;
    }
    if (Array.isArray(payload.lanes) && payload.lanes.length > 0) {
      state.lanes = payload.lanes;
    }
    if (Array.isArray(payload.work_centers) && payload.work_centers.length > 0) {
      state.workCenters = new Map(
        payload.work_centers.map((wc) => [wc.resource_id, wc])
      );
    }
    if (Array.isArray(payload.demands) && payload.demands.length > 0) {
      state.demands = payload.demands.map((d) => ({
        ...d,
        sensed_units:
          d.sensed_units ?? DriverBasedDemandEngine.calculateSensedDemand(d),
      }));
    }
    if (payload.initial_inventory && typeof payload.initial_inventory === 'object') {
      state.initialInventory = new Map(
        Object.entries(payload.initial_inventory).map(([k, v]) => [k, Number(v)])
      );
    }
    if (Array.isArray(payload.open_pos)) {
      state.openPurchaseOrders = payload.open_pos;
    }

    // Rebuild EKG Graph
    const newEkg = new EKGSupplyNetwork();
    state.nodes.forEach((n) => newEkg.registerNode(n));
    state.products.forEach((p) => newEkg.registerProduct(p));
    state.bomEdges.forEach((b) => newEkg.registerBOMEdge(b));
    state.lanes.forEach((l) => newEkg.registerLane(l));
    state.ekg = newEkg;

    isInitialized = state.nodes.length > 0 && state.products.length > 0;
    resolvedExceptions.clear();
    rebuildDefaultScenarios();

    res.json(buildWorkspaceResponse());
  });

  // Update Master Data Tables (Nodes, BOMs, Work Centers & Changeover Matrix, Inventory & Open POs)
  app.post('/api/v1/master-data/update', (req, res) => {
    const {
      nodes,
      bom_edges,
      work_centers,
      initial_inventory,
      open_pos,
    }: {
      nodes?: SupplyNode[];
      bom_edges?: MultiLevelBOMItem[];
      work_centers?: WorkCenter[];
      initial_inventory?: Record<string, number>;
      open_pos?: OpenPurchaseOrder[];
    } = req.body || {};

    if (Array.isArray(nodes)) {
      state.nodes = nodes;
    }
    if (Array.isArray(bom_edges)) {
      state.bomEdges = bom_edges;
    }
    if (Array.isArray(work_centers)) {
      state.workCenters = new Map(
        work_centers.map((wc) => [wc.resource_id, wc])
      );
    }
    if (initial_inventory && typeof initial_inventory === 'object') {
      state.initialInventory = new Map(
        Object.entries(initial_inventory).map(([k, v]) => [k, Number(v)])
      );
    }
    if (Array.isArray(open_pos)) {
      state.openPurchaseOrders = open_pos;
    }

    // Re-sync EKG Graph
    const newEkg = new EKGSupplyNetwork();
    state.nodes.forEach((n) => newEkg.registerNode(n));
    state.products.forEach((p) => newEkg.registerProduct(p));
    state.bomEdges.forEach((b) => newEkg.registerBOMEdge(b));
    state.lanes.forEach((l) => newEkg.registerLane(l));
    state.ekg = newEkg;

    isInitialized = state.nodes.length > 0 && state.products.length > 0;
    rebuildDefaultScenarios();

    res.json(buildWorkspaceResponse());
  });

  // Reset Baseline State to Company-Appropriate Default Dataset
  app.post('/api/v1/reset', (_req, res) => {
    const activeCompany =
      userSession?.company_name ||
      companyName ||
      'AstraBio Cold-Chain Therapeutics';
    state = createCompanySeedState(activeCompany);
    companyName = activeCompany;
    isInitialized = true;
    resolvedExceptions.clear();
    activeOptimizationOptions = {};
    rebuildDefaultScenarios();

    res.json(buildWorkspaceResponse());
  });

  // Vite Middleware for Development or Static Serving for Production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Nexora Concurrent Execution Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
