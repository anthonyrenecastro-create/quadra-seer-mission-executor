// components/collab/ContributionExchange.tsx
// Contribution packages: explicit artifact selection, preview, publish,
// import into another mission (attribution preserved), JSON export.

import React, { useState } from 'react';
import {
  createContribution,
  downloadContributionExport,
  getContribution,
  importContribution,
  listAgents,
  listBranches,
  listContributions,
  listEvidence,
  listExperiments,
  previewContribution,
  publishContribution,
  type ContributionArtifact,
  type ContributionPackage,
  type Mission,
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
  fmtDate,
  useCollab,
} from './ui';

const KIND_TONES: Record<ContributionPackage['kind'], 'blue' | 'teal' | 'purple' | 'green' | 'amber'> = {
  finding: 'blue',
  dataset: 'teal',
  method: 'purple',
  'experiment-result': 'green',
  agent: 'amber',
};

export default function ContributionExchange({
  missionId,
  allMissions,
}: {
  missionId: string;
  allMissions: Mission[];
}) {
  const packages = useCollab(() => listContributions(missionId), [missionId]);
  const [showBuilder, setShowBuilder] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      packages.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  if (packages.loading) return <LoadingState label="Loading contributions…" />;
  if (packages.error) return <ErrorState message={packages.error} onRetry={packages.reload} />;

  const list = packages.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Contribution exchange</h2>
          <p className="text-sm text-slate-600">
            Share findings, datasets, methods, experiment results, or agents with another mission.
            You explicitly choose what goes in — private mission content stays private by default.
          </p>
        </div>
        <Btn variant="primary" onClick={() => setShowBuilder(true)}>
          + Build package
        </Btn>
      </div>

      {error && <ErrorState message={error} />}

      {list.length === 0 ? (
        <EmptyState
          title="No contribution packages yet"
          hint="Package up a result worth sharing — artifacts are frozen at their current versions, and attribution travels with them."
        >
          <Btn variant="primary" onClick={() => setShowBuilder(true)}>
            + Build package
          </Btn>
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {list.map((p) => (
            <Card key={p.id}>
              <CardBody>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={KIND_TONES[p.kind]}>{p.kind}</Badge>
                  <Badge tone={p.status === 'published' ? 'green' : 'slate'}>{p.status}</Badge>
                  <span className="text-xs text-slate-600">v{p.version} · {p.artifacts.length} artifacts</span>
                </div>
                <p className="mt-2 font-semibold text-slate-900">{p.title}</p>
                <p className="mt-1 line-clamp-2 text-sm text-slate-600">{p.summary}</p>
                <p className="mt-1 text-xs text-slate-600">Attribution: {p.attribution || '—'}</p>
                {p.imports.length > 0 && (
                  <p className="mt-1 text-xs text-teal-800">
                    Imported by {p.imports.length} mission{p.imports.length === 1 ? '' : 's'}
                    {p.imports.some((i) => i.derivative) ? ' (includes modified derivatives)' : ''}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Btn variant="ghost" onClick={() => setPreviewId(p.id)}>Preview</Btn>
                  {p.status === 'draft' && (
                    <Btn variant="primary" onClick={() => act(() => publishContribution(p.id))} disabled={busy}>
                      Publish
                    </Btn>
                  )}
                  {p.status === 'published' && (
                    <>
                      <Btn variant="ghost" onClick={() => setImportId(p.id)} disabled={busy}>
                        Import into mission…
                      </Btn>
                      <Btn
                        variant="subtle"
                        onClick={() => downloadContributionExport(p.id, `${p.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`)}
                      >
                        Export JSON
                      </Btn>
                    </>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {showBuilder && (
        <PackageBuilderModal
          missionId={missionId}
          onClose={() => setShowBuilder(false)}
          onSaved={() => {
            setShowBuilder(false);
            packages.reload();
          }}
        />
      )}
      {previewId && (
        <PreviewModal id={previewId} onClose={() => setPreviewId(null)} />
      )}
      {importId && (
        <ImportModal
          id={importId}
          missions={allMissions.filter((m) => m.id !== missionId)}
          onClose={() => setImportId(null)}
          onImported={() => {
            setImportId(null);
            packages.reload();
          }}
        />
      )}
    </div>
  );
}

function useMissionArtifacts(missionId: string) {
  const evidence = useCollab(() => listEvidence(missionId), [missionId]);
  const branches = useCollab(() => listBranches(missionId), [missionId]);
  const experiments = useCollab(() => listExperiments(missionId), [missionId]);
  const agents = useCollab(() => listAgents(missionId), [missionId]);
  return { evidence, branches, experiments, agents };
}

function PackageBuilderModal({
  missionId,
  onClose,
  onSaved,
}: {
  missionId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { evidence, branches, experiments, agents } = useMissionArtifacts(missionId);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [intendedUse, setIntendedUse] = useState('');
  const [kind, setKind] = useState<ContributionPackage['kind']>('finding');
  const [license, setLicense] = useState('');
  const [limitations, setLimitations] = useState('');
  const [reproduction, setReproduction] = useState('');
  const [selected, setSelected] = useState<ContributionArtifact[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (a: ContributionArtifact) => {
    setSelected((s) => (s.some((x) => x.kind === a.kind && x.refId === a.refId) ? s.filter((x) => !(x.kind === a.kind && x.refId === a.refId)) : [...s, a]));
  };

  const check = (a: ContributionArtifact) => selected.some((x) => x.kind === a.kind && x.refId === a.refId);

  const save = async () => {
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    if (selected.length === 0) {
      setError('Select at least one artifact to include — sharing is explicit.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createContribution(missionId, {
        title: title.trim(),
        summary: summary.trim(),
        intendedUse: intendedUse.trim(),
        kind,
        license: license.trim(),
        limitations: limitations.trim(),
        reproduction: reproduction.trim(),
        artifacts: selected,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed');
      setSaving(false);
    }
  };

  const group = (
    label: string,
    items: { id: string; title?: string; name?: string; version: number }[] | null,
    loading: boolean,
    kindName: string,
  ) => (
    <div>
      <SectionTitle className="mb-1">{label}</SectionTitle>
      {loading ? (
        <p className="text-sm text-slate-600">Loading…</p>
      ) : !items || items.length === 0 ? (
        <p className="text-sm text-slate-600">None.</p>
      ) : (
        <ul className="max-h-40 space-y-1 overflow-y-auto">
          {items.map((it) => {
            const a: ContributionArtifact = { kind: kindName, refId: it.id, version: it.version, label: it.title ?? it.name ?? it.id };
            return (
              <li key={it.id}>
                <label className="flex items-start gap-2 rounded-lg border border-stone-200 px-3 py-1.5 text-sm hover:bg-stone-50">
                  <input type="checkbox" checked={check(a)} onChange={() => toggle(a)} className="mt-0.5 h-4 w-4 accent-slate-800" />
                  <span className="text-slate-800">
                    {a.label} <span className="text-xs text-slate-600">(v{it.version})</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  return (
    <Modal title="Build contribution package" onClose={onClose} wide>
      <div className="space-y-4">
        {error && <ErrorState message={error} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title">
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Kind">
            <Select value={kind} onChange={(e) => setKind(e.target.value as ContributionPackage['kind'])}>
              {(['finding', 'dataset', 'method', 'experiment-result', 'agent'] as const).map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Summary">
          <TextArea value={summary} onChange={(e) => setSummary(e.target.value)} />
        </Field>
        <Field label="Intended use">
          <TextInput value={intendedUse} onChange={(e) => setIntendedUse(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="License / usage permissions">
            <TextInput value={license} onChange={(e) => setLicense(e.target.value)} placeholder="e.g. CC-BY-4.0" />
          </Field>
          <Field label="Limitations">
            <TextInput value={limitations} onChange={(e) => setLimitations(e.target.value)} />
          </Field>
          <Field label="Reproduction">
            <TextInput value={reproduction} onChange={(e) => setReproduction(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {group('Evidence', evidence.data, evidence.loading, 'evidence')}
          {group('Branches', branches.data, branches.loading, 'branch')}
          {group('Experiments', experiments.data, experiments.loading, 'experiment')}
          {group('Agents', agents.data, agents.loading, 'agent')}
        </div>
        <p className="text-xs text-slate-600">
          {selected.length} artifact{selected.length === 1 ? '' : 's'} selected. Artifacts are frozen at their current versions.
        </p>
        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>
            {saving ? 'Creating…' : 'Create package (draft)'}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

function PreviewModal({ id, onClose }: { id: string; onClose: () => void }) {
  const preview = useCollab(() => previewContribution(id), [id]);
  return (
    <Modal title="Package preview" onClose={onClose} wide>
      {preview.loading && <LoadingState label="Loading preview…" />}
      {preview.error && <ErrorState message={preview.error} onRetry={preview.reload} />}
      {preview.data && <PackageDetail pkg={preview.data} />}
    </Modal>
  );
}

function PackageDetail({ pkg }: { pkg: ContributionPackage }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={KIND_TONES[pkg.kind]}>{pkg.kind}</Badge>
        <Badge tone={pkg.status === 'published' ? 'green' : 'slate'}>{pkg.status}</Badge>
      </div>
      <h3 className="text-base font-bold text-slate-900">{pkg.title}</h3>
      {pkg.summary && <p className="text-slate-800">{pkg.summary}</p>}
      <dl className="space-y-1.5">
        {[
          ['Intended use', pkg.intendedUse],
          ['Attribution', pkg.attribution],
          ['Provenance', pkg.provenance],
          ['License', pkg.license],
          ['Limitations', pkg.limitations],
          ['Reproduction', pkg.reproduction],
        ].map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="w-32 shrink-0 font-semibold text-slate-700">{k}</dt>
            <dd className="text-slate-900">{v || '—'}</dd>
          </div>
        ))}
      </dl>
      <div>
        <SectionTitle className="mb-1">Artifacts ({pkg.artifacts.length})</SectionTitle>
        <ul className="space-y-1">
          {pkg.artifacts.map((a, i) => (
            <li key={i} className="rounded-lg bg-stone-50 px-3 py-1.5 text-slate-800">
              <span className="font-medium">{a.label}</span>
              <span className="ml-2 text-xs text-slate-600">{a.kind} · {a.refId} · frozen at v{a.version}</span>
            </li>
          ))}
        </ul>
      </div>
      {pkg.imports.length > 0 && (
        <div>
          <SectionTitle className="mb-1">Import history</SectionTitle>
          <ul className="space-y-1 text-slate-800">
            {pkg.imports.map((im, i) => (
              <li key={i} className="text-sm">
                Imported into mission {im.missionId} by {im.actor} · {fmtDate(im.at)}
                {im.derivative ? <Badge tone="amber" className="ml-2">modified derivative</Badge> : <Badge tone="teal" className="ml-2">original</Badge>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ImportModal({
  id,
  missions,
  onClose,
  onImported,
}: {
  id: string;
  missions: Mission[];
  onClose: () => void;
  onImported: () => void;
}) {
  const detail = useCollab(() => getContribution(id), [id]);
  const [targetId, setTargetId] = useState('');
  const [derivativeNote, setDerivativeNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doImport = async () => {
    if (!targetId) {
      setError('Choose a target mission.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await importContribution(id, { targetMissionId: targetId, derivativeNote: derivativeNote.trim() || undefined });
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
      setSaving(false);
    }
  };

  return (
    <Modal title="Import package into another mission" onClose={onClose}>
      <div className="space-y-4">
        {error && <ErrorState message={error} />}
        {detail.loading && <LoadingState label="Loading package…" />}
        {detail.data && (
          <p className="text-sm text-slate-700">
            Importing <span className="font-semibold text-slate-900">{detail.data.title}</span> ({detail.data.artifacts.length} artifacts).
            Artifacts are copied as new evidence items with attribution preserved.
          </p>
        )}
        <Field label="Target mission">
          <Select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">Choose mission…</option>
            {missions.map((m) => (
              <option key={m.id} value={m.id}>{m.title}</option>
            ))}
          </Select>
        </Field>
        <Field label="Derivative note (optional)" hint="If you plan to modify the artifacts on import, say so — the import is marked as a modified derivative.">
          <TextInput value={derivativeNote} onChange={(e) => setDerivativeNote(e.target.value)} placeholder="e.g. adapted thresholds for our dataset" />
        </Field>
        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={doImport} disabled={saving || missions.length === 0}>
            {saving ? 'Importing…' : 'Import package'}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
