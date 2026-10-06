// components/collab/AgentWorkshop.tsx
// Mission agents: editor, capability-checked test runner, run inspector,
// honest packaging/deploy status. No LLM calls; runs are tool-bounded.

import React, { useState } from 'react';
import {
  confirmDeploy,
  createAgent,
  deployAgent,
  getAgent,
  getAgentRuns,
  listAgents,
  listEvidence,
  packageAgent,
  patchAgent,
  runAgent,
  testAgent,
  type Agent,
  type AgentTestCase,
  type Health,
} from '../../services/collabService';
import {
  Badge,
  Btn,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Modal,
  SectionTitle,
  Select,
  TextArea,
  TextInput,
  cx,
  fmtDate,
  useCollab,
} from './ui';

const ALLOWED_TOOLS = ['evidence.read', 'evidence.write', 'hrm.simulate'];

const RUN_TONES: Record<'ok' | 'denied' | 'error', 'green' | 'red' | 'red'> = {
  ok: 'green',
  denied: 'red',
  error: 'red',
};

const DEPLOY_TONES: Record<string, 'slate' | 'amber' | 'green'> = {
  'not-deployed': 'slate',
  packaged: 'amber',
  deployed: 'green',
};

export default function AgentWorkshop({ missionId, health }: { missionId: string; health: Health | null }) {
  const agents = useCollab(() => listAgents(missionId), [missionId]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  if (agents.loading) return <LoadingState label="Loading agents…" />;
  if (agents.error) return <ErrorState message={agents.error} onRetry={agents.reload} />;

  const list = agents.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Agent workshop</h2>
          <p className="text-sm text-slate-600">
            Mission-scoped agents with explicit tool permissions. Runs are tool-bounded (no LLM calls in v1);
            every denial is recorded. User-authored code execution is unavailable — editing and export are supported.
          </p>
        </div>
        <Btn variant="primary" onClick={() => setShowCreate(true)}>
          + New agent
        </Btn>
      </div>

      {list.length === 0 ? (
        <EmptyState
          title="No agents yet"
          hint="Create a bounded agent — for example, one that may only read evidence — then test its capabilities before trusting it."
        >
          <Btn variant="primary" onClick={() => setShowCreate(true)}>
            + New agent
          </Btn>
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setSelectedId(a.id)}
              className={cx(
                'rounded-xl border bg-white p-4 text-left shadow-sm transition-colors',
                selectedId === a.id ? 'border-slate-800 ring-1 ring-slate-800' : 'border-stone-200 hover:border-stone-400',
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={DEPLOY_TONES[a.deployment.status] ?? 'slate'}>{a.deployment.status}</Badge>
                <span className="text-xs text-slate-600">v{a.version}</span>
              </div>
              <p className="mt-2 font-semibold text-slate-900">{a.name}</p>
              <p className="mt-1 line-clamp-2 text-sm text-slate-600">{a.purpose}</p>
              <p className="mt-2 text-xs text-slate-600">
                Tools: {a.allowedTools.join(', ') || 'none'} · {a.runs.length} runs
              </p>
            </button>
          ))}
        </div>
      )}

      {selectedId && (
        <AgentDetail
          agentId={selectedId}
          missionId={missionId}
          health={health}
          onClose={() => setSelectedId(null)}
          onChanged={agents.reload}
        />
      )}

      {showCreate && (
        <AgentFormModal
          missionId={missionId}
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            agents.reload();
          }}
        />
      )}
    </div>
  );
}

function AgentDetail({
  agentId,
  missionId,
  health,
  onClose,
  onChanged,
}: {
  agentId: string;
  missionId: string;
  health: Health | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const detail = useCollab(() => getAgent(agentId), [agentId]);
  const runs = useCollab(() => getAgentRuns(agentId), [agentId]);
  const evidence = useCollab(() => listEvidence(missionId), [missionId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [runTool, setRunTool] = useState('evidence.read');
  const [runInput, setRunInput] = useState('');
  const [authorizeExternal, setAuthorizeExternal] = useState(false);
  const [deployUrl, setDeployUrl] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      detail.reload();
      runs.reload();
      onChanged();
      after?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  if (detail.loading) return <LoadingState label="Loading agent…" />;
  if (detail.error) return <ErrorState message={detail.error} onRetry={detail.reload} />;
  const a = detail.data;
  if (!a) return <EmptyState title="Agent not found" />;

  const doRun = () =>
    act(() => runAgent(a.id, { tool: runTool, input: runInput.trim(), authorizeExternal }));

  const doTest = async () => {
    setBusy(true);
    setError(null);
    setTestResult(null);
    try {
      const r = await testAgent(a.id);
      setTestResult(r.ok ? 'Test run completed — see run history below.' : 'Test run reported problems — see run history.');
      runs.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Test run failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={DEPLOY_TONES[a.deployment.status] ?? 'slate'}>{a.deployment.status}</Badge>
              <span className="text-xs text-slate-600">v{a.version} · updated {fmtDate(a.updatedAt)}</span>
            </div>
            <h3 className="mt-1 text-lg font-bold text-slate-900">{a.name}</h3>
            <p className="text-sm text-slate-600">{a.purpose}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn variant="ghost" onClick={() => setShowEdit(true)} disabled={busy}>Edit</Btn>
            <Btn variant="subtle" onClick={onClose}>Close</Btn>
          </div>
        </div>

        {error && <ErrorState message={error} />}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 text-sm">
            <SectionTitle>Capabilities</SectionTitle>
            <p className="text-slate-800"><span className="font-semibold">Allowed tools:</span> {a.allowedTools.join(', ') || 'none'}</p>
            <p className="text-slate-800">
              <span className="font-semibold">Permissions:</span> read {a.permissions.read ? '✓' : '✗'} · write{' '}
              {a.permissions.write ? '✓' : '✗'} · execute {a.permissions.execute ? '✓' : '✗'}
            </p>
            <p className="text-slate-800">
              <span className="font-semibold">Allowed sources:</span>{' '}
              {a.allowedSources.length > 0 ? a.allowedSources.join(', ') : 'none (reads denied)'}
            </p>
            <p className="text-slate-800">
              <span className="font-semibold">Model:</span> {a.model.provider}
              {a.model.model ? ` · ${a.model.model}` : ''} (tool-bounded runs; no LLM calls in v1)
            </p>
            <p className="text-slate-800">
              <span className="font-semibold">Limits:</span> {a.limits.maxRuntimeMs} ms max runtime
              {a.limits.maxSpend ? ` · max spend ${a.limits.maxSpend}` : ''}
            </p>
          </div>
          <div>
            <SectionTitle className="mb-1">Instructions</SectionTitle>
            <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-stone-50 p-3 text-sm text-slate-800">
              {a.instructions || '—'}
            </p>
          </div>
        </div>

        {/* Test cases */}
        <div className="rounded-lg border border-stone-200 p-3">
          <div className="flex items-center justify-between">
            <SectionTitle>Test cases ({a.testCases.length})</SectionTitle>
            <Btn variant="ghost" onClick={doTest} disabled={busy}>
              {busy ? 'Running…' : 'Run tests'}
            </Btn>
          </div>
          {testResult && <p className="mt-1 text-sm text-slate-700">{testResult}</p>}
          {a.testCases.length === 0 ? (
            <p className="mt-1 text-sm text-slate-600">No test cases defined. Add them in the editor.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {a.testCases.map((t, i) => (
                <li key={i} className="rounded-lg bg-stone-50 px-3 py-2 text-sm">
                  <span className="font-medium text-slate-900">{t.name}</span>
                  <span className="block text-xs text-slate-600">input: {t.input}</span>
                  <span className="block text-xs text-slate-600">expected: {t.expected}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Run a tool */}
        <div className="rounded-lg border border-stone-200 p-3">
          <SectionTitle className="mb-2">Run a tool</SectionTitle>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Tool">
              <Select value={runTool} onChange={(e) => setRunTool(e.target.value)} className="w-44">
                {ALLOWED_TOOLS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <Field label="Input">
              <TextInput value={runInput} onChange={(e) => setRunInput(e.target.value)} placeholder="evidence id, query, or params" className="w-64" />
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-800">
              <input type="checkbox" checked={authorizeExternal} onChange={(e) => setAuthorizeExternal(e.target.checked)} className="h-4 w-4 accent-slate-800" />
              Authorize external write
            </label>
            <Btn variant="primary" onClick={doRun} disabled={busy || !runInput.trim()}>
              {busy ? 'Running…' : 'Run'}
            </Btn>
          </div>
          {runTool === 'hrm.simulate' && !health?.hrm && (
            <p className="mt-2 text-sm text-slate-600">
              <Badge tone="slate">HRM unavailable</Badge> <span className="ml-1">This run will be denied or fail honestly — the engine is not reachable.</span>
            </p>
          )}
          <p className="mt-2 text-xs text-slate-600">
            Capability checks run at the tool boundary; denials are recorded below with reasons.
          </p>
        </div>

        {/* Run history */}
        <div>
          <SectionTitle className="mb-2">Run history ({runs.data?.length ?? 0})</SectionTitle>
          {runs.loading ? (
            <p className="text-sm text-slate-600">Loading…</p>
          ) : !runs.data || runs.data.length === 0 ? (
            <p className="text-sm text-slate-600">No runs yet.</p>
          ) : (
            <ul className="space-y-2">
              {runs.data.map((r) => (
                <li key={r.id} className="rounded-lg border border-stone-200 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={RUN_TONES[r.status]}>{r.status}</Badge>
                    <span className="font-medium text-slate-900">{r.tool}</span>
                    <span className="text-xs text-slate-600">{fmtDate(r.at)} · {r.actor}</span>
                  </div>
                  {r.status === 'denied' && r.denialReason && (
                    <p className="mt-1 text-red-800">Denied: {r.denialReason}</p>
                  )}
                  {r.output && (
                    <p className="mt-1 whitespace-pre-wrap text-slate-800">{r.output}</p>
                  )}
                  {r.artifacts.length > 0 && (
                    <p className="mt-1 text-xs text-slate-600">Artifacts: {r.artifacts.join(', ')}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Package + deploy */}
        <div className="rounded-lg border border-stone-200 p-3">
          <SectionTitle className="mb-2">Deploy to your Vercel account</SectionTitle>
          <p className="text-sm text-slate-600">
            Status: <Badge tone={DEPLOY_TONES[a.deployment.status] ?? 'slate'}>{a.deployment.status}</Badge>
            {a.deployment.detail && <span className="ml-2">{a.deployment.detail}</span>}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Packaging generates a manifest for your own Vercel account. Only a confirmed deployment with a live URL counts as deployed — a generated package is not a deployment.
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <Btn variant="ghost" onClick={() => act(() => packageAgent(a.id))} disabled={busy}>
              Generate package
            </Btn>
            <Btn variant="ghost" onClick={() => act(() => deployAgent(a.id))} disabled={busy}>
              Record deployment intent
            </Btn>
            <Field label="Live URL to confirm">
              <TextInput value={deployUrl} onChange={(e) => setDeployUrl(e.target.value)} placeholder="https://…" className="w-64" />
            </Field>
            <Btn variant="primary" onClick={() => act(() => confirmDeploy(a.id, deployUrl.trim()))} disabled={busy || !deployUrl.trim()}>
              Confirm deployed
            </Btn>
          </div>
        </div>

        {showEdit && (
          <AgentFormModal
            missionId={missionId}
            initial={a}
            evidenceIds={(evidence.data ?? []).map((e) => e.id)}
            onClose={() => setShowEdit(false)}
            onSaved={() => {
              setShowEdit(false);
              detail.reload();
              onChanged();
            }}
          />
        )}
      </CardBody>
    </Card>
  );
}

function AgentFormModal({
  missionId,
  initial,
  evidenceIds = [],
  onClose,
  onSaved,
}: {
  missionId: string;
  initial?: Agent;
  evidenceIds?: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [purpose, setPurpose] = useState(initial?.purpose ?? '');
  const [instructions, setInstructions] = useState(initial?.instructions ?? '');
  const [tools, setTools] = useState<string[]>(initial?.allowedTools ?? ['evidence.read']);
  const [canRead, setCanRead] = useState(initial?.permissions.read ?? true);
  const [canWrite, setCanWrite] = useState(initial?.permissions.write ?? false);
  const [canExecute, setCanExecute] = useState(initial?.permissions.execute ?? false);
  const [sources, setSources] = useState((initial?.allowedSources ?? []).join(', '));
  const [maxRuntimeMs, setMaxRuntimeMs] = useState(String(initial?.limits.maxRuntimeMs ?? 60000));
  const [maxSpend, setMaxSpend] = useState(initial?.limits.maxSpend ?? '');
  const [provider, setProvider] = useState(initial?.model.provider ?? 'unconfigured');
  const [model, setModel] = useState(initial?.model.model ?? '');
  const [testCases, setTestCases] = useState<AgentTestCase[]>(initial?.testCases ?? []);
  const [tcName, setTcName] = useState('');
  const [tcInput, setTcInput] = useState('');
  const [tcExpected, setTcExpected] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleTool = (t: string) =>
    setTools((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  const addTestCase = () => {
    if (!tcName.trim() || !tcInput.trim()) {
      setError('Test case needs a name and an input.');
      return;
    }
    setTestCases((c) => [...c, { name: tcName.trim(), input: tcInput.trim(), expected: tcExpected.trim() }]);
    setTcName('');
    setTcInput('');
    setTcExpected('');
    setError(null);
  };

  const save = async () => {
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    const body = {
      name: name.trim(),
      purpose: purpose.trim(),
      instructions: instructions.trim(),
      allowedTools: tools,
      permissions: { read: canRead, write: canWrite, execute: canExecute },
      allowedSources: sources.split(',').map((s) => s.trim()).filter(Boolean),
      limits: { maxRuntimeMs: parseInt(maxRuntimeMs, 10) || 60000, maxSpend: maxSpend.trim() },
      model: { provider: provider.trim() || 'unconfigured', model: model.trim() },
      testCases,
    };
    try {
      if (initial) await patchAgent(initial.id, body);
      else await createAgent(missionId, body);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setSaving(false);
    }
  };

  return (
    <Modal title={initial ? 'Edit agent' : 'New agent'} onClose={onClose} wide>
      <div className="space-y-4">
        {error && <ErrorState message={error} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Purpose">
            <TextInput value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          </Field>
        </div>
        <Field label="Instructions">
          <TextArea value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="What this agent should do, in plain language." />
        </Field>
        <div>
          <SectionTitle className="mb-2">Allowed tools</SectionTitle>
          <div className="flex flex-wrap gap-3">
            {ALLOWED_TOOLS.map((t) => (
              <label key={t} className="flex items-center gap-2 text-sm text-slate-800">
                <input type="checkbox" checked={tools.includes(t)} onChange={() => toggleTool(t)} className="h-4 w-4 accent-slate-800" />
                <span className="font-mono">{t}</span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <SectionTitle className="mb-2">Permissions</SectionTitle>
          <div className="flex flex-wrap gap-4 text-sm text-slate-800">
            <label className="flex items-center gap-2"><input type="checkbox" checked={canRead} onChange={(e) => setCanRead(e.target.checked)} className="h-4 w-4 accent-slate-800" /> Read</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={canWrite} onChange={(e) => setCanWrite(e.target.checked)} className="h-4 w-4 accent-slate-800" /> Write</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={canExecute} onChange={(e) => setCanExecute(e.target.checked)} className="h-4 w-4 accent-slate-800" /> Execute</label>
          </div>
        </div>
        <Field label="Allowed evidence sources (comma-separated ids)" hint={evidenceIds.length > 0 ? `Available: ${evidenceIds.slice(0, 6).join(', ')}${evidenceIds.length > 6 ? '…' : ''}` : 'No evidence in this mission yet.'}>
          <TextInput value={sources} onChange={(e) => setSources(e.target.value)} placeholder="ev_xxxx, ev_yyyy" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Max runtime (ms)">
            <TextInput value={maxRuntimeMs} onChange={(e) => setMaxRuntimeMs(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Max spend">
            <TextInput value={maxSpend} onChange={(e) => setMaxSpend(e.target.value)} placeholder="e.g. $5 (informational in v1)" />
          </Field>
          <Field label="Model provider">
            <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="unconfigured">unconfigured</option>
              <option value="gemini-ready">gemini-ready</option>
            </Select>
          </Field>
          <Field label="Model name">
            <TextInput value={model} onChange={(e) => setModel(e.target.value)} placeholder="optional" />
          </Field>
        </div>
        <div className="rounded-lg border border-stone-200 p-3">
          <SectionTitle className="mb-2">Test cases ({testCases.length})</SectionTitle>
          {testCases.map((t, i) => (
            <p key={i} className="mb-1 text-sm text-slate-800">
              <span className="font-medium">{t.name}</span>
              <span className="text-xs text-slate-600"> — input: {t.input} · expected: {t.expected || '—'}</span>
            </p>
          ))}
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <TextInput value={tcName} onChange={(e) => setTcName(e.target.value)} placeholder="Case name" aria-label="Test case name" />
            <TextInput value={tcInput} onChange={(e) => setTcInput(e.target.value)} placeholder="Input" aria-label="Test case input" />
            <TextInput value={tcExpected} onChange={(e) => setTcExpected(e.target.value)} placeholder="Expected" aria-label="Test case expected" />
          </div>
          <Btn variant="subtle" onClick={addTestCase} className="mt-2">+ Add test case</Btn>
        </div>
        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : initial ? 'Save changes' : 'Create agent'}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
