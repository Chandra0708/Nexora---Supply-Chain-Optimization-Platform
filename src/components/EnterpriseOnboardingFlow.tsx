import React, { useState, useRef } from 'react';
import {
  Building2,
  Mail,
  UserCheck,
  ArrowRight,
  Upload,
  FileJson,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  AlertTriangle,
  Play,
  Layers,
  ShieldCheck,
  Database,
  LogOut,
  RotateCcw,
} from 'lucide-react';
import { SupplyChainFixturePayload, UserSession } from '../types/ibp.ts';
import {
  generateBlankCsvTemplateBundle,
  generateBlankJsonTemplate,
  parseCsvIntoPayload,
  SchemaValidationReport,
  validateSupplyChainPayload,
} from '../utils/supplyChainValidator.ts';

interface EnterpriseOnboardingFlowProps {
  userSession: UserSession | null;
  actionBusy: boolean;
  onLogin: (
    companyName: string,
    workEmail: string,
    role: 'Supply Chain Planner' | 'Operations Lead'
  ) => Promise<void>;
  onLogout: () => Promise<void>;
  onLaunchDigitalTwin: (payload: SupplyChainFixturePayload) => Promise<void>;
}

export const EnterpriseOnboardingFlow: React.FC<
  EnterpriseOnboardingFlowProps
> = ({
  userSession,
  actionBusy,
  onLogin,
  onLogout,
  onLaunchDigitalTwin,
}) => {
  // Stage 1: Login Form State
  const [companyInput, setCompanyInput] = useState<string>(
    'AstraBio Cold-Chain Therapeutics'
  );
  const [emailInput, setEmailInput] = useState<string>(
    's.planner@astrabio-global.io'
  );
  const [roleInput, setRoleInput] = useState<
    'Supply Chain Planner' | 'Operations Lead'
  >('Supply Chain Planner');

  // Stage 2: Onboarding & File Ingestion State
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [stagedPayload, setStagedPayload] =
    useState<SupplyChainFixturePayload | null>(null);
  const [uploadedFileNames, setUploadedFileNames] = useState<string[]>([]);
  const [validationReport, setValidationReport] =
    useState<SchemaValidationReport | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [loadingDemo, setLoadingDemo] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyInput.trim() || !emailInput.trim()) return;
    setStagedPayload(null);
    setValidationReport(null);
    setUploadedFileNames([]);
    setParseError(null);
    await onLogin(companyInput.trim(), emailInput.trim(), roleInput);
  };

  const processFiles = async (fileList: FileList | File[]) => {
    setParseError(null);
    const files = Array.from(fileList);
    if (files.length === 0) return;

    let workingPayload: SupplyChainFixturePayload = stagedPayload
      ? { ...stagedPayload }
      : {
          company_name:
            userSession?.company_name || companyInput || 'Enterprise Supply Network',
        };
    const newNames = [...uploadedFileNames];

    try {
      for (const file of files) {
        const text = await file.text();
        if (!newNames.includes(file.name)) {
          newNames.push(file.name);
        }

        if (file.name.toLowerCase().endsWith('.json')) {
          const parsedJson = JSON.parse(text) as SupplyChainFixturePayload;
          workingPayload = {
            ...workingPayload,
            ...parsedJson,
            company_name:
              parsedJson.company_name ||
              userSession?.company_name ||
              workingPayload.company_name,
          };
        } else if (file.name.toLowerCase().endsWith('.csv')) {
          workingPayload = parseCsvIntoPayload(
            file.name,
            text,
            workingPayload
          );
        } else {
          throw new Error(
            `Unsupported file format '${file.name}'. Please upload .json or .csv files.`
          );
        }
      }

      setUploadedFileNames(newNames);
      setStagedPayload(workingPayload);
      const report = validateSupplyChainPayload(workingPayload);
      setValidationReport(report);
    } catch (err) {
      setParseError(
        err instanceof Error
          ? err.message
          : 'Failed to parse uploaded file. Check JSON/CSV syntax.'
      );
    }
  };

  const handleDownloadJsonTemplate = () => {
    const content = generateBlankJsonTemplate(
      userSession?.company_name || companyInput
    );
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'supply_chain_test_fixture.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadCsvTemplate = () => {
    const content = generateBlankCsvTemplateBundle();
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nexora_csv_bundle_template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleLoadDemoSandbox = async (overrideCompany?: string) => {
    setLoadingDemo(true);
    setParseError(null);
    try {
      const targetCompany =
        overrideCompany ||
        userSession?.company_name ||
        companyInput ||
        'AstraBio Cold-Chain Therapeutics';
      const res = await fetch(
        `/api/v1/demo-fixture?company=${encodeURIComponent(targetCompany)}`
      );
      const demoFixture: SupplyChainFixturePayload = await res.json();
      const customizedFixture: SupplyChainFixturePayload = {
        ...demoFixture,
        company_name: targetCompany,
      };
      const slug = targetCompany
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
      setUploadedFileNames([`${slug}_fixture.json (Industry Sandbox)`]);
      setStagedPayload(customizedFixture);
      const report = validateSupplyChainPayload(customizedFixture);
      setValidationReport(report);
    } catch (err) {
      setParseError(
        err instanceof Error ? err.message : 'Failed to load demo sandbox.'
      );
    } finally {
      setLoadingDemo(false);
    }
  };

  const handleClearStagedFiles = () => {
    setStagedPayload(null);
    setValidationReport(null);
    setUploadedFileNames([]);
    setParseError(null);
  };

  // ==========================================================================
  // VIEW 1: ENTERPRISE AUTHENTICATION & WORKSPACE GATEWAY
  // ==========================================================================
  if (!userSession) {
    return (
      <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col justify-between">
        {/* Top Minimal Brand Header */}
        <header className="flex items-center justify-between px-8 py-4 border-b border-slate-800/80 bg-[#0F1623]">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold tracking-tight text-white font-display">
              Nexora
            </span>
            <span className="text-xs text-slate-400 border-l border-slate-800 pl-3">
              Concurrent Supply Chain Planning & Finite Execution Platform
            </span>
          </div>
          <div className="text-xs font-mono text-slate-400">
            Engine Architecture: Kinaxis DAG · o9 EKG · OMP Finite MILP
          </div>
        </header>

        {/* Centered Login & Workspace Gateway */}
        <main className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="max-w-4xl w-full grid grid-cols-1 lg:grid-cols-12 bg-[#111827] border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
            {/* Left 5 Cols: Architecture & Clean-State Guarantee */}
            <div className="lg:col-span-5 bg-[#0F1623] p-8 border-b lg:border-b-0 lg:border-r border-slate-800 flex flex-col justify-between">
              <div className="space-y-6">
                <div>
                  <div className="text-xs font-mono uppercase tracking-wider text-sky-400">
                    Enterprise Tenant Gateway
                  </div>
                  <h1 className="text-2xl font-bold text-white mt-2 font-display leading-snug">
                    Initialize Your Supply Chain Digital Twin
                  </h1>
                  <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                    Authenticate your organization workspace to provision an
                    isolated, clean in-memory planning graph. Upload your own
                    JSON or CSV master tables to run concurrent pegging and
                    finite MILP scheduling.
                  </p>
                </div>

                <div className="space-y-3 pt-2">
                  <div className="p-3 bg-[#111827] border border-slate-800/90 rounded-lg">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                      <Database className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      <span>Clean-Slate Engine Initialization</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                      Every tenant session starts with 0 hardcoded facilities or
                      SKUs. Your graph is constructed strictly from your
                      validated schema upload.
                    </p>
                  </div>

                  <div className="p-3 bg-[#111827] border border-slate-800/90 rounded-lg">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>Strict Client-Side Schema Validation</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                      Automated foreign-key checks (BOM to Item Master, Open POs
                      to Facilities) and numeric boundary verification prior to
                      solver execution.
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-slate-800/80 text-[11px] text-slate-500">
                Quick-Fill Organization Presets (Each with Domain-Specific Units &amp; BOM):
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[
                    {
                      company: 'AstraBio Cold-Chain Therapeutics',
                      email: 's.planner@astrabio-global.io',
                      role: 'Supply Chain Planner' as const,
                      uom: 'blister packs · vials',
                    },
                    {
                      company: 'Nordic Semiconductor Foundry',
                      email: 'ops.lead@nordicsemi.eu',
                      role: 'Operations Lead' as const,
                      uom: 'wafers · dies',
                    },
                    {
                      company: 'VoltEdge EV Battery Systems',
                      email: 'planner@voltedge-gigafab.io',
                      role: 'Supply Chain Planner' as const,
                      uom: 'kWh packs · modules',
                    },
                  ].map((preset) => (
                    <button
                      key={preset.company}
                      type="button"
                      onClick={() => {
                        setCompanyInput(preset.company);
                        setEmailInput(preset.email);
                        setRoleInput(preset.role);
                      }}
                      className="px-2.5 py-1.5 text-left text-[11px] bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700/80 rounded transition-colors cursor-pointer"
                    >
                      <div className="font-semibold text-white">
                        {preset.company}
                      </div>
                      <div className="text-[10px] font-mono text-sky-400">
                        Units: {preset.uom}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Right 7 Cols: Authentication Form */}
            <div className="lg:col-span-7 p-8 flex flex-col justify-center">
              <div className="mb-6">
                <h2 className="text-lg font-bold text-white font-display">
                  Sign In to Enterprise Planning Workspace
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Enter your organization details and operational role to launch
                  a clean planning session.
                </p>
              </div>

              <form onSubmit={handleLoginSubmit} className="space-y-5">
                <div>
                  <label
                    htmlFor="login-company"
                    className="block text-xs font-medium text-slate-300 mb-1.5"
                  >
                    Company / Organization Name
                  </label>
                  <div className="relative">
                    <Building2 className="w-4 h-4 text-slate-500 absolute left-3.5 top-2.5" />
                    <input
                      id="login-company"
                      type="text"
                      required
                      value={companyInput}
                      onChange={(e) => setCompanyInput(e.target.value)}
                      placeholder="e.g., Acme Global Manufacturing"
                      className="w-full bg-[#0B0F17] border border-slate-700 focus:border-sky-400 rounded-md pl-10 pr-3.5 py-2 text-sm text-white outline-none transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="login-email"
                    className="block text-xs font-medium text-slate-300 mb-1.5"
                  >
                    Work Email Address
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-2.5" />
                    <input
                      id="login-email"
                      type="email"
                      required
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="planner@company.com"
                      className="w-full bg-[#0B0F17] border border-slate-700 focus:border-sky-400 rounded-md pl-10 pr-3.5 py-2 text-sm text-white outline-none transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Operational Planning Role
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(
                      [
                        {
                          role: 'Supply Chain Planner',
                          desc: 'S&OP consensus demand, multi-tier BOM pegging & scenario simulation',
                        },
                        {
                          role: 'Operations Lead',
                          desc: 'Finite plant scheduling, sequence changeover & exception resolution',
                        },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.role}
                        type="button"
                        onClick={() => setRoleInput(opt.role)}
                        className={`text-left p-3.5 rounded-lg border transition-colors cursor-pointer ${
                          roleInput === opt.role
                            ? 'bg-sky-500/10 border-sky-400 text-white'
                            : 'bg-[#0B0F17] border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold">
                            {opt.role}
                          </span>
                          <UserCheck
                            className={`w-3.5 h-3.5 ${
                              roleInput === opt.role
                                ? 'text-sky-400'
                                : 'text-slate-600'
                            }`}
                          />
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                          {opt.desc}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={actionBusy}
                    className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 disabled:opacity-50 rounded-md transition-colors cursor-pointer"
                  >
                    <span>
                      {actionBusy
                        ? 'Initializing Clean Workspace...'
                        : 'Initialize Clean Workspace & Continue to Data Ingestion'}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </form>
            </div>
          </div>
        </main>

        <footer className="px-8 py-4 border-t border-slate-800/80 bg-[#0F1623] text-xs text-slate-500 flex items-center justify-between">
          <span>Nexora Enterprise Planning Suite</span>
          <span>Zero Hardcoded Default State · Schema-Validated Ingestion</span>
        </footer>
      </div>
    );
  }

  // ==========================================================================
  // VIEW 2: ONBOARDING & DATA INGESTION SCREEN (First Action After Login)
  // ==========================================================================
  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col">
      {/* Top Session Bar */}
      <header className="flex items-center justify-between gap-6 px-8 py-4 border-b border-slate-800 bg-[#0F1623]">
        <div className="flex items-center gap-4">
          <span className="text-lg font-bold tracking-tight text-white font-display">
            Nexora
          </span>
          <span className="text-xs text-slate-400 border-l border-slate-800 pl-4">
            Workspace:{' '}
            <strong className="text-white font-semibold">
              {userSession.company_name}
            </strong>
          </span>
          <span className="text-xs text-slate-400 hidden sm:inline">
            · {userSession.work_email} ({userSession.role})
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 rounded">
            Engine State: CLEAN / AWAITING MODEL INGESTION
          </span>
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-md transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5 text-slate-400" />
            <span>Switch Workspace</span>
          </button>
        </div>
      </header>

      {/* Main Onboarding Content */}
      <main className="flex-1 max-w-[1360px] w-full mx-auto px-8 py-8 space-y-6">
        {/* Header & Template Downloads */}
        <section className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-800">
          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-sky-400">
              Step 1 of 2 · Enterprise Data Ingestion & Schema Validation
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white mt-1 font-display">
              Import Supply Chain Model for {userSession.company_name}
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Your workspace is initialized in a clean state (0 Facilities, 0
              Items, 0 Assembly Lines). Upload your structured JSON fixture or
              CSV tables below to validate and construct the in-memory Digital
              Twin.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleDownloadJsonTemplate}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-md transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-sky-400" />
              <span>Download Blank JSON Template</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadCsvTemplate}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-md transition-colors cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              <span>Download Blank CSV Template</span>
            </button>
            <button
              type="button"
              disabled={loadingDemo || actionBusy}
              onClick={() => handleLoadDemoSandbox()}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-md transition-colors cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              <span>
                {loadingDemo
                  ? 'Loading Sandbox...'
                  : `Load ${userSession.company_name.split(' ')[0]} Sandbox`}
              </span>
            </button>
          </div>
        </section>

        {/* Quick Multi-Company Industry Dataset Selector */}
        <section className="p-3.5 bg-[#111827] border border-slate-800 rounded-lg flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="text-slate-300">
            <span className="font-semibold text-white">
              Industry Reference Models (With Authentic Units, BOMs &amp; Work Centers):
            </span>{' '}
            Load your organization&apos;s domain model or test another industry dataset:
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[
              {
                name: 'AstraBio Cold-Chain Therapeutics',
                badge: 'Biologics (blister packs / vials)',
              },
              {
                name: 'Nordic Semiconductor Foundry',
                badge: 'Semiconductor (wafers / dies)',
              },
              {
                name: 'VoltEdge EV Battery Systems',
                badge: 'EV Gigafactory (kWh packs / modules)',
              },
            ].map((ind) => (
              <button
                key={ind.name}
                type="button"
                disabled={loadingDemo || actionBusy}
                onClick={() => handleLoadDemoSandbox(ind.name)}
                className={`px-3 py-1.5 rounded border text-[11px] font-medium transition-colors cursor-pointer ${
                  stagedPayload?.company_name === ind.name
                    ? 'bg-sky-500/20 border-sky-400 text-sky-300'
                    : 'bg-[#0B0F17] border-slate-800 hover:border-slate-700 text-slate-300'
                }`}
              >
                {ind.badge}
              </button>
            ))}
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left 6 Cols: Drag-and-Drop Ingestion Zone */}
          <div className="lg:col-span-6 bg-[#111827] border border-slate-800 rounded-lg p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-white font-display">
                  Drag & Drop Supply Chain Schema Files
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Supports full-network JSON (
                  <code className="text-sky-300 font-mono">
                    supply_chain_test_fixture.json
                  </code>
                  ) or multi-file CSV bundles.
                </p>
              </div>
              {uploadedFileNames.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearStagedFiles}
                  className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Clear Staged</span>
                </button>
              )}
            </div>

            {/* Dropzone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  processFiles(e.dataTransfer.files);
                }
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
                dragActive
                  ? 'border-sky-400 bg-sky-500/10'
                  : 'border-slate-700 hover:border-slate-500 bg-[#0B0F17]'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".json,.csv"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    processFiles(e.target.files);
                  }
                }}
              />
              <Upload className="w-9 h-9 text-sky-400 mx-auto mb-3" />
              <div className="text-sm font-semibold text-white">
                Drop JSON fixture or CSV bundle files here, or click to browse
              </div>
              <p className="text-xs text-slate-400 mt-1.5 max-w-md mx-auto">
                Upload a single structured{' '}
                <span className="text-slate-200 font-mono">.json</span> file or
                drop multiple{' '}
                <span className="text-slate-200 font-mono">.csv</span> tables
                (Facilities, Items, Multi-Tier BOM, Work Centers, Inventory,
                Open POs, Demand Orders).
              </p>

              <div className="flex items-center justify-center gap-4 mt-5 text-xs text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <FileJson className="w-3.5 h-3.5 text-sky-400" />
                  <span>Full Network JSON</span>
                </span>
                <span>·</span>
                <span className="inline-flex items-center gap-1.5">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Multi-Table CSV Bundle</span>
                </span>
              </div>
            </div>

            {parseError && (
              <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-md flex items-start gap-2.5 text-xs text-rose-300">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">File Parsing Error</div>
                  <div className="mt-0.5">{parseError}</div>
                </div>
              </div>
            )}

            {/* Supported CSV / JSON Schema Entities Reference */}
            <div className="space-y-2.5 pt-2 border-t border-slate-800">
              <div className="text-xs font-medium text-slate-300">
                Supported Schema Tables & Required Domain Constraints:
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <div className="p-2.5 bg-[#0B0F17] border border-slate-800/90 rounded">
                  <div className="font-mono text-sky-400 font-semibold">
                    1. Facilities / Nodes
                  </div>
                  <div className="text-slate-400 text-[11px] mt-0.5">
                    SUPPLIER, PLANT, DISTRIBUTION_CENTER, CUSTOMER with storage
                    & currency.
                  </div>
                </div>
                <div className="p-2.5 bg-[#0B0F17] border border-slate-800/90 rounded">
                  <div className="font-mono text-sky-400 font-semibold">
                    2. Item Master & Multi-Tier BOM
                  </div>
                  <div className="text-slate-400 text-[11px] mt-0.5">
                    RAW_MATERIAL, SUB_ASSEMBLY, FINISHED_GOOD (`unit_cost &gt;=
                    0`, `lead_time &gt;= 0`).
                  </div>
                </div>
                <div className="p-2.5 bg-[#0B0F17] border border-slate-800/90 rounded">
                  <div className="font-mono text-sky-400 font-semibold">
                    3. Line Capacities & Changeovers
                  </div>
                  <div className="text-slate-400 text-[11px] mt-0.5">
                    Finite shift hours (`capacity_hours &gt; 0`), run rates &
                    sequence setup matrix.
                  </div>
                </div>
                <div className="p-2.5 bg-[#0B0F17] border border-slate-800/90 rounded">
                  <div className="font-mono text-sky-400 font-semibold">
                    4. Inventory, Open POs & Demands
                  </div>
                  <div className="text-slate-400 text-[11px] mt-0.5">
                    Starting stock, in-transit POs (FK to Facilities) & customer
                    demand orders.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right 6 Cols: Client-Side Schema Validation & Preview Summary Card */}
          <div className="lg:col-span-6 bg-[#111827] border border-slate-800 rounded-lg p-6 space-y-5">
            <div>
              <h2 className="text-base font-semibold text-white font-display">
                Schema Validation & Digital Twin Preview
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Client-side foreign key integrity & numeric boundary audit prior
                to DAG construction.
              </p>
            </div>

            {!validationReport || !stagedPayload ? (
              <div className="p-10 bg-[#0B0F17] border border-slate-800/90 rounded-lg text-center space-y-3">
                <Database className="w-8 h-8 text-slate-600 mx-auto" />
                <div className="text-sm font-medium text-slate-300">
                  No Supply Chain Model Staged Yet
                </div>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Upload a JSON/CSV file on the left, or click{' '}
                  <strong className="text-amber-300">Load Demo Sandbox</strong>{' '}
                  above to run the client-side schema validator and preview your
                  network topology.
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                {/* Preview Summary Card required by specification */}
                <div
                  className={`p-5 rounded-lg border ${
                    validationReport.isValid
                      ? 'bg-emerald-500/10 border-emerald-500/40'
                      : 'bg-rose-500/10 border-rose-500/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        {validationReport.isValid ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                        )}
                        <span
                          className={`text-xs font-mono uppercase tracking-wider font-semibold ${
                            validationReport.isValid
                              ? 'text-emerald-300'
                              : 'text-rose-300'
                          }`}
                        >
                          {validationReport.isValid
                            ? 'Schema Validation Passed · Ready to Launch'
                            : 'Schema Validation Failed · Fix Errors Below'}
                        </span>
                      </div>
                      <h3 className="text-lg font-bold text-white mt-2 font-display">
                        Detected {validationReport.summary.facilitiesCount}{' '}
                        Facilities, {validationReport.summary.itemsCount} Items,{' '}
                        {validationReport.summary.assemblyLinesCount} Assembly
                        Lines, {validationReport.summary.totalOpenOrdersCount}{' '}
                        Open Orders
                      </h3>
                      <p className="text-xs text-slate-300 mt-1">
                        Ingested from:{' '}
                        <span className="font-mono text-slate-200">
                          {uploadedFileNames.join(', ')}
                        </span>
                      </p>
                    </div>
                  </div>

                  {/* Breakdown KPIs */}
                  <div className="grid grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-800/80">
                    <div>
                      <div className="text-[11px] text-slate-400">
                        Facilities
                      </div>
                      <div className="text-base font-bold font-mono tabular-nums text-white">
                        {validationReport.summary.facilitiesCount}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {validationReport.summary.plantsCount} Plant ·{' '}
                        {validationReport.summary.dcsCount} DC ·{' '}
                        {validationReport.summary.suppliersCount} Sup
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">
                        Items & BOM
                      </div>
                      <div className="text-base font-bold font-mono tabular-nums text-white">
                        {validationReport.summary.itemsCount}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {validationReport.summary.finishedGoodsCount} FG ·{' '}
                        {validationReport.summary.bomEdgesCount} BOM Links
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">
                        Assembly Lines
                      </div>
                      <div className="text-base font-bold font-mono tabular-nums text-white">
                        {validationReport.summary.assemblyLinesCount}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Finite MILP Resources
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">
                        Open Orders
                      </div>
                      <div className="text-base font-bold font-mono tabular-nums text-white">
                        {validationReport.summary.totalOpenOrdersCount}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {validationReport.summary.openPosCount} POs ·{' '}
                        {validationReport.summary.demandOrdersCount} Demands
                      </div>
                    </div>
                  </div>

                  {/* Launch Digital Twin & Optimize CTA */}
                  <div className="mt-5">
                    <button
                      type="button"
                      disabled={!validationReport.isValid || actionBusy}
                      onClick={() => onLaunchDigitalTwin(stagedPayload)}
                      className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 disabled:opacity-40 rounded-md transition-colors cursor-pointer"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      <span>
                        {actionBusy
                          ? 'Constructing DAG & Solving Finite MILP...'
                          : 'Launch Digital Twin & Optimize'}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Detailed Validation Audit Trail */}
                <div className="space-y-2.5">
                  <div className="text-xs font-medium text-slate-300">
                    Client-Side Integrity & Constraint Verification Audit:
                  </div>
                  <div className="divide-y divide-slate-800 border border-slate-800 rounded-md bg-[#0B0F17]">
                    {validationReport.checks.map((chk) => (
                      <div
                        key={chk.id}
                        className="p-3 flex items-start justify-between gap-3 text-xs"
                      >
                        <div className="flex items-start gap-2.5">
                          {chk.passed ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                          )}
                          <div>
                            <div className="font-medium text-slate-200">
                              {chk.title}
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              {chk.detail}
                            </div>
                          </div>
                        </div>
                        <span
                          className={`font-mono text-[10px] px-2 py-0.5 rounded shrink-0 ${
                            chk.passed
                              ? 'text-emerald-300 bg-emerald-500/10'
                              : 'text-rose-300 bg-rose-500/10'
                          }`}
                        >
                          {chk.passed ? 'PASSED' : 'FAILED'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Specific Validation Errors List if any */}
                {validationReport.errors.length > 0 && (
                  <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-md space-y-1.5 text-xs text-rose-300">
                    <div className="font-semibold">
                      Schema Violations Detected ({validationReport.errors.length}
                      ):
                    </div>
                    <ul className="list-disc list-inside space-y-1 text-[11px]">
                      {validationReport.errors.slice(0, 8).map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};
