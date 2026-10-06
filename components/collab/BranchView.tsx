// components/collab/BranchView.tsx
// Perspective branches: create / duplicate / archive / compare / selective merge.

import React, { useState } from 'react';
import {
  archiveBranch,
  compareBranches,
  createBranch,
  duplicateBranch,
  getBranch,
  listBranches,
  mergeBranch,
  patchBranch,
  type Branch,
  type BranchCompare,
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

const STATUS_TONES: Record<Branch['status'], 'green' | 'slate' | 'purple'> = {
  active: 'green',
  archived: 'slate',
  merged: 'purple',
};

function linesToArray(v: string): string[] {
  return v.split('\n').map((s) => s.trim()).filter(Boolean);
}

export default function BranchView({ missionId }: { missionId: string }) {
  const branches = useCollab(() => listBranches(missionId), [missionId]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');
  const [compareResult, setCompareResult] = useState<BranchCompare | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  const runCompare = async () => {
    if (!compareA || !compareB || compareA === compareB) {
      setCompareError('Choose two different branches to compare.');
      return;
    }
    setCompareLoading(true);
    setCompareError(null);
    try {
      const r = await compareBranches(compareA, compareB);
      setCompareResult(r);
    } catch (e) {
      setCompareError(e instanceof Error ? e.message : 'Compare failed');
    } finally {
      setCompareLoading(false);
    }
  };

  if (branches.loading) return <LoadingState label="Loading branches…" />;
  if (branches.error) return <ErrorState message={branches.error} onRetry={branches.reload} />;

  const list = branches.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold tracking-tight">Perspective branches</h2>
        <Btn variant="primary" onClick={() => setShowCreate(true)}>
          + New branch
        </Btn>
      </div>

      {list.length === 0 ? (
        <EmptyState
          title="No branches yet"
          hint="Branches let the mission explore alternative approaches side by side — different assumptions, evidence, and predicted outcomes, without disturbing the main line of work."
        >
          <Btn variant="primary" onClick={() => setShowCreate(true)}>
            + New branch
          </Btn>
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setSelectedId(b.id)}
              className={cx(
                'rounded-xl border bg-white p-4 text-left shadow-sm transition-colors',
                selectedId === b.id ? 'border-slate-800 ring-1 ring-slate-800' : 'border-stone-200 hover:border-stone-400',
              )}
            >
              <div className="flex items-center gap-2">
                <Badge tone={STATUS_TONES[b.status]}>{b.status}</Badge>
                <span className="text-xs text-slate-600">v{b.version}</span>
              </div>
              <p className="mt-2 font-semibold text-slate-900">{b.name}</p>
              <p className="mt-1 line-clamp-2 text-sm text-slate-600">{b.approach || b.rationale}</p>
              <p className="mt-2 text-xs text-slate-600">
                {b.assumptions.length} assumptions · {b.risks.length} risks · {b.openQuestions.length} open questions
              </p>
            </button>
          ))}
        </div>
      )}

      {selectedId && (
        <BranchDetail
          branchId={selectedId}
          allBranches={list}
          onClose={() => setSelectedId(null)}
          onChanged={branches.reload}
        />
      )}

      {/* Compare */}
      <Card>
        <CardBody>
          <SectionTitle className="mb-3">Compare branches</SectionTitle>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Branch A">
              <Select value={compareA} onChange={(e) => setCompareA(e.target.value)} className="w-52">
                <option value="">Choose…</option>
                {list.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Branch B">
              <Select value={compareB} onChange={(e) => setCompareB(e.target.value)} className="w-52">
                <option value="">Choose…</option>
                {list.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </Select>
            </Field>
            <Btn variant="ghost" onClick={runCompare} disabled={compareLoading}>
              {compareLoading ? 'Comparing…' : 'Compare'}
            </Btn>
          </div>
          {compareError && <div className="mt-3"><ErrorState message={compareError} /></div>}
          {compareResult && <CompareTable result={compareResult} nameA={list.find((b) => b.id === compareA)?.name ?? 'A'} nameB={list.find((b) => b.id === compareB)?.name ?? 'B'} />}
        </CardBody>
      </Card>

      {showCreate && (
        <BranchFormModal
          missionId={missionId}
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            branches.reload();
          }}
        />
      )}
    </div>
  );
}

function CompareTable({ result, nameA, nameB }: { result: BranchCompare; nameA: string; nameB: string }) {
  const sections: { label: string; diff: { onlyA: string[]; onlyB: string[]; common: string[] } }[] = [
    { label: 'Assumptions', diff: result.assumptions },
    { label: 'Evidence', diff: result.evidence },
    { label: 'Risks', diff: result.risks },
  ];
  return (
    <div className="mt-4 space-y-4">
      {sections.map((s) => (
        <div key={s.label}>
          <h4 className="mb-1 text-sm font-semibold text-slate-800">{s.label}</h4>
          <div className="grid gap-2 md:grid-cols-3">
            <div className="rounded-lg bg-blue-50 p-3">
              <p className="text-xs font-semibold text-blue-900">Only in {nameA} ({s.diff.onlyA.length})</p>
              <ul className="mt-1 list-disc pl-4 text-sm text-blue-900">
                {s.diff.onlyA.map((x, i) => <li key={i}>{x}</li>)}
                {s.diff.onlyA.length === 0 && <li className="list-none text-xs">—</li>}
              </ul>
            </div>
            <div className="rounded-lg bg-stone-100 p-3">
              <p className="text-xs font-semibold text-slate-800">Common ({s.diff.common.length})</p>
              <ul className="mt-1 list-disc pl-4 text-sm text-slate-800">
                {s.diff.common.map((x, i) => <li key={i}>{x}</li>)}
                {s.diff.common.length === 0 && <li className="list-none text-xs">—</li>}
              </ul>
            </div>
            <div className="rounded-lg bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-900">Only in {nameB} ({s.diff.onlyB.length})</p>
              <ul className="mt-1 list-disc pl-4 text-sm text-amber-900">
                {s.diff.onlyB.map((x, i) => <li key={i}>{x}</li>)}
                {s.diff.onlyB.length === 0 && <li className="list-none text-xs">—</li>}
              </ul>
            </div>
          </div>
        </div>
      ))}
      {result.predictions && (
        <div>
          <h4 className="mb-1 text-sm font-semibold text-slate-800">Predicted outcomes</h4>
          <div className="grid gap-2 md:grid-cols-2">
            <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{result.predictions.a || '—'}</p>
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{result.predictions.b || '—'}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function BranchDetail({
  branchId,
  allBranches,
  onClose,
  onChanged,
}: {
  branchId: string;
  allBranches: Branch[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const detail = useCollab(() => getBranch(branchId), [branchId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMerge, setShowMerge] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
      detail.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  if (detail.loading) return <LoadingState label="Loading branch…" />;
  if (detail.error) return <ErrorState message={detail.error} onRetry={detail.reload} />;
  const b = detail.data;
  if (!b) return <EmptyState title="Branch not found" />;

  const listBlock = (label: string, items: string[]) => (
    <div>
      <SectionTitle className="mb-1">{label} ({items.length})</SectionTitle>
      {items.length === 0 ? (
        <p className="text-sm text-slate-600">—</p>
      ) : (
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">
          {items.map((x, i) => <li key={i}>{x}</li>)}
        </ul>
      )}
    </div>
  );

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Badge tone={STATUS_TONES[b.status]}>{b.status}</Badge>
              <span className="text-xs text-slate-600">v{b.version} · updated {fmtDate(b.updatedAt)}</span>
            </div>
            <h3 className="mt-1 text-lg font-bold text-slate-900">{b.name}</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn variant="ghost" onClick={() => setShowEdit(true)} disabled={busy}>Edit</Btn>
            <Btn variant="ghost" onClick={() => act(() => duplicateBranch(b.id))} disabled={busy}>Duplicate</Btn>
            {b.status === 'active' && (
              <>
                <Btn variant="ghost" onClick={() => setShowMerge(true)} disabled={busy}>Merge…</Btn>
                <Btn variant="danger" onClick={() => act(() => archiveBranch(b.id))} disabled={busy}>Archive</Btn>
              </>
            )}
            <Btn variant="subtle" onClick={onClose}>Close</Btn>
          </div>
        </div>

        {error && <ErrorState message={error} />}

        {b.approach && <p className="text-sm text-slate-800"><span className="font-semibold">Approach:</span> {b.approach}</p>}
        {b.rationale && <p className="text-sm text-slate-800"><span className="font-semibold">Rationale:</span> {b.rationale}</p>}
        {b.evidenceVersion && (
          <p className="text-xs text-slate-600">References evidence as of version marker: <span className="font-mono">{b.evidenceVersion}</span></p>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {listBlock('Assumptions', b.assumptions)}
          {listBlock('Constraints', b.constraints)}
          {listBlock('Expected benefits', b.expectedBenefits)}
          {listBlock('Risks', b.risks)}
          {listBlock('Open questions', b.openQuestions)}
          {listBlock('Proposed experiments', b.proposedExperiments)}
        </div>

        {(b.evidenceRefs.supporting.length > 0 || b.evidenceRefs.conflicting.length > 0) && (
          <div>
            <SectionTitle className="mb-1">Evidence references</SectionTitle>
            <p className="text-sm text-slate-800">
              <span className="font-medium text-green-800">Supporting:</span> {b.evidenceRefs.supporting.join(', ') || '—'}
            </p>
            <p className="text-sm text-slate-800">
              <span className="font-medium text-red-800">Conflicting:</span> {b.evidenceRefs.conflicting.join(', ') || '—'}
            </p>
          </div>
        )}

        {b.mergeProvenance.length > 0 && (
          <div className="rounded-lg border border-purple-300 bg-purple-50 p-3">
            <SectionTitle className="mb-1">Merge provenance</SectionTitle>
            <ul className="space-y-1 text-sm text-purple-900">
              {b.mergeProvenance.map((m, i) => (
                <li key={i}>
                  Adopted <span className="font-medium">“{m.element}”</span> from branch {m.fromBranch} (v{m.fromVersion})
                </li>
              ))}
            </ul>
          </div>
        )}

        {b.history.length > 0 && (
          <div>
            <SectionTitle className="mb-1">Revision history</SectionTitle>
            <ul className="space-y-1 text-xs text-slate-600">
              {b.history.map((h) => (
                <li key={h.v}>v{h.v} · {fmtDate(h.at)} · {h.actor} — {h.change}</li>
              ))}
            </ul>
          </div>
        )}

        {showMerge && (
          <MergeModal
            source={b}
            targets={allBranches.filter((t) => t.id !== b.id && t.status === 'active')}
            onClose={() => setShowMerge(false)}
            onMerged={() => {
              setShowMerge(false);
              onChanged();
              detail.reload();
            }}
          />
        )}
        {showEdit && (
          <BranchFormModal
            missionId={b.missionId}
            initial={b}
            onClose={() => setShowEdit(false)}
            onSaved={() => {
              setShowEdit(false);
              onChanged();
              detail.reload();
            }}
          />
        )}
      </CardBody>
    </Card>
  );
}

function BranchFormModal({
  missionId,
  initial,
  onClose,
  onSaved,
}: {
  missionId: string;
  initial?: Branch;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [approach, setApproach] = useState(initial?.approach ?? '');
  const [rationale, setRationale] = useState(initial?.rationale ?? '');
  const [assumptions, setAssumptions] = useState((initial?.assumptions ?? []).join('\n'));
  const [constraints, setConstraints] = useState((initial?.constraints ?? []).join('\n'));
  const [benefits, setBenefits] = useState((initial?.expectedBenefits ?? []).join('\n'));
  const [risks, setRisks] = useState((initial?.risks ?? []).join('\n'));
  const [questions, setQuestions] = useState((initial?.openQuestions ?? []).join('\n'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    const body = {
      name: name.trim(),
      approach: approach.trim(),
      rationale: rationale.trim(),
      assumptions: linesToArray(assumptions),
      constraints: linesToArray(constraints),
      expectedBenefits: linesToArray(benefits),
      risks: linesToArray(risks),
      openQuestions: linesToArray(questions),
    };
    try {
      if (initial) await patchBranch(initial.id, body);
      else await createBranch(missionId, body);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setSaving(false);
    }
  };

  const multi = (label: string, value: string, set: (v: string) => void) => (
    <Field label={`${label} (one per line)`}>
      <TextArea value={value} onChange={(e) => set(e.target.value)} className="min-h-[4rem]" />
    </Field>
  );

  return (
    <Modal title={initial ? 'Edit branch' : 'New branch'} onClose={onClose} wide>
      <div className="space-y-4">
        {error && <ErrorState message={error} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Approach">
            <TextInput value={approach} onChange={(e) => setApproach(e.target.value)} />
          </Field>
        </div>
        <Field label="Rationale">
          <TextArea value={rationale} onChange={(e) => setRationale(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {multi('Assumptions', assumptions, setAssumptions)}
          {multi('Constraints', constraints, setConstraints)}
          {multi('Expected benefits', benefits, setBenefits)}
          {multi('Risks', risks, setRisks)}
        </div>
        {multi('Open questions', questions, setQuestions)}
        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : initial ? 'Save changes' : 'Create branch'}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

function MergeModal({
  source,
  targets,
  onClose,
  onMerged,
}: {
  source: Branch;
  targets: Branch[];
  onClose: () => void;
  onMerged: () => void;
}) {
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '');
  const [picks, setPicks] = useState<Record<string, number[]>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups: { key: string; label: string; items: string[] }[] = [
    { key: 'assumptions', label: 'Assumptions', items: source.assumptions },
    { key: 'risks', label: 'Risks', items: source.risks },
    { key: 'expectedBenefits', label: 'Expected benefits', items: source.expectedBenefits },
    { key: 'openQuestions', label: 'Open questions', items: source.openQuestions },
    { key: 'proposedExperiments', label: 'Proposed experiments', items: source.proposedExperiments },
    { key: 'constraints', label: 'Constraints', items: source.constraints },
  ];

  const toggle = (key: string, idx: number) => {
    setPicks((p) => {
      const cur = p[key] ?? [];
      return { ...p, [key]: cur.includes(idx) ? cur.filter((i) => i !== idx) : [...cur, idx] };
    });
  };

  const merge = async () => {
    if (!targetId) {
      setError('Choose a target branch.');
      return;
    }
    const total = Object.values(picks).reduce((n, a) => n + a.length, 0);
    if (total === 0) {
      setError('Select at least one element to adopt.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await mergeBranch(source.id, { targetBranchId: targetId, picks });
      onMerged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Merge failed');
      setSaving(false);
    }
  };

  return (
    <Modal title={`Merge "${source.name}" into…`} onClose={onClose} wide>
      <div className="space-y-4">
        {error && <ErrorState message={error} />}
        {targets.length === 0 ? (
          <p className="text-sm text-slate-600">No other active branches to merge into.</p>
        ) : (
          <>
            <Field label="Target branch">
              <Select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
            </Field>
            <p className="text-sm text-slate-600">
              Check the elements to adopt. Provenance is recorded on the merged branch; disagreements are preserved in history.
            </p>
            {groups.map((g) => (
              <div key={g.key}>
                <SectionTitle className="mb-1">{g.label}</SectionTitle>
                {g.items.length === 0 ? (
                  <p className="text-sm text-slate-600">—</p>
                ) : (
                  <ul className="space-y-1">
                    {g.items.map((x, i) => (
                      <li key={i}>
                        <label className="flex items-start gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm hover:bg-stone-50">
                          <input
                            type="checkbox"
                            checked={(picks[g.key] ?? []).includes(i)}
                            onChange={() => toggle(g.key, i)}
                            className="mt-0.5 h-4 w-4 accent-slate-800"
                          />
                          <span className="text-slate-800">{x}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
              <Btn variant="primary" onClick={merge} disabled={saving}>
                {saving ? 'Merging…' : 'Merge selected'}
              </Btn>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
