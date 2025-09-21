import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAction, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import {
  Scenario,
  ScenarioBrief,
  ScenarioBriefSchema,
  scenarioJsonSchema,
  validateScenario,
} from './schema/Scenario';
import { toast, ToastContainer } from 'react-toastify';

interface BriefFormState {
  title: string;
  description: string;
  domain: ScenarioBrief['domain'] | '';
  language: string;
  numAgents: string;
  timeHorizon: ScenarioBrief['timeHorizon'] | '';
  mustInclude: string;
  avoidContent: string;
}

interface LlmFormState {
  chatModel: string;
  temperature: string;
  top_p: string;
  seed: string;
  maxTokens: string;
}

interface LogEntry {
  id: number;
  level: 'info' | 'error';
  label: string;
  details?: unknown;
  timestamp: number;
}

interface JsonEditorProps {
  value: string;
  onChange(value: string): void;
  schema: unknown;
}

const DEFAULT_BRIEF: BriefFormState = {
  title: '',
  description: '',
  domain: 'town',
  language: 'en',
  numAgents: '10',
  timeHorizon: 'day',
  mustInclude: '',
  avoidContent: '',
};

const DEFAULT_LLM: LlmFormState = {
  chatModel: '',
  temperature: '0.1',
  top_p: '',
  seed: '',
  maxTokens: '',
};

function parseGuardrail(value: string): string[] {
  return value
    .split(/\n|,/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function toNumber(value: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

let monacoLoader: Promise<any> | null = null;

async function loadMonaco(): Promise<any> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Monaco not available on server'));
  }
  const existing = (window as any).monaco;
  if (existing) {
    return existing;
  }
  if (monacoLoader) {
    return monacoLoader;
  }
  monacoLoader = new Promise((resolve, reject) => {
    const loaderUrl = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/loader.js';
    const script = document.createElement('script');
    script.src = loaderUrl;
    script.async = true;
    script.onload = () => {
      const globalRequire = (window as any).require;
      if (!globalRequire) {
        reject(new Error('Monaco loader failed to expose require'));
        return;
      }
      globalRequire.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
      globalRequire(['vs/editor/editor.main'], () => {
        resolve((window as any).monaco);
      });
    };
    script.onerror = () => reject(new Error('Failed to load Monaco editor'));
    document.body.appendChild(script);
  });
  return monacoLoader;
}

function JsonEditor({ value, onChange, schema }: JsonEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<any>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadMonaco()
      .then((monaco) => {
        if (cancelled || !containerRef.current) {
          return;
        }
        monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
          validate: true,
          schemas: [
            {
              uri: 'inmemory://schema/scenario.json',
              fileMatch: ['*'],
              schema,
            },
          ],
        });
        const modelUri = monaco.Uri.parse('inmemory://model/scenario.json');
        const existingModel = monaco.editor.getModel(modelUri);
        const model = existingModel ?? monaco.editor.createModel(value, 'json', modelUri);
        editorRef.current = monaco.editor.create(containerRef.current, {
          model,
          minimap: { enabled: false },
          automaticLayout: true,
          theme: 'vs-dark',
          fontSize: 13,
        });
        const disposable = editorRef.current.onDidChangeModelContent(() => {
          const nextValue = editorRef.current?.getValue();
          if (typeof nextValue === 'string') {
            onChange(nextValue);
          }
        });
        return () => {
          disposable.dispose();
        };
      })
      .catch(() => {
        setFallback(true);
      });
    return () => {
      cancelled = true;
      if (editorRef.current) {
        const currentModel = editorRef.current.getModel?.();
        editorRef.current.dispose();
        if (currentModel && currentModel.getModeId && currentModel.getModeId() === 'json') {
          // keep model for reuse
        }
      }
    };
  }, [onChange, schema]);

  useEffect(() => {
    if (fallback) {
      return;
    }
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    const model = editor.getModel?.();
    if (model && model.getValue() !== value) {
      editor.pushUndoStop();
      model.pushEditOperations(
        [],
        [
          {
            range: model.getFullModelRange(),
            text: value,
          },
        ],
        () => null,
      );
      editor.pushUndoStop();
    }
  }, [value, fallback]);

  if (fallback) {
    return (
      <textarea
        className="h-96 w-full rounded border border-slate-700 bg-slate-950 p-3 font-mono text-sm text-white"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return <div ref={containerRef} className="h-96 w-full rounded border border-slate-700" />;
}

export default function ConfiguratorPage() {
  const [brief, setBrief] = useState<BriefFormState>(DEFAULT_BRIEF);
  const [llm, setLlm] = useState<LlmFormState>(DEFAULT_LLM);
  const [moderationEnabled, setModerationEnabled] = useState(true);
  const [scenarioText, setScenarioText] = useState<string>(() => JSON.stringify({}, null, 2));
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showLogs, setShowLogs] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  const generateScenario = useAction(api.configurator.generateScenario);
  const resetWorld = useMutation(api.configurator.resetWorld);
  const applyScenario = useMutation(api.configurator.applyScenario);
  const exportScenario = useMutation(api.configurator.exportScenario);
  const importScenarioMutation = useMutation(api.configurator.importScenario);

  useEffect(() => {
    document.title = 'AI Town Scenario Configurator';
    return () => {
      document.title = 'AI Town';
    };
  }, []);

  const appendLog = useCallback((entry: Omit<LogEntry, 'id' | 'timestamp'>) => {
    setLogs((previous) => [
      ...previous,
      { id: Date.now() + Math.random(), timestamp: Date.now(), ...entry },
    ]);
  }, []);

  const scenarioStatus = useMemo(() => {
    try {
      const parsed = JSON.parse(scenarioText);
      const validation = validateScenario(parsed);
      if (validation.ok) {
        return { state: 'valid' as const, scenario: validation.data };
      }
      if (validation.repaired) {
        return { state: 'repaired' as const, scenario: validation.repaired, issues: validation.issues };
      }
      return { state: 'invalid' as const, issues: validation.issues };
    } catch (error) {
      return { state: 'parse-error' as const, message: (error as Error).message };
    }
  }, [scenarioText]);

  const updateScenario = useCallback(
    (mutator: (draft: Scenario) => void) => {
      try {
        const parsed = JSON.parse(scenarioText) ?? {};
        const draft: Scenario = JSON.parse(JSON.stringify(parsed));
        mutator(draft);
        setScenarioText(JSON.stringify(draft, null, 2));
      } catch (error) {
        toast.error(`Unable to update scenario JSON: ${(error as Error).message}`);
      }
    },
    [scenarioText],
  );

  const handleBriefChange = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const parsedBrief = ScenarioBriefSchema.parse({
        title: brief.title,
        description: brief.description,
        domain: brief.domain || undefined,
        language: brief.language || undefined,
        numAgents: toNumber(brief.numAgents),
        timeHorizon: brief.timeHorizon || undefined,
        guardrails: {
          mustInclude: parseGuardrail(brief.mustInclude),
          avoidContent: parseGuardrail(brief.avoidContent),
        },
      }) as ScenarioBrief;
      appendLog({ level: 'info', label: 'LLM.generate.request', details: { brief: parsedBrief, llm } });
      const llmArgs = {
        chatModel: llm.chatModel || undefined,
        temperature: toNumber(llm.temperature),
        top_p: toNumber(llm.top_p),
        seed: toNumber(llm.seed),
        maxTokens: toNumber(llm.maxTokens),
      };
      const result = await generateScenario({
        brief: parsedBrief,
        moderationEnabled,
        llm: llmArgs,
      });
      setScenarioText(JSON.stringify(result.scenario, null, 2));
      appendLog({ level: 'info', label: 'LLM.generate.success', details: result.report });
      toast.success('Scenario generated');
    } catch (error) {
      appendLog({ level: 'error', label: 'LLM.generate.error', details: (error as Error).message });
      toast.error((error as Error).message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApply = async () => {
    if (scenarioStatus.state === 'parse-error') {
      toast.error(`Scenario JSON invalid: ${scenarioStatus.message}`);
      return;
    }
    if (scenarioStatus.state === 'invalid') {
      toast.error('Scenario failed validation. Fix errors before applying.');
      return;
    }
    if (scenarioStatus.state === 'repaired') {
      appendLog({
        level: 'info',
        label: 'scenario.repaired',
        details: scenarioStatus.issues?.map((issue) => issue.message ?? issue),
      });
      toast.info('Scenario auto-repaired before apply.');
    }
    const scenario: Scenario =
      scenarioStatus.state === 'valid' ? scenarioStatus.scenario : scenarioStatus.scenario;
    const resetFirst = true;
    setIsApplying(true);
    try {
      appendLog({ level: 'info', label: 'world.reset.request', details: {} });
      const resetResult = await resetWorld({});
      appendLog({ level: 'info', label: 'world.reset.success', details: resetResult });
      const applyResult = await applyScenario({
        scenario,
        worldId: resetResult.worldId,
        resetFirst: false,
      });
      appendLog({ level: 'info', label: 'world.apply.success', details: applyResult });
      toast.success(`Scenario applied as ${applyResult.scenarioName}`);
    } catch (error) {
      appendLog({ level: 'error', label: 'world.apply.error', details: (error as Error).message });
      toast.error((error as Error).message);
    } finally {
      setIsApplying(false);
    }
  };

  const handleExport = async () => {
    try {
      const result = await exportScenario({});
      setScenarioText(JSON.stringify(result.scenario, null, 2));
      appendLog({ level: 'info', label: 'world.export.success', details: result });
      toast.success('Scenario exported from current world');
    } catch (error) {
      appendLog({ level: 'error', label: 'world.export.error', details: (error as Error).message });
      toast.error((error as Error).message);
    }
  };

  const handleImport = async (file: File) => {
    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      const validation = validateScenario(raw);
      if (!validation.ok && !validation.repaired) {
        throw new Error('Scenario JSON failed validation');
      }
      const canonical = validation.ok ? validation.data : validation.repaired!;
      if (!validation.ok) {
        appendLog({
          level: 'info',
          label: 'scenario.repaired',
          details: validation.issues.map((issue) => issue.message),
        });
        toast.info('Scenario auto-repaired before import.');
      }
      appendLog({ level: 'info', label: 'world.import.request', details: { size: file.size } });
      const result = await importScenarioMutation({ scenario: canonical });
      appendLog({ level: 'info', label: 'world.import.success', details: result });
      setScenarioText(JSON.stringify(canonical, null, 2));
      toast.success(`Imported scenario ${result.scenarioName}`);
    } catch (error) {
      appendLog({ level: 'error', label: 'world.import.error', details: (error as Error).message });
      toast.error((error as Error).message);
    }
  };

  const downloadScenario = () => {
    const blob = new Blob([scenarioText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ai-town-scenario.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const baseUrl = (import.meta.env.BASE_URL ?? '/').replace(/\/*$/, '/');

  const metrics = useMemo(() => {
    if (scenarioStatus.state === 'valid' || scenarioStatus.state === 'repaired') {
      return scenarioStatus.scenario.metrics ?? {};
    }
    return {};
  }, [scenarioStatus]);

  const updateMetric = (key: 'trackNetwork' | 'trackMessageStats', value: boolean) => {
    updateScenario((draft) => {
      const metricsDraft = draft.metrics ?? {};
      metricsDraft[key] = value;
      draft.metrics = metricsDraft;
    });
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold">Scenario Configurator</h1>
          <p className="text-sm text-slate-300">
            Provide a brief, generate a canonical scenario, validate JSON, and apply it to the running town.
          </p>
        </header>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <form onSubmit={handleBriefChange} className="rounded border border-slate-800 bg-slate-900 p-4 shadow">
            <h2 className="text-xl font-semibold">Scenario Brief</h2>
            <label className="mt-4 block text-sm font-medium">
              Title
              <input
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2"
                value={brief.title}
                onChange={(event) => setBrief((prev) => ({ ...prev, title: event.target.value }))}
                required
              />
            </label>
            <label className="mt-4 block text-sm font-medium">
              Description
              <textarea
                className="mt-1 h-24 w-full rounded border border-slate-700 bg-slate-950 p-2"
                value={brief.description}
                onChange={(event) => setBrief((prev) => ({ ...prev, description: event.target.value }))}
                required
              />
            </label>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Domain
                <select
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2"
                  value={brief.domain}
                  onChange={(event) =>
                    setBrief((prev) => ({ ...prev, domain: event.target.value as BriefFormState['domain'] }))
                  }
                >
                  <option value="town">Town</option>
                  <option value="campus">Campus</option>
                  <option value="office">Office</option>
                  <option value="hospital">Hospital</option>
                  <option value="market">Market</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              <label className="block text-sm font-medium">
                Language
                <input
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2"
                  value={brief.language}
                  onChange={(event) => setBrief((prev) => ({ ...prev, language: event.target.value }))}
                  placeholder="en"
                />
              </label>
              <label className="block text-sm font-medium">
                Number of Agents
                <input
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2"
                  value={brief.numAgents}
                  onChange={(event) => setBrief((prev) => ({ ...prev, numAgents: event.target.value }))}
                  placeholder="10"
                />
              </label>
              <label className="block text-sm font-medium">
                Time Horizon
                <select
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2"
                  value={brief.timeHorizon}
                  onChange={(event) =>
                    setBrief((prev) => ({ ...prev, timeHorizon: event.target.value as BriefFormState['timeHorizon'] }))
                  }
                >
                  <option value="">Auto</option>
                  <option value="short">Short</option>
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                </select>
              </label>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Must Include (comma or newline separated)
                <textarea
                  className="mt-1 h-20 w-full rounded border border-slate-700 bg-slate-950 p-2"
                  value={brief.mustInclude}
                  onChange={(event) => setBrief((prev) => ({ ...prev, mustInclude: event.target.value }))}
                />
              </label>
              <label className="block text-sm font-medium">
                Must Avoid (comma or newline separated)
                <textarea
                  className="mt-1 h-20 w-full rounded border border-slate-700 bg-slate-950 p-2"
                  value={brief.avoidContent}
                  onChange={(event) => setBrief((prev) => ({ ...prev, avoidContent: event.target.value }))}
                />
              </label>
            </div>
            <button
              type="button"
              className="mt-4 w-full rounded bg-emerald-500 p-2 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-60"
              onClick={handleGenerate}
              disabled={isGenerating}
            >
              {isGenerating ? 'Generating…' : 'Generate Scenario'}
            </button>
            <div className="mt-4 flex items-center justify-between text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={moderationEnabled}
                  onChange={(event) => setModerationEnabled(event.target.checked)}
                />
                Moderation enabled
              </label>
              <button type="button" className="text-xs text-emerald-300" onClick={() => setShowAdvanced((v) => !v)}>
                {showAdvanced ? 'Hide advanced' : 'Show advanced'}
              </button>
            </div>
            {showAdvanced && (
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium uppercase tracking-wide text-slate-300">
                  Chat model
                  <input
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm"
                    value={llm.chatModel}
                    onChange={(event) => setLlm((prev) => ({ ...prev, chatModel: event.target.value }))}
                    placeholder="gpt-4o-mini"
                  />
                </label>
                <label className="block text-xs font-medium uppercase tracking-wide text-slate-300">
                  Temperature
                  <input
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm"
                    value={llm.temperature}
                    onChange={(event) => setLlm((prev) => ({ ...prev, temperature: event.target.value }))}
                    placeholder="0.1"
                  />
                </label>
                <label className="block text-xs font-medium uppercase tracking-wide text-slate-300">
                  top_p
                  <input
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm"
                    value={llm.top_p}
                    onChange={(event) => setLlm((prev) => ({ ...prev, top_p: event.target.value }))}
                    placeholder=""
                  />
                </label>
                <label className="block text-xs font-medium uppercase tracking-wide text-slate-300">
                  Seed
                  <input
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm"
                    value={llm.seed}
                    onChange={(event) => setLlm((prev) => ({ ...prev, seed: event.target.value }))}
                    placeholder=""
                  />
                </label>
                <label className="block text-xs font-medium uppercase tracking-wide text-slate-300">
                  Max tokens
                  <input
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm"
                    value={llm.maxTokens}
                    onChange={(event) => setLlm((prev) => ({ ...prev, maxTokens: event.target.value }))}
                    placeholder=""
                  />
                </label>
              </div>
            )}
          </form>

          <div className="flex flex-col gap-4">
            <div className="rounded border border-slate-800 bg-slate-900 p-4 shadow">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">Scenario JSON</h2>
                <div className="text-xs uppercase tracking-wide text-slate-400">
                  {scenarioStatus.state === 'valid' && 'Valid'}
                  {scenarioStatus.state === 'repaired' && 'Auto-repaired'}
                  {scenarioStatus.state === 'invalid' && 'Invalid'}
                  {scenarioStatus.state === 'parse-error' && 'Parse error'}
                </div>
              </div>
              <JsonEditor value={scenarioText} onChange={setScenarioText} schema={scenarioJsonSchema} />
              {scenarioStatus.state === 'invalid' && (
                <ul className="mt-2 list-disc pl-5 text-xs text-rose-300">
                  {scenarioStatus.issues?.map((issue, index) => (
                    <li key={`${issue.message}-${index}`}>{issue.message}</li>
                  ))}
                </ul>
              )}
              {scenarioStatus.state === 'parse-error' && (
                <p className="mt-2 text-xs text-rose-300">{scenarioStatus.message}</p>
              )}
            </div>
            <div className="rounded border border-slate-800 bg-slate-900 p-4 shadow">
              <h2 className="text-xl font-semibold">Actions</h2>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  className="rounded bg-cyan-500 p-2 text-sm font-semibold text-black hover:bg-cyan-400 disabled:opacity-60"
                  onClick={handleApply}
                  disabled={isApplying}
                >
                  {isApplying ? 'Applying…' : 'Apply & Run'}
                </button>
                <a
                  href={baseUrl}
                  className="rounded border border-slate-600 p-2 text-center text-sm font-semibold text-slate-100 hover:bg-slate-800"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Town
                </a>
                <button
                  className="rounded border border-slate-600 p-2 text-sm font-semibold text-slate-100 hover:bg-slate-800"
                  onClick={downloadScenario}
                >
                  Download JSON
                </button>
                <button
                  className="rounded border border-slate-600 p-2 text-sm font-semibold text-slate-100 hover:bg-slate-800"
                  onClick={handleExport}
                >
                  Export from world
                </button>
                <label className="flex items-center justify-center rounded border border-dashed border-slate-600 p-2 text-sm hover:bg-slate-800">
                  <input
                    type="file"
                    accept="application/json"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        void handleImport(file);
                        event.target.value = '';
                      }
                    }}
                  />
                  Import scenario JSON
                </label>
              </div>
              <div className="mt-4 flex flex-col gap-2 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!metrics.trackNetwork}
                    onChange={(event) => updateMetric('trackNetwork', event.target.checked)}
                  />
                  Track network metrics
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!metrics.trackMessageStats}
                    onChange={(event) => updateMetric('trackMessageStats', event.target.checked)}
                  />
                  Track message statistics
                </label>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded border border-slate-800 bg-slate-900 p-4 shadow">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Developer Console</h2>
            <button className="text-xs text-emerald-300" onClick={() => setShowLogs((v) => !v)}>
              {showLogs ? 'Hide' : 'Show'}
            </button>
          </div>
          {showLogs && (
            <div className="mt-3 max-h-64 overflow-auto rounded border border-slate-800 bg-slate-950 p-3 text-xs">
              {logs.length === 0 && <p className="text-slate-400">No events yet.</p>}
              {logs.map((entry) => (
                <div key={entry.id} className="mb-2">
                  <div className="flex justify-between font-mono">
                    <span className={entry.level === 'error' ? 'text-rose-300' : 'text-emerald-300'}>
                      {entry.label}
                    </span>
                    <span className="text-slate-500">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                  </div>
                  {entry.details && (
                    <pre className="mt-1 whitespace-pre-wrap break-all text-slate-300">
                      {JSON.stringify(entry.details, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <ToastContainer position="bottom-right" autoClose={2500} theme="dark" />
    </main>
  );
}
