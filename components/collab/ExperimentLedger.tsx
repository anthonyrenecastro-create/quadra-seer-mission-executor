// components/collab/ExperimentLedger.tsx
// Structured experiment workflow: prediction (immutable once started), results
// versioning, HRM simulation runs, outcome-signal mapping.

import React, { useState } from 'react';
import {
  createExperiment,
  getExperiment,
  listBranches,
  listEvidence,
  listExperiments,
  patchExperiment,
  recordResults,
  runHrm,
  startExperiment,
  type Experiment,
  type ExperimentKind,
  type ExperimentStatus,
  type Health,
  type LinkedClaimUpdate,
  type Measurement,
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

const STATUS_TONES: Record<ExperimentStatus, 'slate' | 'blue' | 'amber' | 'green' | 'purple'> = {
  planned: 'slate',
  running: 'blue',
  'awaiting-results': 'amber',
  complete: 'green',
  inconclusive: 'purple',
};

const KIND_LABELS: Record<ExperimentKind, string> = {
  'planned-test': 'Planned test',
  simulation: 'Simulation (internal)',
  'real-world-observation': 'Real-world observation',
};

export default function ExperimentLedger({ missionId, health }: { missionId: string; health: Health | null }) {
  const experiments = useCollab(() => listExperiments(missionId), [missionId]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  if (experiments.loading) return <LoadingState label="Loading experiments…" />;
  if (experiments.error) return <ErrorState message={experiments.error} onRetry={experiments.reload} />;

  const list = experiments.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold tracking-tight">Experiment ledger</h2>
        <Btn variant="primary" onClick={() => setShowCreate(true)}>
          + New experiment
        </Btn>
      </div>

      {list.length === 0 ? (
        <EmptyState
          title="No experiments yet"
          hint="Register a question, record a prediction before testing, then log results. Simulations are labeled as internal simulations; inconclusive is a valid terminal outcome."
        >
          <Btn variant="primary" onClick={() => setShowCreate(true)}>
            + New experiment
          </Btn>
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setSelectedId(e.id)}
              className={cx(
                'rounded-xl border bg-white p-4 text-left shadow-sm transition-colors',
                selectedId === e.id ? 'border-slate-800 ring-1 ring-slate-800' : 'border-stone-200 hover:border-stone-400',
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={STATUS_TONES[e.status]}>{e.status.replace('-', ' ')}</Badge>
                <Badge tone="slate">{KIND_LABELS[e.kind]}</Badge>
              </div>
              <p className="mt-2 font-semibold text-slate-900">{e.title}</p>
              <p className="mt-1 line-clamp-2 text-sm text-slate-600">{e.question}</p>
              <p className="mt-2 text-xs text-slate-600">
                {e.results.length} result version{e.results.length === 1 ? '' : 's'}
                {e.outcomeSignal?.mapped ? ' · outcome signal mapped' : ''}
              </p>
            </button>
          ))}
        </div>
      )}

      {selectedId && (
        <ExperimentDetail
          experimentId={selectedId}
          missionId={missionId}
          health={health}
          onClose={() => setSelectedId(null)}
          onChanged={experiments.reload}
        />
      )}

      {showCreate && (
        <ExperimentFormModal
          missionId={missionId}
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            experiments.reload();
          }}
        />
      )}
    </div>
  );
}

function ExperimentDetail({
  experimentId,
  missionId,
  health,
  onClose,
  onChanged,
}: {
  experimentId: string;
  missionId: string;
  health: Health | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const detail = useCollab(() => getExperiment(experimentId), [experimentId]);
  const branches = useCollab(() => listBranches(missionId), [missionId]);
  const claims = useCollab(() => listEvidence(missionId, { kind: 'claim' }), [missionId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [hrmSteps, setHrmSteps] = useState('100');
  const [hrmSeed, setHrmSeed] = useState('42');

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      detail.reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  if (detail.loading) return <LoadingState label="Loading experiment…" />;
  if (detail.error) return <ErrorState message={detail.error} onRetry={detail.reload} />;
  const e = detail.data;
  if (!e) return <EmptyState title="Experiment not found" />;

  const predictionLocked = e.status !== 'planned';
  const hrmAvailable = health?.hrm === true;

  const doHrm = async () => {
    const steps = parseInt(hrmSteps, 10);
    const seed = parseInt(hrmSeed, 10);
    if (!Number.isFinite(steps) || steps <= 0 || !Number.isFinite(seed)) {
      setError('Steps and seed must be positive numbers.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await runHrm(e.id, { steps, seed });
      if (r && r.available === false) {
        setError(`HRM unavailable: ${r.reason ?? 'no reason given'}`);
      } else {
        detail.reload();
        onChanged();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'HRM run failed');
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
              <Badge tone={STATUS_TONES[e.status]}>{e.status.replace('-', ' ')}</Badge>
              <Badge tone="slate">{KIND_LABELS[e.kind]}</Badge>
              <span className="text-xs text-slate-600">v{e.version}</span>
            </div>
            <h3 className="mt-1 text-lg font-bold text-slate-900">{e.title}</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {!predictionLocked && (
              <Btn variant="ghost" onClick={() => setShowEdit(true)} disabled={busy}>Edit</Btn>
            )}
            {e.status === 'planned' && (
              <Btn variant="primary" onClick={() => act(() => startExperiment(e.id))} disabled={busy}>
                Start
              </Btn>
            )}
            {(e.status === 'running' || e.status === 'awaiting-results') && (
              <Btn variant="primary" onClick={() => setShowResult(true)} disabled={busy}>
                Record result
              </Btn>
            )}
            <Btn variant="subtle" onClick={onClose}>Close</Btn>
          </div>
        </div>

        {error && <ErrorState message={error} />}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 text-sm">
            <p className="text-slate-800"><span className="font-semibold">Question:</span> {e.question || '—'}</p>
            <p className="text-slate-800"><span className="font-semibold">Hypothesis:</span> {e.hypothesis || '—'}</p>
            <p className="text-slate-800"><span className="font-semibold">Method:</span> {e.method || '—'}</p>
            <p className="text-slate-800"><span className="font-semibold">Success criteria:</span> {e.successCriteria || '—'}</p>
            {e.baseline && <p className="text-slate-800"><span className="font-semibold">Baseline:</span> {e.baseline}</p>}
            {e.resources && <p className="text-slate-800"><span className="font-semibold">Resources:</span> {e.resources}</p>}
          </div>
          <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
            <SectionTitle className="mb-1">
              Prediction {predictionLocked && <Badge tone="slate" className="ml-1">locked — immutable once started</Badge>}
            </SectionTitle>
            <p className="text-sm text-slate-800">{e.prediction || 'No prediction recorded.'}</p>
          </div>
        </div>

        {/* HRM simulation */}
        <div className="rounded-lg border border-stone-200 p-3">
          <SectionTitle className="mb-2">HRM simulation</SectionTitle>
          {hrmAvailable ? (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Steps">
                <TextInput value={hrmSteps} onChange={(ev) => setHrmSteps(ev.target.value)} className="w-24" inputMode="numeric" />
              </Field>
              <Field label="Seed">
                <TextInput value={hrmSeed} onChange={(ev) => setHrmSeed(ev.target.value)} className="w-24" inputMode="numeric" />
              </Field>
              <Btn variant="ghost" onClick={doHrm} disabled={busy}>
                {busy ? 'Running…' : 'Run HRM simulation'}
              </Btn>
              <p className="w-full text-xs text-slate-600">
                Output is appended as a result version labeled <span className="font-medium">internal-simulation</span> — a simulation is not a real-world observation.
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-600">
              <Badge tone="slate">HRM unavailable</Badge>{' '}
              <span className="ml-1">The simulation engine is not reachable from this backend. Results can still be recorded manually.</span>
            </p>
          )}
        </div>

        {/* Results version history */}
        <div>
          <SectionTitle className="mb-2">Results ({e.results.length})</SectionTitle>
          {e.results.length === 0 ? (
            <p className="text-sm text-slate-600">No results recorded yet. The original prediction is preserved above for comparison.</p>
          ) : (
            <div className="space-y-3">
              {e.results.map((r) => (
                <div key={r.v} className="rounded-lg border border-stone-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="blue">result v{r.v}</Badge>
                    <Badge tone={r.kind === 'simulation' ? 'purple' : 'slate'}>
                      {r.kind === 'simulation' ? 'internal simulation' : r.kind || 'observation'}
                    </Badge>
                    <span className="text-xs text-slate-600">{fmtDate(r.at)} · {r.actor}</span>
                  </div>
                  {r.observations && <p className="mt-2 text-sm text-slate-800"><span className="font-semibold">Observations:</span> {r.observations}</p>}
                  {r.measurements.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-sm text-slate-800">
                      {r.measurements.map((m, i) => (
                        <li key={i}><span className="font-medium">{m.name}:</span> {m.value}{m.unit ? ` ${m.unit}` : ''}</li>
                      ))}
                    </ul>
                  )}
                  {r.limitations && <p className="mt-1 text-sm text-slate-800"><span className="font-semibold">Limitations:</span> {r.limitations}</p>}
                  {r.interpretation && <p className="mt-1 text-sm text-slate-800"><span className="font-semibold">Interpretation:</span> {r.interpretation}</p>}
                  {r.recommendations.length > 0 && (
                    <p className="mt-1 text-sm text-slate-800"><span className="font-semibold">Recommendations:</span> {r.recommendations.join('; ')}</p>
                  )}
                  {r.artifacts.length > 0 && (
                    <p className="mt-1 text-sm text-slate-800"><span className="font-semibold">Artifacts:</span> {r.artifacts.join(', ')}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Linked claim updates + outcome signal */}
        {e.linkedClaimUpdates.length > 0 && (
          <div>
            <SectionTitle className="mb-1">Linked claim updates</SectionTitle>
            <ul className="space-y-1 text-sm text-slate-800">
              {e.linkedClaimUpdates.map((u, i) => (
                <li key={i} className="rounded-lg bg-stone-50 px-3 py-2">
                  <span className="font-medium">{u.evidenceId}</span>: {u.from || '—'} → {u.to}
                  <span className="block text-xs text-slate-600">triggered by {u.triggeredBy} · {u.why}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {e.outcomeSignal?.mapped && (
          <div className="rounded-lg border border-green-300 bg-green-50 p-3">
            <SectionTitle className="mb-1">Outcome signal</SectionTitle>
            <p className="text-sm text-green-900">
              Mapped to the outcome/feedback system at {fmtDate(e.outcomeSignal.at)}. The mapping is a documented,
              reviewable adapter — it does not claim to modulate memory.
            </p>
          </div>
        )}

        {showResult && (
          <ResultFormModal
            claims={claims.data ?? []}
            onClose={() => setShowResult(false)}
            onSaved={() => {
              setShowResult(false);
              detail.reload();
              onChanged();
            }}
            experimentId={e.id}
          />
        )}
        {showEdit && (
          <ExperimentFormModal
            missionId={missionId}
            initial={e}
            branches={branches.data ?? []}
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

function ExperimentFormModal({
  missionId,
  initial,
  branches = [],
  onClose,
  onSaved,
}: {
  missionId: string;
  initial?: Experiment;
  branches?: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [question, setQuestion] = useState(initial?.question ?? '');
  const [hypothesis, setHypothesis] = useState(initial?.hypothesis ?? '');
  const [prediction, setPrediction] = useState(initial?.prediction ?? '');
  const [method, setMethod] = useState(initial?.method ?? '');
  const [successCriteria, setSuccessCriteria] = useState(initial?.successCriteria ?? '');
  const [kind, setKind] = useState<ExperimentKind>(initial?.kind ?? 'planned-test');
  const [branchId, setBranchId] = useState(initial?.branchId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!title.trim() || !question.trim()) {
      setError('Title and question are required.');
      return;
    }
    setSaving(true);
    setError(null);
    const body = {
      title: title.trim(),
      question: question.trim(),
      hypothesis: hypothesis.trim(),
      prediction: prediction.trim(),
      method: method.trim(),
      successCriteria: successCriteria.trim(),
      kind,
      branchId,
    };
    try {
      if (initial) await patchExperiment(initial.id, body);
      else await createExperiment(missionId, body);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setSaving(false);
    }
  };

  return (
    <Modal title={initial ? 'Edit experiment' : 'New experiment'} onClose={onClose} wide>
      <div className="space-y-4">
        {error && <ErrorState message={error} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title">
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Kind">
            <Select value={kind} onChange={(e) => setKind(e.target.value as ExperimentKind)}>
              {(Object.keys(KIND_LABELS) as ExperimentKind[]).map((k) => (
                <option key={k} value={k}>{KIND_LABELS[k]}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Question">
          <TextInput value={question} onChange={(e) => setQuestion(e.target.value)} />
        </Field>
        <Field label="Hypothesis">
          <TextArea value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} />
        </Field>
        <Field label="Prediction (recorded before testing; locked once started)" hint="Be specific enough that the result can confirm or contradict it.">
          <TextArea value={prediction} onChange={(e) => setPrediction(e.target.value)} />
        </Field>
        <Field label="Method">
          <TextArea value={method} onChange={(e) => setMethod(e.target.value)} />
        </Field>
        <Field label="Success / failure criteria">
          <TextInput value={successCriteria} onChange={(e) => setSuccessCriteria(e.target.value)} />
        </Field>
        <Field label="Branch (optional)">
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">None</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : initial ? 'Save changes' : 'Create experiment'}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

function ResultFormModal({
  experimentId,
  claims,
  onClose,
  onSaved,
}: {
  experimentId: string;
  claims: { id: string; title: string; claimStatus: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [observations, setObservations] = useState('');
  const [measurements, setMeasurements] = useState<Measurement[]>([{ name: '', value: '', unit: '' }]);
  const [limitations, setLimitations] = useState('');
  const [interpretation, setInterpretation] = useState('');
  const [recommendations, setRecommendations] = useState('');
  const [kind, setKind] = useState('observation');
  const [claimUpdates, setClaimUpdates] = useState<LinkedClaimUpdate[]>([]);
  const [cuEvidence, setCuEvidence] = useState('');
  const [cuTo, setCuTo] = useState('supported');
  const [cuWhy, setCuWhy] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addClaimUpdate = () => {
    if (!cuEvidence || !cuWhy.trim()) {
      setError('Choose a claim and give a reason for the linked update.');
      return;
    }
    const from = claims.find((c) => c.id === cuEvidence)?.claimStatus ?? '';
    setClaimUpdates((u) => [...u, { evidenceId: cuEvidence, from, to: cuTo, why: cuWhy.trim(), triggeredBy: 'result-v(next)' }]);
    setCuEvidence('');
    setCuWhy('');
    setError(null);
  };

  const save = async () => {
    if (!observations.trim() && !interpretation.trim()) {
      setError('Record at least observations or an interpretation.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await recordResults(experimentId, {
        observations: observations.trim(),
        measurements: measurements.filter((m) => m.name.trim() || m.value.trim()),
        artifacts: [],
        limitations: limitations.trim(),
        interpretation: interpretation.trim(),
        recommendations: recommendations.split('\n').map((s) => s.trim()).filter(Boolean),
        kind,
        linkedClaimUpdates: claimUpdates,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record result');
      setSaving(false);
    }
  };

  return (
    <Modal title="Record result" onClose={onClose} wide>
      <div className="space-y-4">
        {error && <ErrorState message={error} />}
        <p className="text-sm text-slate-600">
          Results are appended as a new version — earlier versions and the original prediction are never overwritten.
          Inconclusive is a valid outcome; do not relabel it a failure.
        </p>
        <Field label="Result kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="observation">Real-world observation</option>
            <option value="planned-test">Planned test</option>
            <option value="simulation">Internal simulation</option>
          </Select>
        </Field>
        <Field label="Observations">
          <TextArea value={observations} onChange={(e) => setObservations(e.target.value)} placeholder="What actually happened, concretely." />
        </Field>
        <div>
          <SectionTitle className="mb-2">Measurements</SectionTitle>
          {measurements.map((m, i) => (
            <div key={i} className="mb-2 grid grid-cols-3 gap-2">
              <TextInput value={m.name} onChange={(e) => setMeasurements((ms) => ms.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Name" aria-label={`Measurement ${i + 1} name`} />
              <TextInput value={m.value} onChange={(e) => setMeasurements((ms) => ms.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder="Value" aria-label={`Measurement ${i + 1} value`} />
              <div className="flex gap-2">
                <TextInput value={m.unit} onChange={(e) => setMeasurements((ms) => ms.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} placeholder="Unit" aria-label={`Measurement ${i + 1} unit`} />
                <Btn variant="subtle" onClick={() => setMeasurements((ms) => ms.filter((_, j) => j !== i))} aria-label={`Remove measurement ${i + 1}`}>×</Btn>
              </div>
            </div>
          ))}
          <Btn variant="subtle" onClick={() => setMeasurements((ms) => [...ms, { name: '', value: '', unit: '' }])}>
            + Add measurement
          </Btn>
        </div>
        <Field label="Limitations">
          <TextArea value={limitations} onChange={(e) => setLimitations(e.target.value)} placeholder="What this result cannot show." />
        </Field>
        <Field label="Interpretation">
          <TextArea value={interpretation} onChange={(e) => setInterpretation(e.target.value)} placeholder="What the result means for the hypothesis — without overstating." />
        </Field>
        <Field label="Recommendations (one per line)">
          <TextArea value={recommendations} onChange={(e) => setRecommendations(e.target.value)} placeholder="Changes to claims, branches, tasks, or future experiments…" />
        </Field>
        <div className="rounded-lg border border-stone-200 p-3">
          <SectionTitle className="mb-2">Linked claim updates</SectionTitle>
          {claimUpdates.map((u, i) => (
            <p key={i} className="mb-1 text-sm text-slate-800">
              {u.evidenceId}: {u.from || '—'} → {u.to} <span className="text-xs text-slate-600">({u.why})</span>
            </p>
          ))}
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <Field label="Claim">
              <Select value={cuEvidence} onChange={(e) => setCuEvidence(e.target.value)}>
                <option value="">Choose…</option>
                {claims.map((c) => (
                  <option key={c.id} value={c.id}>{c.title} ({c.claimStatus})</option>
                ))}
              </Select>
            </Field>
            <Field label="New status">
              <Select value={cuTo} onChange={(e) => setCuTo(e.target.value)}>
                {['unreviewed', 'supported', 'disputed', 'insufficient-evidence'].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </Field>
            <Field label="Why">
              <TextInput value={cuWhy} onChange={(e) => setCuWhy(e.target.value)} />
            </Field>
          </div>
          <Btn variant="subtle" onClick={addClaimUpdate} className="mt-2">+ Link claim update</Btn>
        </div>
        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>
            {saving ? 'Recording…' : 'Record result'}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
