import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Cpu,
  FastForward,
  GitMerge,
  Layers,
  Pause,
  Play,
  RotateCcw,
  Sliders,
  Sparkles,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import {
  AIOptimizationObjective,
  AISupplyChainOptimizationResponse,
  Lane,
  NodeType,
  Product,
  ScenarioComparisonResult,
  ScenarioSimulationInput,
  SupplyNode,
  WorkCenter,
} from '../types/ibp.ts';

interface AiSupplyChainOptimizerModalProps {
  isOpen: boolean;
  onClose: () => void;
  companyName: string;
  primaryUom: string;
  nodes: SupplyNode[];
  lanes: Lane[];
  products: Product[];
  workCenters: WorkCenter[];
  savedScenarios: ScenarioComparisonResult[];
  initialScenarioId?: string;
  customScenario?: ScenarioSimulationInput;
  onApplyToBeWorkspace: (updatedWorkspace: any) => void;
}

export const AiSupplyChainOptimizerModal: React.FC<
  AiSupplyChainOptimizerModalProps
> = ({
  isOpen,
  onClose,
  companyName,
  primaryUom,
  nodes,
  lanes,
  products,
  workCenters,
  savedScenarios,
  initialScenarioId = 'BASELINE',
  customScenario,
  onApplyToBeWorkspace,
}) => {
  const [selectedScenarioId, setSelectedScenarioId] =
    useState<string>(initialScenarioId);
  const [objective, setObjective] = useState<AIOptimizationObjective>(
    'BALANCED_MARGIN_OTIF'
  );
  const [loadingAi, setLoadingAi] = useState<boolean>(false);
  const [applyingToBe, setApplyingToBe] = useState<boolean>(false);
  const [appliedSuccess, setAppliedSuccess] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [aiResult, setAiResult] =
    useState<AISupplyChainOptimizationResponse | null>(null);

  // AS-IS (0) -> TO-BE (100) continuous animation progress
  const [progress, setProgress] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedScenarioId(initialScenarioId || 'BASELINE');
      setAppliedSuccess(false);
    }
  }, [isOpen, initialScenarioId]);

  const runAiOptimization = async (
    targetScenarioId: string,
    targetObjective: AIOptimizationObjective
  ) => {
    setLoadingAi(true);
    setErrorMsg(null);
    setAppliedSuccess(false);
    try {
      const bodyPayload: Record<string, any> = {
        scenario_id: targetScenarioId,
        objective: targetObjective,
      };
      if (targetScenarioId === 'CUSTOM_SANDBOX' && customScenario) {
        bodyPayload.custom_scenario = customScenario;
      }

      const res = await fetch('/api/v1/ai/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });
      const data = await res.json();
      if (data.status === 'SUCCESS' && data.optimization) {
        setAiResult(data.optimization);
        setProgress(0);
        setIsPlaying(true);
      } else {
        setErrorMsg(data.message || 'Unable to compute AI optimization');
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Network error calling AI solver'
      );
    } finally {
      setLoadingAi(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      runAiOptimization(selectedScenarioId, objective);
    }
  }, [isOpen, selectedScenarioId, objective]);

  // Animation loop for smooth AS-IS (0%) -> TO-BE (100%) transition
  useEffect(() => {
    if (!isOpen || !isPlaying || loadingAi || !aiResult) return;

    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          setIsPlaying(false);
          return 100;
        }
        return Math.min(100, Number((prev + 0.8).toFixed(1)));
      });
    }, 45);

    return () => clearInterval(interval);
  }, [isOpen, isPlaying, loadingAi, aiResult]);

  // Determine current active transformation stage (1..4) from progress (0..100)
  const activeStageNumber = useMemo(() => {
    if (progress < 25) return 1;
    if (progress < 55) return 2;
    if (progress < 85) return 3;
    return 4;
  }, [progress]);

  const ratio = progress / 100;

  // Compute DAG Layout for the Animated AS-IS -> TO-BE Network Canvas
  const graphLayout = useMemo(() => {
    if (!nodes || nodes.length === 0) return { positionedNodes: [], edges: [] };
    const suppliers = nodes.filter((n) => n.node_type === NodeType.SUPPLIER);
    const plants = nodes.filter(
      (n) =>
        n.node_type === NodeType.PLANT || n.node_type === NodeType.WORK_CENTER
    );
    const dcs = nodes.filter(
      (n) => n.node_type === NodeType.DISTRIBUTION_CENTER
    );
    const customers = nodes.filter((n) => n.node_type === NodeType.CUSTOMER);

    const placeColumn = (
      list: SupplyNode[],
      x: number,
      echelonTitle: string
    ) =>
      list.map((n, idx) => {
        const count = list.length;
        const y =
          count === 1
            ? 125
            : Math.round(52 + (idx * 150) / Math.max(1, count - 1));
        return {
          ...n,
          x,
          y,
          echelonTitle,
        };
      });

    const positionedNodes = [
      ...placeColumn(suppliers, 30, 'TIER-1 SUPPLIERS'),
      ...placeColumn(plants, 260, 'FINITE PLANTS'),
      ...placeColumn(dcs, 490, 'REGIONAL DCs'),
      ...placeColumn(customers, 710, 'CUSTOMERS'),
    ];

    const posMap = new Map(positionedNodes.map((p) => [p.node_id, p]));
    const edges = lanes
      .map((lane) => {
        const orig = posMap.get(lane.origin_node_id);
        const dest = posMap.get(lane.destination_node_id);
        if (!orig || !dest) return null;
        return {
          lane_id: lane.lane_id,
          mode: lane.mode,
          from_id: lane.origin_node_id,
          to_id: lane.destination_node_id,
          x1: orig.x + 165,
          y1: orig.y + 34,
          x2: dest.x,
          y2: dest.y + 34,
        };
      })
      .filter(Boolean) as {
      lane_id: string;
      mode: string;
      from_id: string;
      to_id: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }[];

    return { positionedNodes, edges };
  }, [nodes, lanes]);

  const handleApplyToBe = async () => {
    if (!aiResult) return;
    setApplyingToBe(true);
    try {
      const res = await fetch('/api/v1/ai/apply-to-be', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiResult.recommended_levers),
      });
      const updatedSnap = await res.json();
      if (updatedSnap && updatedSnap.status === 'SUCCESS') {
        onApplyToBeWorkspace(updatedSnap);
        setAppliedSuccess(true);
        setProgress(100);
        setIsPlaying(false);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to apply TO-BE plan'
      );
    } finally {
      setApplyingToBe(false);
    }
  };

  if (!isOpen) return null;

  const asIsPlan = aiResult?.as_is_plan;
  const toBePlan = aiResult?.to_be_plan;

  // Interpolated Telemetry Values based on progress ratio (0.0 -> 1.0)
  const interpOtif =
    asIsPlan && toBePlan
      ? (
          asIsPlan.otif_percentage +
          (toBePlan.otif_percentage - asIsPlan.otif_percentage) * ratio
        ).toFixed(1)
      : '0.0';

  const interpShortfall =
    asIsPlan && toBePlan
      ? Math.round(
          asIsPlan.unmet_units +
            (toBePlan.unmet_units - asIsPlan.unmet_units) * ratio
        )
      : 0;

  const interpMargin =
    asIsPlan && toBePlan
      ? (
          asIsPlan.gross_margin_pct +
          (toBePlan.gross_margin_pct - asIsPlan.gross_margin_pct) * ratio
        ).toFixed(1)
      : '0.0';

  const interpSetupHours =
    asIsPlan && toBePlan
      ? (
          asIsPlan.total_setup_hours +
          (toBePlan.total_setup_hours - asIsPlan.total_setup_hours) * ratio
        ).toFixed(1)
      : '0.0';

  const interpCost =
    asIsPlan && toBePlan
      ? Math.round(
          asIsPlan.total_cost +
            (toBePlan.total_cost - asIsPlan.total_cost) * ratio
        )
      : 0;

  const currentStageObj =
    aiResult?.transformation_stages.find(
      (s) => s.stage_number === activeStageNumber
    ) || aiResult?.transformation_stages[0];

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 lg:p-6 overflow-y-auto">
      <div className="bg-[#0B0F17] border border-slate-800 rounded-xl max-w-[1380px] w-full max-h-[94vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Top Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 bg-[#0F1623] border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-sky-500/15 border border-sky-500/40 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5 text-sky-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono uppercase tracking-wider text-sky-400 font-semibold">
                  Nexora AI Supply Chain Optimizer · AS-IS → TO-BE Digital Twin
                </span>
                <span className="px-2 py-0.5 text-[10px] font-mono bg-slate-800 text-slate-300 rounded border border-slate-700">
                  {aiResult?.model_used || 'gemini-3.8-flash'}
                </span>
              </div>
              <h2 className="text-lg font-bold text-white font-display">
                {companyName} — Guided AS-IS to TO-BE Supply Chain Transformation
              </h2>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Scenario Context Selector */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-400 whitespace-nowrap">
                Scenario Context:
              </label>
              <select
                value={selectedScenarioId}
                onChange={(e) => setSelectedScenarioId(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 max-w-[230px]"
              >
                <option value="BASELINE">
                  Active Workspace Baseline (Live Data)
                </option>
                {customScenario && (
                  <option value="CUSTOM_SANDBOX">
                    Sandbox Form: {customScenario.scenario_name}
                  </option>
                )}
                {savedScenarios.map((scn, idx) => (
                  <option key={scn.scenario_id} value={scn.scenario_id}>
                    BR-0{idx + 1}: {scn.scenario_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Optimization Objective Selector */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-400 whitespace-nowrap">
                AI Objective:
              </label>
              <select
                value={objective}
                onChange={(e) =>
                  setObjective(e.target.value as AIOptimizationObjective)
                }
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-sky-300 font-medium"
              >
                <option value="BALANCED_MARGIN_OTIF">
                  Balanced Margin &amp; OTIF Recovery
                </option>
                <option value="MAX_OTIF_RECOVERY">
                  Max OTIF Service Level (SLA First)
                </option>
                <option value="MIN_TOTAL_COST">
                  Min Total Landed &amp; Setup Cost
                </option>
              </select>
            </div>

            <button
              type="button"
              disabled={loadingAi}
              onClick={() => runAiOptimization(selectedScenarioId, objective)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 rounded-md transition-colors cursor-pointer"
            >
              <RotateCcw
                className={`w-3.5 h-3.5 ${loadingAi ? 'animate-spin' : ''}`}
              />
              <span>{loadingAi ? 'Synthesizing...' : 'Re-Synthesize AI'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-md cursor-pointer"
              aria-label="Close AI Optimizer Modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Main Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {errorMsg && (
            <div className="p-4 bg-rose-950/40 border border-rose-500/40 rounded-lg text-xs text-rose-200 flex items-center justify-between">
              <span>{errorMsg}</span>
              <button
                type="button"
                onClick={() => runAiOptimization(selectedScenarioId, objective)}
                className="px-3 py-1 bg-rose-500/20 border border-rose-500/40 rounded text-rose-100 font-semibold cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}

          {loadingAi || !aiResult || !asIsPlan || !toBePlan ? (
            <div className="space-y-6 py-8">
              <div className="flex flex-col items-center justify-center text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-sky-500/15 border border-sky-500/40 flex items-center justify-center animate-pulse">
                  <Cpu className="w-6 h-6 text-sky-400" />
                </div>
                <div className="text-base font-semibold text-white">
                  Gemini AI is analyzing {companyName}&apos;s Multi-Echelon Graph
                  &amp; Finite Work Centers...
                </div>
                <p className="text-xs text-slate-400 max-w-xl">
                  Evaluating BOM pegging dependencies, sequence-dependent
                  changeover matrices, and upstream PO lead times in{' '}
                  <span className="text-sky-300 font-mono">{primaryUom}</span> to
                  construct the AS-IS → TO-BE transformation trajectory.
                </p>
              </div>
              <div className="grid grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-24 bg-[#111827] border border-slate-800 rounded-lg animate-pulse"
                  />
                ))}
              </div>
              <div className="h-80 bg-[#111827] border border-slate-800 rounded-lg animate-pulse" />
            </div>
          ) : (
            <>
              {/* 1. INTERACTIVE AS-IS -> TO-BE TIMELINE SCRUBBER & PLAYBACK BAR */}
              <div className="bg-[#111827] border border-slate-800 rounded-lg p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        if (progress >= 100) {
                          setProgress(0);
                          setIsPlaying(true);
                        } else {
                          setIsPlaying(!isPlaying);
                        }
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-sky-400 hover:bg-sky-300 text-slate-950 rounded-md transition-colors cursor-pointer"
                    >
                      {isPlaying ? (
                        <>
                          <Pause className="w-3.5 h-3.5" />
                          <span>Pause Transformation</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5" />
                          <span>
                            {progress >= 100
                              ? 'Replay AS-IS → TO-BE'
                              : 'Play AS-IS → TO-BE'}
                          </span>
                        </>
                      )}
                    </button>

                    {/* Quick State Jump Buttons */}
                    <div className="flex items-center rounded-md border border-slate-700 overflow-hidden text-xs font-mono">
                      <button
                        type="button"
                        onClick={() => {
                          setIsPlaying(false);
                          setProgress(0);
                        }}
                        className={`px-3 py-1.5 transition-colors cursor-pointer ${
                          progress < 15
                            ? 'bg-rose-500/25 text-rose-200 font-semibold'
                            : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        AS-IS (0%)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsPlaying(false);
                          setProgress(40);
                        }}
                        className={`px-3 py-1.5 border-l border-slate-700 transition-colors cursor-pointer ${
                          progress >= 15 && progress < 60
                            ? 'bg-amber-500/25 text-amber-200 font-semibold'
                            : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        BOM Expedite (40%)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsPlaying(false);
                          setProgress(75);
                        }}
                        className={`px-3 py-1.5 border-l border-slate-700 transition-colors cursor-pointer ${
                          progress >= 60 && progress < 90
                            ? 'bg-sky-500/25 text-sky-200 font-semibold'
                            : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Line Resequence (75%)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsPlaying(false);
                          setProgress(100);
                        }}
                        className={`px-3 py-1.5 border-l border-slate-700 transition-colors cursor-pointer ${
                          progress >= 90
                            ? 'bg-emerald-500/25 text-emerald-200 font-semibold'
                            : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        TO-BE (100%)
                      </button>
                    </div>
                  </div>

                  {/* Continuous Progress Scrubber */}
                  <div className="flex items-center gap-3 flex-1 max-w-md">
                    <span className="text-[11px] font-mono text-rose-400 font-semibold">
                      AS-IS
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round(progress)}
                      onChange={(e) => {
                        setIsPlaying(false);
                        setProgress(Number(e.target.value));
                      }}
                      className="w-full accent-sky-400 cursor-pointer"
                      aria-label="AS-IS to TO-BE Transformation Progress"
                    />
                    <span className="text-[11px] font-mono text-emerald-400 font-semibold">
                      TO-BE ({Math.round(progress)}%)
                    </span>
                  </div>
                </div>

                {/* 4 Clickable Stage Progression Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2">
                  {aiResult.transformation_stages.map((stg) => {
                    const isCurrent = stg.stage_number === activeStageNumber;
                    const isPassed = stg.stage_number < activeStageNumber;
                    const stageTargetProgress =
                      stg.stage_number === 1
                        ? 0
                        : stg.stage_number === 2
                        ? 38
                        : stg.stage_number === 3
                        ? 72
                        : 100;

                    return (
                      <button
                        key={stg.stage_number}
                        type="button"
                        onClick={() => {
                          setIsPlaying(false);
                          setProgress(stageTargetProgress);
                        }}
                        className={`text-left p-3.5 rounded-lg border transition-all cursor-pointer ${
                          isCurrent
                            ? stg.stage_number === 1
                              ? 'bg-rose-950/25 border-rose-500/60'
                              : stg.stage_number === 4
                              ? 'bg-emerald-950/25 border-emerald-500/60'
                              : 'bg-sky-950/30 border-sky-400/60'
                            : isPassed
                            ? 'bg-slate-900/80 border-emerald-500/30'
                            : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[11px] font-mono mb-1">
                          <span
                            className={
                              isCurrent
                                ? stg.stage_number === 1
                                  ? 'text-rose-400 font-bold'
                                  : stg.stage_number === 4
                                  ? 'text-emerald-400 font-bold'
                                  : 'text-sky-400 font-bold'
                                : isPassed
                                ? 'text-emerald-400'
                                : 'text-slate-400'
                            }
                          >
                            0{stg.stage_number} · {stg.phase_code.replace(/_/g, ' ')}
                          </span>
                          {isPassed || (isCurrent && stg.stage_number === 4) ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          ) : isCurrent ? (
                            <Zap className="w-3.5 h-3.5 text-sky-400 animate-pulse" />
                          ) : null}
                        </div>
                        <div className="text-xs font-semibold text-white line-clamp-1">
                          {stg.title.replace(/^Stage \d:\s*/, '')}
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 mt-1 line-clamp-1">
                          {stg.subtitle}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. LIVE INTERPOLATED AS-IS -> TO-BE KPI TELEMETRY STRIP */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* OTIF Fill Rate Card */}
                <div className="bg-[#111827] border border-slate-800 rounded-lg p-4">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>OTIF Service Fill Rate</span>
                    <span className="font-mono text-emerald-400 font-semibold">
                      +{aiResult.kpi_deltas.otif_improvement_pts} pts TO-BE
                    </span>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between">
                    <span
                      className={`text-2xl font-bold font-mono tabular-nums ${
                        Number(interpOtif) >= 95
                          ? 'text-emerald-400'
                          : Number(interpOtif) >= 88
                          ? 'text-amber-400'
                          : 'text-rose-400'
                      }`}
                    >
                      {interpOtif}%
                    </span>
                    <div className="text-[11px] font-mono text-slate-400 flex items-center gap-1.5">
                      <span className="text-rose-400">
                        {asIsPlan.otif_percentage}%
                      </span>
                      <ArrowRight className="w-3 h-3 text-slate-500" />
                      <span className="text-emerald-400 font-semibold">
                        {toBePlan.otif_percentage}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Unfulfilled Shortfall Card */}
                <div className="bg-[#111827] border border-slate-800 rounded-lg p-4">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Unfulfilled Shortfall ({primaryUom})</span>
                    <span className="font-mono text-emerald-400 font-semibold">
                      -{aiResult.kpi_deltas.shortfall_reduction_units.toLocaleString()}{' '}
                      {primaryUom}
                    </span>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between">
                    <span
                      className={`text-2xl font-bold font-mono tabular-nums ${
                        interpShortfall === 0
                          ? 'text-emerald-400'
                          : 'text-amber-400'
                      }`}
                    >
                      {interpShortfall.toLocaleString()}{' '}
                      <span className="text-xs font-normal text-slate-400">
                        {primaryUom}
                      </span>
                    </span>
                    <div className="text-[11px] font-mono text-slate-400 flex items-center gap-1.5">
                      <span className="text-rose-400">
                        {asIsPlan.unmet_units.toLocaleString()}
                      </span>
                      <ArrowRight className="w-3 h-3 text-slate-500" />
                      <span className="text-emerald-400 font-semibold">
                        {toBePlan.unmet_units.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Commercial Gross Margin & Preserved Revenue */}
                <div className="bg-[#111827] border border-slate-800 rounded-lg p-4">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Commercial Gross Margin</span>
                    <span className="font-mono text-sky-400 font-semibold">
                      +$
                      {aiResult.kpi_deltas.revenue_preserved_usd.toLocaleString()}{' '}
                      Rev
                    </span>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between">
                    <span className="text-2xl font-bold font-mono tabular-nums text-white">
                      {interpMargin}%
                    </span>
                    <div className="text-[11px] font-mono text-slate-400 flex items-center gap-1.5">
                      <span className="text-amber-400">
                        {asIsPlan.gross_margin_pct}%
                      </span>
                      <ArrowRight className="w-3 h-3 text-slate-500" />
                      <span className="text-emerald-400 font-semibold">
                        {toBePlan.gross_margin_pct}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Changeover Setup Downtime & Total Cost */}
                <div className="bg-[#111827] border border-slate-800 rounded-lg p-4">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Changeover Setup Downtime</span>
                    <span className="font-mono text-emerald-400 font-semibold">
                      -{aiResult.kpi_deltas.setup_hours_saved} hrs saved
                    </span>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between">
                    <span className="text-2xl font-bold font-mono tabular-nums text-sky-400">
                      {interpSetupHours}h
                    </span>
                    <div className="text-[11px] font-mono text-slate-400 flex items-center gap-1.5">
                      <span>${(interpCost / 1000).toFixed(1)}k Total Cost</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. ANIMATED MULTI-ECHELON SUPPLY CHAIN DIGITAL TWIN (AS-IS -> TO-BE) */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-8 bg-[#111827] border border-slate-800 rounded-lg p-5 flex flex-col justify-between space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
                    <div>
                      <div className="text-xs text-slate-400 flex items-center gap-2">
                        <span>
                          Live Multi-Echelon Network Flow Animation ({primaryUom})
                        </span>
                        <span className="text-slate-600">·</span>
                        <span className="font-mono text-sky-400">
                          {currentStageObj?.title}
                        </span>
                      </div>
                      <h3 className="text-base font-semibold text-white mt-0.5 font-display">
                        AS-IS Bottleneck Relief → TO-BE Synchronized Material
                        Allocation
                      </h3>
                    </div>

                    <div className="flex items-center gap-4 text-[11px] font-mono">
                      <span className="flex items-center gap-1.5 text-rose-400">
                        <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
                        AS-IS Bottleneck
                      </span>
                      <span className="flex items-center gap-1.5 text-sky-400">
                        <span className="w-2.5 h-2.5 rounded-full bg-sky-400 inline-block" />
                        AI Expedite / Resequence
                      </span>
                      <span className="flex items-center gap-1.5 text-emerald-400">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" />
                        TO-BE Synchronized
                      </span>
                    </div>
                  </div>

                  {/* Interactive SVG Digital Twin Canvas */}
                  <div className="bg-[#0B0F17] border border-slate-800/90 rounded-lg p-3 overflow-x-auto">
                    <svg
                      viewBox="0 0 910 275"
                      className="w-full h-72 min-w-[760px]"
                    >
                      <defs>
                        <linearGradient
                          id="edgeGradAsIs"
                          x1="0%"
                          y1="0%"
                          x2="100%"
                          y2="0%"
                        >
                          <stop offset="0%" stopColor="#F43F5E" />
                          <stop offset="100%" stopColor="#F59E0B" />
                        </linearGradient>
                        <linearGradient
                          id="edgeGradToBe"
                          x1="0%"
                          y1="0%"
                          x2="100%"
                          y2="0%"
                        >
                          <stop offset="0%" stopColor="#38BDF8" />
                          <stop offset="100%" stopColor="#10B981" />
                        </linearGradient>
                      </defs>

                      {/* Echelon Column Headers */}
                      <text
                        x="30"
                        y="22"
                        fill="#64748B"
                        fontSize="10"
                        fontFamily="monospace"
                        fontWeight="600"
                      >
                        01. TIER-1 SUPPLIERS
                      </text>
                      <text
                        x="260"
                        y="22"
                        fill="#64748B"
                        fontSize="10"
                        fontFamily="monospace"
                        fontWeight="600"
                      >
                        02. FINITE PLANTS &amp; LINES
                      </text>
                      <text
                        x="490"
                        y="22"
                        fill="#64748B"
                        fontSize="10"
                        fontFamily="monospace"
                        fontWeight="600"
                      >
                        03. REGIONAL DCs
                      </text>
                      <text
                        x="710"
                        y="22"
                        fill="#64748B"
                        fontSize="10"
                        fontFamily="monospace"
                        fontWeight="600"
                      >
                        04. CUSTOMER SLA DEMAND
                      </text>

                      {/* Animated Supply Lanes & Material Flow Particles */}
                      {graphLayout.edges.map((edge, idx) => {
                        const midX = (edge.x1 + edge.x2) / 2;
                        const pathData = `M ${edge.x1} ${edge.y1} C ${midX} ${edge.y1}, ${midX} ${edge.y2}, ${edge.x2} ${edge.y2}`;
                        const isTransitioned = progress >= 45;
                        const strokeColor =
                          progress < 25
                            ? 'url(#edgeGradAsIs)'
                            : 'url(#edgeGradToBe)';

                        // Compute animated particle position along cubic bezier curve
                        const t = ((progress * 2.5 + idx * 23) % 100) / 100;
                        const invT = 1 - t;
                        const px =
                          invT * invT * invT * edge.x1 +
                          3 * invT * invT * t * midX +
                          3 * invT * t * t * midX +
                          t * t * t * edge.x2;
                        const py =
                          invT * invT * invT * edge.y1 +
                          3 * invT * invT * t * edge.y1 +
                          3 * invT * t * t * edge.y2 +
                          t * t * t * edge.y2;

                        return (
                          <g key={edge.lane_id}>
                            {/* Base Lane Curve */}
                            <path
                              d={pathData}
                              fill="none"
                              stroke={strokeColor}
                              strokeWidth={isTransitioned ? 2.5 : 1.75}
                              strokeDasharray={
                                progress < 30 ? '5 4' : undefined
                              }
                              opacity={0.75}
                            />
                            {/* Moving Flow Particle */}
                            <circle
                              cx={px}
                              cy={py}
                              r={progress >= 35 ? 4 : 3}
                              fill={
                                progress < 25
                                  ? '#FB7185'
                                  : progress < 75
                                  ? '#38BDF8'
                                  : '#34D399'
                              }
                            />
                          </g>
                        );
                      })}

                      {/* Echelon Nodes with AS-IS -> TO-BE Status Morphing */}
                      {graphLayout.positionedNodes.map((n) => {
                        const nodeTrans = aiResult.node_transformations.find(
                          (nt) => nt.node_id === n.node_id
                        );
                        const isFocus =
                          currentStageObj?.focus_node_ids.includes(n.node_id) ||
                          selectedNodeId === n.node_id;

                        // Determine node visual state based on progress and echelon
                        const nodeThreshold =
                          n.node_type === NodeType.SUPPLIER
                            ? 30
                            : n.node_type === NodeType.PLANT ||
                              n.node_type === NodeType.WORK_CENTER
                            ? 60
                            : 85;
                        const isNodeOptimized = progress >= nodeThreshold;

                        const borderColor = isNodeOptimized
                          ? '#10B981'
                          : progress >= nodeThreshold - 25
                          ? '#38BDF8'
                          : nodeTrans?.as_is_status === 'BOTTLENECK'
                          ? '#F43F5E'
                          : '#F59E0B';

                        const badgeBg = isNodeOptimized
                          ? '#064E3B'
                          : progress >= nodeThreshold - 25
                          ? '#0C4A6E'
                          : '#4C0519';

                        const badgeText = isNodeOptimized
                          ? nodeTrans?.to_be_status || 'OPTIMIZED'
                          : progress >= nodeThreshold - 25
                          ? 'AI OPTIMIZING'
                          : nodeTrans?.as_is_status || 'BOTTLENECK';

                        const metricLabel = isNodeOptimized
                          ? nodeTrans?.to_be_metric_label || 'Nominal Flow'
                          : nodeTrans?.as_is_metric_label || 'Constrained';

                        return (
                          <g
                            key={n.node_id}
                            onClick={() =>
                              setSelectedNodeId(
                                selectedNodeId === n.node_id ? null : n.node_id
                              )
                            }
                            className="cursor-pointer"
                          >
                            <rect
                              x={n.x}
                              y={n.y}
                              width="165"
                              height="68"
                              rx="7"
                              fill="#111827"
                              stroke={borderColor}
                              strokeWidth={isFocus ? 2.2 : 1.4}
                            />

                            {/* Top Node ID + Status Pill */}
                            <text
                              x={n.x + 10}
                              y={n.y + 18}
                              fill="#F8FAFC"
                              fontSize="10.5"
                              fontWeight="700"
                              fontFamily="monospace"
                            >
                              {n.node_id.slice(0, 14)}
                            </text>

                            <rect
                              x={n.x + 100}
                              y={n.y + 7}
                              width="57"
                              height="15"
                              rx="3"
                              fill={badgeBg}
                            />
                            <text
                              x={n.x + 128}
                              y={n.y + 17.5}
                              textAnchor="middle"
                              fill={
                                isNodeOptimized
                                  ? '#6EE7B7'
                                  : progress >= nodeThreshold - 25
                                  ? '#7DD3FC'
                                  : '#FDA4AF'
                              }
                              fontSize="7.5"
                              fontFamily="monospace"
                              fontWeight="700"
                            >
                              {badgeText}
                            </text>

                            {/* Node Name */}
                            <text
                              x={n.x + 10}
                              y={n.y + 34}
                              fill="#94A3B8"
                              fontSize="9.5"
                            >
                              {n.name.slice(0, 23)}
                            </text>

                            {/* Interpolated AS-IS -> TO-BE Metric Label */}
                            <text
                              x={n.x + 10}
                              y={n.y + 50}
                              fill={isNodeOptimized ? '#34D399' : '#FBBF24'}
                              fontSize="8.8"
                              fontFamily="monospace"
                            >
                              {metricLabel.slice(0, 26)}
                            </text>

                            {/* Bottom Node Transformation Bar */}
                            <rect
                              x={n.x + 10}
                              y={n.y + 57}
                              width="145"
                              height="4"
                              rx="2"
                              fill="#1E293B"
                            />
                            <rect
                              x={n.x + 10}
                              y={n.y + 57}
                              width={Math.max(
                                12,
                                Math.round(145 * (progress / 100))
                              )}
                              height="4"
                              rx="2"
                              fill={isNodeOptimized ? '#10B981' : '#38BDF8'}
                            />
                          </g>
                        );
                      })}
                    </svg>
                  </div>

                  {/* Active Stage Narrative & Selected Node Inspection Banner */}
                  <div className="p-4 bg-[#0B0F17] border border-slate-800 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 text-[10px] font-mono font-semibold bg-sky-500/20 text-sky-300 border border-sky-500/40 rounded">
                          STAGE 0{currentStageObj?.stage_number} NARRATIVE
                        </span>
                        <span className="text-xs font-semibold text-white">
                          {currentStageObj?.key_action}
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        {currentStageObj?.narrative}
                      </p>
                    </div>
                    <div className="shrink-0 sm:text-right border-t sm:border-t-0 sm:border-l border-slate-800 pt-2 sm:pt-0 sm:pl-4">
                      <div className="text-[10px] font-mono uppercase text-slate-400">
                        Quantified Stage Impact
                      </div>
                      <div className="text-xs font-mono font-semibold text-emerald-400 mt-0.5">
                        {currentStageObj?.quantified_impact}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right 4 Cols: Gemini AI Diagnosis, Levers & Work Center Load Morphing */}
                <div className="lg:col-span-4 flex flex-col justify-between gap-4">
                  {/* AI Prescriptive Summary & Root-Cause Card */}
                  <div className="bg-[#111827] border border-slate-800 rounded-lg p-5 space-y-4">
                    <div className="pb-3 border-b border-slate-800 flex items-center justify-between">
                      <div>
                        <div className="text-[11px] font-mono text-sky-400 uppercase">
                          Gemini AI Prescriptive Playbook
                        </div>
                        <h3 className="text-sm font-semibold text-white mt-0.5 font-display">
                          Executive Diagnosis &amp; Policy Levers
                        </h3>
                      </div>
                      <Sparkles className="w-4 h-4 text-sky-400 shrink-0" />
                    </div>

                    <div className="space-y-3 text-xs">
                      <div className="p-3 bg-[#0B0F17] border border-slate-800 rounded-md">
                        <div className="text-[10px] font-mono uppercase text-rose-400 font-semibold mb-1">
                          AS-IS Root-Cause Bottleneck
                        </div>
                        <p className="text-slate-300 leading-relaxed">
                          {aiResult.root_cause_diagnosis}
                        </p>
                      </div>

                      <div className="p-3 bg-[#0B0F17] border border-slate-800 rounded-md">
                        <div className="text-[10px] font-mono uppercase text-emerald-400 font-semibold mb-1">
                          TO-BE AI Optimization Strategy
                        </div>
                        <p className="text-slate-300 leading-relaxed">
                          {aiResult.executive_summary}
                        </p>
                      </div>

                      {/* AI Recommended Policy Levers Checklist */}
                      <div className="space-y-1.5 pt-1">
                        <div className="text-[11px] font-semibold text-slate-300">
                          Activated TO-BE Optimization Levers:
                        </div>
                        <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                          <div className="p-2 rounded bg-slate-900 border border-slate-800 flex items-center gap-2 text-emerald-300">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            <span>Campaign Batching</span>
                          </div>
                          <div className="p-2 rounded bg-slate-900 border border-slate-800 flex items-center gap-2 text-emerald-300">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            <span>
                              {aiResult.recommended_levers
                                .authorize_overtime_override
                                ? 'Flex Overtime ON'
                                : 'Standard Shift'}
                            </span>
                          </div>
                          <div className="p-2 rounded bg-slate-900 border border-slate-800 flex items-center gap-2 text-sky-300">
                            <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                            <span>
                              {aiResult.recommended_levers.expedite_air_enabled
                                ? 'Priority Air Charter'
                                : 'Standard Transit'}
                            </span>
                          </div>
                          <div className="p-2 rounded bg-slate-900 border border-slate-800 flex items-center gap-2 text-sky-300">
                            <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                            <span>
                              +{aiResult.recommended_levers.safety_stock_boost_pct}
                              % Buffer ({primaryUom})
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Finite Work Center Load & Setup Morphing Card */}
                  <div className="bg-[#111827] border border-slate-800 rounded-lg p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold text-white uppercase tracking-wider font-mono">
                        Work Center AS-IS → TO-BE Load Shift
                      </h4>
                      <span className="text-[11px] font-mono text-sky-400">
                        {Math.round(progress)}% Morph
                      </span>
                    </div>

                    <div className="space-y-3">
                      {workCenters.map((wc) => {
                        const asIsLoads = asIsPlan.work_center_loads.filter(
                          (l) => l.work_center_id === wc.resource_id
                        );
                        const toBeLoads = toBePlan.work_center_loads.filter(
                          (l) => l.work_center_id === wc.resource_id
                        );

                        const asIsRun = asIsLoads.reduce(
                          (a, b) => a + b.run_hours,
                          0
                        );
                        const toBeRun = toBeLoads.reduce(
                          (a, b) => a + b.run_hours,
                          0
                        );
                        const asIsSetup = asIsLoads.reduce(
                          (a, b) => a + b.setup_hours,
                          0
                        );
                        const toBeSetup = toBeLoads.reduce(
                          (a, b) => a + b.setup_hours,
                          0
                        );
                        const totalCap =
                          asIsLoads.reduce((a, b) => a + b.capacity_hours, 0) ||
                          240;

                        const curRun = asIsRun + (toBeRun - asIsRun) * ratio;
                        const curSetup =
                          asIsSetup + (toBeSetup - asIsSetup) * ratio;
                        const runPct = Math.min(
                          85,
                          Math.round((curRun / totalCap) * 100)
                        );
                        const setupPct = Math.min(
                          25,
                          Math.round((curSetup / totalCap) * 100)
                        );

                        return (
                          <div
                            key={wc.resource_id}
                            className="p-3 bg-[#0B0F17] border border-slate-800 rounded-md space-y-1.5"
                          >
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-medium text-slate-200 truncate">
                                {wc.name}
                              </span>
                              <span className="font-mono text-[11px] text-emerald-400">
                                Setup: {asIsSetup.toFixed(1)}h →{' '}
                                {toBeSetup.toFixed(1)}h
                              </span>
                            </div>

                            {/* Morphing Stacked Bar */}
                            <div className="w-full h-3 bg-slate-900 rounded-full overflow-hidden flex border border-slate-800">
                              <div
                                style={{ width: `${runPct}%` }}
                                className="bg-sky-500 h-full transition-all duration-150"
                                title={`Run Hours: ${curRun.toFixed(1)}h`}
                              />
                              <div
                                style={{ width: `${setupPct}%` }}
                                className="bg-amber-400 h-full transition-all duration-150"
                                title={`Changeover Setup Hours: ${curSetup.toFixed(
                                  1
                                )}h`}
                              />
                            </div>

                            <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                              <span className="text-sky-400">
                                Productive Run: {curRun.toFixed(1)}h
                              </span>
                              <span className="text-amber-400">
                                Changeover: {curSetup.toFixed(1)}h
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* 4. NODE-BY-NODE AS-IS vs TO-BE TRANSFORMATION AUDIT TABLE */}
              <div className="bg-[#111827] border border-slate-800 rounded-lg p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-slate-400">
                      Node-Level Transformation Ledger ({companyName})
                    </div>
                    <h3 className="text-sm font-semibold text-white font-display">
                      AS-IS Disrupted State vs. TO-BE AI-Optimized State Across
                      All Facilities
                    </h3>
                  </div>
                  <span className="text-xs font-mono text-slate-400">
                    Unit Basis: <strong className="text-sky-300">{primaryUom}</strong>
                  </span>
                </div>

                <div className="overflow-x-auto border border-slate-800 rounded-md">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-900/80 text-slate-400">
                        <th className="py-2.5 px-3 font-medium">Facility Node</th>
                        <th className="py-2.5 px-3 font-medium">Echelon</th>
                        <th className="py-2.5 px-3 font-medium">
                          AS-IS State (Before AI)
                        </th>
                        <th className="py-2.5 px-3 font-medium">
                          AI Prescriptive Intervention
                        </th>
                        <th className="py-2.5 px-3 font-medium">
                          TO-BE State (After AI)
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {aiResult.node_transformations.map((nt) => (
                        <tr
                          key={nt.node_id}
                          className="hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="py-2.5 px-3 font-mono text-slate-200 font-semibold">
                            {nt.node_id}
                            <div className="text-[11px] font-sans font-normal text-slate-400">
                              {nt.node_name}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-slate-400">
                            {nt.node_type}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-rose-300">
                            <span className="px-1.5 py-0.5 text-[10px] rounded bg-rose-500/20 border border-rose-500/40 text-rose-300 mr-2">
                              {nt.as_is_status}
                            </span>
                            {nt.as_is_metric_label}
                          </td>
                          <td className="py-2.5 px-3 text-sky-300">
                            {nt.ai_intervention}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-emerald-300">
                            <span className="px-1.5 py-0.5 text-[10px] rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 mr-2">
                              {nt.to_be_status}
                            </span>
                            {nt.to_be_metric_label}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer with Commit TO-BE Action */}
        <div className="px-6 py-4 bg-[#0F1623] border-t border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div className="text-xs text-slate-400 flex items-center gap-2">
            <span>
              Ready to commit the AI-optimized TO-BE schedule to{' '}
              <strong className="text-white">{companyName}</strong>?
            </span>
            {appliedSuccess && (
              <span className="px-2.5 py-1 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono font-semibold flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                TO-BE Plan Committed to Live Workspace!
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-md cursor-pointer"
            >
              Close Visualizer
            </button>
            <button
              type="button"
              disabled={loadingAi || applyingToBe || !aiResult}
              onClick={handleApplyToBe}
              className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 rounded-md transition-colors cursor-pointer"
            >
              <GitMerge className="w-4 h-4" />
              <span>
                {applyingToBe
                  ? 'Committing TO-BE State...'
                  : appliedSuccess
                  ? 'Re-Commit AI TO-BE State to Baseline'
                  : 'Commit AI TO-BE Plan to Active Workspace'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
