// components/collab/EvidenceMap.tsx
// Evidence map: filterable list + deterministic SVG graph + inspector panel.

import React, { useMemo, useRef, useState } from 'react';
import {
  createEvidence,
  createRelation,
  deleteEvidence,
  deleteRelation,
  getEvidence,
  getImpacted,
  listEvidence,
  listRelations,
  patchEvidence,
  uploadEvidence,
  type ClaimStatus,
  type EvidenceItem,
  type EvidenceKind,
  type Health,
  type Impacted,
  type ParseStatus,
  type Relation,
  type RelationType,
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

const KIND_TONES: Record<EvidenceKind, 'blue' | 'teal' | 'purple' | 'amber' | 'slate' | 'green' | 'red'> = {
  document: 'blue',
  dataset: 'teal',
  claim: 'purple',
  question: 'amber',
  assumption: 'slate',
  decision: 'green',
  'experiment-result': 'red',
};

const CLAIM_TONES: Record<ClaimStatus, 'slate' | 'green' | 'red' | 'amber'> = {
  unreviewed: 'slate',
  supported: 'green',
  disputed: 'red',
  'insufficient-evidence': 'amber',
};

const PARSE_TONES: Record<ParseStatus, 'green' | 'amber' | 'red'> = {
  parsed: 'green',
  'stored-unparsed': 'amber',
  unsupported: 'red',
};

const PARSE_LABELS: Record<ParseStatus, string> = {
  parsed: 'Parsed',
  'stored-unparsed': 'Stored unparsed',
  unsupported: 'Unsupported format',
};

const REL_LABELS: Record<RelationType, string> = {
  supports: 'supports',
  contradicts: 'contradicts',
  'depends-on': 'depends on',
  'derived-from': 'derived from',
  tests: 'tests',
};

const KIND_COLORS: Record<EvidenceKind, string> = {
  document: '#1d4ed8',
  dataset: '#0f766e',
  claim: '#7e22ce',
  question: '#b45309',
  assumption: '#475569',
  decision: '#15803d',
  'experiment-result': '#be123c',
};

function ClaimBadge({ item }: { item: EvidenceItem }) {
  const latestAi = [...(item.statusHistory ?? [])].reverse().find((s) => s.aiSuggested);
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge tone={CLAIM_TONES[item.claimStatus]}>{item.claimStatus.replace('-', ' ')}</Badge>
      {latestAi && (
        <Badge tone="purple" title={`AI suggested "${latestAi.to}" at ${fmtDate(latestAi.at)} — not a human review`}>
          AI-suggested
        </Badge>
      )}
    </span>
  );
}

export default function EvidenceMap({ missionId, health }: { missionId: string; health: Health | null }) {
  const [kind, setKind] = useState('');
  const [claimStatus, setClaimStatus] = useState('');
  const [q, setQ] = useState('');
  const [view, setView] = useState<'list' | 'graph'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const query = useMemo(() => ({ kind: kind || undefined, claimStatus: claimStatus || undefined, q: q || undefined }), [kind, claimStatus, q]);
  const evidence = useCollab(() => listEvidence(missionId, query), [missionId, query.kind, query.claimStatus, query.q]);
  const relations = useCollab(() => listRelations(missionId), [missionId]);

  const reloadAll = () => {
    evidence.reload();
    relations.reload();
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      await uploadEvidence(missionId, file);
      reloadAll();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <Card>
        <CardBody className="flex flex-wrap items-end gap-3">
          <Field label="Kind">
            <Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-40">
              <option value="">All kinds</option>
              {Object.keys(KIND_TONES).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Claim status">
            <Select value={claimStatus} onChange={(e) => setClaimStatus(e.target.value)} className="w-44">
              <option value="">All statuses</option>
              {Object.keys(CLAIM_TONES).map((s) => (
                <option key={s} value={s}>
                  {s.replace('-', ' ')}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Search">
            <TextInput
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Title, source, text…"
              className="w-56"
            />
          </Field>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex rounded-lg border border-stone-300" role="tablist" aria-label="Evidence view">
              {(['list', 'graph'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={cx(
                    'px-3 py-1.5 text-sm font-medium capitalize transition-colors first:rounded-l-lg last:rounded-r-lg',
                    view === v ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-stone-100',
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
            <Btn variant="ghost" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading…' : 'Upload'}
            </Btn>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              aria-label="Upload evidence file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
              }}
            />
            <Btn variant="primary" onClick={() => setShowCreate(true)}>
              + Add evidence
            </Btn>
          </div>
        </CardBody>
      </Card>

      {uploadError && <ErrorState message={uploadError} />}

      {evidence.loading || relations.loading ? (
        <LoadingState label="Loading evidence…" />
      ) : evidence.error ? (
        <ErrorState message={evidence.error} onRetry={reloadAll} />
      ) : !evidence.data || evidence.data.length === 0 ? (
        <EmptyState
          title="No evidence yet"
          hint="Add the first document, dataset, claim, or question — or upload a file. PDF, DOCX, and XLSX files are parsed in your browser; other formats are stored with an honest parse status."
        >
          <Btn variant="primary" onClick={() => setShowCreate(true)}>
            + Add evidence
          </Btn>
        </EmptyState>
      ) : view === 'list' ? (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="space-y-3 lg:col-span-3">
            {evidence.data.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={cx(
                  'w-full rounded-xl border bg-white p-4 text-left shadow-sm transition-colors',
                  selectedId === item.id ? 'border-slate-800 ring-1 ring-slate-800' : 'border-stone-200 hover:border-stone-400',
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={KIND_TONES[item.kind]}>{item.kind}</Badge>
                  {item.kind === 'claim' && <ClaimBadge item={item} />}
                  {item.content?.parseStatus && item.content.parseStatus !== 'parsed' && (
                    <Badge tone={PARSE_TONES[item.content.parseStatus]}>{PARSE_LABELS[item.content.parseStatus]}</Badge>
                  )}
                  {item.importedFrom && <Badge tone="teal" title={`Imported from mission ${item.importedFrom.missionId}`}>imported</Badge>}
                </div>
                <p className="mt-2 font-semibold text-slate-900">{item.title}</p>
                <p className="mt-0.5 text-xs text-slate-600">
                  {item.source || 'no source'}
                  {item.author ? ` · ${item.author}` : ''} · {fmtDate(item.createdAt)}
                </p>
                {item.locator?.excerpt && (
                  <p className="mt-2 line-clamp-3 text-sm text-slate-700">{item.locator.excerpt}</p>
                )}
              </button>
            ))}
          </div>
          <div className="lg:col-span-2">
            {selectedId ? (
              <Inspector
                evidenceId={selectedId}
                missionId={missionId}
                allEvidence={evidence.data}
                relations={relations.data ?? []}
                onChanged={reloadAll}
                onClose={() => setSelectedId(null)}
              />
            ) : (
              <Card>
                <CardBody>
                  <p className="text-sm text-slate-600">Select an item to inspect its detail, relations, and impact.</p>
                </CardBody>
              </Card>
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardBody>
              <GraphView
                items={evidence.data}
                relations={relations.data ?? []}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            </CardBody>
          </Card>
          <div className="lg:col-span-2">
            {selectedId ? (
              <Inspector
                evidenceId={selectedId}
                missionId={missionId}
                allEvidence={evidence.data}
                relations={relations.data ?? []}
                onChanged={reloadAll}
                onClose={() => setSelectedId(null)}
              />
            ) : (
              <Card>
                <CardBody>
                  <p className="text-sm text-slate-600">Select a node to inspect it.</p>
                </CardBody>
              </Card>
            )}
          </div>
        </div>
      )}

      {showCreate && (
        <CreateEvidenceModal
          missionId={missionId}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            reloadAll();
          }}
        />
      )}
      {health && !health.ok && (
        <p className="text-xs text-slate-600">Note: backend health check reported an error; some actions may fail.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deterministic radial SVG graph (no layout library)
// ---------------------------------------------------------------------------

function GraphView({
  items,
  relations,
  selectedId,
  onSelect,
}: {
  items: EvidenceItem[];
  relations: Relation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const W = 720;
  const H = 460;
  const cx0 = W / 2;
  const cy0 = H / 2;
  const R = Math.min(W, H) / 2 - 60;

  const pos = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    items.forEach((it, i) => {
      const a = (2 * Math.PI * i) / Math.max(items.length, 1) - Math.PI / 2;
      map.set(it.id, { x: cx0 + R * Math.cos(a), y: cy0 + R * Math.sin(a) });
    });
    return map;
  }, [items]);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2" aria-label="Kind legend">
        {(Object.keys(KIND_COLORS) as EvidenceKind[]).map((k) => (
          <span key={k} className="flex items-center gap-1 text-xs text-slate-700">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: KIND_COLORS[k] }} />
            {k}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border border-stone-200 bg-stone-50" role="img" aria-label="Evidence relation graph">
        {relations.map((r) => {
          const a = pos.get(r.from);
          const b = pos.get(r.to);
          if (!a || !b) return null;
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          return (
            <g key={r.id}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#a8a29e" strokeWidth={1.2} />
              <text x={mx} y={my - 4} textAnchor="middle" fontSize={10} fill="#57534e">
                {REL_LABELS[r.type]}
              </text>
            </g>
          );
        })}
        {items.map((it) => {
          const p = pos.get(it.id);
          if (!p) return null;
          const selected = it.id === selectedId;
          return (
            <g key={it.id} onClick={() => onSelect(it.id)} style={{ cursor: 'pointer' }}>
              <circle
                cx={p.x}
                cy={p.y}
                r={selected ? 14 : 10}
                fill={KIND_COLORS[it.kind]}
                stroke={selected ? '#0c0a09' : '#ffffff'}
                strokeWidth={selected ? 3 : 2}
              />
              <text x={p.x} y={p.y + 26} textAnchor="middle" fontSize={11} fill="#1c1917" fontWeight={selected ? 700 : 400}>
                {it.title.length > 22 ? `${it.title.slice(0, 22)}…` : it.title}
              </text>
              <title>{`${it.title} (${it.kind})`}</title>
            </g>
          );
        })}
      </svg>
      <p className="mt-2 text-xs text-slate-600">
        {items.length} nodes · {relations.length} relations. Switch to List for the readable alternative.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inspector panel
// ---------------------------------------------------------------------------

function Inspector({
  evidenceId,
  missionId,
  allEvidence,
  relations,
  onChanged,
  onClose,
}: {
  evidenceId: string;
  missionId: string;
  allEvidence: EvidenceItem[];
  relations: Relation[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const detail = useCollab(() => getEvidence(evidenceId), [evidenceId]);
  const impacted = useCollab(() => getImpacted(evidenceId), [evidenceId]);
  const [statusTo, setStatusTo] = useState<ClaimStatus>('supported');
  const [why, setWhy] = useState('');
  const [aiSuggested, setAiSuggested] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [relTo, setRelTo] = useState('');
  const [relType, setRelType] = useState<RelationType>('supports');
  const [relNote, setRelNote] = useState('');

  const item = detail.data;
  const outgoing = relations.filter((r) => r.from === evidenceId);
  const incoming = relations.filter((r) => r.to === evidenceId);
  const byId = useMemo(() => new Map(allEvidence.map((e) => [e.id, e])), [allEvidence]);

  const changeStatus = async () => {
    if (!why.trim()) {
      setError('A reason is required to change a claim status.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await patchEvidence(evidenceId, { claimStatus: statusTo, why: why.trim(), aiSuggested });
      setWhy('');
      detail.reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Status change failed');
    } finally {
      setSaving(false);
    }
  };

  const addRelation = async () => {
    if (!relTo) {
      setError('Choose a target item for the relation.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createRelation(missionId, { from: evidenceId, to: relTo, type: relType, note: relNote.trim() });
      setRelTo('');
      setRelNote('');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add relation');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('Archive this evidence item? The record is kept in history.')) return;
    setSaving(true);
    try {
      await deleteEvidence(evidenceId);
      onClose();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
      setSaving(false);
    }
  };

  if (detail.loading) return <LoadingState label="Loading item…" />;
  if (detail.error) return <ErrorState message={detail.error} onRetry={detail.reload} />;
  if (!item) return <EmptyState title="Item not found" />;

  return (
    <Card className="lg:sticky lg:top-4">
      <CardBody className="space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={KIND_TONES[item.kind]}>{item.kind}</Badge>
              {item.kind === 'claim' && <ClaimBadge item={item} />}
            </div>
            <h3 className="mt-2 text-base font-bold text-slate-900">{item.title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspector"
            className="rounded-lg px-2 py-1 text-lg leading-none text-slate-600 hover:bg-stone-100"
          >
            ×
          </button>
        </div>

        {error && <ErrorState message={error} />}

        <dl className="space-y-1.5 text-sm">
          <div className="flex gap-2"><dt className="w-24 shrink-0 font-semibold text-slate-700">Source</dt><dd className="text-slate-900">{item.source || '—'}</dd></div>
          <div className="flex gap-2"><dt className="w-24 shrink-0 font-semibold text-slate-700">Author</dt><dd className="text-slate-900">{item.author || '—'}</dd></div>
          <div className="flex gap-2"><dt className="w-24 shrink-0 font-semibold text-slate-700">Created</dt><dd className="text-slate-900">{fmtDate(item.createdAt)}</dd></div>
          <div className="flex gap-2"><dt className="w-24 shrink-0 font-semibold text-slate-700">Version</dt><dd className="text-slate-900">v{item.version}</dd></div>
          <div className="flex gap-2"><dt className="w-24 shrink-0 font-semibold text-slate-700">Parse</dt><dd><Badge tone={PARSE_TONES[item.content.parseStatus]}>{PARSE_LABELS[item.content.parseStatus]}</Badge></dd></div>
          {(item.locator?.page > 0 || item.locator?.sheet || item.locator?.row > 0) && (
            <div className="flex gap-2"><dt className="w-24 shrink-0 font-semibold text-slate-700">Locator</dt>
              <dd className="text-slate-900">
                {[item.locator.page > 0 && `p. ${item.locator.page}`, item.locator.sheet && `sheet ${item.locator.sheet}`, item.locator.row > 0 && `row ${item.locator.row}`].filter(Boolean).join(' · ')}
              </dd>
            </div>
          )}
          {item.importedFrom && (
            <div className="flex gap-2"><dt className="w-24 shrink-0 font-semibold text-slate-700">Imported</dt>
              <dd className="text-slate-900">from mission {item.importedFrom.missionId}{item.importedFrom.derivative ? ' (modified derivative)' : ''}</dd>
            </div>
          )}
        </dl>

        {item.content?.text && (
          <div>
            <SectionTitle className="mb-1">Content</SectionTitle>
            <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-stone-50 p-3 text-sm text-slate-800">
              {item.content.text}
            </p>
          </div>
        )}

        {item.kind === 'claim' && (
          <div className="rounded-lg border border-stone-200 p-3">
            <SectionTitle className="mb-2">Change claim status</SectionTitle>
            <div className="space-y-2">
              <Field label="New status">
                <Select value={statusTo} onChange={(e) => setStatusTo(e.target.value as ClaimStatus)}>
                  {(Object.keys(CLAIM_TONES) as ClaimStatus[]).map((s) => (
                    <option key={s} value={s}>{s.replace('-', ' ')}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Reason (required)">
                <TextArea value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why is this status warranted?" />
              </Field>
              <label className="flex items-center gap-2 text-sm text-slate-800">
                <input type="checkbox" checked={aiSuggested} onChange={(e) => setAiSuggested(e.target.checked)} className="h-4 w-4 accent-purple-700" />
                AI suggested this status <Badge tone="purple">marks suggestion, not review</Badge>
              </label>
              <Btn variant="primary" onClick={changeStatus} disabled={saving}>
                {saving ? 'Saving…' : 'Apply status'}
              </Btn>
            </div>
            {item.statusHistory.length > 0 && (
              <ul className="mt-3 space-y-1.5 border-t border-stone-200 pt-3">
                {item.statusHistory.map((s, i) => (
                  <li key={i} className="text-xs text-slate-700">
                    <span className="font-medium">{s.from || '—'} → {s.to}</span> by {s.actor} · {fmtDate(s.at)}
                    {s.aiSuggested && <Badge tone="purple" className="ml-1">AI-suggested</Badge>}
                    <span className="block text-slate-600">{s.why}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div>
          <SectionTitle className="mb-2">Relations</SectionTitle>
          {(outgoing.length > 0 || incoming.length > 0) ? (
            <ul className="space-y-1.5">
              {outgoing.map((r) => (
                <RelationRow key={r.id} text={`This ${REL_LABELS[r.type]} “${byId.get(r.to)?.title ?? r.to}”`} note={r.note} onDelete={() => deleteRelation(r.id).then(onChanged)} />
              ))}
              {incoming.map((r) => (
                <RelationRow key={r.id} text={`“${byId.get(r.from)?.title ?? r.from}” ${REL_LABELS[r.type]} this`} note={r.note} onDelete={() => deleteRelation(r.id).then(onChanged)} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-600">No relations yet.</p>
          )}
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <Field label="Link to">
              <Select value={relTo} onChange={(e) => setRelTo(e.target.value)} className="w-44">
                <option value="">Choose item…</option>
                {allEvidence.filter((e) => e.id !== evidenceId).map((e) => (
                  <option key={e.id} value={e.id}>{e.title}</option>
                ))}
              </Select>
            </Field>
            <Field label="Type">
              <Select value={relType} onChange={(e) => setRelType(e.target.value as RelationType)} className="w-36">
                {(Object.keys(REL_LABELS) as RelationType[]).map((t) => (
                  <option key={t} value={t}>{REL_LABELS[t]}</option>
                ))}
              </Select>
            </Field>
            <Btn variant="ghost" onClick={addRelation} disabled={saving}>Add</Btn>
          </div>
          <Field label="Note (optional)">
            <TextInput value={relNote} onChange={(e) => setRelNote(e.target.value)} placeholder="Why this relation holds" className="mt-2" />
          </Field>
        </div>

        <div>
          <SectionTitle className="mb-2">Downstream impact</SectionTitle>
          {impacted.loading ? (
            <p className="text-sm text-slate-600">Checking…</p>
          ) : impacted.error ? (
            <p className="text-sm text-red-800">Could not load impact: {impacted.error}</p>
          ) : (
            <ImpactedList impacted={impacted.data} />
          )}
        </div>

        <div className="flex justify-end border-t border-stone-200 pt-3">
          <Btn variant="danger" onClick={remove} disabled={saving}>
            Archive item
          </Btn>
        </div>
      </CardBody>
    </Card>
  );
}

function RelationRow({ text, note, onDelete }: { text: string; note: string; onDelete: () => void }) {
  return (
    <li className="flex items-start justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2 text-sm">
      <span className="text-slate-800">
        {text}
        {note && <span className="block text-xs text-slate-600">{note}</span>}
      </span>
      <button type="button" onClick={onDelete} aria-label="Delete relation" className="text-slate-500 hover:text-red-700">
        ×
      </button>
    </li>
  );
}

function ImpactedList({ impacted }: { impacted: Impacted | null }) {
  if (!impacted) return <p className="text-sm text-slate-600">No downstream items.</p>;
  const claims = impacted.claims ?? [];
  const decisions = impacted.decisions ?? [];
  if (claims.length === 0 && decisions.length === 0) {
    return <p className="text-sm text-slate-600">No downstream claims or decisions depend on this item.</p>;
  }
  return (
    <div className="space-y-2">
      {claims.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-2">
          <p className="text-xs font-semibold text-amber-900">Affected claims — review if this evidence changed:</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-amber-900">
            {claims.map((c) => (
              <li key={c.id}>{c.title} <span className="text-xs">({c.claimStatus})</span></li>
            ))}
          </ul>
        </div>
      )}
      {decisions.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-2">
          <p className="text-xs font-semibold text-amber-900">Affected decisions:</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-amber-900">
            {decisions.map((d) => (
              <li key={d.id}>{d.title}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CreateEvidenceModal({
  missionId,
  onClose,
  onCreated,
}: {
  missionId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [kind, setKind] = useState<EvidenceKind>('document');
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createEvidence(missionId, {
        kind,
        title: title.trim(),
        source: source.trim(),
        permissions: 'mission',
        content: { text: text.trim(), parseStatus: 'parsed', format: 'text', uploadId: '' },
        locator: { page: 0, sheet: '', row: 0, excerpt: text.trim().slice(0, 500) },
        claimStatus: kind === 'claim' ? 'unreviewed' : undefined,
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed');
      setSaving(false);
    }
  };

  return (
    <Modal title="Add evidence" onClose={onClose} wide>
      <div className="space-y-4">
        {error && <ErrorState message={error} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Kind">
            <Select value={kind} onChange={(e) => setKind(e.target.value as EvidenceKind)}>
              {(Object.keys(KIND_TONES) as EvidenceKind[]).map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </Select>
          </Field>
          <Field label="Source">
            <TextInput value={source} onChange={(e) => setSource(e.target.value)} placeholder="URL, citation, system…" />
          </Field>
        </div>
        <Field label="Title">
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short descriptive title" />
        </Field>
        <Field label="Content / notes">
          <TextArea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste text, describe the dataset, state the claim…" className="min-h-[8rem]" />
        </Field>
        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Add evidence'}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
