export enum NodeType {
  SUPPLIER = 'SUPPLIER',
  PLANT = 'PLANT',
  WORK_CENTER = 'WORK_CENTER',
  DISTRIBUTION_CENTER = 'DISTRIBUTION_CENTER',
  CUSTOMER = 'CUSTOMER',
}

export enum Currency {
  USD = 'USD',
  EUR = 'EUR',
  GBP = 'GBP',
}

export interface FinancialMetrics {
  unit_sales_price: number;
  unit_variable_cost: number;
  holding_cost_rate_annual: number;
  currency: Currency;
  landed_duty_pct: number;
}

export interface SupplyNode {
  node_id: string;
  name: string;
  node_type: NodeType;
  region: string;
  currency: Currency;
  working_capital_limit_usd: number;
  storage_capacity_m3: number;
}

export interface MultiLevelBOMItem {
  bom_id: string;
  component_id: string;
  parent_product_id: string;
  quantity_required: number;
  scrap_factor: number;
  lead_time_days: number;
}

export interface SequenceDependentSetup {
  from_product_id: string;
  to_product_id: string;
  setup_time_hours: number;
  setup_cost: number;
  changeover_type: string; // e.g. 'Allergen Cleanout', 'Dose Calibration', 'Packaging Foil Swap'
}

export interface WorkCenter {
  resource_id: string;
  name: string;
  plant_id: string;
  capacity_hours_per_bucket: number;
  overtime_cost_per_hour: number;
  max_overtime_hours: number;
  run_rate_hours_per_unit: number;
  setup_matrix: SequenceDependentSetup[];
}

export interface Product {
  product_id: string;
  name: string;
  family: string;
  tier: 'FINISHED_GOOD' | 'SUB_ASSEMBLY' | 'RAW_MATERIAL';
  unit_of_measure?: string; // e.g. 'blister packs', 'vials', 'wafers', 'dies', 'kWh packs', 'modules'
  shelf_life_buckets: number;
  storage_footprint_m3: number;
  batch_size_min: number;
  financials: FinancialMetrics;
}

export interface Lane {
  lane_id: string;
  origin_node_id: string;
  destination_node_id: string;
  mode: 'OCEAN' | 'AIR' | 'RAIL' | 'TRUCK';
  lead_time_buckets: number;
  transit_cost_per_unit: number;
  max_capacity_units: number;
}

export interface DemandDriver {
  promo_uplift_pct: number;
  price_elasticity: number;
  baseline_price: number;
  current_price: number;
  macro_gdp_factor: number;
  pos_sell_through_index: number;
  weather_index: number;
}

export interface DemandSignal {
  demand_id: string;
  customer_id: string;
  customer_name: string;
  product_id: string;
  bucket: number;
  bucket_label: string;
  baseline_units: number;
  sensed_units: number;
  drivers: DemandDriver;
  unmet_penalty_per_unit: number;
}

export interface ProductionSlot {
  slot_id: string;
  product_id: string;
  product_name: string;
  work_center_id: string;
  work_center_name: string;
  bucket: number;
  bucket_label: string;
  quantity: number;
  run_hours: number;
  setup_hours: number;
  setup_from_product_id: string | null;
  setup_cost: number;
  overtime_hours: number;
  start_hour_offset: number;
  end_hour_offset: number;
  lot_expiry_bucket: number;
}

export interface BucketInventoryRecord {
  product_id: string;
  bucket: number;
  bucket_label: string;
  opening_inventory: number;
  production_units: number;
  sensed_demand_units: number;
  fulfilled_units: number;
  unmet_units: number;
  closing_inventory: number;
  expired_waste_units: number;
  storage_utilization_m3: number;
}

export interface UnisonOptimizationResult {
  status: 'OPTIMAL' | 'FEASIBLE' | 'STRESSED';
  solve_time_ms: number;
  total_cost: number;
  total_revenue: number;
  gross_margin_usd: number;
  gross_margin_pct: number;
  working_capital_tied_usd: number;
  otif_percentage: number;
  total_demand_units: number;
  fulfilled_units: number;
  unmet_units: number;
  asset_utilization_pct: number;
  total_setup_hours: number;
  total_overtime_hours: number;
  cost_breakdown: {
    production: number;
    inventory_holding: number;
    stockout_penalty: number;
    overtime: number;
    changeover_setups: number;
    transit_landed: number;
  };
  production_plan: ProductionSlot[];
  inventory_ledger: BucketInventoryRecord[];
  work_center_loads: {
    work_center_id: string;
    work_center_name: string;
    bucket: number;
    bucket_label: string;
    capacity_hours: number;
    run_hours: number;
    setup_hours: number;
    overtime_hours: number;
    utilization_pct: number;
  }[];
}

export interface PeggingImpactNode {
  node_id: string;
  node_name: string;
  node_type: NodeType;
  tier_depth: number;
  cumulative_delay_buckets: number;
  impacted_products: string[];
  impacted_demand_ids: string[];
  at_risk_revenue_usd: number;
  at_risk_units: number;
  severity: 'CRITICAL' | 'WARNING' | 'NOMINAL';
}

export interface PropagationResult {
  root_disruption_node: string;
  root_node_name: string;
  delay_buckets: number;
  affected_product_id: string | null;
  nodes_impacted_count: number;
  total_at_risk_revenue_usd: number;
  total_at_risk_units: number;
  pegging_chain: PeggingImpactNode[];
  bom_explosion_path: {
    from_item: string;
    to_item: string;
    qty_per: number;
    lead_time_days: number;
  }[];
}

export interface ScenarioSimulationInput {
  scenario_id?: string;
  scenario_name: string;
  demand_surge_pct: number;
  capacity_cut_pct: number;
  work_center_id: string;
  supplier_delay_buckets: number;
  expedite_air_enabled: boolean;
  authorize_overtime_override: boolean;
}

export interface ScenarioComparisonResult {
  scenario_id: string;
  scenario_name: string;
  created_at: string;
  overrides: ScenarioSimulationInput;
  baseline_kpis: {
    total_cost: number;
    total_revenue: number;
    gross_margin_pct: number;
    working_capital_usd: number;
    otif_percentage: number;
    unmet_units: number;
    asset_utilization_pct: number;
    setup_hours: number;
  };
  scenario_kpis: {
    total_cost: number;
    total_revenue: number;
    gross_margin_pct: number;
    working_capital_usd: number;
    otif_percentage: number;
    unmet_units: number;
    asset_utilization_pct: number;
    setup_hours: number;
  };
  deltas: {
    cost_variance: number;
    cost_variance_pct: number;
    otif_variance_pct_points: number;
    unmet_units_delta: number;
    working_capital_delta: number;
    margin_pct_delta: number;
  };
  baseline_result: UnisonOptimizationResult;
  scenario_result: UnisonOptimizationResult;
}

export interface PrescriptiveOption {
  option_id: string;
  priority: number;
  action_code: 'AUTHORIZE_OVERTIME' | 'EXPEDITE_INTERSITE_TRANSFER' | 'RESEQUENCE_CAMPAIGN_BATCH' | 'COMMERCIAL_TIER_ALLOCATION';
  title: string;
  resource_target: string;
  description: string;
  estimated_cost_usd: number;
  net_margin_preservation_usd: number;
  expected_otif_recovery_pct: number;
  lead_time_impact_hours: number;
}

export interface ControlTowerException {
  exception_id: string;
  affected_product_id: string;
  affected_product_name: string;
  bucket: number;
  bucket_label: string;
  unmet_units: number;
  revenue_at_risk_usd: number;
  root_cause: string;
  pegged_work_center_id: string;
  pegged_supplier_id: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  status: 'OPEN' | 'RESOLVED';
  applied_option_id?: string;
  prescriptions: PrescriptiveOption[];
}

export interface OpenPurchaseOrder {
  po_id: string;
  supplier_id: string;
  product_id: string;
  destination_node_id: string;
  scheduled_bucket: number;
  scheduled_bucket_label: string;
  ordered_qty: number;
  unit_price_usd: number;
  status: 'IN_TRANSIT' | 'CONFIRMED' | 'EXPEDITED';
}

export interface UserSession {
  company_name: string;
  work_email: string;
  role: 'Supply Chain Planner' | 'Operations Lead';
  authenticated_at: string;
}

export interface SupplyChainFixturePayload {
  company_name?: string;
  nodes?: SupplyNode[];
  products?: Product[];
  bom_edges?: MultiLevelBOMItem[];
  lanes?: Lane[];
  work_centers?: WorkCenter[];
  demands?: DemandSignal[];
  initial_inventory?: Record<string, number>;
  open_pos?: OpenPurchaseOrder[];
}

export type AIOptimizationObjective =
  | 'BALANCED_MARGIN_OTIF'
  | 'MAX_OTIF_RECOVERY'
  | 'MIN_TOTAL_COST';

export interface AITransformationStage {
  stage_number: number; // 1 = AS-IS, 2 = Upstream & BOM, 3 = Finite Scheduling, 4 = TO-BE
  phase_code: 'AS_IS_DIAGNOSIS' | 'UPSTREAM_EXPEDITE' | 'FINITE_RESEQUENCING' | 'TO_BE_EQUILIBRIUM';
  title: string;
  subtitle: string;
  narrative: string;
  key_action: string;
  quantified_impact: string;
  focus_node_ids: string[];
}

export interface AINodeTransformationState {
  node_id: string;
  node_name: string;
  node_type: NodeType;
  as_is_status: 'BOTTLENECK' | 'AT_RISK' | 'NOMINAL';
  to_be_status: 'OPTIMIZED' | 'BUFFERED' | 'SYNCHRONIZED';
  as_is_metric_label: string;
  to_be_metric_label: string;
  ai_intervention: string;
}

export interface AISupplyChainOptimizationResponse {
  optimization_id: string;
  generated_at: string;
  model_used: string;
  company_name: string;
  primary_uom: string;
  scenario_context_name: string;
  objective: AIOptimizationObjective;
  executive_summary: string;
  root_cause_diagnosis: string;
  recommended_levers: {
    authorize_overtime_override: boolean;
    expedite_air_enabled: boolean;
    resequence_campaigns: boolean;
    supplier_delay_mitigation_buckets: number;
    safety_stock_boost_pct: number;
    rationale: string;
  };
  transformation_stages: AITransformationStage[];
  node_transformations: AINodeTransformationState[];
  as_is_plan: UnisonOptimizationResult;
  to_be_plan: UnisonOptimizationResult;
  kpi_deltas: {
    otif_improvement_pts: number;
    shortfall_reduction_units: number;
    net_cost_delta_usd: number;
    gross_margin_improvement_pts: number;
    revenue_preserved_usd: number;
    setup_hours_saved: number;
  };
}



