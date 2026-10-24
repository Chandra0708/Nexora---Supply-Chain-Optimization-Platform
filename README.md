# Nexora — Concurrent Supply Chain IBP & Finite Scheduling Platform

**Nexora** is an enterprise Integrated Business Planning (IBP) and Supply Chain Digital Twin platform that unifies **Kinaxis-style real-time pegging & copy-on-write scenario sandboxing**, **o9-style Enterprise Knowledge Graph (EKG) & driver-based demand sensing**, and **OMP Unison-style finite capacity scheduling with sequence-dependent changeovers**.

---

## Key Capabilities

### 1. Enterprise Authentication & Clean-State Onboarding Gateway
- **Role-Based Session Gateway**: Supports enterprise workspace authentication by **Company Name**, **Work Email**, and operational role (**Supply Chain Planner** or **Operations Lead**).
- **Clean-State Initialization**: Initializes in an empty state upon login and guides new organizations through an **Import Supply Chain Model** onboarding flow.
- **Client-Side Schema & Foreign-Key Validation**: Validates incoming `.json` and `.csv` supply chain models before constructing the in-memory Directed Acyclic Graph (DAG):
  - Checks foreign-key integrity across BOM edges, open purchase orders, and work center plant assignments.
  - Validates numeric constraints (`lead_time_days >= 0`, `capacity_hours_per_bucket > 0`, non-negative unit costs/prices).
- **Downloadable Templates & Multi-Industry Demo Sandboxes**: Includes blank JSON/CSV templates and 1-click industry digital twins:
  - **AstraBio Cold-Chain Therapeutics** (*Biologics & Cold-Chain Pharma* — `blister packs`, `vials`, `injectors`, `kg`)
  - **Nordic Semiconductor Foundry** (*Wafer Fab & CoWoS Packaging* — `dies`, `wafers`, `liters`)
  - **VoltEdge EV Battery Systems** (*Gigafactory EV Packs & Grid Storage* — `kWh packs`, `modules`, `racks`, `metric tons`, `coils`)

---

### 2. Real-Time Enterprise SLA Alerting & Guided Resolution Playbook
- **Live Header Navigation Flashing**: Continuously monitors active baseline and compared scenario KPIs against user-defined **Min OTIF (%)** and **Min Gross Margin (%)** guardrails:
  - **Control Tower** and **Capacity & Production Scheduling** flash when unmet demand causes OTIF to drop below target.
  - **Knowledge Graph & Demand** flashes when pricing discounts, air-charter expedites, or setup penalties compress Gross Margin below target.
  - **Scenario Sandbox** flashes when any selected what-if branch breaches OTIF or Margin thresholds.
- **Guided Alert Resolution Playbook**: Automatically surfaces actionable 1-click resolutions (`Auto-Recover OTIF`, `Protect Margin`, `Calibrate SLA to Current Baseline`) whenever an alert is active.

---

### 3. Enterprise Knowledge Graph (EKG) & Driver-Based Demand Sensing
- **Multi-Echelon Supply Network & BOM Disruption Propagation**: Interactive SVG Directed Acyclic Graph (Tier-2 Suppliers → Tier-1 Manufacturing Plants → Regional DCs → Customer Demand) that traces upstream delays across multi-tier BOM links and calculates exposed volume (in product-specific units of measure) and **Customer Revenue at Risk ($)**.
- **Multivariate Causal Demand Sensing**: Adjusts consensus demand using log-linear price elasticity, promotional lift, customer pull/POS index, and external/seasonal indices, then propagates sensed demand directly into the finite MILP scheduler.
- **Synchronized S&OP Material Balance Ledger**: Time-phased ledger tracking Opening Inventory, MILP Production, Sensed Demand, Fulfilled Volume, Unfulfilled Shortfall, Closing Inventory, and storage footprint (`Cold Vault Volume`, `FOUP Pod Volume`, or `Hazmat Bay Volume`) in each SKU's native `unit_of_measure`.

---

### 4. Capacity & Production Scheduling (OMP Unison Pattern)
- **Finite Capacity Gantt Timeline**: Schedules production across plant work centers (`WC_BLISTER_LINE_1`, `WC_EUV_LITHO_BAY_1`, `WC_ELECTRODE_COATER_1`, etc.) across weekly tactical buckets (`W44–W47`), respecting shift capacities, max overtime hours, and per-unit run rates.
- **Sequence-Dependent Setup Penalty Matrix**: Models product-to-product changeover downtime hours and cleaning/calibration validation costs (e.g., *Full CIP/SIP Sterilization*, *Reticle Mask Swap + EUV Optics Calibration*, *NMC-to-LFP Slurry Purge*).
- **MILP Objective Function Decomposition**: Breaks down total supply chain cost across Variable Production, Stockout Penalties, Transit & Landed Duties, Changeover Setups, Shift Overtime Premiums, and Inventory Carrying Cost.

---

### 5. Concurrent Copy-on-Write Scenario Sandbox & Discrepancy Heatmap
- **What-If Disruption Branch Generator**: Spawn ephemeral scenarios by varying Demand Surge (%), Line Capacity Cut (%), Constrained Work Center, Upstream Supplier Delay Buckets, Overtime Shift Buffers, and Expedited Air Charter.
- **Multi-Scenario Comparative Summary Matrix**: Diffs 2+ scenario branches side-by-side against the active Production Baseline (or any chosen reference branch) with inline **SVG sparkline trends** for **OTIF (%)** and **Total Cost ($)**.
- **Inventory Holding & Changeover Cost Discrepancy Heatmap**: Thermal cell visualization across scenario branches and `W44–W47` buckets that highlights where disruptions or batching policies cause inventory holding buildup vs. sequence changeover spikes.
- **1-Click Branch Promotion**: Merge any optimal what-if scenario branch directly into the active Production Baseline.

---

### 6. Control Tower & Prescriptive Exception Resolution
- **Root-Cause Pegging Audit Trail**: Identifies stockout exceptions by SKU, horizon bucket, pegged work center bottleneck,upstream supplier delay, shortfall quantity (in the SKU's `unit_of_measure`), and revenue at risk.
- **Ranked Prescriptive Options**: Provides 3 ranked resolution levers per exception (Weekend Overtime Authorization, Campaign Sequence Consolidation, Expedited Air Charter) with estimated intervention cost, net margin preservation, and expected OTIF recovery.

---

### 7. Master Data Manager
- **Interactive Master Tables**: View, add, edit, or delete **Nodes / Facilities**, **Multi-Level BOMs**, **Work Centers & Changeover Matrices**, and **Current Inventory & Open POs** with full `unit_of_measure` support.
- **Hot-Swap Fixture Import & Export**: Drag-and-drop new `.json` or `.csv` fixtures at any time or download the active network state as `supply_chain_test_fixture.json`.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS, Lucide Icons, Custom SVG DAG & Sparkline Renderers
- **Backend / API**: Node.js, Express (`server.ts` with Vite middleware in development)
- **In-Memory Engines (`/src/engine.ts`)**:
  - `EKGSupplyNetwork` (Multi-tier BOM explosion & DAG disruption traversal)
  - `DriverBasedDemandEngine` (Log-linear price elasticity & causal demand sensing)
  - `UnisonOptimizationSolver` (Finite capacity scheduling, sequence-dependent setups & MILP cost rolls)
  - `ScenarioSandboxEngine` (Copy-on-write branch simulation & KPI variance evaluation)
  - `ControlTowerEngine` (Exception detection & prescriptive option ranking)

---

## JSON Fixture Schema Overview

When uploading a custom `.json` model via the Onboarding screen or Master Data Manager, use the following structure:

```json
{
  "company_name": "Nordic Semiconductor Foundry",
  "nodes": [
    {
      "node_id": "SUP_KYOTO_SILICON",
      "name": "Kyoto Ultra-Pure 300mm Wafer Corp",
      "node_type": "SUPPLIER",
      "region": "APAC · Japan",
      "currency": "USD",
      "working_capital_limit_usd": 14000000,
      "storage_capacity_m3": 9000
    }
  ],
  "products": [
    {
      "product_id": "SKU_AI_TENSOR_COWOS",
      "name": "AI Tensor Core Accelerator (CoWoS-S)",
      "tier": "FINISHED_GOOD",
      "unit_of_measure": "dies",
      "shelf_life_days": 1095,
      "storage_volume_m3_per_unit": 0.04,
      "financials": {
        "unit_sales_price": 1850,
        "unit_variable_cost": 520,
        "holding_cost_rate_annual": 0.24,
        "stockout_penalty_per_unit": 2400
      }
    }
  ],
  "bom_edges": [
    {
      "bom_id": "BOM_SEMI_1",
      "component_id": "RAW_SILICON_300MM_WAFER",
      "parent_product_id": "SUB_EUV_PATTERNED_WAFER",
      "quantity_required": 1.0,
      "scrap_factor": 0.04,
      "lead_time_days": 12
    }
  ],
  "work_centers": [
    {
      "resource_id": "WC_EUV_LITHO_BAY_1",
      "name": "Extreme UV Lithography Scanner Bay 1",
      "plant_id": "PLANT_LULEA_FAB1",
      "capacity_hours_per_bucket": 42,
      "max_overtime_hours": 14,
      "overtime_cost_per_hour": 680,
      "run_rate_hours_per_unit": 0.045,
      "setup_matrix": [
        {
          "from_product_id": "SKU_AI_TENSOR_COWOS",
          "to_product_id": "SKU_AUTO_ADAS_SOC",
          "setup_time_hours": 5.5,
          "setup_cost": 4200,
          "changeover_type": "Reticle Mask Swap + EUV Optics Calibration"
        }
      ]
    }
  ],
  "initial_inventory": {
    "SKU_AI_TENSOR_COWOS": 210,
    "RAW_SILICON_300MM_WAFER": 950
  },
  "open_pos": [
    {
      "po_id": "PO-FAB-401",
      "supplier_id": "SUP_KYOTO_SILICON",
      "product_id": "RAW_SILICON_300MM_WAFER",
      "destination_node_id": "PLANT_LULEA_FAB1",
      "scheduled_bucket": 1,
      "scheduled_bucket_label": "W44 · Nov 02",
      "ordered_qty": 450,
      "unit_price_usd": 410,
      "status": "IN_TRANSIT"
    }
  ]
}
