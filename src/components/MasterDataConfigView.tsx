import React, { useState, useRef } from 'react';
import {
  Upload,
  RotateCcw,
  Plus,
  Trash2,
  Save,
  Download,
  FileJson,
  FileSpreadsheet,
  X,
  CheckCircle2,
  Building2,
  Layers,
  Cpu,
  PackageCheck,
} from 'lucide-react';
import {
  Currency,
  MultiLevelBOMItem,
  NodeType,
  OpenPurchaseOrder,
  Product,
  SequenceDependentSetup,
  SupplyChainFixturePayload,
  SupplyNode,
  WorkCenter,
} from '../types/ibp.ts';

type MasterSubTab = 'NODES' | 'BOMS' | 'RESOURCES' | 'INVENTORY_POS';

interface MasterDataConfigViewProps {
  companyName: string;
  nodes: SupplyNode[];
  products: Product[];
  bomEdges: MultiLevelBOMItem[];
  workCenters: WorkCenter[];
  initialInventory: Record<string, number>;
  openPos: OpenPurchaseOrder[];
  buckets: { bucket: number; label: string }[];
  actionBusy: boolean;
  onUpdateMasterData: (payload: {
    nodes?: SupplyNode[];
    bom_edges?: MultiLevelBOMItem[];
    work_centers?: WorkCenter[];
    initial_inventory?: Record<string, number>;
    open_pos?: OpenPurchaseOrder[];
  }) => Promise<void>;
  onImportFixture: (payload: SupplyChainFixturePayload) => Promise<void>;
  onResetDefaultDataset: () => Promise<void>;
}

export const MasterDataConfigView: React.FC<MasterDataConfigViewProps> = ({
  companyName,
  nodes,
  products,
  bomEdges,
  workCenters,
  initialInventory,
  openPos,
  buckets,
  actionBusy,
  onUpdateMasterData,
  onImportFixture,
  onResetDefaultDataset,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<MasterSubTab>('NODES');
  const [uploadModalOpen, setUploadModalOpen] = useState<boolean>(false);
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [uploadFeedback, setUploadFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Editable Local States synced with props
  const [localNodes, setLocalNodes] = useState<SupplyNode[]>(nodes);
  const [localBoms, setLocalBoms] = useState<MultiLevelBOMItem[]>(bomEdges);
  const [localWorkCenters, setLocalWorkCenters] =
    useState<WorkCenter[]>(workCenters);
  const [localInventory, setLocalInventory] =
    useState<Record<string, number>>(initialInventory);
  const [localOpenPos, setLocalOpenPos] =
    useState<OpenPurchaseOrder[]>(openPos);
  const [selectedSetupWcId, setSelectedSetupWcId] = useState<string>(
    workCenters[0]?.resource_id || 'WC_BLISTER_LINE_1'
  );
  const [saveBanner, setSaveBanner] = useState<string | null>(null);

  // Sync local state when parent state updates (e.g. after Reset or Import)
  React.useEffect(() => {
    setLocalNodes(nodes);
    setLocalBoms(bomEdges);
    setLocalWorkCenters(workCenters);
    setLocalInventory(initialInventory);
    setLocalOpenPos(openPos);
    if (
      workCenters.length > 0 &&
      !workCenters.some((w) => w.resource_id === selectedSetupWcId)
    ) {
      setSelectedSetupWcId(workCenters[0].resource_id);
    }
  }, [nodes, bomEdges, workCenters, initialInventory, openPos]);

  const triggerSaveNotification = (msg: string) => {
    setSaveBanner(msg);
    setTimeout(() => setSaveBanner(null), 3500);
  };

  // Commit changes to backend and recompute Unison MILP
  const handleCommitChanges = async () => {
    await onUpdateMasterData({
      nodes: localNodes,
      bom_edges: localBoms,
      work_centers: localWorkCenters,
      initial_inventory: localInventory,
      open_pos: localOpenPos,
    });
    triggerSaveNotification(
      'Master data committed and propagated to Enterprise Knowledge Graph & Unison MILP Solver.'
    );
  };

  // Download sample supply_chain_test_fixture.json
  const handleDownloadSampleFixture = () => {
    const sampleFixture: SupplyChainFixturePayload = {
      company_name: 'Apex Precision Semicon & Medical Devices Corp',
      nodes: localNodes,
      products,
      bom_edges: localBoms,
      work_centers: localWorkCenters,
      initial_inventory: localInventory,
      open_pos: localOpenPos,
    };
    const blob = new Blob([JSON.stringify(sampleFixture, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'supply_chain_test_fixture.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Parse uploaded JSON or CSV file
  const processUploadedFile = async (file: File) => {
    setUploadFeedback(null);
    try {
      const text = await file.text();
      if (file.name.endsWith('.json')) {
        const parsed = JSON.parse(text) as SupplyChainFixturePayload;
        await onImportFixture(parsed);
        setUploadFeedback({
          type: 'success',
          message: `Imported JSON fixture "${file.name}" (${
            parsed.nodes?.length || localNodes.length
          } nodes, ${
            parsed.bom_edges?.length || localBoms.length
          } BOM links). Supply chain graph re-solved.`,
        });
      } else if (file.name.endsWith('.csv')) {
        const lines = text
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines.length < 2) {
          throw new Error('CSV file must include a header row and at least one data row.');
        }
        const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
        const rows = lines.slice(1).map((line) =>
          line.split(',').map((cell) => cell.trim())
        );

        // Detect CSV entity schema by column headers
        if (headers.includes('node_id') && headers.includes('node_type')) {
          const importedNodes: SupplyNode[] = rows.map((r, i) => ({
            node_id: r[headers.indexOf('node_id')] || `NODE_CSV_${i + 1}`,
            name: r[headers.indexOf('name')] || `Imported Facility ${i + 1}`,
            node_type:
              (r[headers.indexOf('node_type')] as NodeType) || NodeType.PLANT,
            region: r[headers.indexOf('region')] || 'Global',
            currency:
              (r[headers.indexOf('currency')] as Currency) || Currency.USD,
            working_capital_limit_usd:
              Number(r[headers.indexOf('working_capital_limit_usd')]) || 5000000,
            storage_capacity_m3:
              Number(r[headers.indexOf('storage_capacity_m3')]) || 4000,
          }));
          await onImportFixture({ nodes: importedNodes });
          setUploadFeedback({
            type: 'success',
            message: `Imported ${importedNodes.length} supply nodes from CSV "${file.name}".`,
          });
        } else if (
          headers.includes('component_id') &&
          headers.includes('parent_product_id')
        ) {
          const importedBoms: MultiLevelBOMItem[] = rows.map((r, i) => ({
            bom_id: r[headers.indexOf('bom_id')] || `BOM_CSV_${i + 1}`,
            component_id: r[headers.indexOf('component_id')],
            parent_product_id: r[headers.indexOf('parent_product_id')],
            quantity_required:
              Number(r[headers.indexOf('quantity_required')]) || 1.0,
            scrap_factor: Number(r[headers.indexOf('scrap_factor')]) || 0.02,
            lead_time_days: Number(r[headers.indexOf('lead_time_days')]) || 2,
          }));
          await onImportFixture({ bom_edges: importedBoms });
          setUploadFeedback({
            type: 'success',
            message: `Imported ${importedBoms.length} multi-level BOM relationships from CSV "${file.name}".`,
          });
        } else if (headers.includes('po_id') || headers.includes('ordered_qty')) {
          const importedPos: OpenPurchaseOrder[] = rows.map((r, i) => ({
            po_id: r[headers.indexOf('po_id')] || `PO-CSV-${100 + i}`,
            supplier_id: r[headers.indexOf('supplier_id')] || 'SUP_BASEL_API',
            product_id: r[headers.indexOf('product_id')] || 'RAW_PEPTIDE_API',
            destination_node_id:
              r[headers.indexOf('destination_node_id')] || 'PLANT_NJ_BIOLOGICS',
            scheduled_bucket:
              Number(r[headers.indexOf('scheduled_bucket')]) || 1,
            scheduled_bucket_label: 'W44 · Nov 02',
            ordered_qty: Number(r[headers.indexOf('ordered_qty')]) || 500,
            unit_price_usd: Number(r[headers.indexOf('unit_price_usd')]) || 25,
            status: 'CONFIRMED',
          }));
          await onImportFixture({ open_pos: importedPos });
          setUploadFeedback({
            type: 'success',
            message: `Imported ${importedPos.length} Open Purchase Orders from CSV "${file.name}".`,
          });
        } else if (
          headers.includes('product_id') &&
          headers.includes('opening_inventory')
        ) {
          const invMap: Record<string, number> = { ...localInventory };
          rows.forEach((r) => {
            const pid = r[headers.indexOf('product_id')];
            const qty = Number(r[headers.indexOf('opening_inventory')]);
            if (pid && !Number.isNaN(qty)) {
              invMap[pid] = qty;
            }
          });
          await onImportFixture({ initial_inventory: invMap });
          setUploadFeedback({
            type: 'success',
            message: `Updated initial inventory balances from CSV "${file.name}".`,
          });
        } else {
          throw new Error(
            'Unrecognized CSV header format. Expected columns for Nodes (node_id, node_type), BOMs (component_id, parent_product_id), Inventory (product_id, opening_inventory), or Open POs (po_id, ordered_qty).'
          );
        }
      } else {
        throw new Error('Unsupported file extension. Please upload a .json or .csv file.');
      }
    } catch (err) {
      setUploadFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Failed to parse fixture file.',
      });
    }
  };

  // Load an alternate pre-built Industrial Enterprise Fixture with 1 click inside the modal
  const handleLoadAlternateCompanyFixture = async () => {
    const customCompanyFixture: SupplyChainFixturePayload = {
      company_name: 'Nordic Bio-Synthetics & Cryo Biologics AG',
      initial_inventory: {
        SKU_CARDIO_50MG: 310,
        SKU_CARDIO_100MG: 260,
        SKU_ONCO_300MG: 195,
        SKU_IMMUNO_10ML: 240,
        RAW_PEPTIDE_API: 1450,
        RAW_CRYO_VIAL_10ML: 5000,
        SUB_BULK_CARDIO_GRANULE: 680,
      },
      work_centers: localWorkCenters.map((wc) => ({
        ...wc,
        capacity_hours_per_bucket: 48,
        max_overtime_hours: 16,
      })),
      open_pos: [
        ...localOpenPos,
        {
          po_id: 'PO-NORDIC-9920',
          supplier_id: 'SUP_BASEL_API',
          product_id: 'SKU_ONCO_300MG',
          destination_node_id: 'DC_ROTTERDAM_EU',
          scheduled_bucket: 1,
          scheduled_bucket_label: 'W44 · Nov 02',
          ordered_qty: 220,
          unit_price_usd: 68.0,
          status: 'EXPEDITED',
        },
      ],
    };
    await onImportFixture(customCompanyFixture);
    setUploadFeedback({
      type: 'success',
      message:
        'Loaded "Nordic Bio-Synthetics & Cryo Biologics AG" enterprise fixture (48h shift capacities & boosted cryo inventory).',
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Action Header Bar */}
      <div className="bg-[#111827] border border-slate-800 rounded-lg p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs text-slate-400">
            Enterprise Knowledge Graph Schema · Active Dataset:{' '}
            <span className="text-sky-400 font-semibold">{companyName}</span>
          </div>
          <h2 className="text-lg font-semibold text-white mt-0.5 font-display">
            Master Data & Network Topology Configuration
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setUploadFeedback(null);
              setUploadModalOpen(true);
            }}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import JSON / CSV Fixture</span>
          </button>

          <button
            type="button"
            disabled={actionBusy}
            onClick={handleCommitChanges}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Commit Edits & Re-Solve</span>
          </button>

          <button
            type="button"
            disabled={actionBusy}
            onClick={async () => {
              await onResetDefaultDataset();
              triggerSaveNotification(
                'Restored default Global Biologics & Sterile Fill sample dataset.'
              );
            }}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
            <span>Restore Default Sample Dataset</span>
          </button>
        </div>
      </div>

      {saveBanner && (
        <div className="p-3.5 bg-emerald-950/40 border border-emerald-500/40 rounded-lg flex items-center justify-between text-xs text-emerald-300">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{saveBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveBanner(null)}
            className="text-slate-400 hover:text-white cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Sub-Tabs Selector */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-[#111827] border border-slate-800 rounded-lg p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveSubTab('NODES')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              activeSubTab === 'NODES'
                ? 'bg-sky-400 text-slate-950 font-semibold'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Nodes / Facilities ({localNodes.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('BOMS')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              activeSubTab === 'BOMS'
                ? 'bg-sky-400 text-slate-950 font-semibold'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Multi-Level BOMs ({localBoms.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('RESOURCES')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              activeSubTab === 'RESOURCES'
                ? 'bg-sky-400 text-slate-950 font-semibold'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>Resources & Routings ({localWorkCenters.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('INVENTORY_POS')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              activeSubTab === 'INVENTORY_POS'
                ? 'bg-sky-400 text-slate-950 font-semibold'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <PackageCheck className="w-3.5 h-3.5" />
            <span>
              Current Inventory & Open POs ({Object.keys(localInventory).length}{' '}
              SKUs · {localOpenPos.length} POs)
            </span>
          </button>
        </div>

        <button
          type="button"
          onClick={handleDownloadSampleFixture}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-900 border border-slate-700 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5 text-slate-400" />
          <span>Download supply_chain_test_fixture.json</span>
        </button>
      </div>

      {/* =====================================================================
          SUB-TAB 1: NODES / FACILITIES (PLANTS, DCs, SUPPLIERS, CUSTOMERS)
         ===================================================================== */}
      {activeSubTab === 'NODES' && (
        <div className="bg-[#111827] border border-slate-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <div>
              <div className="text-xs text-slate-400">
                Network Echelon Master Table
              </div>
              <h3 className="text-base font-semibold text-white mt-0.5 font-display">
                Nodes & Facilities (Suppliers, Plants, Cold-Chain DCs, Customers)
              </h3>
            </div>

            <button
              type="button"
              onClick={() => {
                const newNode: SupplyNode = {
                  node_id: `NODE_FACILITY_${localNodes.length + 1}`,
                  name: 'New Regional Distribution Facility',
                  node_type: NodeType.DISTRIBUTION_CENTER,
                  region: 'AMER · US West',
                  currency: Currency.USD,
                  working_capital_limit_usd: 5000000,
                  storage_capacity_m3: 6000,
                };
                setLocalNodes([...localNodes, newNode]);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Facility Node</span>
            </button>
          </div>

          <div className="overflow-x-auto border border-slate-800 rounded-md">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/70 text-slate-400">
                  <th className="py-2.5 px-3 font-medium">Node ID</th>
                  <th className="py-2.5 px-3 font-medium">Facility Name</th>
                  <th className="py-2.5 px-3 font-medium">Echelon Type</th>
                  <th className="py-2.5 px-3 font-medium">Region</th>
                  <th className="py-2.5 px-3 font-medium">Currency</th>
                  <th className="py-2.5 px-3 font-medium text-right">
                    Working Cap Limit ($)
                  </th>
                  <th className="py-2.5 px-3 font-medium text-right">
                    Storage Cap (m³)
                  </th>
                  <th className="py-2.5 px-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {localNodes.map((n, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/30">
                    <td className="py-2 px-3">
                      <input
                        type="text"
                        value={n.node_id}
                        onChange={(e) => {
                          const next = [...localNodes];
                          next[idx] = { ...n, node_id: e.target.value };
                          setLocalNodes(next);
                        }}
                        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-sky-400 w-44"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="text"
                        value={n.name}
                        onChange={(e) => {
                          const next = [...localNodes];
                          next[idx] = { ...n, name: e.target.value };
                          setLocalNodes(next);
                        }}
                        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white w-64"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <select
                        value={n.node_type}
                        onChange={(e) => {
                          const next = [...localNodes];
                          next[idx] = {
                            ...n,
                            node_type: e.target.value as NodeType,
                          };
                          setLocalNodes(next);
                        }}
                        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                      >
                        <option value={NodeType.SUPPLIER}>SUPPLIER</option>
                        <option value={NodeType.PLANT}>PLANT</option>
                        <option value={NodeType.DISTRIBUTION_CENTER}>
                          DISTRIBUTION_CENTER
                        </option>
                        <option value={NodeType.CUSTOMER}>CUSTOMER</option>
                      </select>
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="text"
                        value={n.region}
                        onChange={(e) => {
                          const next = [...localNodes];
                          next[idx] = { ...n, region: e.target.value };
                          setLocalNodes(next);
                        }}
                        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 w-36"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <select
                        value={n.currency}
                        onChange={(e) => {
                          const next = [...localNodes];
                          next[idx] = {
                            ...n,
                            currency: e.target.value as Currency,
                          };
                          setLocalNodes(next);
                        }}
                        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-slate-200"
                      >
                        <option value={Currency.USD}>USD</option>
                        <option value={Currency.EUR}>EUR</option>
                        <option value={Currency.GBP}>GBP</option>
                      </select>
                    </td>
                    <td className="py-2 px-3 text-right">
                      <input
                        type="number"
                        value={n.working_capital_limit_usd}
                        onChange={(e) => {
                          const next = [...localNodes];
                          next[idx] = {
                            ...n,
                            working_capital_limit_usd: Number(e.target.value),
                          };
                          setLocalNodes(next);
                        }}
                        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono tabular-nums text-right text-white w-28"
                      />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <input
                        type="number"
                        value={n.storage_capacity_m3}
                        onChange={(e) => {
                          const next = [...localNodes];
                          next[idx] = {
                            ...n,
                            storage_capacity_m3: Number(e.target.value),
                          };
                          setLocalNodes(next);
                        }}
                        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono tabular-nums text-right text-white w-24"
                      />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setLocalNodes(localNodes.filter((_, i) => i !== idx))
                        }
                        className="p-1 text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                        title="Remove Node"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          SUB-TAB 2: MULTI-LEVEL BOMs (PARENT-CHILD & SCRAP FACTORS)
         ===================================================================== */}
      {activeSubTab === 'BOMS' && (
        <div className="bg-[#111827] border border-slate-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <div>
              <div className="text-xs text-slate-400">
                Multi-Level Bill of Materials DAG Edges
              </div>
              <h3 className="text-base font-semibold text-white mt-0.5 font-display">
                Parent-Child Component Relationships, Usage Ratios & Scrap Factors
              </h3>
            </div>

            <button
              type="button"
              onClick={() => {
                const newBom: MultiLevelBOMItem = {
                  bom_id: `BOM_${localBoms.length + 1}`,
                  component_id: products[0]?.product_id || 'RAW_PEPTIDE_API',
                  parent_product_id:
                    products[products.length - 1]?.product_id ||
                    'SKU_CARDIO_50MG',
                  quantity_required: 1.0,
                  scrap_factor: 0.02,
                  lead_time_days: 3,
                };
                setLocalBoms([...localBoms, newBom]);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add BOM Edge</span>
            </button>
          </div>

          <div className="overflow-x-auto border border-slate-800 rounded-md">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/70 text-slate-400">
                  <th className="py-2.5 px-3 font-medium">BOM Edge ID</th>
                  <th className="py-2.5 px-3 font-medium">
                    Child Component / Intermediate
                  </th>
                  <th className="py-2.5 px-3 font-medium">
                    Parent Assembly / Finished SKU
                  </th>
                  <th className="py-2.5 px-3 font-medium text-right">
                    Quantity Per Parent
                  </th>
                  <th className="py-2.5 px-3 font-medium text-right">
                    Scrap Factor (0–1)
                  </th>
                  <th className="py-2.5 px-3 font-medium text-right">
                    Offset Lead Time (Days)
                  </th>
                  <th className="py-2.5 px-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {localBoms.map((b, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/30">
                    <td className="py-2 px-3 font-mono text-slate-300">
                      {b.bom_id}
                    </td>
                    <td className="py-2 px-3">
                      <select
                        value={b.component_id}
                        onChange={(e) => {
                          const next = [...localBoms];
                          next[idx] = { ...b, component_id: e.target.value };
                          setLocalBoms(next);
                        }}
                        className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs font-mono text-amber-400"
                      >
                        {products.map((p) => (
                          <option key={p.product_id} value={p.product_id}>
                            {p.product_id} ({p.tier})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 px-3">
                      <select
                        value={b.parent_product_id}
                        onChange={(e) => {
                          const next = [...localBoms];
                          next[idx] = {
                            ...b,
                            parent_product_id: e.target.value,
                          };
                          setLocalBoms(next);
                        }}
                        className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs font-mono text-sky-400"
                      >
                        {products.map((p) => (
                          <option key={p.product_id} value={p.product_id}>
                            {p.product_id} ({p.tier})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 px-3 text-right">
                      <input
                        type="number"
                        step="0.1"
                        value={b.quantity_required}
                        onChange={(e) => {
                          const next = [...localBoms];
                          next[idx] = {
                            ...b,
                            quantity_required: Number(e.target.value),
                          };
                          setLocalBoms(next);
                        }}
                        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono tabular-nums text-right text-white w-24"
                      />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="0.5"
                        value={b.scrap_factor}
                        onChange={(e) => {
                          const next = [...localBoms];
                          next[idx] = {
                            ...b,
                            scrap_factor: Number(e.target.value),
                          };
                          setLocalBoms(next);
                        }}
                        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono tabular-nums text-right text-white w-24"
                      />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <input
                        type="number"
                        min="0"
                        value={b.lead_time_days}
                        onChange={(e) => {
                          const next = [...localBoms];
                          next[idx] = {
                            ...b,
                            lead_time_days: Number(e.target.value),
                          };
                          setLocalBoms(next);
                        }}
                        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono tabular-nums text-right text-white w-20"
                      />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setLocalBoms(localBoms.filter((_, i) => i !== idx))
                        }
                        className="p-1 text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                        title="Delete BOM Edge"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          SUB-TAB 3: RESOURCES & ROUTINGS (WORK CENTERS & CHANGEOVER MATRIX)
         ===================================================================== */}
      {activeSubTab === 'RESOURCES' && (
        <div className="space-y-6">
          {/* Work Centers Table */}
          <div className="bg-[#111827] border border-slate-800 rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div>
                <div className="text-xs text-slate-400">
                  OMP Unison Finite Capacity Parameters
                </div>
                <h3 className="text-base font-semibold text-white mt-0.5 font-display">
                  Plant Work Centers, Shift Capacities, Run Rates & Overtime Bounds
                </h3>
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-800 rounded-md">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/70 text-slate-400">
                    <th className="py-2.5 px-3 font-medium">Resource ID</th>
                    <th className="py-2.5 px-3 font-medium">Work Center Name</th>
                    <th className="py-2.5 px-3 font-medium">Plant Node</th>
                    <th className="py-2.5 px-3 font-medium text-right">
                      Regular Shift Cap (Hrs/Wk)
                    </th>
                    <th className="py-2.5 px-3 font-medium text-right">
                      Max Overtime (Hrs/Wk)
                    </th>
                    <th className="py-2.5 px-3 font-medium text-right">
                      Overtime Rate ($/Hr)
                    </th>
                    <th className="py-2.5 px-3 font-medium text-right">
                      Run Rate (Hrs/Unit)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {localWorkCenters.map((wc, idx) => (
                    <tr key={wc.resource_id} className="hover:bg-slate-800/30">
                      <td className="py-2 px-3 font-mono text-sky-400">
                        {wc.resource_id}
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          value={wc.name}
                          onChange={(e) => {
                            const next = [...localWorkCenters];
                            next[idx] = { ...wc, name: e.target.value };
                            setLocalWorkCenters(next);
                          }}
                          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white w-64"
                        />
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-300">
                        {wc.plant_id}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <input
                          type="number"
                          value={wc.capacity_hours_per_bucket}
                          onChange={(e) => {
                            const next = [...localWorkCenters];
                            next[idx] = {
                              ...wc,
                              capacity_hours_per_bucket: Number(e.target.value),
                            };
                            setLocalWorkCenters(next);
                          }}
                          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono tabular-nums text-right text-white w-24"
                        />
                      </td>
                      <td className="py-2 px-3 text-right">
                        <input
                          type="number"
                          value={wc.max_overtime_hours}
                          onChange={(e) => {
                            const next = [...localWorkCenters];
                            next[idx] = {
                              ...wc,
                              max_overtime_hours: Number(e.target.value),
                            };
                            setLocalWorkCenters(next);
                          }}
                          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono tabular-nums text-right text-white w-24"
                        />
                      </td>
                      <td className="py-2 px-3 text-right">
                        <input
                          type="number"
                          value={wc.overtime_cost_per_hour}
                          onChange={(e) => {
                            const next = [...localWorkCenters];
                            next[idx] = {
                              ...wc,
                              overtime_cost_per_hour: Number(e.target.value),
                            };
                            setLocalWorkCenters(next);
                          }}
                          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono tabular-nums text-right text-white w-24"
                        />
                      </td>
                      <td className="py-2 px-3 text-right">
                        <input
                          type="number"
                          step="0.005"
                          value={wc.run_rate_hours_per_unit}
                          onChange={(e) => {
                            const next = [...localWorkCenters];
                            next[idx] = {
                              ...wc,
                              run_rate_hours_per_unit: Number(e.target.value),
                            };
                            setLocalWorkCenters(next);
                          }}
                          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono tabular-nums text-right text-white w-24"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Sequence-Dependent Setup Changeover Matrix Editor */}
          <div className="bg-[#111827] border border-slate-800 rounded-lg p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
              <div>
                <div className="text-xs text-slate-400">
                  Sequence-Dependent Changeover Matrix Configuration
                </div>
                <h3 className="text-base font-semibold text-white mt-0.5 font-display">
                  Product-to-Product Transition Setup Times & Sanitization Costs
                </h3>
              </div>

              <div className="flex items-center gap-3">
                <select
                  value={selectedSetupWcId}
                  onChange={(e) => setSelectedSetupWcId(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-xs text-white"
                >
                  {localWorkCenters.map((wc) => (
                    <option key={wc.resource_id} value={wc.resource_id}>
                      {wc.resource_id} — {wc.name}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => {
                    const wcIdx = localWorkCenters.findIndex(
                      (w) => w.resource_id === selectedSetupWcId
                    );
                    if (wcIdx === -1) return;
                    const newRule: SequenceDependentSetup = {
                      from_product_id: 'SKU_CARDIO_50MG',
                      to_product_id: 'SKU_IMMUNO_10ML',
                      setup_time_hours: 3.5,
                      setup_cost: 480,
                      changeover_type: 'Custom Line Sanitization Cycle',
                    };
                    const next = [...localWorkCenters];
                    next[wcIdx] = {
                      ...next[wcIdx],
                      setup_matrix: [...next[wcIdx].setup_matrix, newRule],
                    };
                    setLocalWorkCenters(next);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Transition Rule</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-800 rounded-md">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/70 text-slate-400">
                    <th className="py-2 px-3 font-medium">From Preceding SKU</th>
                    <th className="py-2 px-3 font-medium">To Succeeding SKU</th>
                    <th className="py-2 px-3 font-medium">
                      Changeover Protocol Classification
                    </th>
                    <th className="py-2 px-3 font-medium text-right">
                      Setup Time (Hours)
                    </th>
                    <th className="py-2 px-3 font-medium text-right">
                      Changeover Cost ($)
                    </th>
                    <th className="py-2 px-3 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {localWorkCenters
                    .find((w) => w.resource_id === selectedSetupWcId)
                    ?.setup_matrix.map((rule, rIdx) => {
                      const wcIdx = localWorkCenters.findIndex(
                        (w) => w.resource_id === selectedSetupWcId
                      );
                      return (
                        <tr key={rIdx} className="hover:bg-slate-800/30">
                          <td className="py-2 px-3 font-mono text-slate-200">
                            {rule.from_product_id}
                          </td>
                          <td className="py-2 px-3 font-mono text-sky-400">
                            {rule.to_product_id}
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={rule.changeover_type}
                              onChange={(e) => {
                                const next = [...localWorkCenters];
                                const mat = [...next[wcIdx].setup_matrix];
                                mat[rIdx] = {
                                  ...rule,
                                  changeover_type: e.target.value,
                                };
                                next[wcIdx] = {
                                  ...next[wcIdx],
                                  setup_matrix: mat,
                                };
                                setLocalWorkCenters(next);
                              }}
                              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 w-64"
                            />
                          </td>
                          <td className="py-2 px-3 text-right">
                            <input
                              type="number"
                              step="0.5"
                              value={rule.setup_time_hours}
                              onChange={(e) => {
                                const next = [...localWorkCenters];
                                const mat = [...next[wcIdx].setup_matrix];
                                mat[rIdx] = {
                                  ...rule,
                                  setup_time_hours: Number(e.target.value),
                                };
                                next[wcIdx] = {
                                  ...next[wcIdx],
                                  setup_matrix: mat,
                                };
                                setLocalWorkCenters(next);
                              }}
                              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono tabular-nums text-right text-amber-400 w-24"
                            />
                          </td>
                          <td className="py-2 px-3 text-right">
                            <input
                              type="number"
                              value={rule.setup_cost}
                              onChange={(e) => {
                                const next = [...localWorkCenters];
                                const mat = [...next[wcIdx].setup_matrix];
                                mat[rIdx] = {
                                  ...rule,
                                  setup_cost: Number(e.target.value),
                                };
                                next[wcIdx] = {
                                  ...next[wcIdx],
                                  setup_matrix: mat,
                                };
                                setLocalWorkCenters(next);
                              }}
                              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono tabular-nums text-right text-white w-24"
                            />
                          </td>
                          <td className="py-2 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => {
                                const next = [...localWorkCenters];
                                next[wcIdx] = {
                                  ...next[wcIdx],
                                  setup_matrix: next[wcIdx].setup_matrix.filter(
                                    (_, i) => i !== rIdx
                                  ),
                                };
                                setLocalWorkCenters(next);
                              }}
                              className="p-1 text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
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
          SUB-TAB 4: CURRENT INVENTORY & OPEN POs / WORK ORDERS
         ===================================================================== */}
      {activeSubTab === 'INVENTORY_POS' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left 5 Cols: Current On-Hand Inventory Balances */}
          <div className="lg:col-span-5 bg-[#111827] border border-slate-800 rounded-lg p-6 space-y-4">
            <div className="pb-4 border-b border-slate-800">
              <div className="text-xs text-slate-400">
                Opening Stock Snapshot (Bucket W44)
              </div>
              <h3 className="text-base font-semibold text-white mt-0.5 font-display">
                Current On-Hand Inventory by SKU
              </h3>
            </div>

            <div className="overflow-x-auto border border-slate-800 rounded-md">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/70 text-slate-400">
                    <th className="py-2 px-3 font-medium">Product / Component SKU</th>
                    <th className="py-2 px-3 font-medium">Tier &amp; UOM</th>
                    <th className="py-2 px-3 font-medium text-right">
                      On-Hand Balance
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {products.map((p) => (
                    <tr key={p.product_id} className="hover:bg-slate-800/30">
                      <td className="py-2 px-3">
                        <div className="font-mono text-slate-200">
                          {p.product_id}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate max-w-[180px]">
                          {p.name}
                        </div>
                      </td>
                      <td className="py-2 px-3 font-mono text-[11px] text-slate-400">
                        <div>{p.tier}</div>
                        <div className="text-[10px] text-sky-400">
                          {p.unit_of_measure || 'units'}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          <input
                            type="number"
                            min={0}
                            value={localInventory[p.product_id] ?? 0}
                            onChange={(e) =>
                              setLocalInventory({
                                ...localInventory,
                                [p.product_id]: Number(e.target.value),
                              })
                            }
                            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono tabular-nums text-right text-emerald-400 w-24"
                          />
                          <span className="text-[10px] font-mono text-slate-400 w-16 text-left truncate">
                            {p.unit_of_measure || 'units'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right 7 Cols: Open Purchase Orders & Scheduled Receipts */}
          <div className="lg:col-span-7 bg-[#111827] border border-slate-800 rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div>
                <div className="text-xs text-slate-400">
                  Transactional Supply Pipeline
                </div>
                <h3 className="text-base font-semibold text-white mt-0.5 font-display">
                  Open Purchase Orders (POs) & In-Transit Work Orders
                </h3>
              </div>

              <button
                type="button"
                onClick={() => {
                  const newPo: OpenPurchaseOrder = {
                    po_id: `PO-2026-${8950 + localOpenPos.length}`,
                    supplier_id: 'SUP_BASEL_API',
                    product_id: 'SKU_CARDIO_50MG',
                    destination_node_id: 'DC_CHICAGO_COLD',
                    scheduled_bucket: 1,
                    scheduled_bucket_label: buckets[0]?.label || 'W44 · Nov 02',
                    ordered_qty: 200,
                    unit_price_usd: 34.0,
                    status: 'CONFIRMED',
                  };
                  setLocalOpenPos([...localOpenPos, newPo]);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Open PO</span>
              </button>
            </div>

            <div className="overflow-x-auto border border-slate-800 rounded-md">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/70 text-slate-400">
                    <th className="py-2 px-3 font-medium">Order ID</th>
                    <th className="py-2 px-3 font-medium">Product SKU</th>
                    <th className="py-2 px-3 font-medium">Arrival Bucket</th>
                    <th className="py-2 px-3 font-medium text-right">
                      Ordered Qty
                    </th>
                    <th className="py-2 px-3 font-medium">Status</th>
                    <th className="py-2 px-3 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {localOpenPos.map((po, idx) => (
                    <tr key={po.po_id} className="hover:bg-slate-800/30">
                      <td className="py-2 px-3 font-mono text-sky-400">
                        {po.po_id}
                      </td>
                      <td className="py-2 px-3">
                        <select
                          value={po.product_id}
                          onChange={(e) => {
                            const next = [...localOpenPos];
                            next[idx] = { ...po, product_id: e.target.value };
                            setLocalOpenPos(next);
                          }}
                          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-slate-200"
                        >
                          {products.map((p) => (
                            <option key={p.product_id} value={p.product_id}>
                              {p.product_id}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 px-3">
                        <select
                          value={po.scheduled_bucket}
                          onChange={(e) => {
                            const bNum = Number(e.target.value);
                            const bObj = buckets.find((b) => b.bucket === bNum);
                            const next = [...localOpenPos];
                            next[idx] = {
                              ...po,
                              scheduled_bucket: bNum,
                              scheduled_bucket_label:
                                bObj?.label || `W${43 + bNum}`,
                            };
                            setLocalOpenPos(next);
                          }}
                          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-slate-300"
                        >
                          {buckets.map((b) => (
                            <option key={b.bucket} value={b.bucket}>
                              {b.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 px-3 text-right">
                        <input
                          type="number"
                          min={0}
                          value={po.ordered_qty}
                          onChange={(e) => {
                            const next = [...localOpenPos];
                            next[idx] = {
                              ...po,
                              ordered_qty: Number(e.target.value),
                            };
                            setLocalOpenPos(next);
                          }}
                          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono tabular-nums text-right text-white w-24"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <select
                          value={po.status}
                          onChange={(e) => {
                            const next = [...localOpenPos];
                            next[idx] = {
                              ...po,
                              status: e.target.value as OpenPurchaseOrder['status'],
                            };
                            setLocalOpenPos(next);
                          }}
                          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-emerald-400"
                        >
                          <option value="IN_TRANSIT">IN_TRANSIT</option>
                          <option value="CONFIRMED">CONFIRMED</option>
                          <option value="EXPEDITED">EXPEDITED</option>
                        </select>
                      </td>
                      <td className="py-2 px-3 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            setLocalOpenPos(
                              localOpenPos.filter((_, i) => i !== idx)
                            )
                          }
                          className="p-1 text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          FILE UPLOAD DRAG-AND-DROP MODAL (JSON / CSV FIXTURE IMPORTER)
         ===================================================================== */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-[#111827] border border-slate-700 rounded-xl max-w-xl w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <div className="text-xs text-slate-400">
                  Dynamic State Replacement · JSON or CSV Fixtures
                </div>
                <h3 className="text-base font-semibold text-white mt-0.5 font-display">
                  Import Supply Chain Dataset Fixture
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Drag and Drop Zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragActive(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                  processUploadedFile(e.dataTransfer.files[0]);
                }
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
                dragActive
                  ? 'border-sky-400 bg-sky-950/20'
                  : 'border-slate-700 bg-[#0B0F17] hover:border-slate-500'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.csv"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    processUploadedFile(e.target.files[0]);
                  }
                }}
                className="hidden"
              />
              <Upload className="w-8 h-8 text-sky-400 mx-auto mb-3" />
              <div className="text-sm font-semibold text-white">
                Drag and drop <span className="font-mono text-sky-400">supply_chain_test_fixture.json</span> or CSV file here
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Supports full JSON network fixtures or entity CSV tables (Nodes, Multi-Level BOMs, Inventory, Open POs)
              </p>
              <div className="mt-4 flex items-center justify-center gap-4 text-[11px] text-slate-400 font-mono">
                <span className="inline-flex items-center gap-1">
                  <FileJson className="w-3.5 h-3.5 text-sky-400" /> .JSON Fixture
                </span>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" /> .CSV Table
                </span>
              </div>
            </div>

            {uploadFeedback && (
              <div
                className={`p-3.5 rounded-lg border text-xs ${
                  uploadFeedback.type === 'success'
                    ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
                    : 'bg-rose-950/30 border-rose-500/40 text-rose-300'
                }`}
              >
                {uploadFeedback.message}
              </div>
            )}

            {/* Quick Template Actions */}
            <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownloadSampleFixture}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-slate-400" />
                  <span>Download Template JSON</span>
                </button>

                <button
                  type="button"
                  onClick={handleLoadAlternateCompanyFixture}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-sky-300 bg-sky-950/40 hover:bg-sky-900/50 border border-sky-500/30 rounded cursor-pointer"
                >
                  <span>Load Sample Fixture (Nordic Bio-Synthetics)</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                className="px-4 py-1.5 text-xs font-semibold text-slate-950 bg-white hover:bg-slate-200 rounded cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
