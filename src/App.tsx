import React, { useEffect, useState, useMemo } from 'react';
import {
  GitBranch,
  AlertTriangle,
  Sliders,
  Play,
  RotateCcw,
  CheckCircle2,
  ArrowRight,
  Layers,
  Activity,
  FileCode,
  Search,
  ChevronRight,
  Download,
  GitMerge,
} from 'lucide-react';
import {
  ControlTowerException,
  DemandSignal,
  Lane,
  MultiLevelBOMItem,
  NodeType,
  OpenPurchaseOrder,
  Product,
  PropagationResult,
  ScenarioComparisonResult,
  ScenarioSimulationInput,
  SupplyChainFixturePayload,
  SupplyNode,
  UnisonOptimizationResult,
  UserSession,
  WorkCenter,
} from './types/ibp.ts';
import { PYTHON_FASTAPI_BLUEPRINT } from './data/pythonBlueprint.ts';
import { MasterDataConfigView } from './components/MasterDataConfigView.tsx';
import { EnterpriseOnboardingFlow } from './components/EnterpriseOnboardingFlow.tsx';

type ActiveModule =
  | 'EKG_DEMAND'
  | 'UNISON_SCHEDULER'
  | 'SCENARIO_SANDBOX'
  | 'CONTROL_TOWER'
  | 'MASTER_DATA'
  | 'API_BLUEPRINT';

interface WorkspaceState {
  is_initialized?: boolean;
  user_session?: UserSession | null;
  company_name?: string;
  nodes: SupplyNode[];
  products: Product[];
  bom_edges: MultiLevelBOMItem[];
  lanes: Lane[];
  work_centers: WorkCenter[];
  buckets: { bucket: number; label: string }[];
  demands: DemandSignal[];
  initial_inventory: Record<string, number>;
  open_pos: OpenPurchaseOrder[];
  active_options: {
    authorizeOvertimeOverride?: boolean;
    expediteAirEnabled?: boolean;
    supplierDelayBuckets?: number;
    resequenceCampaigns?: boolean;
  };
  current_plan: UnisonOptimizationResult;
  exceptions: ControlTowerException[];
  default_propagation: PropagationResult;
  saved_scenarios: ScenarioComparisonResult[];
}

export default function App() {
  const [activeModule, setActiveModule] = useState<ActiveModule>('EKG_DEMAND');
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionBusy, setActionBusy] = useState<boolean>(false);

  // Module 1: EKG & Demand Sensing state
  const [selectedDisruptedNode, setSelectedDisruptedNode] =
    useState<string>('SUP_BASEL_API');
  const [disruptionDelayBuckets, setDisruptionDelayBuckets] = useState<number>(2);
  const [selectedComponentFilter, setSelectedComponentFilter] =
    useState<string>('RAW_PEPTIDE_API');
  const [propagationData, setPropagationData] = useState<PropagationResult | null>(
    null
  );

  const [selectedDemandSku, setSelectedDemandSku] =
    useState<string>('SKU_CARDIO_50MG');
  const [promoLiftPct, setPromoLiftPct] = useState<number>(15);
  const [unitPriceOverride, setUnitPriceOverride] = useState<number>(132);
  const [posIndexOverride, setPosIndexOverride] = useState<number>(1.06);
  const [weatherIndexOverride, setWeatherIndexOverride] = useState<number>(1.03);

  // Module 2: Unison Scheduler state
  const [selectedWorkCenterFilter, setSelectedWorkCenterFilter] =
    useState<string>('ALL');
  const [matrixWcId, setMatrixWcId] = useState<string>('WC_BLISTER_LINE_1');

  // Module 3: Scenario Sandbox state
  const [scenarioForm, setScenarioForm] = useState<ScenarioSimulationInput>({
    scenario_name: 'Red Sea Transit Halt + 25% Cardio Surge',
    demand_surge_pct: 25,
    capacity_cut_pct: 15,
    work_center_id: 'WC_BLISTER_LINE_1',
    supplier_delay_buckets: 2,
    expedite_air_enabled: false,
    authorize_overtime_override: true,
  });
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<string[]>([]);
  const [varianceReferenceId, setVarianceReferenceId] = useState<string>('BASELINE');
  const [showCostDecompositionRows, setShowCostDecompositionRows] =
    useState<boolean>(true);
  const [heatmapNormMode, setHeatmapNormMode] = useState<
    'BENCHMARK_DELTA' | 'MIN_MAX_RANGE'
  >('BENCHMARK_DELTA');
  const [heatmapCostFilter, setHeatmapCostFilter] = useState<
    'ALL' | 'HOLDING_ONLY' | 'CHANGEOVER_ONLY'
  >('ALL');

  // Enterprise SLA Thresholds & Real-Time Header Alerting State
  const [otifThresholdPct, setOtifThresholdPct] = useState<number>(95.0);
  const [marginThresholdPct, setMarginThresholdPct] = useState<number>(68.0);
  const [alertMonitorScenarios, setAlertMonitorScenarios] =
    useState<boolean>(true);

  // Module 4: Control Tower search/filter
  const [exceptionFilter, setExceptionFilter] = useState<'ALL' | 'OPEN' | 'RESOLVED'>(
    'ALL'
  );
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Module 5: API Explorer live tester
  const [apiEndpointToTest, setApiEndpointToTest] = useState<string>(
    '/api/v1/optimize/unison'
  );
  const [apiLiveResponse, setApiLiveResponse] = useState<string>('');

  const fetchInitialWorkspace = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/state');
      const data = await res.json();
      setWorkspace(data);
      setPropagationData(data.default_propagation);
      if (data.saved_scenarios && data.saved_scenarios.length > 0) {
        setSelectedScenarioIds(
          data.saved_scenarios.map((s: ScenarioComparisonResult) => s.scenario_id)
        );
      }
      const firstNonCustomer = data.nodes?.find(
        (n: SupplyNode) => n.node_type !== NodeType.CUSTOMER
      );
      if (firstNonCustomer) {
        setSelectedDisruptedNode(firstNonCustomer.node_id);
      }
      const firstRaw = data.products?.find(
        (p: Product) => p.tier !== 'FINISHED_GOOD'
      );
      setSelectedComponentFilter(firstRaw ? firstRaw.product_id : 'ALL');
      const firstFg = data.products?.find(
        (p: Product) => p.tier === 'FINISHED_GOOD'
      );
      if (firstFg) {
        setSelectedDemandSku(firstFg.product_id);
        const sample = data.demands?.find(
          (d: DemandSignal) => d.product_id === firstFg.product_id
        );
        if (sample) {
          setPromoLiftPct(Math.round(sample.drivers.promo_uplift_pct * 100));
          setUnitPriceOverride(sample.drivers.current_price);
          setPosIndexOverride(sample.drivers.pos_sell_through_index);
          setWeatherIndexOverride(sample.drivers.weather_index);
        }
      }
      if (data.work_centers && data.work_centers.length > 0) {
        const firstWc = data.work_centers[0];
        setMatrixWcId(firstWc.resource_id);
        setScenarioForm((prev) => ({
          ...prev,
          work_center_id: firstWc.resource_id,
          scenario_name: `${
            firstNonCustomer?.name.split(' ')[0] || 'Upstream'
          } Halt + 25% ${firstFg?.name.split(' ')[0] || 'Demand'} Surge`,
        }));
      }
      setApiLiveResponse(
        JSON.stringify(
          {
            endpoint: 'GET /api/v1/state',
            solver_status: data.current_plan.status,
            solve_time_ms: data.current_plan.solve_time_ms,
            otif_percentage: data.current_plan.otif_percentage,
            total_cost_usd: data.current_plan.total_cost,
            cost_breakdown: data.current_plan.cost_breakdown,
          },
          null,
          2
        )
      );
    } catch (err) {
      console.error('Failed to load IBP state:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInitialWorkspace();
  }, []);

  // Handlers
  const handleRunPropagation = async (
    nodeId = selectedDisruptedNode,
    delay = disruptionDelayBuckets,
    compId = selectedComponentFilter
  ) => {
    setActionBusy(true);
    try {
      const res = await fetch('/api/v1/plan/propagate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          disrupted_node_id: nodeId,
          delay_buckets: delay,
          product_id: compId === 'ALL' ? null : compId,
        }),
      });
      const json = await res.json();
      if (json.propagation_result) {
        setPropagationData(json.propagation_result);
      }
    } finally {
      setActionBusy(false);
    }
  };

  const handleApplyDemandDrivers = async () => {
    setActionBusy(true);
    try {
      const res = await fetch('/api/v1/demand/sense', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: selectedDemandSku,
          promo_uplift_pct: promoLiftPct / 100,
          current_price: unitPriceOverride,
          pos_sell_through_index: posIndexOverride,
          weather_index: weatherIndexOverride,
        }),
      });
      const json = await res.json();
      if (workspace && json.current_plan) {
        setWorkspace({
          ...workspace,
          demands: json.demands,
          current_plan: json.current_plan,
          exceptions: json.exceptions,
        });
      }
    } finally {
      setActionBusy(false);
    }
  };

  const handleRunUnisonSolver = async (overrides?: {
    authorize_overtime_override?: boolean;
    expedite_air_enabled?: boolean;
    resequence_campaigns?: boolean;
  }) => {
    setActionBusy(true);
    try {
      const res = await fetch('/api/v1/optimize/unison', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(overrides || {}),
      });
      const json = await res.json();
      if (workspace && json.results) {
        setWorkspace({
          ...workspace,
          active_options: json.active_options,
          current_plan: json.results,
          exceptions: json.exceptions,
        });
      }
    } finally {
      setActionBusy(false);
    }
  };

  const handleRunScenarioBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionBusy(true);
    try {
      const res = await fetch('/api/v1/scenarios/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scenarioForm),
      });
      const json = await res.json();
      if (json.scenario_analysis) {
        const newId = json.scenario_analysis.scenario_id;
        setSelectedScenarioIds((prev) =>
          prev.includes(newId) ? prev : [newId, ...prev]
        );
        if (workspace) {
          setWorkspace({
            ...workspace,
            saved_scenarios: json.saved_scenarios,
          });
        }
      }
    } finally {
      setActionBusy(false);
    }
  };

  const handleToggleScenarioSelection = (scenarioId: string) => {
    setSelectedScenarioIds((prev) =>
      prev.includes(scenarioId)
        ? prev.filter((id) => id !== scenarioId)
        : [...prev, scenarioId]
    );
  };

  const handlePromoteScenarioToBaseline = async (scenarioId: string) => {
    setActionBusy(true);
    try {
      const res = await fetch('/api/v1/scenarios/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario_id: scenarioId }),
      });
      const json = await res.json();
      if (workspace && json.current_plan) {
        setWorkspace({
          ...workspace,
          demands: json.demands,
          active_options: json.active_options,
          current_plan: json.current_plan,
          exceptions: json.exceptions,
        });
      }
    } finally {
      setActionBusy(false);
    }
  };

  const handleApplyPrescription = async (
    exceptionId: string,
    optionId: string,
    actionCode: string
  ) => {
    setActionBusy(true);
    try {
      const res = await fetch('/api/v1/control-tower/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exception_id: exceptionId,
          option_id: optionId,
          action_code: actionCode,
        }),
      });
      const json = await res.json();
      if (workspace && json.current_plan) {
        setWorkspace({
          ...workspace,
          active_options: json.active_options,
          current_plan: json.current_plan,
          exceptions: json.exceptions,
        });
      }
    } finally {
      setActionBusy(false);
    }
  };

  const applyFullWorkspaceSnapshot = (json: WorkspaceState) => {
    setWorkspace(json);
    if (json.default_propagation) {
      setPropagationData(json.default_propagation);
    }
    if (json.saved_scenarios && json.saved_scenarios.length > 0) {
      setSelectedScenarioIds(
        json.saved_scenarios.map((s: ScenarioComparisonResult) => s.scenario_id)
      );
    }
    const firstNonCustomer = json.nodes?.find(
      (n) => n.node_type !== NodeType.CUSTOMER
    );
    if (firstNonCustomer) {
      setSelectedDisruptedNode(firstNonCustomer.node_id);
    }
    const firstRaw = json.products?.find((p) => p.tier !== 'FINISHED_GOOD');
    setSelectedComponentFilter(firstRaw ? firstRaw.product_id : 'ALL');
    const firstFg = json.products?.find((p) => p.tier === 'FINISHED_GOOD');
    if (firstFg) {
      setSelectedDemandSku(firstFg.product_id);
      const sample = json.demands?.find(
        (d) => d.product_id === firstFg.product_id
      );
      if (sample) {
        setPromoLiftPct(Math.round(sample.drivers.promo_uplift_pct * 100));
        setUnitPriceOverride(sample.drivers.current_price);
        setPosIndexOverride(sample.drivers.pos_sell_through_index);
        setWeatherIndexOverride(sample.drivers.weather_index);
      }
    }
    if (json.work_centers && json.work_centers.length > 0) {
      const firstWc = json.work_centers[0];
      setMatrixWcId(firstWc.resource_id);
      setScenarioForm((prev) => ({
        ...prev,
        work_center_id: firstWc.resource_id,
        scenario_name: `${
          firstNonCustomer?.name.split(' ')[0] || 'Upstream'
        } Halt + 25% ${firstFg?.name.split(' ')[0] || 'Demand'} Surge`,
      }));
    }
  };

  const handleResetBaseline = async (companyOverride?: string) => {
    setActionBusy(true);
    try {
      const res = await fetch('/api/v1/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          companyOverride ? { company_name: companyOverride } : {}
        ),
      });
      const json = await res.json();
      if (json.current_plan) {
        applyFullWorkspaceSnapshot(json);
      }
    } finally {
      setActionBusy(false);
    }
  };

  const handleUpdateMasterData = async (
    payload: Partial<SupplyChainFixturePayload>
  ) => {
    setActionBusy(true);
    try {
      const res = await fetch('/api/v1/master-data/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.current_plan) {
        applyFullWorkspaceSnapshot(json);
      }
    } finally {
      setActionBusy(false);
    }
  };

  const handleImportFixture = async (payload: SupplyChainFixturePayload) => {
    setActionBusy(true);
    try {
      const res = await fetch('/api/v1/master-data/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.current_plan) {
        applyFullWorkspaceSnapshot(json);
      }
    } finally {
      setActionBusy(false);
    }
  };

  const handleSessionLogin = async (
    companyName: string,
    workEmail: string,
    role: 'Supply Chain Planner' | 'Operations Lead'
  ) => {
    setActionBusy(true);
    try {
      const res = await fetch('/api/v1/session/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: companyName,
          work_email: workEmail,
          role,
        }),
      });
      const json = await res.json();
      applyFullWorkspaceSnapshot(json);
    } finally {
      setActionBusy(false);
    }
  };

  const handleSessionLogout = async () => {
    setActionBusy(true);
    try {
      const res = await fetch('/api/v1/session/logout', { method: 'POST' });
      const json = await res.json();
      applyFullWorkspaceSnapshot(json);
    } finally {
      setActionBusy(false);
    }
  };

  const handleClearWorkspaceToOnboarding = async () => {
    setActionBusy(true);
    try {
      const res = await fetch('/api/v1/workspace/clear', { method: 'POST' });
      const json = await res.json();
      applyFullWorkspaceSnapshot(json);
    } finally {
      setActionBusy(false);
    }
  };

  const handleLaunchDigitalTwin = async (payload: SupplyChainFixturePayload) => {
    await handleImportFixture(payload);
    setActiveModule('CONTROL_TOWER');
  };

  const handleExportScheduleCsv = () => {
    if (!workspace) return;
    const headers = [
      'Slot ID',
      'Work Center',
      'Product SKU',
      'Horizon Bucket',
      'Planned Qty',
      'Run Hours',
      'Setup Hours',
      'Setup Cost USD',
      'Overtime Hours',
    ];
    const rows = workspace.current_plan.production_plan.map((s) => [
      s.slot_id,
      s.work_center_id,
      s.product_id,
      s.bucket_label,
      s.quantity,
      s.run_hours,
      s.setup_hours,
      s.setup_cost,
      s.overtime_hours,
    ]);
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'unison_finite_schedule.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleTestLiveEndpoint = async (endpoint: string) => {
    setApiEndpointToTest(endpoint);
    setActionBusy(true);
    try {
      let res: Response;
      if (endpoint === '/api/v1/plan/propagate') {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            disrupted_node_id: selectedDisruptedNode,
            delay_buckets: disruptionDelayBuckets,
            product_id: selectedComponentFilter,
          }),
        });
      } else if (endpoint === '/api/v1/optimize/unison') {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(workspace?.active_options || {}),
        });
      } else if (endpoint === '/api/v1/scenarios/simulate') {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(scenarioForm),
        });
      } else {
        res = await fetch('/api/v1/control-tower/exceptions');
      }
      const data = await res.json();
      setApiLiveResponse(JSON.stringify(data, null, 2));
    } finally {
      setActionBusy(false);
    }
  };

  const finishedProducts = useMemo(
    () =>
      workspace?.products.filter((p) => p.tier === 'FINISHED_GOOD') || [],
    [workspace]
  );

  // Company-specific metadata, domain terminology, and Units of Measure
  const companyMeta = useMemo(() => {
    const companyName =
      workspace?.company_name ||
      workspace?.user_session?.company_name ||
      'AstraBio Cold-Chain Therapeutics';
    const lowerName = companyName.toLowerCase();
    const isSemi =
      lowerName.includes('semi') ||
      lowerName.includes('foundry') ||
      lowerName.includes('nordic') ||
      lowerName.includes('silicon') ||
      (workspace?.products || []).some(
        (p) => p.unit_of_measure === 'wafers' || p.unit_of_measure === 'dies'
      );
    const isBattery =
      lowerName.includes('volt') ||
      lowerName.includes('battery') ||
      lowerName.includes('ev') ||
      lowerName.includes('energy') ||
      (workspace?.products || []).some(
        (p) =>
          p.unit_of_measure === 'kWh packs' || p.unit_of_measure === 'modules'
      );

    const productUomMap = new Map<string, string>();
    for (const p of workspace?.products || []) {
      if (p.unit_of_measure) {
        productUomMap.set(p.product_id, p.unit_of_measure);
      } else if (isSemi) {
        productUomMap.set(
          p.product_id,
          p.tier === 'FINISHED_GOOD' ? 'dies' : 'wafers'
        );
      } else if (isBattery) {
        productUomMap.set(
          p.product_id,
          p.tier === 'FINISHED_GOOD' ? 'kWh packs' : 'metric tons'
        );
      } else {
        productUomMap.set(
          p.product_id,
          p.tier === 'FINISHED_GOOD' ? 'blister packs' : 'kg'
        );
      }
    }

    const fgs = (workspace?.products || []).filter(
      (p) => p.tier === 'FINISHED_GOOD'
    );
    const uniqueFgUoms = Array.from(
      new Set(fgs.map((p) => productUomMap.get(p.product_id)).filter(Boolean))
    ) as string[];
    const primaryUom =
      uniqueFgUoms.length === 1
        ? uniqueFgUoms[0]
        : uniqueFgUoms.length > 1
        ? uniqueFgUoms.slice(0, 2).join(' / ')
        : isSemi
        ? 'dies / wafers'
        : isBattery
        ? 'kWh packs / modules'
        : 'blister packs / vials';

    const shortPrimaryUom =
      uniqueFgUoms[0] ||
      (isSemi ? 'dies' : isBattery ? 'kWh packs' : 'blister packs');

    const getProductUom = (productId?: string | null) => {
      if (!productId) return shortPrimaryUom;
      return productUomMap.get(productId) || shortPrimaryUom;
    };

    const firstRaw = (workspace?.products || []).find(
      (p) => p.tier !== 'FINISHED_GOOD'
    );
    const firstSupplier = (workspace?.nodes || []).find(
      (n) => n.node_type === NodeType.SUPPLIER
    );

    if (isSemi) {
      return {
        industryTag: 'Semiconductor Foundry & Wafer Fab',
        primaryUom,
        shortPrimaryUom,
        getProductUom,
        wipBufferLabel: 'Fab Cleanroom Stock + Wafer Die Bank WIP',
        storageFootprintTitle:
          'Time-Phased Inventory, Wafer Fab Output, Fulfilled Demand & Cleanroom FOUP Footprint',
        storageColumnLabel: 'FOUP Pod Volume',
        posDriverLabel: 'Hyperscaler & Auto OEM Pull Index',
        externalDriverLabel: 'Cleanroom Yield & Litho Index',
        changeoverMatrixTitle:
          'EUV Reticle Mask Alignment & Chamber Purge Validation Costs',
        productionCostLabel: 'Wafer Fab Lithography & CoWoS Packaging',
        transitCostLabel: 'Shock-Monitored Air Freight & Fab Duties',
        upstreamDelayLabel: `Wafer / Optics Supplier Delay (${
          firstSupplier?.name.split(' ')[0] || 'Tier-2'
        })`,
        expediteCheckboxLabel: `Enable Dedicated Air Charter for ${
          firstRaw?.name.split(' ')[0] || 'Wafer'
        } Replenishment`,
        holdingSubtitle: 'Cleanroom FOUP nitrogen-purged WIP carrying cost',
      };
    }

    if (isBattery) {
      return {
        industryTag: 'Gigafactory EV Battery & Energy Storage',
        primaryUom,
        shortPrimaryUom,
        getProductUom,
        wipBufferLabel: 'Cell Formation Stock + High-Voltage Pack WIP',
        storageFootprintTitle:
          'Time-Phased Inventory, Gigafactory Pack Output, Fulfilled Demand & Hazmat Bay Footprint',
        storageColumnLabel: 'Hazmat Bay Volume',
        posDriverLabel: 'EV OEM Assembly Line Pull Index',
        externalDriverLabel: 'Grid Storage Seasonal Peak Index',
        changeoverMatrixTitle:
          'Cathode Slurry Line Purge & Laser Fixture Calibration Costs',
        productionCostLabel: 'Electrode Coating, Cell Formation & Pack Assembly',
        transitCostLabel: 'Class-9 Hazmat Heavy Freight & Duties',
        upstreamDelayLabel: `Lithium / Cathode Supplier Delay (${
          firstSupplier?.name.split(' ')[0] || 'Tier-2'
        })`,
        expediteCheckboxLabel: `Enable Priority Charter for ${
          firstRaw?.name.split(' ')[0] || 'Cathode'
        } Replenishment`,
        holdingSubtitle: 'Climate-controlled Class-9 battery WIP carrying cost',
      };
    }

    return {
      industryTag: 'Biologics & Cold-Chain Pharmaceuticals',
      primaryUom,
      shortPrimaryUom,
      getProductUom,
      wipBufferLabel: 'Cycle Stock + Cold-Chain WIP Buffer',
      storageFootprintTitle:
        'Time-Phased Inventory, Production, Fulfilled Demand & Cold-Storage Footprint',
      storageColumnLabel: 'Cold Vault Volume',
      posDriverLabel: 'Hospital POS Index',
      externalDriverLabel: 'Seasonal Epidemiological',
      changeoverMatrixTitle:
        'Sterile Line Changeover Times & Cleaning Validation Costs',
      productionCostLabel: 'Variable Production & API Conversion',
      transitCostLabel: 'Cold-Chain Transit & Landed Duties',
      upstreamDelayLabel: `API / Vial Supplier Delay (${
        firstSupplier?.name.split(' ')[0] || 'Tier-2'
      })`,
      expediteCheckboxLabel: `Enable Expedited Air Charter for ${
        firstRaw?.name.split(' ')[0] || 'API'
      } Replenishment`,
      holdingSubtitle: 'Cycle stock + cold-chain WIP carrying cost',
    };
  }, [workspace]);

  const openExceptionsCount = useMemo(
    () =>
      workspace?.exceptions.filter((e) => e.status === 'OPEN').length || 0,
    [workspace]
  );

  // Dynamic SVG DAG Node & Edge Layout computed from uploaded workspace.nodes & workspace.lanes
  const dynamicGraphLayout = useMemo(() => {
    if (!workspace || workspace.nodes.length === 0) {
      return { nodes: [], edges: [] };
    }
    const suppliers = workspace.nodes.filter(
      (n) => n.node_type === NodeType.SUPPLIER
    );
    const plants = workspace.nodes.filter(
      (n) =>
        n.node_type === NodeType.PLANT || n.node_type === NodeType.WORK_CENTER
    );
    const dcs = workspace.nodes.filter(
      (n) => n.node_type === NodeType.DISTRIBUTION_CENTER
    );
    const customers = workspace.nodes.filter(
      (n) => n.node_type === NodeType.CUSTOMER
    );

    const placeColumn = (list: SupplyNode[], x: number) =>
      list.map((n, idx) => {
        const count = list.length;
        const y =
          count === 1
            ? 100
            : Math.round(45 + (idx * 130) / Math.max(1, count - 1));
        return {
          id: n.node_id,
          label: n.node_id.slice(0, 15),
          sub: `${n.region} · ${n.currency}`,
          x,
          y,
        };
      });

    const positionedNodes = [
      ...placeColumn(suppliers, 25),
      ...placeColumn(plants, 235),
      ...placeColumn(dcs, 435),
      ...placeColumn(customers, 615),
    ];

    const posMap = new Map(positionedNodes.map((p) => [p.id, p]));
    const edges = workspace.lanes
      .map((lane) => {
        const orig = posMap.get(lane.origin_node_id);
        const dest = posMap.get(lane.destination_node_id);
        if (!orig || !dest) return null;
        return {
          x1: orig.x + 130,
          y1: orig.y + 27,
          x2: dest.x,
          y2: dest.y + 27,
          from: lane.origin_node_id,
        };
      })
      .filter(Boolean) as {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      from: string;
    }[];

    return { nodes: positionedNodes, edges };
  }, [workspace]);

  if (loading || !workspace) {
    return (
      <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col">
        <header className="flex items-center justify-between gap-8 px-8 py-4 border-b border-slate-800/80 bg-[#0F1623]">
          <span className="text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 font-display">
            Nexora
          </span>
          <div className="h-4 w-64 bg-slate-800 rounded animate-pulse" />
          <div className="h-8 w-36 bg-slate-800 rounded animate-pulse" />
        </header>
        <div className="p-8 max-w-[1440px] w-full mx-auto space-y-6">
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((n) => (
              <div
                key={n}
                className="h-28 bg-[#111827] border border-slate-800 rounded-lg p-5 animate-pulse"
              />
            ))}
          </div>
          <div className="h-96 bg-[#111827] border border-slate-800 rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  // Gate 1 & Gate 2: Enterprise Login Gateway -> Clean-State Onboarding & Schema Validation
  if (!workspace.user_session || !workspace.is_initialized) {
    return (
      <EnterpriseOnboardingFlow
        userSession={workspace.user_session || null}
        actionBusy={actionBusy}
        onLogin={handleSessionLogin}
        onLogout={handleSessionLogout}
        onLaunchDigitalTwin={handleLaunchDigitalTwin}
      />
    );
  }

  const plan = workspace.current_plan;

  // Real-time Enterprise Threshold Breach Evaluation (Active Baseline + Selected Scenario Branches)
  const isBaselineOtifBreached = plan.otif_percentage < otifThresholdPct;
  const isBaselineMarginBreached = plan.gross_margin_pct < marginThresholdPct;

  const activeComparedScenarios = workspace.saved_scenarios.filter((s) =>
    selectedScenarioIds.includes(s.scenario_id)
  );
  const scenarioOtifBreaches = activeComparedScenarios.filter(
    (s) => s.scenario_kpis.otif_percentage < otifThresholdPct
  );
  const scenarioMarginBreaches = activeComparedScenarios.filter(
    (s) => s.scenario_kpis.gross_margin_pct < marginThresholdPct
  );

  const hasScenarioThresholdBreach =
    alertMonitorScenarios &&
    (scenarioOtifBreaches.length > 0 || scenarioMarginBreaches.length > 0);

  const anyEnterpriseThresholdBreach =
    isBaselineOtifBreached ||
    isBaselineMarginBreached ||
    hasScenarioThresholdBreach;

  // Compute flashing header navigation states
  const flashControlTowerNav =
    isBaselineOtifBreached || isBaselineMarginBreached;
  const flashSchedulerNav = isBaselineOtifBreached;
  const flashScenarioSandboxNav =
    hasScenarioThresholdBreach ||
    isBaselineOtifBreached ||
    isBaselineMarginBreached;
  const flashEkgDemandNav = isBaselineMarginBreached;

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col">
      {/* STRICT 3-ZONE TOP BAR CONTRACT */}
      <header className="flex items-center justify-between gap-8 px-8 py-4 border-b border-slate-800 bg-[#0F1623]">
        {/* Zone 1: Brand Title, single text element */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveModule('CONTROL_TOWER');
          }}
          className="text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 font-display"
        >
          Nexora
        </a>

        {/* Zone 2: 5 concise single-line text navigation links (flash on real-time threshold breach) */}
        <nav className="flex items-center gap-6 text-sm font-medium">
          <button
            type="button"
            onClick={() => setActiveModule('CONTROL_TOWER')}
            title={
              flashControlTowerNav
                ? `ALERT: Baseline ${
                    isBaselineOtifBreached
                      ? `OTIF (${plan.otif_percentage.toFixed(1)}% < ${otifThresholdPct}%)`
                      : `Margin (${plan.gross_margin_pct.toFixed(1)}% < ${marginThresholdPct}%)`
                  } below Enterprise Threshold`
                : 'Control Tower & Prescriptive Resolution'
            }
            className={`px-2.5 py-1 rounded-t transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              flashControlTowerNav
                ? 'nav-alert-flash-critical font-semibold'
                : activeModule === 'CONTROL_TOWER'
                ? 'text-white border-sky-400'
                : 'text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            Control Tower ({openExceptionsCount})
          </button>
          <button
            type="button"
            onClick={() => setActiveModule('UNISON_SCHEDULER')}
            title={
              flashSchedulerNav
                ? `ALERT: Finite Capacity OTIF (${plan.otif_percentage.toFixed(
                    1
                  )}%) below ${otifThresholdPct}% SLA target`
                : 'Capacity & Production Scheduling'
            }
            className={`px-2.5 py-1 rounded-t transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              flashSchedulerNav
                ? 'nav-alert-flash-warning font-semibold'
                : activeModule === 'UNISON_SCHEDULER'
                ? 'text-white border-sky-400'
                : 'text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            Capacity & Production Scheduling
          </button>
          <button
            type="button"
            onClick={() => setActiveModule('SCENARIO_SANDBOX')}
            title={
              flashScenarioSandboxNav
                ? `ALERT: ${
                    scenarioOtifBreaches.length + scenarioMarginBreaches.length
                  } Scenario Branch KPI breach(es) detected`
                : 'Scenario Sandbox & Cost Discrepancy Heatmap'
            }
            className={`px-2.5 py-1 rounded-t transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              flashScenarioSandboxNav
                ? isBaselineOtifBreached || isBaselineMarginBreached
                  ? 'nav-alert-flash-critical font-semibold'
                  : 'nav-alert-flash-warning font-semibold'
                : activeModule === 'SCENARIO_SANDBOX'
                ? 'text-white border-sky-400'
                : 'text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            Scenario Sandbox
          </button>
          <button
            type="button"
            onClick={() => setActiveModule('EKG_DEMAND')}
            title={
              flashEkgDemandNav
                ? `ALERT: Gross Margin (${plan.gross_margin_pct.toFixed(
                    1
                  )}%) below ${marginThresholdPct}% threshold`
                : 'Knowledge Graph & Demand'
            }
            className={`px-2.5 py-1 rounded-t transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              flashEkgDemandNav
                ? 'nav-alert-flash-warning font-semibold'
                : activeModule === 'EKG_DEMAND'
                ? 'text-white border-sky-400'
                : 'text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            Knowledge Graph & Demand
          </button>
          <button
            type="button"
            onClick={() => setActiveModule('MASTER_DATA')}
            className={`px-2.5 py-1 rounded-t transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              activeModule === 'MASTER_DATA'
                ? 'text-white border-sky-400'
                : 'text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            Master Data Manager
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            disabled={actionBusy}
            onClick={() => handleRunUnisonSolver()}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {actionBusy ? 'Solving MILP...' : 'Run Unison Solver'}
          </button>
        </div>
      </header>

      {/* MAIN WORKSPACE CONTAINER */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-8 py-6 space-y-6">
        {/* CONTEXTUAL WORKSPACE BAR & GLOBAL TELEMETRY STRIP */}
        <section className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-800/80">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="text-slate-200 font-medium">
                {workspace.company_name || workspace.user_session?.company_name}
              </span>
              <select
                aria-label="Quick Switch Company Digital Twin"
                value={
                  workspace.company_name ||
                  workspace.user_session?.company_name ||
                  'AstraBio Cold-Chain Therapeutics'
                }
                onChange={(e) => handleResetBaseline(e.target.value)}
                className="bg-slate-900 border border-slate-700 text-[11px] text-sky-300 font-medium rounded px-2 py-0.5 cursor-pointer"
                title="Switch active company supply chain digital twin & units of measure"
              >
                {![
                  'AstraBio Cold-Chain Therapeutics',
                  'Nordic Semiconductor Foundry',
                  'VoltEdge EV Battery Systems',
                ].includes(
                  workspace.company_name ||
                    workspace.user_session?.company_name ||
                    ''
                ) && (
                  <option
                    value={
                      workspace.company_name ||
                      workspace.user_session?.company_name ||
                      ''
                    }
                  >
                    {workspace.company_name ||
                      workspace.user_session?.company_name}
                  </option>
                )}
                <option value="AstraBio Cold-Chain Therapeutics">
                  AstraBio Cold-Chain Therapeutics (blister packs · vials)
                </option>
                <option value="Nordic Semiconductor Foundry">
                  Nordic Semiconductor Foundry (dies · wafers)
                </option>
                <option value="VoltEdge EV Battery Systems">
                  VoltEdge EV Battery Systems (kWh packs · modules)
                </option>
              </select>
              {workspace.user_session && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-sky-400">
                    {workspace.user_session.role} ({workspace.user_session.work_email})
                  </span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>
                {workspace.nodes.length} Facilities · {workspace.products.length}{' '}
                Items ({companyMeta.primaryUom}) · {workspace.work_centers.length} Lines
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-slate-300">
                MILP Solve: {plan.solve_time_ms} ms ({plan.status})
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white mt-1 font-display">
              {activeModule === 'EKG_DEMAND' &&
                'Enterprise Knowledge Graph & Driver-Based Demand Sensing'}
              {activeModule === 'UNISON_SCHEDULER' &&
                'Unison Tactical S&OP to Finite Sequence-Dependent Scheduling'}
              {activeModule === 'SCENARIO_SANDBOX' &&
                'Concurrent Copy-on-Write Scenario Sandbox & Variance Matrix'}
              {activeModule === 'CONTROL_TOWER' &&
                'Exception Pegging Audit Trail & Prescriptive Resolution'}
              {activeModule === 'MASTER_DATA' &&
                'Master Data Manager · Network Topology, BOMs & Inventory'}
              {activeModule === 'API_BLUEPRINT' &&
                'Live REST API Inspector & Python FastAPI / PuLP Reference'}
            </h1>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleClearWorkspaceToOnboarding}
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5 text-sky-400" />
              <span>Re-Import Model</span>
            </button>
            <button
              type="button"
              onClick={handleExportScheduleCsv}
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-700/80 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-slate-400" />
              <span>Download Schedule CSV</span>
            </button>
            <button
              type="button"
              onClick={handleSessionLogout}
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-700/80 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>Switch Workspace</span>
            </button>
          </div>
        </section>

        {/* REAL-TIME ENTERPRISE THRESHOLD ALERTING & SLA GUARDRAIL BAR */}
        <section
          className={`p-4 rounded-lg border transition-colors ${
            anyEnterpriseThresholdBreach
              ? 'bg-rose-950/20 border-rose-500/40'
              : 'bg-[#111827] border-slate-800'
          }`}
        >
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
            {/* Left: Real-Time Alert Status & Flashing Nav Indicator */}
            <div className="flex items-start sm:items-center gap-3">
              {anyEnterpriseThresholdBreach ? (
                <div className="w-8 h-8 rounded-md bg-rose-500/20 border border-rose-500/40 flex items-center justify-center shrink-0 animate-pulse">
                  <AlertTriangle className="w-4 h-4 text-rose-400" />
                </div>
              ) : (
                <div className="w-8 h-8 rounded-md bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                </div>
              )}

              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-white">
                    Real-Time Enterprise SLA Threshold Monitor
                  </span>
                  {isBaselineOtifBreached && (
                    <button
                      type="button"
                      onClick={() => setActiveModule('CONTROL_TOWER')}
                      className="px-2 py-0.5 text-[11px] font-mono font-semibold text-rose-200 bg-rose-500/25 border border-rose-500/50 rounded animate-pulse cursor-pointer"
                    >
                      BASELINE OTIF BREACH: {plan.otif_percentage.toFixed(1)}% &lt;{' '}
                      {otifThresholdPct.toFixed(1)}%
                    </button>
                  )}
                  {isBaselineMarginBreached && (
                    <button
                      type="button"
                      onClick={() => setActiveModule('EKG_DEMAND')}
                      className="px-2 py-0.5 text-[11px] font-mono font-semibold text-rose-200 bg-rose-500/25 border border-rose-500/50 rounded animate-pulse cursor-pointer"
                    >
                      BASELINE MARGIN BREACH: {plan.gross_margin_pct.toFixed(1)}% &lt;{' '}
                      {marginThresholdPct.toFixed(1)}%
                    </button>
                  )}
                  {hasScenarioThresholdBreach && (
                    <button
                      type="button"
                      onClick={() => setActiveModule('SCENARIO_SANDBOX')}
                      className="px-2 py-0.5 text-[11px] font-mono font-semibold text-amber-200 bg-amber-500/20 border border-amber-500/40 rounded cursor-pointer"
                    >
                      {scenarioOtifBreaches.length} OTIF /{' '}
                      {scenarioMarginBreaches.length} MARGIN SCENARIO BREACHES →
                    </button>
                  )}
                  {!anyEnterpriseThresholdBreach && (
                    <span className="text-[11px] font-mono text-emerald-400">
                      ALL ACTIVE &amp; SCENARIO KPIS WITHIN ENTERPRISE THRESHOLDS
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Header navigation tabs automatically flash when live **OTIF** or
                  **Gross Margin** drops below your configured enterprise thresholds.
                </p>
              </div>
            </div>

            {/* Right: Interactive Threshold Sliders & Inputs */}
            <div className="flex flex-wrap items-center gap-5 text-xs">
              <div className="flex items-center gap-2.5 bg-[#0B0F17] border border-slate-800 px-3 py-2 rounded-md">
                <label
                  htmlFor="otif-threshold-input"
                  className="text-slate-300 font-medium whitespace-nowrap"
                >
                  Min OTIF Threshold:
                </label>
                <input
                  id="otif-threshold-input"
                  type="range"
                  min={75}
                  max={99.5}
                  step={0.5}
                  value={otifThresholdPct}
                  onChange={(e) => setOtifThresholdPct(Number(e.target.value))}
                  className="w-24 accent-sky-400 cursor-pointer"
                />
                <input
                  type="number"
                  min={50}
                  max={100}
                  step={0.5}
                  value={otifThresholdPct}
                  onChange={(e) =>
                    setOtifThresholdPct(
                      Math.min(100, Math.max(50, Number(e.target.value) || 0))
                    )
                  }
                  className="w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-right font-mono tabular-nums text-white"
                />
                <span className="font-mono text-slate-400">%</span>
              </div>

              <div className="flex items-center gap-2.5 bg-[#0B0F17] border border-slate-800 px-3 py-2 rounded-md">
                <label
                  htmlFor="margin-threshold-input"
                  className="text-slate-300 font-medium whitespace-nowrap"
                >
                  Min Gross Margin:
                </label>
                <input
                  id="margin-threshold-input"
                  type="range"
                  min={45}
                  max={85}
                  step={0.5}
                  value={marginThresholdPct}
                  onChange={(e) => setMarginThresholdPct(Number(e.target.value))}
                  className="w-24 accent-sky-400 cursor-pointer"
                />
                <input
                  type="number"
                  min={20}
                  max={95}
                  step={0.5}
                  value={marginThresholdPct}
                  onChange={(e) =>
                    setMarginThresholdPct(
                      Math.min(95, Math.max(20, Number(e.target.value) || 0))
                    )
                  }
                  className="w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-right font-mono tabular-nums text-white"
                />
                <span className="font-mono text-slate-400">%</span>
              </div>

              <label className="inline-flex items-center gap-2 text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={alertMonitorScenarios}
                  onChange={(e) => setAlertMonitorScenarios(e.target.checked)}
                  className="accent-sky-400 rounded cursor-pointer"
                />
                <span>Include Scenario Branches</span>
              </label>
            </div>
          </div>

          {/* Guided Alert Resolution Playbook (Displayed automatically when any header tab flashes) */}
          {anyEnterpriseThresholdBreach && (
            <div className="mt-4 pt-3.5 border-t border-rose-500/30 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-md bg-[#0B0F17]/90 border border-slate-800 flex flex-col justify-between gap-2.5">
                <div>
                  <div className="flex items-center justify-between font-mono text-[11px]">
                    <span className="text-rose-400 font-semibold">
                      1. RESOLVE OTIF FLASHING ALERT
                    </span>
                    <span className="text-slate-400">
                      Current: {plan.otif_percentage.toFixed(1)}%
                    </span>
                  </div>
                  <p className="text-slate-300 text-[11px] mt-1 leading-relaxed">
                    Flashes <strong>Control Tower</strong> &amp;{' '}
                    <strong>Capacity Scheduling</strong> when unmet demand causes OTIF to
                    dip below {otifThresholdPct.toFixed(1)}%. Authorize weekend overtime,
                    resequence campaigns, or apply a Control Tower prescription.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() =>
                      handleRunUnisonSolver({
                        authorize_overtime_override: true,
                        resequence_campaigns: true,
                        expedite_air_enabled: true,
                      })
                    }
                    className="px-2.5 py-1.5 bg-sky-400 hover:bg-sky-300 text-slate-950 font-semibold rounded text-[11px] transition-colors cursor-pointer"
                  >
                    Auto-Recover OTIF (Overtime + Resequence)
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveModule('CONTROL_TOWER')}
                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] transition-colors cursor-pointer"
                  >
                    Open Control Tower →
                  </button>
                </div>
              </div>

              <div className="p-3 rounded-md bg-[#0B0F17]/90 border border-slate-800 flex flex-col justify-between gap-2.5">
                <div>
                  <div className="flex items-center justify-between font-mono text-[11px]">
                    <span className="text-amber-400 font-semibold">
                      2. RESOLVE MARGIN FLASHING ALERT
                    </span>
                    <span className="text-slate-400">
                      Current: {plan.gross_margin_pct.toFixed(1)}%
                    </span>
                  </div>
                  <p className="text-slate-300 text-[11px] mt-1 leading-relaxed">
                    Flashes <strong>Knowledge Graph &amp; Demand</strong> when unit price
                    discounts, air-charter expedites, or changeover setups compress Gross
                    Margin below {marginThresholdPct.toFixed(1)}%. Consolidate setups or
                    optimize commercial pricing.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() =>
                      handleRunUnisonSolver({
                        resequence_campaigns: true,
                        expedite_air_enabled: false,
                      })
                    }
                    className="px-2.5 py-1.5 bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-semibold rounded text-[11px] transition-colors cursor-pointer"
                  >
                    Protect Margin (Cut Setup &amp; Air Cost)
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveModule('EKG_DEMAND')}
                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] transition-colors cursor-pointer"
                  >
                    Adjust Pricing Drivers →
                  </button>
                </div>
              </div>

              <div className="p-3 rounded-md bg-[#0B0F17]/90 border border-slate-800 flex flex-col justify-between gap-2.5">
                <div>
                  <div className="flex items-center justify-between font-mono text-[11px]">
                    <span className="text-sky-400 font-semibold">
                      3. RESOLVE SCENARIO / SLA GUARDRAIL
                    </span>
                    <span className="text-slate-400">
                      {scenarioOtifBreaches.length + scenarioMarginBreaches.length} Branch
                      Alerts
                    </span>
                  </div>
                  <p className="text-slate-300 text-[11px] mt-1 leading-relaxed">
                    Flashes <strong>Scenario Sandbox</strong> when a compared what-if
                    branch violates OTIF or Margin targets. Uncheck disrupted branches,
                    disable scenario alert monitoring, or align SLA thresholds.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setOtifThresholdPct(
                        Math.max(75, Math.floor(plan.otif_percentage - 0.5))
                      );
                      setMarginThresholdPct(
                        Math.max(45, Math.floor(plan.gross_margin_pct - 0.5))
                      );
                      setAlertMonitorScenarios(false);
                    }}
                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-white font-medium rounded text-[11px] transition-colors cursor-pointer"
                  >
                    Calibrate SLA to Current Baseline
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveModule('SCENARIO_SANDBOX')}
                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] transition-colors cursor-pointer"
                  >
                    Inspect Heatmap →
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* EXECUTIVE KPI STRIP (SINGLE-ELEVATION CARDS, TABULAR NUMERALS) */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div
            className={`p-4 bg-[#111827] border rounded-lg transition-colors ${
              isBaselineOtifBreached
                ? 'border-rose-500/70 bg-rose-950/15'
                : 'border-slate-800'
            }`}
          >
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>On-Time In-Full (OTIF)</span>
              <span className="font-mono text-[10px] text-slate-500">
                SLA &ge; {otifThresholdPct.toFixed(1)}%
              </span>
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <span
                className={`text-2xl font-bold font-mono tabular-nums ${
                  isBaselineOtifBreached ? 'text-rose-400' : 'text-white'
                }`}
              >
                {plan.otif_percentage.toFixed(1)}%
              </span>
              <span
                className={`text-xs font-mono tabular-nums ${
                  !isBaselineOtifBreached
                    ? 'text-emerald-400'
                    : 'text-rose-400 font-semibold'
                }`}
              >
                {plan.fulfilled_units.toLocaleString()} /{' '}
                {plan.total_demand_units.toLocaleString()} {companyMeta.shortPrimaryUom}
              </span>
            </div>
            <div className="mt-1.5 text-xs text-slate-500">
              Unfulfilled Shortfall: {plan.unmet_units.toLocaleString()}{' '}
              {companyMeta.shortPrimaryUom}
            </div>
          </div>

          <div className="p-4 bg-[#111827] border border-slate-800 rounded-lg">
            <div className="text-xs text-slate-400">Total Supply Chain Cost</div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold font-mono tabular-nums text-white">
                ${plan.total_cost.toLocaleString()}
              </span>
              <span className="text-xs font-mono tabular-nums text-slate-400">
                Setups: ${plan.cost_breakdown.changeover_setups.toLocaleString()}
              </span>
            </div>
            <div className="mt-1.5 text-xs text-slate-500">
              Prod ${plan.cost_breakdown.production.toLocaleString()} · Hold $
              {plan.cost_breakdown.inventory_holding.toLocaleString()}
            </div>
          </div>

          <div
            className={`p-4 bg-[#111827] border rounded-lg transition-colors ${
              isBaselineMarginBreached
                ? 'border-rose-500/70 bg-rose-950/15'
                : 'border-slate-800'
            }`}
          >
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Commercial Gross Margin</span>
              <span className="font-mono text-[10px] text-slate-500">
                SLA &ge; {marginThresholdPct.toFixed(1)}%
              </span>
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <span
                className={`text-2xl font-bold font-mono tabular-nums ${
                  isBaselineMarginBreached ? 'text-rose-400' : 'text-white'
                }`}
              >
                {plan.gross_margin_pct.toFixed(1)}%
              </span>
              <span
                className={`text-xs font-mono tabular-nums ${
                  isBaselineMarginBreached ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                ${plan.gross_margin_usd.toLocaleString()}
              </span>
            </div>
            <div className="mt-1.5 text-xs text-slate-500">
              Recognized Revenue: ${plan.total_revenue.toLocaleString()}
            </div>
          </div>

          <div className="p-4 bg-[#111827] border border-slate-800 rounded-lg">
            <div className="text-xs text-slate-400">Working Capital Tied</div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold font-mono tabular-nums text-white">
                ${plan.working_capital_tied_usd.toLocaleString()}
              </span>
              <span className="text-xs font-mono tabular-nums text-slate-400">
                20% WACC
              </span>
            </div>
            <div className="mt-1.5 text-xs text-slate-500">
              {companyMeta.wipBufferLabel}
            </div>
          </div>

          <div className="p-4 bg-[#111827] border border-slate-800 rounded-lg">
            <div className="text-xs text-slate-400">Finite Line Utilization</div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold font-mono tabular-nums text-white">
                {plan.asset_utilization_pct.toFixed(1)}%
              </span>
              <span className="text-xs font-mono tabular-nums text-amber-400">
                {plan.total_setup_hours}h setups
              </span>
            </div>
            <div className="mt-1.5 text-xs text-slate-500">
              Scheduled Overtime: {plan.total_overtime_hours} hrs
            </div>
          </div>
        </section>

        {/* =====================================================================
            MODULE 1: ENTERPRISE KNOWLEDGE GRAPH & DRIVER-BASED DEMAND SENSING
           ===================================================================== */}
        {activeModule === 'EKG_DEMAND' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              {/* Left 7 Cols: Interactive Multi-Tier Supply & BOM DAG Propagation */}
              <div className="lg:col-span-7 bg-[#111827] border border-slate-800 rounded-lg p-6 flex flex-col justify-between">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
                    <div>
                      <div className="text-xs text-slate-400">
                        Kinaxis Pattern · Real-Time In-Memory Pegging Traversal
                      </div>
                      <h2 className="text-lg font-semibold text-white mt-0.5 font-display">
                        Multi-Echelon Supply Network & BOM Disruption Propagation
                      </h2>
                    </div>

                    <div className="flex items-center gap-2">
                      <select
                        aria-label="Select Disrupted Node"
                        value={selectedDisruptedNode}
                        onChange={(e) => {
                          setSelectedDisruptedNode(e.target.value);
                          handleRunPropagation(
                            e.target.value,
                            disruptionDelayBuckets,
                            selectedComponentFilter
                          );
                        }}
                        className="bg-slate-900 border border-slate-700 text-xs text-slate-200 rounded px-2.5 py-1.5"
                      >
                        {workspace.nodes
                          .filter((n) => n.node_type !== NodeType.CUSTOMER)
                          .map((n) => (
                            <option key={n.node_id} value={n.node_id}>
                              {n.node_id} ({n.node_type})
                            </option>
                          ))}
                      </select>

                      <select
                        aria-label="Delay Buckets"
                        value={disruptionDelayBuckets}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setDisruptionDelayBuckets(val);
                          handleRunPropagation(
                            selectedDisruptedNode,
                            val,
                            selectedComponentFilter
                          );
                        }}
                        className="bg-slate-900 border border-slate-700 text-xs text-slate-200 rounded px-2.5 py-1.5 font-mono tabular-nums"
                      >
                        <option value={0}>0 Wks Delay (Nominal)</option>
                        <option value={1}>+1 Wk Delay</option>
                        <option value={2}>+2 Wks Delay</option>
                        <option value={3}>+3 Wks Severe Halt</option>
                      </select>

                      <select
                        aria-label="Affected BOM Component"
                        value={selectedComponentFilter}
                        onChange={(e) => {
                          setSelectedComponentFilter(e.target.value);
                          handleRunPropagation(
                            selectedDisruptedNode,
                            disruptionDelayBuckets,
                            e.target.value
                          );
                        }}
                        className="bg-slate-900 border border-slate-700 text-xs text-slate-200 rounded px-2.5 py-1.5"
                      >
                        <option value="ALL">All BOM Components</option>
                        {workspace.products
                          .filter((p) => p.tier !== 'FINISHED_GOOD')
                          .map((p) => (
                            <option key={p.product_id} value={p.product_id}>
                              {p.product_id}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>

                  {/* Interactive SVG Directed Acyclic Graph Topology */}
                  <div className="my-5 bg-[#0B0F17] border border-slate-800/90 rounded-lg p-4">
                    <svg
                      viewBox="0 0 760 250"
                      className="w-full h-56 select-none"
                      role="img"
                      aria-label="Enterprise Knowledge Graph Topology"
                    >
                      <defs>
                        <marker
                          id="arrow-nominal"
                          viewBox="0 0 10 10"
                          refX="8"
                          refY="5"
                          markerWidth="6"
                          markerHeight="6"
                          orient="auto-start-reverse"
                        >
                          <path d="M 0 1 L 10 5 L 0 9 z" fill="#475569" />
                        </marker>
                        <marker
                          id="arrow-impact"
                          viewBox="0 0 10 10"
                          refX="8"
                          refY="5"
                          markerWidth="6"
                          markerHeight="6"
                          orient="auto-start-reverse"
                        >
                          <path d="M 0 1 L 10 5 L 0 9 z" fill="#F59E0B" />
                        </marker>
                      </defs>

                      {/* Tier Column Headers */}
                      <text x="30" y="20" fill="#64748B" fontSize="10" fontFamily="monospace">
                        TIER 2: SUPPLIERS
                      </text>
                      <text x="225" y="20" fill="#64748B" fontSize="10" fontFamily="monospace">
                        TIER 1: MFG PLANTS
                      </text>
                      <text x="430" y="20" fill="#64748B" fontSize="10" fontFamily="monospace">
                        REGIONAL DCs
                      </text>
                      <text x="615" y="20" fill="#64748B" fontSize="10" fontFamily="monospace">
                        CUSTOMER DEMAND
                      </text>

                      {/* Dynamic Edges */}
                      {dynamicGraphLayout.edges.map((edge, idx) => {
                        const isImpacted = propagationData?.pegging_chain.some(
                          (p) => p.node_id === edge.from && p.cumulative_delay_buckets > 0
                        );
                        return (
                          <line
                            key={idx}
                            x1={edge.x1}
                            y1={edge.y1}
                            x2={edge.x2}
                            y2={edge.y2}
                            stroke={isImpacted ? '#F59E0B' : '#334155'}
                            strokeWidth={isImpacted ? '2.2' : '1.5'}
                            strokeDasharray={isImpacted ? '5,3' : undefined}
                            markerEnd={
                              isImpacted ? 'url(#arrow-impact)' : 'url(#arrow-nominal)'
                            }
                          />
                        );
                      })}

                      {/* Dynamic Graph Nodes */}
                      {dynamicGraphLayout.nodes.map((n) => {
                        const peg = propagationData?.pegging_chain.find(
                          (p) => p.node_id === n.id
                        );
                        const isRoot = selectedDisruptedNode === n.id;
                        const strokeColor =
                          peg?.severity === 'CRITICAL'
                            ? '#F43F5E'
                            : peg?.severity === 'WARNING'
                            ? '#F59E0B'
                            : '#334155';
                        return (
                          <g
                            key={n.id}
                            onClick={() => {
                              if (!n.id.startsWith('CUST_')) {
                                setSelectedDisruptedNode(n.id);
                                handleRunPropagation(
                                  n.id,
                                  disruptionDelayBuckets,
                                  selectedComponentFilter
                                );
                              }
                            }}
                            className="cursor-pointer"
                          >
                            <rect
                              x={n.x}
                              y={n.y}
                              width="130"
                              height="54"
                              rx="6"
                              fill={isRoot ? '#1E293B' : '#0F172A'}
                              stroke={strokeColor}
                              strokeWidth={isRoot || peg ? '2' : '1'}
                            />
                            <text
                              x={n.x + 10}
                              y={n.y + 20}
                              fill="#F8FAFC"
                              fontSize="11"
                              fontWeight="600"
                              fontFamily="monospace"
                            >
                              {n.label}
                            </text>
                            <text
                              x={n.x + 10}
                              y={n.y + 35}
                              fill="#94A3B8"
                              fontSize="10"
                            >
                              {n.sub}
                            </text>
                            {peg && (
                              <text
                                x={n.x + 10}
                                y={n.y + 48}
                                fill={
                                  peg.severity === 'CRITICAL'
                                    ? '#FB7185'
                                    : '#FBBF24'
                                }
                                fontSize="9"
                                fontFamily="monospace"
                              >
                                Delay: +{peg.cumulative_delay_buckets}w · Risk $
                                {(peg.at_risk_revenue_usd / 1000).toFixed(1)}k
                              </text>
                            )}
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                </div>

                {/* Downstream Pegging Impact Table */}
                {propagationData && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>
                        Pegged Impact Audit Trail ({propagationData.nodes_impacted_count}{' '}
                        Nodes · {propagationData.bom_explosion_path.length} BOM Links)
                      </span>
                      <span className="font-mono tabular-nums text-rose-400 font-semibold">
                        Total Customer Revenue at Risk: $
                        {propagationData.total_at_risk_revenue_usd.toLocaleString()} (
                        {propagationData.total_at_risk_units.toLocaleString()}{' '}
                        {companyMeta.primaryUom})
                      </span>
                    </div>

                    <div className="overflow-x-auto border border-slate-800 rounded-md">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-800 bg-slate-900/70 text-slate-400">
                            <th className="py-2 px-3 font-medium">Pegged Node</th>
                            <th className="py-2 px-3 font-medium">Echelon</th>
                            <th className="py-2 px-3 font-medium text-right">
                              Cumulative Delay
                            </th>
                            <th className="py-2 px-3 font-medium text-right">
                              Exposed Volume ({companyMeta.primaryUom})
                            </th>
                            <th className="py-2 px-3 font-medium text-right">
                              Revenue at Risk
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/70">
                          {propagationData.pegging_chain.map((node) => (
                            <tr
                              key={node.node_id}
                              className="hover:bg-slate-800/40 transition-colors"
                            >
                              <td className="py-2 px-3 font-mono text-slate-200">
                                {node.node_id}
                              </td>
                              <td className="py-2 px-3 text-slate-400">
                                {node.node_type} · {node.severity}
                              </td>
                              <td className="py-2 px-3 text-right font-mono tabular-nums text-amber-400">
                                +{node.cumulative_delay_buckets} buckets
                              </td>
                              <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-300">
                                {node.at_risk_units.toLocaleString()}{' '}
                                {selectedComponentFilter !== 'ALL'
                                  ? companyMeta.getProductUom(selectedComponentFilter)
                                  : companyMeta.shortPrimaryUom}
                              </td>
                              <td className="py-2 px-3 text-right font-mono tabular-nums text-rose-400">
                                ${node.at_risk_revenue_usd.toLocaleString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              {/* Right 5 Cols: o9-Style Multivariate Driver-Based Demand Sensing */}
              <div className="lg:col-span-5 bg-[#111827] border border-slate-800 rounded-lg p-6 flex flex-col justify-between">
                <div className="space-y-5">
                  <div className="pb-4 border-b border-slate-800">
                    <div className="text-xs text-slate-400">
                      o9 Solutions Pattern · Multivariate Causal Forecast Engine
                    </div>
                    <h2 className="text-lg font-semibold text-white mt-0.5 font-display">
                      Driver-Based Consensus Demand Sensing
                    </h2>
                  </div>

                  {/* SKU Selector & Driver Sliders */}
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1.5">
                        Target Finished Good SKU (
                        {companyMeta.getProductUom(selectedDemandSku)})
                      </label>
                      <select
                        value={selectedDemandSku}
                        onChange={(e) => {
                          const sku = e.target.value;
                          setSelectedDemandSku(sku);
                          const sample = workspace.demands.find(
                            (d) => d.product_id === sku
                          );
                          if (sample) {
                            setPromoLiftPct(
                              Math.round(sample.drivers.promo_uplift_pct * 100)
                            );
                            setUnitPriceOverride(sample.drivers.current_price);
                            setPosIndexOverride(sample.drivers.pos_sell_through_index);
                            setWeatherIndexOverride(sample.drivers.weather_index);
                          }
                        }}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-xs text-white"
                      >
                        {finishedProducts.map((p) => (
                          <option key={p.product_id} value={p.product_id}>
                            {p.product_id} — {p.name} (
                            {companyMeta.getProductUom(p.product_id)} · Base $
                            {p.financials.unit_sales_price.toLocaleString()})
                          </option>
                        ))}
                      </select>
                    </div>

                    {(() => {
                      const activeSkuObj = finishedProducts.find(
                        (p) => p.product_id === selectedDemandSku
                      );
                      const basePrice =
                        activeSkuObj?.financials.unit_sales_price || 140;
                      const minPrice = Math.max(10, Math.round(basePrice * 0.65));
                      const maxPrice = Math.max(200, Math.round(basePrice * 1.55));
                      const priceStep = basePrice >= 1000 ? 50 : 2;
                      return (
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-slate-400">Promo Campaign Lift</span>
                              <span className="font-mono tabular-nums text-sky-400">
                                +{promoLiftPct}%
                              </span>
                            </div>
                            <input
                              type="range"
                              min={-20}
                              max={50}
                              value={promoLiftPct}
                              onChange={(e) => setPromoLiftPct(Number(e.target.value))}
                              className="w-full accent-sky-400 cursor-pointer"
                            />
                          </div>

                          <div>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-slate-400">
                                Contract Price ($/
                                {companyMeta
                                  .getProductUom(selectedDemandSku)
                                  .replace(/s$/, '')}
                                )
                              </span>
                              <span className="font-mono tabular-nums text-sky-400">
                                ${unitPriceOverride.toLocaleString()}
                              </span>
                            </div>
                            <input
                              type="range"
                              min={minPrice}
                              max={maxPrice}
                              step={priceStep}
                              value={Math.min(
                                maxPrice,
                                Math.max(minPrice, unitPriceOverride)
                              )}
                              onChange={(e) =>
                                setUnitPriceOverride(Number(e.target.value))
                              }
                              className="w-full accent-sky-400 cursor-pointer"
                            />
                          </div>

                          <div>
                            <div className="flex justify-between text-xs mb-1">
                              <span
                                className="text-slate-400 truncate"
                                title={companyMeta.posDriverLabel}
                              >
                                {companyMeta.posDriverLabel}
                              </span>
                              <span className="font-mono tabular-nums text-emerald-400">
                                {posIndexOverride.toFixed(2)}x
                              </span>
                            </div>
                            <input
                              type="range"
                              min={0.85}
                              max={1.3}
                              step={0.01}
                              value={posIndexOverride}
                              onChange={(e) =>
                                setPosIndexOverride(Number(e.target.value))
                              }
                              className="w-full accent-sky-400 cursor-pointer"
                            />
                          </div>

                          <div>
                            <div className="flex justify-between text-xs mb-1">
                              <span
                                className="text-slate-400 truncate"
                                title={companyMeta.externalDriverLabel}
                              >
                                {companyMeta.externalDriverLabel}
                              </span>
                              <span className="font-mono tabular-nums text-amber-400">
                                {weatherIndexOverride.toFixed(2)}x
                              </span>
                            </div>
                            <input
                              type="range"
                              min={0.9}
                              max={1.25}
                              step={0.01}
                              value={weatherIndexOverride}
                              onChange={(e) =>
                                setWeatherIndexOverride(Number(e.target.value))
                              }
                              className="w-full accent-sky-400 cursor-pointer"
                            />
                          </div>
                        </div>
                      );
                    })()}

                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={handleApplyDemandDrivers}
                      className="w-full py-2.5 px-4 bg-sky-400 hover:bg-sky-300 text-slate-950 font-semibold text-xs rounded-md transition-colors cursor-pointer"
                    >
                      Propagate Sensed Demand ({companyMeta.getProductUom(selectedDemandSku)}) to Unison MILP Solver
                    </button>
                  </div>

                  {/* Time-Series Baseline vs Sensed Table for Selected SKU */}
                  <div className="pt-3 border-t border-slate-800">
                    <div className="text-xs text-slate-400 mb-2">
                      Consensus Forecast Horizon ({selectedDemandSku} ·{' '}
                      {companyMeta.getProductUom(selectedDemandSku)})
                    </div>
                    <div className="overflow-x-auto border border-slate-800 rounded-md">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-800 bg-slate-900/70 text-slate-400">
                            <th className="py-2 px-3 font-medium">Bucket</th>
                            <th className="py-2 px-3 font-medium text-right">
                              Statistical Base
                            </th>
                            <th className="py-2 px-3 font-medium text-right">
                              Driver Lift
                            </th>
                            <th className="py-2 px-3 font-medium text-right">
                              Sensed Consensus ({companyMeta.getProductUom(selectedDemandSku)})
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/70">
                          {workspace.demands
                            .filter((d) => d.product_id === selectedDemandSku)
                            .map((d) => {
                              const lift = d.sensed_units - d.baseline_units;
                              const skuUom = companyMeta.getProductUom(d.product_id);
                              return (
                                <tr key={d.demand_id} className="hover:bg-slate-800/40">
                                  <td className="py-2 px-3 font-mono text-slate-200">
                                    {d.bucket_label}
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-400">
                                    {d.baseline_units.toLocaleString()} {skuUom}
                                  </td>
                                  <td
                                    className={`py-2 px-3 text-right font-mono tabular-nums ${
                                      lift >= 0 ? 'text-sky-400' : 'text-amber-400'
                                    }`}
                                  >
                                    {lift >= 0 ? `+${lift}` : lift} {skuUom}
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-white">
                                    {d.sensed_units.toLocaleString()} {skuUom}
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Multi-Level BOM Reference Footer */}
                <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
                  <span>Elasticity Formula: Base × (1+Promo) × (P/P₀)^e × POS</span>
                  <span className="font-mono text-slate-300">o9 EKG Active</span>
                </div>
              </div>
            </div>

            {/* Full-Width Multi-Dimensional Time-Phased Demand & Inventory Pegging Grid */}
            <div className="bg-[#111827] border border-slate-800 rounded-lg p-6">
              <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                <div>
                  <div className="text-xs text-slate-400">
                    Synchronized S&OP Material Balance Ledger ({companyMeta.industryTag})
                  </div>
                  <h3 className="text-base font-semibold text-white mt-0.5 font-display">
                    {companyMeta.storageFootprintTitle}
                  </h3>
                </div>
                <div className="text-xs text-slate-400 font-mono tabular-nums">
                  {finishedProducts.length} Finished SKUs ({companyMeta.primaryUom}) ×{' '}
                  {workspace.buckets.length} Weekly Tactical Buckets
                </div>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 bg-slate-900/60">
                      <th className="py-2.5 px-3 font-medium">Product SKU &amp; UOM</th>
                      <th className="py-2.5 px-3 font-medium">Bucket</th>
                      <th className="py-2.5 px-3 font-medium text-right">Opening Inv</th>
                      <th className="py-2.5 px-3 font-medium text-right">
                        MILP Production
                      </th>
                      <th className="py-2.5 px-3 font-medium text-right">
                        Sensed Demand
                      </th>
                      <th className="py-2.5 px-3 font-medium text-right">Fulfilled</th>
                      <th className="py-2.5 px-3 font-medium text-right">
                        Unfulfilled Shortfall
                      </th>
                      <th className="py-2.5 px-3 font-medium text-right">Closing Inv</th>
                      <th className="py-2.5 px-3 font-medium text-right">
                        {companyMeta.storageColumnLabel}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {plan.inventory_ledger.map((row) => {
                      const rowUom = companyMeta.getProductUom(row.product_id);
                      return (
                        <tr
                          key={`${row.product_id}_${row.bucket}`}
                          className="hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="py-2 px-3 font-mono text-slate-200">
                            <span>{row.product_id}</span>
                            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-sky-300 border border-slate-700">
                              {rowUom}
                            </span>
                          </td>
                          <td className="py-2 px-3 font-mono text-slate-400">
                            {row.bucket_label}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-300">
                            {row.opening_inventory.toLocaleString()} {rowUom}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-sky-400 font-medium">
                            +{row.production_units.toLocaleString()} {rowUom}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-200">
                            {row.sensed_demand_units.toLocaleString()} {rowUom}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-emerald-400">
                            {row.fulfilled_units.toLocaleString()} {rowUom}
                          </td>
                          <td
                            className={`py-2 px-3 text-right font-mono tabular-nums font-semibold ${
                              row.unmet_units > 0 ? 'text-rose-400' : 'text-slate-500'
                            }`}
                          >
                            {row.unmet_units > 0
                              ? `${row.unmet_units.toLocaleString()} ${rowUom}`
                              : '0'}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-300">
                            {row.closing_inventory.toLocaleString()} {rowUom}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-400">
                            {row.storage_utilization_m3} m³
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            MODULE 2: UNISON TACTICAL-TO-OPERATIONAL SCHEDULER (OMP PATTERN)
           ===================================================================== */}
        {activeModule === 'UNISON_SCHEDULER' && (
          <div className="space-y-6">
            {/* Solver Controls & Policy Lever Bar */}
            <div className="bg-[#111827] border border-slate-800 rounded-lg p-6">
              <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-800">
                <div>
                  <div className="text-xs text-slate-400">
                    OMP Unison Pattern · Finite Capacity & Sequence-Dependent Changeover MILP
                  </div>
                  <h2 className="text-lg font-semibold text-white mt-0.5 font-display">
                    Plant Work Center Finite Sequencing & Campaign Optimization
                  </h2>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      handleRunUnisonSolver({
                        authorize_overtime_override:
                          !workspace.active_options.authorizeOvertimeOverride,
                      })
                    }
                    className={`px-3.5 py-2 text-xs font-medium rounded-md border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      workspace.active_options.authorizeOvertimeOverride
                        ? 'bg-sky-500/20 border-sky-400 text-sky-300'
                        : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {workspace.active_options.authorizeOvertimeOverride
                      ? 'Weekend Overtime: Authorized (+60% Cap)'
                      : 'Authorize Weekend Overtime'}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleRunUnisonSolver({
                        resequence_campaigns:
                          !workspace.active_options.resequenceCampaigns,
                      })
                    }
                    className={`px-3.5 py-2 text-xs font-medium rounded-md border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      workspace.active_options.resequenceCampaigns
                        ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                        : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {workspace.active_options.resequenceCampaigns
                      ? 'Campaign Batching: Active (-35% Setup)'
                      : 'Consolidate Campaign Sequence'}
                  </button>

                  <select
                    aria-label="Filter Work Center"
                    value={selectedWorkCenterFilter}
                    onChange={(e) => setSelectedWorkCenterFilter(e.target.value)}
                    className="bg-slate-900 border border-slate-700 text-xs text-slate-200 rounded-md px-3 py-2"
                  >
                    <option value="ALL">All Finite Work Centers</option>
                    {workspace.work_centers.map((wc) => (
                      <option key={wc.resource_id} value={wc.resource_id}>
                        {wc.resource_id} — {wc.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Finite Machine Gantt Timeline Visualization */}
              <div className="mt-6 space-y-6">
                {workspace.work_centers
                  .filter(
                    (wc) =>
                      selectedWorkCenterFilter === 'ALL' ||
                      wc.resource_id === selectedWorkCenterFilter
                  )
                  .map((wc) => (
                    <div
                      key={wc.resource_id}
                      className="p-4 bg-[#0B0F17] border border-slate-800 rounded-lg space-y-4"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-mono text-xs text-sky-400 font-semibold">
                            {wc.resource_id}
                          </span>
                          <span className="mx-2 text-slate-600">·</span>
                          <span className="text-sm font-semibold text-white">
                            {wc.name}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 font-mono tabular-nums">
                          Regular Cap: {wc.capacity_hours_per_bucket}h/wk · Max OT: +
                          {wc.max_overtime_hours}h · Run Rate: {wc.run_rate_hours_per_unit}
                          h / {companyMeta.shortPrimaryUom.replace(/s$/, '')}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        {workspace.buckets.map((b) => {
                          const slots = plan.production_plan.filter(
                            (s) =>
                              s.work_center_id === wc.resource_id &&
                              s.bucket === b.bucket
                          );
                          const load = plan.work_center_loads.find(
                            (l) =>
                              l.work_center_id === wc.resource_id &&
                              l.bucket === b.bucket
                          );
                          return (
                            <div
                              key={b.bucket}
                              className="p-3 bg-[#111827] border border-slate-800/90 rounded space-y-2.5"
                            >
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-mono font-medium text-slate-200">
                                  {b.label}
                                </span>
                                <span
                                  className={`font-mono tabular-nums ${
                                    (load?.utilization_pct || 0) > 100
                                      ? 'text-amber-400 font-semibold'
                                      : 'text-emerald-400'
                                  }`}
                                >
                                  {load?.utilization_pct}% Load
                                </span>
                              </div>

                              {/* Horizontal Proportional Gantt Strip */}
                              <div className="h-7 w-full bg-slate-950 rounded overflow-hidden flex border border-slate-800">
                                {slots.map((slot) => {
                                  const setupWidthPct = Math.min(
                                    100,
                                    (slot.setup_hours / 52) * 100
                                  );
                                  const runWidthPct = Math.min(
                                    100,
                                    (slot.run_hours / 52) * 100
                                  );
                                  const fgIdx = Math.max(
                                    0,
                                    finishedProducts.findIndex(
                                      (f) => f.product_id === slot.product_id
                                    )
                                  );
                                  const palette = [
                                    'bg-sky-500',
                                    'bg-indigo-500',
                                    'bg-emerald-500',
                                    'bg-teal-500',
                                  ];
                                  const skuColor = palette[fgIdx % palette.length];
                                  const slotUom = companyMeta.getProductUom(
                                    slot.product_id
                                  );
                                  return (
                                    <React.Fragment key={slot.slot_id}>
                                      {slot.setup_hours > 0 && (
                                        <div
                                          style={{ width: `${setupWidthPct}%` }}
                                          title={`Changeover Setup: ${slot.setup_hours}h ($${slot.setup_cost})`}
                                          className="h-full bg-amber-500/80 border-r border-slate-950"
                                        />
                                      )}
                                      <div
                                        style={{ width: `${runWidthPct}%` }}
                                        title={`${slot.product_id}: ${slot.quantity.toLocaleString()} ${slotUom} (${slot.run_hours}h run)`}
                                        className={`h-full ${skuColor} border-r border-slate-950`}
                                      />
                                    </React.Fragment>
                                  );
                                })}
                              </div>

                              {/* Slot Sequence Details */}
                              <div className="space-y-1.5 pt-1">
                                {slots.map((slot) => {
                                  const slotUom = companyMeta.getProductUom(
                                    slot.product_id
                                  );
                                  return (
                                    <div
                                      key={slot.slot_id}
                                      className="text-[11px] flex items-center justify-between text-slate-300 font-mono tabular-nums"
                                    >
                                      <span className="truncate max-w-[120px]">
                                        {slot.product_id.replace('SKU_', '')}
                                      </span>
                                      <span>
                                        {slot.quantity.toLocaleString()} {slotUom} ·{' '}
                                        {slot.run_hours}h
                                        {slot.setup_hours > 0
                                          ? ` (+${slot.setup_hours}h setup)`
                                          : ''}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {/* Sequence-Dependent Setup Changeover Matrix & Cost Breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 bg-[#111827] border border-slate-800 rounded-lg p-6">
                <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                  <div>
                    <div className="text-xs text-slate-400">
                      Sequence-Dependent Setup Penalty Matrix ({matrixWcId})
                    </div>
                    <h3 className="text-base font-semibold text-white mt-0.5 font-display">
                      {companyMeta.changeoverMatrixTitle}
                    </h3>
                  </div>
                  <select
                    aria-label="Select Work Center for Matrix"
                    value={matrixWcId}
                    onChange={(e) => setMatrixWcId(e.target.value)}
                    className="bg-slate-900 border border-slate-700 text-xs text-slate-200 rounded px-2.5 py-1.5"
                  >
                    {workspace.work_centers.map((wc) => (
                      <option key={wc.resource_id} value={wc.resource_id}>
                        {wc.resource_id} — {wc.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-900/60 text-slate-400">
                        <th className="py-2 px-3 font-medium">From Preceding SKU</th>
                        <th className="py-2 px-3 font-medium">To Succeeding SKU</th>
                        <th className="py-2 px-3 font-medium">Protocol Classification</th>
                        <th className="py-2 px-3 font-medium text-right">
                          Downtime Hours
                        </th>
                        <th className="py-2 px-3 font-medium text-right">Setup Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {workspace.work_centers
                        .find((w) => w.resource_id === matrixWcId)
                        ?.setup_matrix.map((s, idx) => (
                          <tr key={idx} className="hover:bg-slate-800/40">
                            <td className="py-2 px-3 font-mono text-slate-200">
                              {s.from_product_id}
                            </td>
                            <td className="py-2 px-3 font-mono text-sky-400">
                              {s.to_product_id}
                            </td>
                            <td className="py-2 px-3 text-slate-300">
                              {s.changeover_type}
                            </td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums text-amber-400">
                              {s.setup_time_hours.toFixed(1)} hrs
                            </td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-200">
                              ${s.setup_cost.toLocaleString()}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="lg:col-span-5 bg-[#111827] border border-slate-800 rounded-lg p-6 flex flex-col justify-between">
                <div>
                  <div className="pb-4 border-b border-slate-800">
                    <div className="text-xs text-slate-400">
                      MILP Objective Function Decomposition ({companyMeta.primaryUom})
                    </div>
                    <h3 className="text-base font-semibold text-white mt-0.5 font-display">
                      Network Cost Optimization Breakdown
                    </h3>
                  </div>

                  <div className="mt-4 space-y-3">
                    {[
                      {
                        label: companyMeta.productionCostLabel,
                        val: plan.cost_breakdown.production,
                        color: 'bg-sky-500',
                      },
                      {
                        label: 'Unfulfilled Demand Penalty Exposure',
                        val: plan.cost_breakdown.stockout_penalty,
                        color: 'bg-rose-500',
                      },
                      {
                        label: companyMeta.transitCostLabel,
                        val: plan.cost_breakdown.transit_landed,
                        color: 'bg-indigo-500',
                      },
                      {
                        label: 'Sequence-Dependent Changeover Setups',
                        val: plan.cost_breakdown.changeover_setups,
                        color: 'bg-amber-500',
                      },
                      {
                        label: 'Shift Overtime Premiums',
                        val: plan.cost_breakdown.overtime,
                        color: 'bg-teal-500',
                      },
                      {
                        label: 'Working Capital Inventory Carrying',
                        val: plan.cost_breakdown.inventory_holding,
                        color: 'bg-emerald-500',
                      },
                    ].map((item) => {
                      const pct = Math.min(
                        100,
                        Math.round((item.val / Math.max(1, plan.total_cost)) * 100)
                      );
                      return (
                        <div key={item.label} className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="text-slate-300">{item.label}</span>
                            <span className="font-mono tabular-nums text-white">
                              ${item.val.toLocaleString()} ({pct}%)
                            </span>
                          </div>
                          <div className="h-2 w-full bg-slate-900 rounded overflow-hidden">
                            <div
                              style={{ width: `${pct}%` }}
                              className={`h-full ${item.color}`}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-6 pt-3 border-t border-slate-800 flex items-center justify-between text-xs">
                  <span className="text-slate-400">Global MILP Objective Value</span>
                  <span className="text-base font-bold font-mono tabular-nums text-white">
                    ${plan.total_cost.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            MODULE 3: SCENARIO SANDBOXING ENGINE (KINAXIS COPY-ON-WRITE PATTERN)
           ===================================================================== */}
        {activeModule === 'SCENARIO_SANDBOX' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left 4 Cols: Branch Parameter Generator */}
            <form
              onSubmit={handleRunScenarioBranch}
              className="lg:col-span-4 bg-[#111827] border border-slate-800 rounded-lg p-6 space-y-4"
            >
              <div className="pb-4 border-b border-slate-800">
                <div className="text-xs text-slate-400">
                  Kinaxis Pattern · Ephemeral Copy-on-Write Sandbox
                </div>
                <h2 className="text-lg font-semibold text-white mt-0.5 font-display">
                  Spawn What-If Disruption Branch
                </h2>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Scenario Branch Name
                </label>
                <input
                  type="text"
                  required
                  value={scenarioForm.scenario_name}
                  onChange={(e) =>
                    setScenarioForm({ ...scenarioForm, scenario_name: e.target.value })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-xs text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Demand Surge (%)
                  </label>
                  <input
                    type="number"
                    min={-30}
                    max={100}
                    value={scenarioForm.demand_surge_pct}
                    onChange={(e) =>
                      setScenarioForm({
                        ...scenarioForm,
                        demand_surge_pct: Number(e.target.value),
                      })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-xs text-white font-mono tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Line Capacity Cut (%)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={scenarioForm.capacity_cut_pct}
                    onChange={(e) =>
                      setScenarioForm({
                        ...scenarioForm,
                        capacity_cut_pct: Number(e.target.value),
                      })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-xs text-white font-mono tabular-nums"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Constrained Resource
                  </label>
                  <select
                    value={scenarioForm.work_center_id}
                    onChange={(e) =>
                      setScenarioForm({
                        ...scenarioForm,
                        work_center_id: e.target.value,
                      })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-2 text-xs text-white"
                  >
                    {workspace.work_centers.map((wc) => (
                      <option key={wc.resource_id} value={wc.resource_id}>
                        {wc.resource_id} — {wc.name}
                      </option>
                    ))}
                    <option value="ALL">All Plant Lines</option>
                  </select>
                </div>

                <div>
                  <label
                    className="block text-xs text-slate-400 mb-1 truncate"
                    title={companyMeta.upstreamDelayLabel}
                  >
                    {companyMeta.upstreamDelayLabel}
                  </label>
                  <select
                    value={scenarioForm.supplier_delay_buckets}
                    onChange={(e) =>
                      setScenarioForm({
                        ...scenarioForm,
                        supplier_delay_buckets: Number(e.target.value),
                      })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-2 text-xs text-white font-mono tabular-nums"
                  >
                    <option value={0}>0 Buckets</option>
                    <option value={1}>1 Bucket Delay</option>
                    <option value={2}>2 Buckets Delay</option>
                    <option value={3}>3 Buckets Delay</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-800">
                <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={scenarioForm.authorize_overtime_override}
                    onChange={(e) =>
                      setScenarioForm({
                        ...scenarioForm,
                        authorize_overtime_override: e.target.checked,
                      })
                    }
                    className="accent-sky-400"
                  />
                  <span>Authorize Overtime Shift Buffer (+60% Max OT)</span>
                </label>

                <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={scenarioForm.expedite_air_enabled}
                    onChange={(e) =>
                      setScenarioForm({
                        ...scenarioForm,
                        expedite_air_enabled: e.target.checked,
                      })
                    }
                    className="accent-sky-400"
                  />
                  <span>{companyMeta.expediteCheckboxLabel}</span>
                </label>
              </div>

              <button
                type="submit"
                disabled={actionBusy}
                className="w-full py-2.5 px-4 bg-sky-400 hover:bg-sky-300 text-slate-950 font-semibold text-xs rounded-md transition-colors cursor-pointer"
              >
                Simulate Copy-on-Write Scenario
              </button>

              {/* Saved Scenario Branches Multi-Select List */}
              <div className="pt-4 border-t border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">
                    Matrix Branches ({selectedScenarioIds.length}/
                    {workspace.saved_scenarios.length} active)
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedScenarioIds(
                          workspace.saved_scenarios.map((s) => s.scenario_id)
                        )
                      }
                      className="text-sky-400 hover:text-sky-300 transition-colors cursor-pointer"
                    >
                      Select All
                    </button>
                    <span className="text-slate-600">·</span>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedScenarioIds(
                          workspace.saved_scenarios
                            .slice(0, 2)
                            .map((s) => s.scenario_id)
                        )
                      }
                      className="text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                    >
                      Top 2
                    </button>
                  </div>
                </div>

                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {workspace.saved_scenarios.map((scn, idx) => {
                    const isChecked = selectedScenarioIds.includes(scn.scenario_id);
                    return (
                      <div
                        key={scn.scenario_id}
                        onClick={() => handleToggleScenarioSelection(scn.scenario_id)}
                        className={`w-full text-left p-2.5 rounded border text-xs transition-colors cursor-pointer flex items-start gap-2.5 ${
                          isChecked
                            ? 'bg-slate-800/90 border-sky-400 text-white'
                            : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-800/40'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}}
                          className="mt-0.5 accent-sky-400 pointer-events-none"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[10px] text-sky-400">
                              BR-0{idx + 1}
                            </span>
                            <span className="font-mono tabular-nums text-[11px] text-slate-400">
                              OTIF {scn.scenario_kpis.otif_percentage}%
                            </span>
                          </div>
                          <div className="font-medium truncate mt-0.5">
                            {scn.scenario_name}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5">
                            Surge: {scn.overrides.demand_surge_pct >= 0 ? '+' : ''}
                            {scn.overrides.demand_surge_pct}% · Cap Cut:{' '}
                            {scn.overrides.capacity_cut_pct}% · Cost: $
                            {scn.scenario_kpis.total_cost.toLocaleString()}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </form>

            {/* Right 8 Cols: Multi-Scenario Table-Based Summary Matrix */}
            <div className="lg:col-span-8 bg-[#111827] border border-slate-800 rounded-lg p-6 space-y-6">
              {(() => {
                const comparedScenarios = workspace.saved_scenarios.filter((s) =>
                  selectedScenarioIds.includes(s.scenario_id)
                );

                // Resolve Reference Benchmark (either Active Baseline Plan or a specific Scenario Branch)
                const refScenario = comparedScenarios.find(
                  (s) => s.scenario_id === varianceReferenceId
                );

                const refMetrics = refScenario
                  ? {
                      label: refScenario.scenario_name,
                      otif_percentage: refScenario.scenario_kpis.otif_percentage,
                      unmet_units: refScenario.scenario_kpis.unmet_units,
                      total_cost: refScenario.scenario_kpis.total_cost,
                      total_revenue: refScenario.scenario_kpis.total_revenue,
                      gross_margin_pct: refScenario.scenario_kpis.gross_margin_pct,
                      working_capital_usd:
                        refScenario.scenario_kpis.working_capital_usd,
                      asset_utilization_pct:
                        refScenario.scenario_kpis.asset_utilization_pct,
                      setup_hours: refScenario.scenario_kpis.setup_hours,
                      overtime_hours:
                        refScenario.scenario_result.total_overtime_hours,
                      cost_breakdown: refScenario.scenario_result.cost_breakdown,
                    }
                  : {
                      label: 'Production Baseline',
                      otif_percentage: plan.otif_percentage,
                      unmet_units: plan.unmet_units,
                      total_cost: plan.total_cost,
                      total_revenue: plan.total_revenue,
                      gross_margin_pct: plan.gross_margin_pct,
                      working_capital_usd: plan.working_capital_tied_usd,
                      asset_utilization_pct: plan.asset_utilization_pct,
                      setup_hours: plan.total_setup_hours,
                      overtime_hours: plan.total_overtime_hours,
                      cost_breakdown: plan.cost_breakdown,
                    };

                // Identify Best Cost and Best OTIF across active compared scenarios
                const bestOtifScenario =
                  comparedScenarios.length > 0
                    ? [...comparedScenarios].sort(
                        (a, b) =>
                          b.scenario_kpis.otif_percentage -
                          a.scenario_kpis.otif_percentage
                      )[0]
                    : null;

                const lowestCostScenario =
                  comparedScenarios.length > 0
                    ? [...comparedScenarios].sort(
                        (a, b) =>
                          a.scenario_kpis.total_cost - b.scenario_kpis.total_cost
                      )[0]
                    : null;

                const highestMarginScenario =
                  comparedScenarios.length > 0
                    ? [...comparedScenarios].sort(
                        (a, b) =>
                          b.scenario_kpis.gross_margin_pct -
                          a.scenario_kpis.gross_margin_pct
                      )[0]
                    : null;

                // Helper: Compute 4-bucket (W44-W47) OTIF % trajectory for any optimization result
                const getBucketOtifSeries = (res: UnisonOptimizationResult): number[] => {
                  return workspace.buckets.map((b) => {
                    const rows = res.inventory_ledger.filter(
                      (r) => r.bucket === b.bucket
                    );
                    const dem = rows.reduce((s, r) => s + r.sensed_demand_units, 0);
                    const ful = rows.reduce((s, r) => s + r.fulfilled_units, 0);
                    return dem > 0 ? Number(((ful / dem) * 100).toFixed(1)) : 100;
                  });
                };

                // Helper: Compute 4-bucket (W44-W47) Cost trajectory for any optimization result
                const getBucketCostSeries = (res: UnisonOptimizationResult): number[] => {
                  return workspace.buckets.map((b) => {
                    const slots = res.production_plan.filter(
                      (s) => s.bucket === b.bucket
                    );
                    const rows = res.inventory_ledger.filter(
                      (r) => r.bucket === b.bucket
                    );
                    const slotCost = slots.reduce(
                      (s, sl) =>
                        s + sl.quantity * 46 + sl.setup_cost + sl.overtime_hours * 88,
                      0
                    );
                    const penaltyAndHold = rows.reduce(
                      (s, r) => s + r.unmet_units * 520 + r.closing_inventory * 0.45,
                      0
                    );
                    return Math.round(slotCost + penaltyAndHold);
                  });
                };

                // Cross-branch series (Baseline -> BR-01 -> BR-02 -> ...)
                const crossBranchLabels = [
                  'BASE',
                  ...comparedScenarios.map((_, i) => `BR-0${i + 1}`),
                ];
                const crossBranchOtifSeries = [
                  plan.otif_percentage,
                  ...comparedScenarios.map((s) => s.scenario_kpis.otif_percentage),
                ];
                const crossBranchCostSeries = [
                  plan.total_cost,
                  ...comparedScenarios.map((s) => s.scenario_kpis.total_cost),
                ];

                // SVG Sparkline Renderer for Cross-Branch & Horizon Trajectories
                const renderSparklineSvg = (
                  values: number[],
                  strokeColor: string,
                  fillColor: string,
                  highlightIdx?: number,
                  width = 116,
                  height = 26
                ) => {
                  if (values.length === 0) return null;
                  const minVal = Math.min(...values);
                  const maxVal = Math.max(...values);
                  const span = maxVal - minVal || 1;
                  const padX = 5;
                  const padY = 4;
                  const innerW = width - padX * 2;
                  const innerH = height - padY * 2;

                  const coords = values.map((v, i) => {
                    const x =
                      values.length === 1
                        ? width / 2
                        : padX + (i / (values.length - 1)) * innerW;
                    const y = padY + innerH - ((v - minVal) / span) * innerH;
                    return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)), v };
                  });

                  const polylinePoints = coords.map((c) => `${c.x},${c.y}`).join(' ');
                  const areaPath =
                    coords.length > 1
                      ? `M ${coords[0].x},${height - 2} L ${coords
                          .map((c) => `${c.x},${c.y}`)
                          .join(' L ')} L ${coords[coords.length - 1].x},${
                          height - 2
                        } Z`
                      : '';

                  return (
                    <svg
                      width={width}
                      height={height}
                      viewBox={`0 0 ${width} ${height}`}
                      className="overflow-visible shrink-0"
                      aria-hidden="true"
                    >
                      {areaPath && (
                        <path d={areaPath} fill={fillColor} fillOpacity="0.16" />
                      )}
                      <polyline
                        fill="none"
                        stroke={strokeColor}
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        points={polylinePoints}
                      />
                      {coords.map((pt, idx) => {
                        const isHighlighted =
                          highlightIdx !== undefined
                            ? idx === highlightIdx
                            : idx === coords.length - 1;
                        return (
                          <circle
                            key={idx}
                            cx={pt.x}
                            cy={pt.y}
                            r={isHighlighted ? 2.8 : 1.7}
                            fill={isHighlighted ? '#F8FAFC' : strokeColor}
                            stroke={isHighlighted ? strokeColor : 'none'}
                            strokeWidth={isHighlighted ? 1.5 : 0}
                          />
                        );
                      })}
                    </svg>
                  );
                };

                const baselineBucketOtif = getBucketOtifSeries(plan);
                const baselineBucketCost = getBucketCostSeries(plan);

                const handleExportMatrixCsv = () => {
                  const headers = [
                    'Dimension / Metric',
                    'Production Baseline',
                    ...comparedScenarios.map((s) => `"${s.scenario_name}"`),
                  ];
                  const matrixRows = [
                    [
                      'Demand Surge Override (%)',
                      '0%',
                      ...comparedScenarios.map(
                        (s) => `${s.overrides.demand_surge_pct}%`
                      ),
                    ],
                    [
                      'Capacity Cut Override (%)',
                      '0%',
                      ...comparedScenarios.map(
                        (s) => `${s.overrides.capacity_cut_pct}%`
                      ),
                    ],
                    [
                      'OTIF Fill Rate (%)',
                      `${plan.otif_percentage}%`,
                      ...comparedScenarios.map(
                        (s) => `${s.scenario_kpis.otif_percentage}%`
                      ),
                    ],
                    [
                      'Unfulfilled Shortfall (Units)',
                      `${plan.unmet_units}`,
                      ...comparedScenarios.map((s) => `${s.scenario_kpis.unmet_units}`),
                    ],
                    [
                      'Total Supply Chain Cost (USD)',
                      `${plan.total_cost}`,
                      ...comparedScenarios.map((s) => `${s.scenario_kpis.total_cost}`),
                    ],
                    [
                      'Commercial Gross Margin (%)',
                      `${plan.gross_margin_pct}%`,
                      ...comparedScenarios.map(
                        (s) => `${s.scenario_kpis.gross_margin_pct}%`
                      ),
                    ],
                    [
                      'Working Capital Tied (USD)',
                      `${plan.working_capital_tied_usd}`,
                      ...comparedScenarios.map(
                        (s) => `${s.scenario_kpis.working_capital_usd}`
                      ),
                    ],
                    [
                      'Finite Line Utilization (%)',
                      `${plan.asset_utilization_pct}%`,
                      ...comparedScenarios.map(
                        (s) => `${s.scenario_kpis.asset_utilization_pct}%`
                      ),
                    ],
                    [
                      'Changeover Setup Downtime (Hours)',
                      `${plan.total_setup_hours}`,
                      ...comparedScenarios.map((s) => `${s.scenario_kpis.setup_hours}`),
                    ],
                  ];

                  const csvContent =
                    'data:text/csv;charset=utf-8,' +
                    [
                      headers.join(','),
                      ...matrixRows.map((r) => r.join(',')),
                    ].join('\n');
                  const encodedUri = encodeURI(csvContent);
                  const link = document.createElement('a');
                  link.setAttribute('href', encodedUri);
                  link.setAttribute('download', 'multi_scenario_comparison_matrix.csv');
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                };

                return comparedScenarios.length > 0 ? (
                  <>
                    {/* Matrix Header & Controls */}
                    <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
                      <div>
                        <div className="text-xs text-slate-400">
                          Concurrent Multi-Branch Diffing · Baseline +{' '}
                          {comparedScenarios.length} Ephemeral Scenarios
                        </div>
                        <h2 className="text-lg font-semibold text-white mt-0.5 font-display">
                          Multi-Scenario Comparative Summary Matrix
                        </h2>
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-slate-400 whitespace-nowrap">
                            Delta Benchmark:
                          </span>
                          <select
                            aria-label="Select Delta Reference Benchmark"
                            value={varianceReferenceId}
                            onChange={(e) => setVarianceReferenceId(e.target.value)}
                            className="bg-slate-900 border border-slate-700 text-xs text-slate-200 rounded px-2.5 py-1.5"
                          >
                            <option value="BASELINE">Production Baseline</option>
                            {comparedScenarios.map((s, idx) => (
                              <option key={s.scenario_id} value={s.scenario_id}>
                                BR-0{idx + 1}: {s.scenario_name.slice(0, 28)}...
                              </option>
                            ))}
                          </select>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            setShowCostDecompositionRows(!showCostDecompositionRows)
                          }
                          className="px-3 py-1.5 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 rounded transition-colors cursor-pointer whitespace-nowrap shrink-0"
                        >
                          {showCostDecompositionRows
                            ? 'Hide Cost Breakdown Rows'
                            : 'Show Cost Breakdown Rows'}
                        </button>

                        <button
                          type="button"
                          onClick={handleExportMatrixCsv}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 rounded transition-colors cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <Download className="w-3.5 h-3.5 text-slate-400" />
                          <span>Export Matrix CSV</span>
                        </button>
                      </div>
                    </div>

                    {/* Multi-Branch Pareto Winner & Trade-Off Sparkline Strip */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="p-3.5 bg-[#0B0F17] border border-slate-800 rounded-lg space-y-2">
                        <div className="flex items-center justify-between text-xs text-slate-400">
                          <span>OTIF Service Trajectory (Across Branches)</span>
                          <span className="font-mono text-[11px] text-emerald-400">
                            Peak {bestOtifScenario?.scenario_kpis.otif_percentage}%
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-lg font-bold font-mono tabular-nums text-emerald-400">
                              {bestOtifScenario?.scenario_kpis.otif_percentage}%
                            </div>
                            <div className="text-[11px] text-slate-400 truncate max-w-[140px]">
                              {bestOtifScenario?.scenario_name}
                            </div>
                          </div>
                          {renderSparklineSvg(
                            crossBranchOtifSeries,
                            '#34D399',
                            '#10B981',
                            undefined,
                            124,
                            30
                          )}
                        </div>
                        <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 pt-1 border-t border-slate-800/70">
                          {crossBranchLabels.map((lbl, idx) => (
                            <span key={lbl}>
                              {lbl}: {crossBranchOtifSeries[idx]}%
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="p-3.5 bg-[#0B0F17] border border-slate-800 rounded-lg space-y-2">
                        <div className="flex items-center justify-between text-xs text-slate-400">
                          <span>Total Cost Trajectory (Across Branches)</span>
                          <span className="font-mono text-[11px] text-sky-400">
                            Min $
                            {(
                              (lowestCostScenario?.scenario_kpis.total_cost || 0) /
                              1000
                            ).toFixed(1)}
                            k
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-lg font-bold font-mono tabular-nums text-sky-400">
                              $
                              {lowestCostScenario?.scenario_kpis.total_cost.toLocaleString()}
                            </div>
                            <div className="text-[11px] text-slate-400 truncate max-w-[140px]">
                              {lowestCostScenario?.scenario_name}
                            </div>
                          </div>
                          {renderSparklineSvg(
                            crossBranchCostSeries,
                            '#38BDF8',
                            '#0284C7',
                            undefined,
                            124,
                            30
                          )}
                        </div>
                        <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 pt-1 border-t border-slate-800/70">
                          {crossBranchLabels.map((lbl, idx) => (
                            <span key={lbl}>
                              {lbl}: ${(crossBranchCostSeries[idx] / 1000).toFixed(0)}k
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="p-3.5 bg-[#0B0F17] border border-slate-800 rounded-lg space-y-2">
                        <div className="flex items-center justify-between text-xs text-slate-400">
                          <span>Best Commercial Gross Margin</span>
                          <span className="font-mono text-[11px] text-slate-300">
                            OTIF vs Cost Trade-Off
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-lg font-bold font-mono tabular-nums text-white">
                            {highestMarginScenario?.scenario_kpis.gross_margin_pct}%
                          </span>
                          <span className="text-xs text-slate-300 truncate">
                            {highestMarginScenario?.scenario_name}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 pt-1 border-t border-slate-800/70 font-mono tabular-nums">
                          Spread:{' '}
                          {(
                            Math.max(...crossBranchOtifSeries) -
                            Math.min(...crossBranchOtifSeries)
                          ).toFixed(1)}{' '}
                          OTIF pts vs. $
                          {(
                            (Math.max(...crossBranchCostSeries) -
                              Math.min(...crossBranchCostSeries)) /
                            1000
                          ).toFixed(1)}
                          k Cost
                        </div>
                      </div>
                    </div>

                    {/* Table-Based Multi-Scenario Summary Matrix */}
                    <div className="overflow-x-auto border border-slate-800 rounded-md">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-800 bg-slate-900/80 text-slate-300">
                            <th className="py-3 px-4 font-semibold min-w-[235px] sticky left-0 bg-slate-900 z-10 border-r border-slate-800">
                              Dimension / KPI Metric & Cross-Branch Trend
                            </th>
                            <th
                              className={`py-3 px-4 font-semibold text-right min-w-[165px] border-r border-slate-800/80 ${
                                varianceReferenceId === 'BASELINE'
                                  ? 'bg-sky-950/25 text-sky-300'
                                  : 'bg-slate-900/60 text-slate-200'
                              }`}
                            >
                              <div className="font-mono text-[10px] text-slate-400 uppercase">
                                {varianceReferenceId === 'BASELINE'
                                  ? 'ACTIVE BENCHMARK'
                                  : 'LIVE PLAN'}
                              </div>
                              <div className="mt-0.5 text-white">
                                Production Baseline
                              </div>
                            </th>

                            {comparedScenarios.map((scn, idx) => {
                              const isRef = varianceReferenceId === scn.scenario_id;
                              return (
                                <th
                                  key={scn.scenario_id}
                                  className={`py-3 px-4 font-semibold text-right min-w-[190px] border-r border-slate-800/60 last:border-r-0 ${
                                    isRef ? 'bg-sky-950/25' : ''
                                  }`}
                                >
                                  <div className="flex items-center justify-end gap-1.5 font-mono text-[10px] text-sky-400">
                                    <span>BR-0{idx + 1}</span>
                                    {isRef && (
                                      <span className="text-amber-400">
                                        · BENCHMARK
                                      </span>
                                    )}
                                  </div>
                                  <div
                                    className="text-white truncate max-w-[175px] ml-auto mt-0.5"
                                    title={scn.scenario_name}
                                  >
                                    {scn.scenario_name}
                                  </div>
                                </th>
                              );
                            })}
                          </tr>
                        </thead>

                        <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                          {/* SECTION 1: SCENARIO INPUT PARAMETERS */}
                          <tr className="bg-slate-950/70">
                            <td
                              colSpan={2 + comparedScenarios.length}
                              className="py-1.5 px-4 font-sans text-[11px] font-semibold text-slate-400 tracking-wide"
                            >
                              01. Scenario Disruption & Policy Lever Parameters
                            </td>
                          </tr>

                          <tr className="hover:bg-slate-800/30">
                            <td className="py-2 px-4 font-sans text-slate-300 sticky left-0 bg-[#111827] border-r border-slate-800">
                              Demand Surge Override
                            </td>
                            <td className="py-2 px-4 text-right text-slate-400 border-r border-slate-800/80">
                              0% (Consensus)
                            </td>
                            {comparedScenarios.map((scn) => (
                              <td
                                key={scn.scenario_id}
                                className="py-2 px-4 text-right text-slate-200 border-r border-slate-800/60 last:border-r-0"
                              >
                                {scn.overrides.demand_surge_pct >= 0
                                  ? `+${scn.overrides.demand_surge_pct}%`
                                  : `${scn.overrides.demand_surge_pct}%`}
                              </td>
                            ))}
                          </tr>

                          <tr className="hover:bg-slate-800/30">
                            <td className="py-2 px-4 font-sans text-slate-300 sticky left-0 bg-[#111827] border-r border-slate-800">
                              Resource Capacity Cut
                            </td>
                            <td className="py-2 px-4 text-right text-slate-400 border-r border-slate-800/80">
                              0% (Nominal)
                            </td>
                            {comparedScenarios.map((scn) => (
                              <td
                                key={scn.scenario_id}
                                className="py-2 px-4 text-right text-slate-200 border-r border-slate-800/60 last:border-r-0"
                              >
                                {scn.overrides.capacity_cut_pct > 0
                                  ? `-${scn.overrides.capacity_cut_pct}% (${scn.overrides.work_center_id.replace(
                                      'WC_',
                                      ''
                                    )})`
                                  : '0% (Nominal)'}
                              </td>
                            ))}
                          </tr>

                          <tr className="hover:bg-slate-800/30">
                            <td className="py-2 px-4 font-sans text-slate-300 sticky left-0 bg-[#111827] border-r border-slate-800">
                              {companyMeta.upstreamDelayLabel} / Levers
                            </td>
                            <td className="py-2 px-4 text-right text-slate-400 border-r border-slate-800/80">
                              0w · Standard
                            </td>
                            {comparedScenarios.map((scn) => (
                              <td
                                key={scn.scenario_id}
                                className="py-2 px-4 text-right text-slate-300 border-r border-slate-800/60 last:border-r-0"
                              >
                                +{scn.overrides.supplier_delay_buckets}w ·{' '}
                                {scn.overrides.authorize_overtime_override
                                  ? 'OT'
                                  : 'No-OT'}{' '}
                                /{' '}
                                {scn.overrides.expedite_air_enabled ? 'Air' : 'Ocean'}
                              </td>
                            ))}
                          </tr>

                          {/* SECTION 2: SERVICE & FINANCIAL PERFORMANCE */}
                          <tr className="bg-slate-950/70">
                            <td
                              colSpan={2 + comparedScenarios.length}
                              className="py-1.5 px-4 font-sans text-[11px] font-semibold text-slate-400 tracking-wide"
                            >
                              02. Service Level, Commercial & Financial KPIs (vs.{' '}
                              {refMetrics.label}) — With W44–W47 & Cross-Branch Sparklines
                            </td>
                          </tr>

                          {/* OTIF % WITH SPARKLINE TRENDS */}
                          <tr className="hover:bg-slate-800/30">
                            <td className="py-3 px-4 font-sans font-medium text-slate-200 sticky left-0 bg-[#111827] border-r border-slate-800">
                              <div className="flex items-center justify-between gap-2">
                                <div>
                                  <div>On-Time In-Full (OTIF %)</div>
                                  <div className="text-[10px] text-slate-400 font-normal mt-0.5">
                                    Cross-Branch Service Trend
                                  </div>
                                </div>
                                {renderSparklineSvg(
                                  crossBranchOtifSeries,
                                  '#34D399',
                                  '#10B981',
                                  undefined,
                                  78,
                                  22
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-right text-white font-semibold border-r border-slate-800/80">
                              <div className="flex items-center justify-end gap-2.5">
                                {renderSparklineSvg(
                                  baselineBucketOtif,
                                  '#34D399',
                                  '#10B981',
                                  undefined,
                                  64,
                                  20
                                )}
                                <div>
                                  <div>{plan.otif_percentage.toFixed(1)}%</div>
                                  <div className="text-[10px] text-slate-400 font-normal">
                                    W44–W47
                                  </div>
                                </div>
                              </div>
                            </td>
                            {comparedScenarios.map((scn) => {
                              const val = scn.scenario_kpis.otif_percentage;
                              const delta = Number(
                                (val - refMetrics.otif_percentage).toFixed(2)
                              );
                              const isBest =
                                bestOtifScenario?.scenario_id === scn.scenario_id;
                              const bucketOtif = getBucketOtifSeries(
                                scn.scenario_result
                              );
                              const lineStroke =
                                val >= 95
                                  ? '#34D399'
                                  : val >= 88
                                  ? '#FBBF24'
                                  : '#FB7185';
                              return (
                                <td
                                  key={scn.scenario_id}
                                  className="py-3 px-4 text-right border-r border-slate-800/60 last:border-r-0"
                                >
                                  <div className="flex items-center justify-end gap-2.5">
                                    <div
                                      title={`W44–W47 Weekly OTIF: ${bucketOtif
                                        .map((v) => `${v}%`)
                                        .join(' → ')}`}
                                    >
                                      {renderSparklineSvg(
                                        bucketOtif,
                                        lineStroke,
                                        lineStroke,
                                        undefined,
                                        64,
                                        20
                                      )}
                                    </div>
                                    <div>
                                      <div
                                        className={`font-semibold ${
                                          isBest ? 'text-emerald-400' : 'text-white'
                                        }`}
                                      >
                                        {val.toFixed(1)}%
                                      </div>
                                      <div
                                        className={`text-[11px] ${
                                          delta < 0
                                            ? 'text-rose-400'
                                            : delta > 0
                                            ? 'text-emerald-400'
                                            : 'text-slate-500'
                                        }`}
                                      >
                                        {delta > 0 ? `+${delta} pts` : `${delta} pts`}
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              );
                            })}
                          </tr>

                          {/* Unfulfilled Shortfall Units */}
                          <tr className="hover:bg-slate-800/30">
                            <td className="py-2.5 px-4 font-sans text-slate-200 sticky left-0 bg-[#111827] border-r border-slate-800">
                              Unfulfilled Shortfall ({companyMeta.primaryUom})
                            </td>
                            <td className="py-2.5 px-4 text-right text-slate-300 border-r border-slate-800/80">
                              {plan.unmet_units.toLocaleString()}{' '}
                              {companyMeta.shortPrimaryUom}
                            </td>
                            {comparedScenarios.map((scn) => {
                              const val = scn.scenario_kpis.unmet_units;
                              const delta = val - refMetrics.unmet_units;
                              return (
                                <td
                                  key={scn.scenario_id}
                                  className="py-2.5 px-4 text-right border-r border-slate-800/60 last:border-r-0"
                                >
                                  <div className="text-white font-semibold">
                                    {val.toLocaleString()}{' '}
                                    {companyMeta.shortPrimaryUom}
                                  </div>
                                  <div
                                    className={`text-[11px] ${
                                      delta > 0
                                        ? 'text-rose-400'
                                        : delta < 0
                                        ? 'text-emerald-400'
                                        : 'text-slate-500'
                                    }`}
                                  >
                                    {delta > 0
                                      ? `+${delta.toLocaleString()} ${
                                          companyMeta.shortPrimaryUom
                                        }`
                                      : `${delta.toLocaleString()} ${
                                          companyMeta.shortPrimaryUom
                                        }`}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>

                          {/* Total Supply Chain Cost WITH SPARKLINE TRENDS */}
                          <tr className="hover:bg-slate-800/30">
                            <td className="py-3 px-4 font-sans font-medium text-slate-200 sticky left-0 bg-[#111827] border-r border-slate-800">
                              <div className="flex items-center justify-between gap-2">
                                <div>
                                  <div>Total Supply Chain Cost</div>
                                  <div className="text-[10px] text-slate-400 font-normal mt-0.5">
                                    Cross-Branch Cost Curve
                                  </div>
                                </div>
                                {renderSparklineSvg(
                                  crossBranchCostSeries,
                                  '#38BDF8',
                                  '#0284C7',
                                  undefined,
                                  78,
                                  22
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-right text-white font-semibold border-r border-slate-800/80">
                              <div className="flex items-center justify-end gap-2.5">
                                {renderSparklineSvg(
                                  baselineBucketCost,
                                  '#38BDF8',
                                  '#0284C7',
                                  undefined,
                                  64,
                                  20
                                )}
                                <div>
                                  <div>${plan.total_cost.toLocaleString()}</div>
                                  <div className="text-[10px] text-slate-400 font-normal">
                                    W44–W47
                                  </div>
                                </div>
                              </div>
                            </td>
                            {comparedScenarios.map((scn) => {
                              const val = scn.scenario_kpis.total_cost;
                              const delta = val - refMetrics.total_cost;
                              const pct = (
                                (delta / Math.max(1, refMetrics.total_cost)) *
                                100
                              ).toFixed(1);
                              const isBest =
                                lowestCostScenario?.scenario_id === scn.scenario_id;
                              const bucketCost = getBucketCostSeries(
                                scn.scenario_result
                              );
                              const costStroke =
                                delta <= 0
                                  ? '#38BDF8'
                                  : delta > 50000
                                  ? '#FB7185'
                                  : '#FBBF24';
                              return (
                                <td
                                  key={scn.scenario_id}
                                  className="py-3 px-4 text-right border-r border-slate-800/60 last:border-r-0"
                                >
                                  <div className="flex items-center justify-end gap-2.5">
                                    <div
                                      title={`W44–W47 Weekly Cost: ${bucketCost
                                        .map((c) => `$${(c / 1000).toFixed(1)}k`)
                                        .join(' → ')}`}
                                    >
                                      {renderSparklineSvg(
                                        bucketCost,
                                        costStroke,
                                        costStroke,
                                        undefined,
                                        64,
                                        20
                                      )}
                                    </div>
                                    <div>
                                      <div
                                        className={`font-semibold ${
                                          isBest ? 'text-sky-400' : 'text-white'
                                        }`}
                                      >
                                        ${val.toLocaleString()}
                                      </div>
                                      <div
                                        className={`text-[11px] ${
                                          delta > 0
                                            ? 'text-rose-400'
                                            : delta < 0
                                            ? 'text-emerald-400'
                                            : 'text-slate-500'
                                        }`}
                                      >
                                        {delta > 0
                                          ? `+$${delta.toLocaleString()} (+${pct}%)`
                                          : delta < 0
                                          ? `-$${Math.abs(delta).toLocaleString()} (${pct}%)`
                                          : '$0 (0.0%)'}
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              );
                            })}
                          </tr>

                          {/* Recognized Revenue */}
                          <tr className="hover:bg-slate-800/30">
                            <td className="py-2.5 px-4 font-sans text-slate-200 sticky left-0 bg-[#111827] border-r border-slate-800">
                              Recognized Revenue
                            </td>
                            <td className="py-2.5 px-4 text-right text-slate-300 border-r border-slate-800/80">
                              ${plan.total_revenue.toLocaleString()}
                            </td>
                            {comparedScenarios.map((scn) => {
                              const val = scn.scenario_kpis.total_revenue;
                              const delta = val - refMetrics.total_revenue;
                              return (
                                <td
                                  key={scn.scenario_id}
                                  className="py-2.5 px-4 text-right border-r border-slate-800/60 last:border-r-0"
                                >
                                  <div className="text-white">
                                    ${val.toLocaleString()}
                                  </div>
                                  <div
                                    className={`text-[11px] ${
                                      delta > 0
                                        ? 'text-emerald-400'
                                        : delta < 0
                                        ? 'text-rose-400'
                                        : 'text-slate-500'
                                    }`}
                                  >
                                    {delta >= 0
                                      ? `+$${delta.toLocaleString()}`
                                      : `-$${Math.abs(delta).toLocaleString()}`}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>

                          {/* Commercial Gross Margin % */}
                          <tr className="hover:bg-slate-800/30">
                            <td className="py-2.5 px-4 font-sans text-slate-200 sticky left-0 bg-[#111827] border-r border-slate-800">
                              Commercial Gross Margin (%)
                            </td>
                            <td className="py-2.5 px-4 text-right text-slate-300 border-r border-slate-800/80">
                              {plan.gross_margin_pct.toFixed(1)}%
                            </td>
                            {comparedScenarios.map((scn) => {
                              const val = scn.scenario_kpis.gross_margin_pct;
                              const delta = Number(
                                (val - refMetrics.gross_margin_pct).toFixed(2)
                              );
                              return (
                                <td
                                  key={scn.scenario_id}
                                  className="py-2.5 px-4 text-right border-r border-slate-800/60 last:border-r-0"
                                >
                                  <div className="text-white font-semibold">
                                    {val.toFixed(1)}%
                                  </div>
                                  <div
                                    className={`text-[11px] ${
                                      delta < 0
                                        ? 'text-rose-400'
                                        : delta > 0
                                        ? 'text-emerald-400'
                                        : 'text-slate-500'
                                    }`}
                                  >
                                    {delta > 0 ? `+${delta}%` : `${delta}%`}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>

                          {/* Working Capital Requirements */}
                          <tr className="hover:bg-slate-800/30">
                            <td className="py-2.5 px-4 font-sans text-slate-200 sticky left-0 bg-[#111827] border-r border-slate-800">
                              Working Capital Tied
                            </td>
                            <td className="py-2.5 px-4 text-right text-slate-300 border-r border-slate-800/80">
                              ${plan.working_capital_tied_usd.toLocaleString()}
                            </td>
                            {comparedScenarios.map((scn) => {
                              const val = scn.scenario_kpis.working_capital_usd;
                              const delta = val - refMetrics.working_capital_usd;
                              return (
                                <td
                                  key={scn.scenario_id}
                                  className="py-2.5 px-4 text-right border-r border-slate-800/60 last:border-r-0"
                                >
                                  <div className="text-slate-200">
                                    ${val.toLocaleString()}
                                  </div>
                                  <div className="text-[11px] text-slate-400">
                                    {delta >= 0
                                      ? `+$${delta.toLocaleString()}`
                                      : `-$${Math.abs(delta).toLocaleString()}`}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>

                          {/* SECTION 3: OPERATIONAL CAPACITY & CHANGEOVER METRICS */}
                          <tr className="bg-slate-950/70">
                            <td
                              colSpan={2 + comparedScenarios.length}
                              className="py-1.5 px-4 font-sans text-[11px] font-semibold text-slate-400 tracking-wide"
                            >
                              03. Finite Capacity, Changeovers & Schedule Execution
                            </td>
                          </tr>

                          <tr className="hover:bg-slate-800/30">
                            <td className="py-2 px-4 font-sans text-slate-200 sticky left-0 bg-[#111827] border-r border-slate-800">
                              Plant Line Utilization (%)
                            </td>
                            <td className="py-2 px-4 text-right text-slate-300 border-r border-slate-800/80">
                              {plan.asset_utilization_pct.toFixed(1)}%
                            </td>
                            {comparedScenarios.map((scn) => {
                              const val = scn.scenario_kpis.asset_utilization_pct;
                              const delta = Number(
                                (val - refMetrics.asset_utilization_pct).toFixed(1)
                              );
                              return (
                                <td
                                  key={scn.scenario_id}
                                  className="py-2 px-4 text-right border-r border-slate-800/60 last:border-r-0"
                                >
                                  <div
                                    className={
                                      val > 100
                                        ? 'text-amber-400 font-semibold'
                                        : 'text-white'
                                    }
                                  >
                                    {val.toFixed(1)}%
                                  </div>
                                  <div className="text-[11px] text-slate-400">
                                    {delta >= 0 ? `+${delta}%` : `${delta}%`}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>

                          <tr className="hover:bg-slate-800/30">
                            <td className="py-2 px-4 font-sans text-slate-200 sticky left-0 bg-[#111827] border-r border-slate-800">
                              Sequence Setup Downtime
                            </td>
                            <td className="py-2 px-4 text-right text-slate-300 border-r border-slate-800/80">
                              {plan.total_setup_hours} hrs
                            </td>
                            {comparedScenarios.map((scn) => (
                              <td
                                key={scn.scenario_id}
                                className="py-2 px-4 text-right text-slate-200 border-r border-slate-800/60 last:border-r-0"
                              >
                                {scn.scenario_kpis.setup_hours} hrs
                              </td>
                            ))}
                          </tr>

                          <tr className="hover:bg-slate-800/30">
                            <td className="py-2 px-4 font-sans text-slate-200 sticky left-0 bg-[#111827] border-r border-slate-800">
                              Scheduled Overtime Hours
                            </td>
                            <td className="py-2 px-4 text-right text-slate-300 border-r border-slate-800/80">
                              {plan.total_overtime_hours} hrs
                            </td>
                            {comparedScenarios.map((scn) => (
                              <td
                                key={scn.scenario_id}
                                className="py-2 px-4 text-right text-amber-400 border-r border-slate-800/60 last:border-r-0"
                              >
                                {scn.scenario_result.total_overtime_hours} hrs
                              </td>
                            ))}
                          </tr>

                          {/* SECTION 4: OPTIONAL COST DECOMPOSITION WITH THERMAL HEATMAP CELLS */}
                          {showCostDecompositionRows && (
                            <>
                              <tr className="bg-slate-950/70">
                                <td
                                  colSpan={2 + comparedScenarios.length}
                                  className="py-1.5 px-4 font-sans text-[11px] font-semibold text-slate-400 tracking-wide"
                                >
                                  04. MILP Cost Objective Decomposition &amp; Thermal Discrepancy Shading (USD vs. {refMetrics.label})
                                </td>
                              </tr>

                              {(
                                [
                                  {
                                    key: 'inventory_holding',
                                    label: 'Inventory Carrying & Holding Cost',
                                    isHighlightedRow: true,
                                  },
                                  {
                                    key: 'changeover_setups',
                                    label: 'Sequence Changeover Setups',
                                    isHighlightedRow: true,
                                  },
                                  {
                                    key: 'production',
                                    label: 'Variable Production Cost',
                                    isHighlightedRow: false,
                                  },
                                  {
                                    key: 'stockout_penalty',
                                    label: 'Stockout Penalty Exposure',
                                    isHighlightedRow: false,
                                  },
                                  {
                                    key: 'overtime',
                                    label: 'Shift Overtime Premiums',
                                    isHighlightedRow: false,
                                  },
                                  {
                                    key: 'transit_landed',
                                    label: companyMeta.transitCostLabel,
                                    isHighlightedRow: false,
                                  },
                                ] as const
                              ).map((costRow) => {
                                const baseVal = plan.cost_breakdown[costRow.key];
                                const refVal = refMetrics.cost_breakdown[costRow.key];
                                const allRowVals = [
                                  baseVal,
                                  ...comparedScenarios.map(
                                    (s) => s.scenario_result.cost_breakdown[costRow.key]
                                  ),
                                ];
                                const minRowVal = Math.min(...allRowVals);
                                const maxRowVal = Math.max(...allRowVals);

                                const getCellHeatClass = (val: number) => {
                                  if (!costRow.isHighlightedRow) {
                                    return 'text-slate-300';
                                  }
                                  const deltaPct =
                                    ((val - refVal) / Math.max(1, refVal)) * 100;
                                  const norm =
                                    maxRowVal > minRowVal
                                      ? (val - minRowVal) / (maxRowVal - minRowVal)
                                      : 0.5;
                                  const score =
                                    heatmapNormMode === 'BENCHMARK_DELTA'
                                      ? deltaPct
                                      : (norm - 0.35) * 60;

                                  if (score <= -3)
                                    return 'bg-emerald-500/15 text-emerald-200';
                                  if (score <= 4)
                                    return 'bg-slate-900/50 text-slate-200';
                                  if (score <= 15)
                                    return 'bg-sky-500/15 text-sky-200';
                                  if (score <= 30)
                                    return 'bg-amber-500/20 text-amber-200';
                                  return 'bg-rose-500/25 text-rose-200';
                                };

                                const baseDelta = baseVal - refVal;
                                const baseDeltaPct = (
                                  (baseDelta / Math.max(1, refVal)) *
                                  100
                                ).toFixed(1);

                                return (
                                  <tr
                                    key={costRow.key}
                                    className="hover:bg-slate-800/30"
                                  >
                                    <td
                                      className={`py-2.5 px-4 font-sans sticky left-0 bg-[#111827] border-r border-slate-800 ${
                                        costRow.isHighlightedRow
                                          ? 'text-sky-300 font-semibold'
                                          : 'text-slate-400'
                                      }`}
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <span>{costRow.label}</span>
                                        {costRow.isHighlightedRow && (
                                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/30">
                                            HEATMAP
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td
                                      className={`py-2.5 px-4 text-right border-r border-slate-800/80 ${getCellHeatClass(
                                        baseVal
                                      )}`}
                                    >
                                      <div className="font-semibold">
                                        ${baseVal.toLocaleString()}
                                      </div>
                                      {costRow.isHighlightedRow && (
                                        <div className="text-[10px] opacity-80">
                                          {baseDelta === 0
                                            ? 'Benchmark (0.0%)'
                                            : baseDelta > 0
                                            ? `+$${baseDelta.toLocaleString()} (+${baseDeltaPct}%)`
                                            : `-$${Math.abs(
                                                baseDelta
                                              ).toLocaleString()} (${baseDeltaPct}%)`}
                                        </div>
                                      )}
                                    </td>
                                    {comparedScenarios.map((scn) => {
                                      const val =
                                        scn.scenario_result.cost_breakdown[
                                          costRow.key
                                        ];
                                      const delta = val - refVal;
                                      const deltaPct = (
                                        (delta / Math.max(1, refVal)) *
                                        100
                                      ).toFixed(1);
                                      return (
                                        <td
                                          key={scn.scenario_id}
                                          className={`py-2.5 px-4 text-right border-r border-slate-800/60 last:border-r-0 ${getCellHeatClass(
                                            val
                                          )}`}
                                        >
                                          <div className="font-semibold">
                                            ${val.toLocaleString()}
                                          </div>
                                          {costRow.isHighlightedRow && (
                                            <div className="text-[10px] opacity-90">
                                              {delta === 0
                                                ? '$0 (0.0%)'
                                                : delta > 0
                                                ? `+$${delta.toLocaleString()} (+${deltaPct}%)`
                                                : `-$${Math.abs(
                                                    delta
                                                  ).toLocaleString()} (${deltaPct}%)`}
                                            </div>
                                          )}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                );
                              })}
                            </>
                          )}

                          {/* SECTION 5: BRANCH PROMOTION ACTIONS */}
                          <tr className="bg-slate-900/90">
                            <td className="py-3 px-4 font-sans font-semibold text-slate-300 sticky left-0 bg-slate-900 border-r border-slate-800">
                              Branch Execution Action
                            </td>
                            <td className="py-3 px-4 text-right font-sans text-slate-400 border-r border-slate-800/80">
                              Active Production Plan
                            </td>
                            {comparedScenarios.map((scn) => (
                              <td
                                key={scn.scenario_id}
                                className="py-3 px-4 text-right font-sans border-r border-slate-800/60 last:border-r-0"
                              >
                                <button
                                  type="button"
                                  disabled={actionBusy}
                                  onClick={() =>
                                    handlePromoteScenarioToBaseline(scn.scenario_id)
                                  }
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded transition-colors cursor-pointer whitespace-nowrap"
                                >
                                  <GitMerge className="w-3 h-3" />
                                  <span>Merge Branch</span>
                                </button>
                              </td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {/* ===============================================================
                        DEDICATED HEATMAP VISUALIZATION: INVENTORY HOLDING & CHANGEOVER
                        COST DISCREPANCIES ACROSS SCENARIO BRANCHES + W44–W47 BUCKETS
                       =============================================================== */}
                    {(() => {
                      const getBucketHoldingCost = (
                        res: UnisonOptimizationResult,
                        bucketNum: number
                      ) => {
                        const rows = res.inventory_ledger.filter(
                          (r) => r.bucket === bucketNum
                        );
                        const rawSum = rows.reduce((acc, r) => {
                          const prod = workspace.products.find(
                            (p) => p.product_id === r.product_id
                          );
                          const unitVarCost =
                            prod?.financials.unit_variable_cost ?? 42;
                          const holdRate =
                            prod?.financials.holding_cost_rate_annual ?? 0.2;
                          const weeklyHoldPerUnit = Math.max(
                            0.35,
                            (unitVarCost * holdRate) / 52
                          );
                          return acc + r.closing_inventory * weeklyHoldPerUnit;
                        }, 0);
                        // Scale bucket sum proportionally to match total inventory_holding
                        const totalLedgerClosing = res.inventory_ledger.reduce(
                          (a, r) => a + r.closing_inventory,
                          0
                        );
                        const bucketClosing = rows.reduce(
                          (a, r) => a + r.closing_inventory,
                          0
                        );
                        if (totalLedgerClosing > 0) {
                          return Math.round(
                            res.cost_breakdown.inventory_holding *
                              (bucketClosing / totalLedgerClosing)
                          );
                        }
                        return Math.round(
                          rawSum || res.cost_breakdown.inventory_holding / 4
                        );
                      };

                      const getBucketChangeoverCost = (
                        res: UnisonOptimizationResult,
                        bucketNum: number
                      ) => {
                        const slots = res.production_plan.filter(
                          (s) => s.bucket === bucketNum
                        );
                        return Math.round(
                          slots.reduce((acc, s) => acc + s.setup_cost, 0)
                        );
                      };

                      type HeatmapRowDef = {
                        id: string;
                        category: 'HOLDING' | 'CHANGEOVER' | 'COMBINED';
                        title: string;
                        subtitle: string;
                        unit: 'USD' | 'HRS';
                        baselineValue: number;
                        benchmarkValue: number;
                        scenarioValues: { scenarioId: string; value: number }[];
                      };

                      const refResult = refScenario
                        ? refScenario.scenario_result
                        : plan;

                      const allHeatmapRows: HeatmapRowDef[] = [
                        {
                          id: 'TOTAL_HOLDING_COST',
                          category: 'HOLDING',
                          title: 'Total Inventory Holding Cost (W44–W47)',
                          subtitle: companyMeta.holdingSubtitle,
                          unit: 'USD',
                          baselineValue: plan.cost_breakdown.inventory_holding,
                          benchmarkValue:
                            refResult.cost_breakdown.inventory_holding,
                          scenarioValues: comparedScenarios.map((s) => ({
                            scenarioId: s.scenario_id,
                            value:
                              s.scenario_result.cost_breakdown.inventory_holding,
                          })),
                        },
                        ...workspace.buckets.map((b) => ({
                          id: `BUCKET_HOLDING_W${b.bucket}`,
                          category: 'HOLDING' as const,
                          title: `${b.label} · Inventory Holding Cost`,
                          subtitle: `Period ${b.bucket} closing stock carrying burden`,
                          unit: 'USD' as const,
                          baselineValue: getBucketHoldingCost(plan, b.bucket),
                          benchmarkValue: getBucketHoldingCost(
                            refResult,
                            b.bucket
                          ),
                          scenarioValues: comparedScenarios.map((s) => ({
                            scenarioId: s.scenario_id,
                            value: getBucketHoldingCost(
                              s.scenario_result,
                              b.bucket
                            ),
                          })),
                        })),
                        {
                          id: 'TOTAL_CHANGEOVER_COST',
                          category: 'CHANGEOVER',
                          title: 'Total Sequence Changeover Setup Cost (W44–W47)',
                          subtitle:
                            'Sequence-dependent sanitization & calibration cost',
                          unit: 'USD',
                          baselineValue: plan.cost_breakdown.changeover_setups,
                          benchmarkValue:
                            refResult.cost_breakdown.changeover_setups,
                          scenarioValues: comparedScenarios.map((s) => ({
                            scenarioId: s.scenario_id,
                            value:
                              s.scenario_result.cost_breakdown.changeover_setups,
                          })),
                        },
                        ...workspace.buckets.map((b) => ({
                          id: `BUCKET_CHANGEOVER_W${b.bucket}`,
                          category: 'CHANGEOVER' as const,
                          title: `${b.label} · Changeover Setup Cost`,
                          subtitle: `Period ${b.bucket} finite line campaign transitions`,
                          unit: 'USD' as const,
                          baselineValue: getBucketChangeoverCost(plan, b.bucket),
                          benchmarkValue: getBucketChangeoverCost(
                            refResult,
                            b.bucket
                          ),
                          scenarioValues: comparedScenarios.map((s) => ({
                            scenarioId: s.scenario_id,
                            value: getBucketChangeoverCost(
                              s.scenario_result,
                              b.bucket
                            ),
                          })),
                        })),
                        {
                          id: 'COMBINED_HOLDING_PLUS_CHANGEOVER',
                          category: 'COMBINED',
                          title:
                            'Combined Holding + Changeover Trade-Off Total',
                          subtitle:
                            'Lot-sizing batch equilibrium (Holding + Setups)',
                          unit: 'USD',
                          baselineValue:
                            plan.cost_breakdown.inventory_holding +
                            plan.cost_breakdown.changeover_setups,
                          benchmarkValue:
                            refResult.cost_breakdown.inventory_holding +
                            refResult.cost_breakdown.changeover_setups,
                          scenarioValues: comparedScenarios.map((s) => ({
                            scenarioId: s.scenario_id,
                            value:
                              s.scenario_result.cost_breakdown
                                .inventory_holding +
                              s.scenario_result.cost_breakdown.changeover_setups,
                          })),
                        },
                      ];

                      const visibleHeatmapRows = allHeatmapRows.filter((r) => {
                        if (heatmapCostFilter === 'HOLDING_ONLY')
                          return (
                            r.category === 'HOLDING' || r.category === 'COMBINED'
                          );
                        if (heatmapCostFilter === 'CHANGEOVER_ONLY')
                          return (
                            r.category === 'CHANGEOVER' ||
                            r.category === 'COMBINED'
                          );
                        return true;
                      });

                      const evaluateThermalStyle = (
                        val: number,
                        benchVal: number,
                        minVal: number,
                        maxVal: number
                      ) => {
                        const delta = val - benchVal;
                        const deltaPct =
                          benchVal > 0
                            ? ((val - benchVal) / benchVal) * 100
                            : val > 0
                            ? 100
                            : 0;
                        const rangeRatio =
                          maxVal > minVal
                            ? (val - minVal) / (maxVal - minVal)
                            : 0.5;

                        const metricScore =
                          heatmapNormMode === 'BENCHMARK_DELTA'
                            ? deltaPct
                            : (rangeRatio - 0.3) * 65;

                        if (metricScore <= -4) {
                          return {
                            cellBg:
                              'bg-emerald-500/20 border-emerald-500/40 text-emerald-100',
                            badgeColor: 'text-emerald-300',
                            barColor: '#10B981',
                            tierLabel: 'SAVINGS',
                            delta,
                            deltaPct,
                            rangeRatio,
                          };
                        }
                        if (metricScore <= 4) {
                          return {
                            cellBg:
                              'bg-slate-900/75 border-slate-800 text-slate-200',
                            badgeColor: 'text-slate-400',
                            barColor: '#64748B',
                            tierLabel: 'NOMINAL',
                            delta,
                            deltaPct,
                            rangeRatio,
                          };
                        }
                        if (metricScore <= 16) {
                          return {
                            cellBg:
                              'bg-sky-500/20 border-sky-500/40 text-sky-100',
                            badgeColor: 'text-sky-300',
                            barColor: '#38BDF8',
                            tierLabel: 'MODERATE',
                            delta,
                            deltaPct,
                            rangeRatio,
                          };
                        }
                        if (metricScore <= 32) {
                          return {
                            cellBg:
                              'bg-amber-500/25 border-amber-500/50 text-amber-100',
                            badgeColor: 'text-amber-300',
                            barColor: '#F59E0B',
                            tierLabel: 'HIGH +Δ',
                            delta,
                            deltaPct,
                            rangeRatio,
                          };
                        }
                        return {
                          cellBg:
                            'bg-rose-500/30 border-rose-500/60 text-rose-100',
                          badgeColor: 'text-rose-300',
                          barColor: '#F43F5E',
                          tierLabel: 'CRITICAL SPIKE',
                          delta,
                          deltaPct,
                          rangeRatio,
                        };
                      };

                      return (
                        <div className="mt-6 pt-6 border-t border-slate-800 space-y-4">
                          <div className="flex flex-wrap items-center justify-between gap-4">
                            <div>
                              <div className="text-xs font-mono uppercase tracking-wider text-sky-400">
                                Lot-Sizing &amp; Setup Friction Discrepancy Analysis
                              </div>
                              <h3 className="text-base font-semibold text-white mt-0.5 font-display">
                                Inventory Holding &amp; Changeover Cost Discrepancy Heatmap
                              </h3>
                              <p className="text-xs text-slate-400 mt-0.5">
                                Visually isolates where scenario disruptions or policy overrides trigger inventory carrying buildup vs. sequence-dependent changeover spikes across W44–W47.
                              </p>
                            </div>

                            {/* Heatmap Controls */}
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <div className="flex items-center bg-slate-900 border border-slate-800 rounded p-0.5">
                                {(
                                  [
                                    { id: 'ALL', label: 'Holding + Changeover' },
                                    { id: 'HOLDING_ONLY', label: 'Holding Only' },
                                    {
                                      id: 'CHANGEOVER_ONLY',
                                      label: 'Changeover Only',
                                    },
                                  ] as const
                                ).map((tab) => (
                                  <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => setHeatmapCostFilter(tab.id)}
                                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                                      heatmapCostFilter === tab.id
                                        ? 'bg-sky-400 text-slate-950 font-semibold'
                                        : 'text-slate-400 hover:text-slate-200'
                                    }`}
                                  >
                                    {tab.label}
                                  </button>
                                ))}
                              </div>

                              <select
                                aria-label="Heatmap Color Normalization"
                                value={heatmapNormMode}
                                onChange={(e) =>
                                  setHeatmapNormMode(
                                    e.target.value as
                                      | 'BENCHMARK_DELTA'
                                      | 'MIN_MAX_RANGE'
                                  )
                                }
                                className="bg-slate-900 border border-slate-700 text-xs text-slate-200 rounded px-2.5 py-1.5"
                              >
                                <option value="BENCHMARK_DELTA">
                                  Color Scale: Δ% vs. {refMetrics.label}
                                </option>
                                <option value="MIN_MAX_RANGE">
                                  Color Scale: Cross-Branch Min–Max
                                </option>
                              </select>
                            </div>
                          </div>

                          {/* Thermal Scale Legend */}
                          <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 bg-[#0B0F17] border border-slate-800 rounded-md text-[11px]">
                            <span className="text-slate-400 font-medium">
                              Thermal Discrepancy Scale:
                            </span>
                            <div className="flex flex-wrap items-center gap-3 font-mono">
                              <span className="inline-flex items-center gap-1.5 text-emerald-300">
                                <span className="w-3 h-3 rounded-sm bg-emerald-500/40 border border-emerald-400 inline-block" />
                                <span>&le; -4% (Cost Savings)</span>
                              </span>
                              <span className="inline-flex items-center gap-1.5 text-slate-300">
                                <span className="w-3 h-3 rounded-sm bg-slate-800 border border-slate-600 inline-block" />
                                <span>-4% to +4% (Nominal Parity)</span>
                              </span>
                              <span className="inline-flex items-center gap-1.5 text-sky-300">
                                <span className="w-3 h-3 rounded-sm bg-sky-500/40 border border-sky-400 inline-block" />
                                <span>+4% to +16% (Moderate +Δ)</span>
                              </span>
                              <span className="inline-flex items-center gap-1.5 text-amber-300">
                                <span className="w-3 h-3 rounded-sm bg-amber-500/45 border border-amber-400 inline-block" />
                                <span>+16% to +32% (Elevated Surge)</span>
                              </span>
                              <span className="inline-flex items-center gap-1.5 text-rose-300">
                                <span className="w-3 h-3 rounded-sm bg-rose-500/50 border border-rose-400 inline-block" />
                                <span>&gt; +32% (Critical Discrepancy)</span>
                              </span>
                            </div>
                          </div>

                          {/* Heatmap Grid */}
                          <div className="overflow-x-auto border border-slate-800 rounded-lg bg-[#0B0F17]">
                            <table className="w-full text-left border-collapse text-xs">
                              <thead>
                                <tr className="border-b border-slate-800 bg-slate-900/90 text-slate-300">
                                  <th className="py-3 px-4 font-semibold min-w-[240px] sticky left-0 bg-slate-900 z-10 border-r border-slate-800">
                                    Cost Discrepancy Dimension &amp; Horizon Bucket
                                  </th>
                                  <th className="py-3 px-4 font-semibold text-right min-w-[165px] border-r border-slate-800">
                                    <div className="text-[10px] font-mono text-slate-400">
                                      LIVE BASELINE
                                    </div>
                                    <div className="text-white mt-0.5">
                                      Production Baseline
                                    </div>
                                  </th>
                                  {comparedScenarios.map((scn, idx) => (
                                    <th
                                      key={scn.scenario_id}
                                      className="py-3 px-4 font-semibold text-right min-w-[185px] border-r border-slate-800/60 last:border-r-0"
                                    >
                                      <div className="text-[10px] font-mono text-sky-400">
                                        BR-0{idx + 1}
                                      </div>
                                      <div
                                        className="text-white truncate max-w-[170px] ml-auto mt-0.5"
                                        title={scn.scenario_name}
                                      >
                                        {scn.scenario_name}
                                      </div>
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800/80 font-mono tabular-nums">
                                {visibleHeatmapRows.map((row) => {
                                  const allVals = [
                                    row.baselineValue,
                                    ...row.scenarioValues.map((sv) => sv.value),
                                  ];
                                  const minVal = Math.min(...allVals);
                                  const maxVal = Math.max(...allVals);

                                  const baseTherm = evaluateThermalStyle(
                                    row.baselineValue,
                                    row.benchmarkValue,
                                    minVal,
                                    maxVal
                                  );

                                  const isSummaryRow =
                                    row.id.startsWith('TOTAL_') ||
                                    row.id.startsWith('COMBINED_');

                                  return (
                                    <tr
                                      key={row.id}
                                      className={
                                        isSummaryRow ? 'bg-slate-950/80' : ''
                                      }
                                    >
                                      <td className="py-2.5 px-4 font-sans sticky left-0 bg-[#111827] border-r border-slate-800">
                                        <div
                                          className={`font-medium ${
                                            isSummaryRow
                                              ? 'text-white font-semibold'
                                              : 'text-slate-300'
                                          }`}
                                        >
                                          {row.title}
                                        </div>
                                        <div className="text-[10px] text-slate-500 mt-0.5">
                                          {row.subtitle}
                                        </div>
                                      </td>

                                      {/* Baseline Cell */}
                                      <td className="p-2 border-r border-slate-800">
                                        <div
                                          className={`p-2.5 rounded border ${baseTherm.cellBg} transition-colors`}
                                        >
                                          <div className="flex items-baseline justify-between gap-2">
                                            <span className="text-[10px] font-semibold uppercase tracking-wider opacity-85">
                                              {baseTherm.tierLabel}
                                            </span>
                                            <span className="text-sm font-bold">
                                              ${row.baselineValue.toLocaleString()}
                                            </span>
                                          </div>
                                          <div className="flex items-center justify-between text-[10px] mt-1 opacity-90">
                                            <span>vs Ref:</span>
                                            <span className={baseTherm.badgeColor}>
                                              {baseTherm.delta === 0
                                                ? '$0 (0.0%)'
                                                : baseTherm.delta > 0
                                                ? `+$${baseTherm.delta.toLocaleString()} (+${baseTherm.deltaPct.toFixed(
                                                    1
                                                  )}%)`
                                                : `-$${Math.abs(
                                                    baseTherm.delta
                                                  ).toLocaleString()} (${baseTherm.deltaPct.toFixed(
                                                    1
                                                  )}%)`}
                                            </span>
                                          </div>
                                          <div className="w-full h-1.5 bg-slate-950/70 rounded-full overflow-hidden mt-1.5">
                                            <div
                                              className="h-full rounded-full"
                                              style={{
                                                width: `${Math.max(
                                                  8,
                                                  Math.round(
                                                    baseTherm.rangeRatio * 100
                                                  )
                                                )}%`,
                                                backgroundColor:
                                                  baseTherm.barColor,
                                              }}
                                            />
                                          </div>
                                        </div>
                                      </td>

                                      {/* Scenario Branch Cells */}
                                      {row.scenarioValues.map((sv) => {
                                        const therm = evaluateThermalStyle(
                                          sv.value,
                                          row.benchmarkValue,
                                          minVal,
                                          maxVal
                                        );
                                        return (
                                          <td
                                            key={sv.scenarioId}
                                            className="p-2 border-r border-slate-800/60 last:border-r-0"
                                          >
                                            <div
                                              className={`p-2.5 rounded border ${therm.cellBg} transition-colors`}
                                            >
                                              <div className="flex items-baseline justify-between gap-2">
                                                <span className="text-[10px] font-semibold uppercase tracking-wider opacity-85">
                                                  {therm.tierLabel}
                                                </span>
                                                <span className="text-sm font-bold">
                                                  ${sv.value.toLocaleString()}
                                                </span>
                                              </div>
                                              <div className="flex items-center justify-between text-[10px] mt-1 opacity-90">
                                                <span>Discrepancy:</span>
                                                <span className={therm.badgeColor}>
                                                  {therm.delta === 0
                                                    ? '$0 (0.0%)'
                                                    : therm.delta > 0
                                                    ? `+$${therm.delta.toLocaleString()} (+${therm.deltaPct.toFixed(
                                                        1
                                                      )}%)`
                                                    : `-$${Math.abs(
                                                        therm.delta
                                                      ).toLocaleString()} (${therm.deltaPct.toFixed(
                                                        1
                                                      )}%)`}
                                                </span>
                                              </div>
                                              <div className="w-full h-1.5 bg-slate-950/70 rounded-full overflow-hidden mt-1.5">
                                                <div
                                                  className="h-full rounded-full"
                                                  style={{
                                                    width: `${Math.max(
                                                      8,
                                                      Math.round(
                                                        therm.rangeRatio * 100
                                                      )
                                                    )}%`,
                                                    backgroundColor:
                                                      therm.barColor,
                                                  }}
                                                />
                                              </div>
                                            </div>
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })()}
                  </>
                ) : (
                  <div className="py-16 text-center space-y-3">
                    <div className="text-sm font-semibold text-white">
                      No Scenario Branches Selected for Matrix Comparison
                    </div>
                    <p className="text-xs text-slate-400 max-w-md mx-auto">
                      Select two or more saved copy-on-write branches on the left—or
                      spawn a new what-if simulation—to inspect side-by-side KPIs across
                      the summary matrix.
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedScenarioIds(
                          workspace.saved_scenarios.map((s) => s.scenario_id)
                        )
                      }
                      className="px-4 py-2 bg-sky-400 hover:bg-sky-300 text-slate-950 font-semibold text-xs rounded-md transition-colors cursor-pointer"
                    >
                      Select All Saved Scenarios ({workspace.saved_scenarios.length})
                    </button>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* =====================================================================
            MODULE 4: CONTROL TOWER & PRESCRIPTIVE EXCEPTION RESOLUTION
           ===================================================================== */}
        {activeModule === 'CONTROL_TOWER' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 bg-[#111827] border border-slate-800 rounded-lg p-5">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 p-1 bg-slate-900 rounded-md border border-slate-800">
                  {(['ALL', 'OPEN', 'RESOLVED'] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setExceptionFilter(status)}
                      className={`px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
                        exceptionFilter === status
                          ? 'bg-sky-400 text-slate-950 font-semibold'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {status === 'ALL'
                        ? `All Exceptions (${workspace.exceptions.length})`
                        : status === 'OPEN'
                        ? `Open Alerts (${openExceptionsCount})`
                        : `Resolved (${
                            workspace.exceptions.length - openExceptionsCount
                          })`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="relative w-72">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter by SKU, work center, or cause..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-md pl-8 pr-3 py-1.5 text-xs text-white"
                />
              </div>
            </div>

            {workspace.exceptions.filter((exc) => {
              if (exceptionFilter !== 'ALL' && exc.status !== exceptionFilter)
                return false;
              if (
                searchQuery &&
                !`${exc.affected_product_id} ${exc.affected_product_name} ${exc.root_cause}`
                  .toLowerCase()
                  .includes(searchQuery.toLowerCase())
              ) {
                return false;
              }
              return true;
            }).length === 0 ? (
              <div className="bg-[#111827] border border-slate-800 rounded-lg p-12 text-center space-y-3">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
                <div className="text-base font-semibold text-white">
                  Zero Unfulfilled Demand Exceptions Matching Filter
                </div>
                <p className="text-xs text-slate-400 max-w-lg mx-auto leading-relaxed">
                  {(() => {
                    const activeCompany =
                      workspace.company_name ||
                      workspace.user_session?.company_name ||
                      'your organization';
                    const startBucket =
                      workspace.buckets[0]?.label?.split('·')[0]?.trim() || 'W1';
                    const endBucket =
                      workspace.buckets[
                        workspace.buckets.length - 1
                      ]?.label
                        ?.split('·')[0]
                        ?.trim() || 'W4';
                    const customerNodes = workspace.nodes.filter(
                      (n) => n.node_type === NodeType.CUSTOMER
                    );
                    const customerSummary =
                      customerNodes.length > 0
                        ? customerNodes.map((c) => c.name).join(', ')
                        : `${workspace.demands.length} customer demand commitments`;
                    const wcSummary =
                      workspace.work_centers.length > 0
                        ? workspace.work_centers.map((wc) => wc.name).join(', ')
                        : 'configured finite work centers';

                    return `All customer demand commitments for ${activeCompany} (${customerSummary}) across ${startBucket}–${endBucket} are balanced within finite work center capacities (${wcSummary}), or active filter criteria returned no open items.`;
                  })()}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setExceptionFilter('ALL');
                    setSearchQuery('');
                  }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs text-white rounded-md cursor-pointer"
                >
                  Show All Records
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {workspace.exceptions
                  .filter((exc) => {
                    if (exceptionFilter !== 'ALL' && exc.status !== exceptionFilter)
                      return false;
                    if (
                      searchQuery &&
                      !`${exc.affected_product_id} ${exc.affected_product_name} ${exc.root_cause}`
                        .toLowerCase()
                        .includes(searchQuery.toLowerCase())
                    ) {
                      return false;
                    }
                    return true;
                  })
                  .map((exc) => (
                    <div
                      key={exc.exception_id}
                      className="bg-[#111827] border border-slate-800 rounded-lg p-6 space-y-5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-800">
                        <div>
                          <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                            <span>{exc.exception_id}</span>
                            <span>·</span>
                            <span>{exc.bucket_label}</span>
                            <span>·</span>
                            <span
                              className={
                                exc.status === 'RESOLVED'
                                  ? 'text-emerald-400 font-semibold'
                                  : 'text-rose-400 font-semibold'
                              }
                            >
                              {exc.status === 'RESOLVED'
                                ? 'RESOLVED IN MILP SCHEDULE'
                                : `${exc.severity} STOCKOUT ALERT`}
                            </span>
                          </div>
                          <h3 className="text-base font-semibold text-white mt-1 font-display">
                            {exc.affected_product_id} — {exc.affected_product_name}
                          </h3>
                          <p className="text-xs text-slate-400 mt-1">
                            Root-Cause Pegging Trace: {exc.root_cause} (Pegged Resource:{' '}
                            <span className="font-mono text-slate-300">
                              {exc.pegged_work_center_id}
                            </span>{' '}
                            / Upstream:{' '}
                            <span className="font-mono text-slate-300">
                              {exc.pegged_supplier_id}
                            </span>
                            )
                          </p>
                        </div>

                        <div className="text-right font-mono tabular-nums">
                          <div className="text-xs text-slate-400">
                            Shortfall ({companyMeta.getProductUom(exc.affected_product_id)}) / Revenue Exposure
                          </div>
                          <div className="text-lg font-bold text-rose-400 mt-0.5">
                            {exc.unmet_units.toLocaleString()}{' '}
                            {companyMeta.getProductUom(exc.affected_product_id)} · $
                            {exc.revenue_at_risk_usd.toLocaleString()}
                          </div>
                        </div>
                      </div>

                      {/* 3 Ranked Prescriptive Options */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {exc.prescriptions.map((opt) => {
                          const isApplied = exc.applied_option_id === opt.option_id;
                          return (
                            <div
                              key={opt.option_id}
                              className={`p-4 rounded-lg border flex flex-col justify-between space-y-4 ${
                                isApplied
                                  ? 'bg-emerald-950/20 border-emerald-500/60'
                                  : 'bg-[#0B0F17] border-slate-800'
                              }`}
                            >
                              <div className="space-y-2">
                                <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                                  <span>OPTION 0{opt.priority}</span>
                                  <span className="text-emerald-400">
                                    Recovers {opt.expected_otif_recovery_pct}% OTIF
                                  </span>
                                </div>
                                <div className="text-sm font-semibold text-white">
                                  {opt.title}
                                </div>
                                <p className="text-xs text-slate-400 leading-relaxed">
                                  {opt.description}
                                </p>
                              </div>

                              <div className="pt-3 border-t border-slate-800/80 space-y-3">
                                <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                                  <span className="text-slate-400">
                                    Intervention Cost:
                                  </span>
                                  <span className="text-white">
                                    ${opt.estimated_cost_usd.toLocaleString()}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                                  <span className="text-slate-400">
                                    Margin Preserved:
                                  </span>
                                  <span className="text-emerald-400">
                                    +${opt.net_margin_preservation_usd.toLocaleString()}
                                  </span>
                                </div>

                                <button
                                  type="button"
                                  disabled={actionBusy || isApplied}
                                  onClick={() =>
                                    handleApplyPrescription(
                                      exc.exception_id,
                                      opt.option_id,
                                      opt.action_code
                                    )
                                  }
                                  className={`w-full py-2 px-3 rounded text-xs font-semibold transition-colors cursor-pointer ${
                                    isApplied
                                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                      : 'bg-sky-400 hover:bg-sky-300 text-slate-950'
                                  }`}
                                >
                                  {isApplied
                                    ? 'Prescription Executed'
                                    : 'Apply Prescriptive Action'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* =====================================================================
            MODULE 5: API INSPECTOR & PYTHON FASTAPI / PULP REFERENCE BLUEPRINT
           ===================================================================== */}
        {activeModule === 'API_BLUEPRINT' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left 5 Cols: Live REST Endpoint Tester */}
            <div className="lg:col-span-5 bg-[#111827] border border-slate-800 rounded-lg p-6 space-y-4">
              <div className="pb-4 border-b border-slate-800">
                <div className="text-xs text-slate-400">
                  Live Backend Orchestration Verification
                </div>
                <h2 className="text-lg font-semibold text-white mt-0.5 font-display">
                  Interactive IBP REST API Console
                </h2>
              </div>

              <div className="space-y-2">
                {[
                  {
                    method: 'POST',
                    path: '/api/v1/plan/propagate',
                    desc: 'Kinaxis-style in-memory DAG disruption & BOM pegging traversal',
                  },
                  {
                    method: 'POST',
                    path: '/api/v1/optimize/unison',
                    desc: 'OMP-style finite capacity MILP & sequence setup optimization',
                  },
                  {
                    method: 'POST',
                    path: '/api/v1/scenarios/simulate',
                    desc: 'Copy-on-write branch simulation & side-by-side KPI variance',
                  },
                  {
                    method: 'GET',
                    path: '/api/v1/control-tower/exceptions',
                    desc: 'Root-cause pegging audit & prioritized prescriptions',
                  },
                ].map((ep) => (
                  <button
                    key={ep.path}
                    type="button"
                    onClick={() => handleTestLiveEndpoint(ep.path)}
                    className={`w-full text-left p-3 rounded-md border transition-colors cursor-pointer ${
                      apiEndpointToTest === ep.path
                        ? 'bg-slate-800 border-sky-400'
                        : 'bg-[#0B0F17] border-slate-800 hover:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-center justify-between font-mono text-xs">
                      <span className="text-sky-400 font-semibold">
                        {ep.method} {ep.path}
                      </span>
                      <span className="text-slate-400">Execute →</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1">{ep.desc}</div>
                  </button>
                ))}
              </div>

              <div className="pt-2">
                <div className="text-xs text-slate-400 mb-1.5 font-mono">
                  Live JSON Payload Response ({apiEndpointToTest})
                </div>
                <pre className="p-3 bg-[#0B0F17] border border-slate-800 rounded-md text-[11px] font-mono text-emerald-300 overflow-x-auto max-h-96">
                  {apiLiveResponse}
                </pre>
              </div>
            </div>

            {/* Right 7 Cols: Python FastAPI + PuLP + NetworkX Reference Code */}
            <div className="lg:col-span-7 bg-[#111827] border border-slate-800 rounded-lg p-6 space-y-4">
              <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                <div>
                  <div className="text-xs text-slate-400">
                    Reference Implementation · Python 3.11 + FastAPI + PuLP + NetworkX
                  </div>
                  <h2 className="text-lg font-semibold text-white mt-0.5 font-display">
                    Mathematical MILP & Enterprise Knowledge Graph Source Code
                  </h2>
                </div>
              </div>

              <pre className="p-4 bg-[#0B0F17] border border-slate-800 rounded-md text-xs font-mono text-slate-200 overflow-x-auto max-h-[620px] leading-relaxed">
                {PYTHON_FASTAPI_BLUEPRINT}
              </pre>
            </div>
          </div>
        )}

        {/* =====================================================================
            MODULE 6: MASTER DATA & CONFIGURATION (UPLOAD, TABLES & RESET)
           ===================================================================== */}
        {activeModule === 'MASTER_DATA' && (
          <MasterDataConfigView
            companyName={
              workspace.company_name || 'Global Biologics & Sterile Fill Network'
            }
            nodes={workspace.nodes}
            products={workspace.products}
            bomEdges={workspace.bom_edges}
            workCenters={workspace.work_centers}
            initialInventory={workspace.initial_inventory || {}}
            openPos={workspace.open_pos || []}
            buckets={workspace.buckets}
            actionBusy={actionBusy}
            onUpdateMasterData={handleUpdateMasterData}
            onImportFixture={handleImportFixture}
            onResetDefaultDataset={handleResetBaseline}
          />
        )}
      </main>

      {/* QUIET ENTERPRISE FOOTER */}
      <footer className="mt-12 border-t border-slate-800/80 bg-[#0F1623] py-4 px-8">
        <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div>
            Nexora Concurrent Planning Platform · Enterprise Knowledge Graph,
            Driver-Based Demand Sensing & Finite MILP Scheduling
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setActiveModule('EKG_DEMAND')}
              className="hover:text-slate-300 transition-colors cursor-pointer"
            >
              Knowledge Graph
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={() => setActiveModule('UNISON_SCHEDULER')}
              className="hover:text-slate-300 transition-colors cursor-pointer"
            >
              Finite Scheduler
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={() => setActiveModule('MASTER_DATA')}
              className="hover:text-slate-300 transition-colors cursor-pointer"
            >
              Master Data & Config
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={() => setActiveModule('API_BLUEPRINT')}
              className="hover:text-slate-300 transition-colors cursor-pointer"
            >
              API & Python Reference
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
