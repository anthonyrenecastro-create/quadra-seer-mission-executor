// components/collab/CollabWorkspace.tsx
// Self-contained collaboration workspace: mission switcher + 7 tabs.
// The main agent mounts this (no required props).

import React, { useEffect, useState } from 'react';
import {
  getHealth,
  listMissions,
  createMission,
  seedDemo,
  type Health,
  type Mission,
} from '../../services/collabService';
import { Badge, Btn, EmptyState, ErrorState, Field, LoadingState, Modal, TextArea, TextInput, cx } from './ui';
import MissionDashboard from './MissionDashboard';
import EvidenceMap from './EvidenceMap';
import BranchView from './BranchView';
import ExperimentLedger from './ExperimentLedger';
import ContributionExchange from './ContributionExchange';
import AgentWorkshop from './AgentWorkshop';
import ActivityTimeline from './ActivityTimeline';

type Tab = 'overview' | 'evidence' | 'branches' | 'experiments' | 'exchange' | 'agents' | 'activity';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'branches', label: 'Branches' },
  { id: 'experiments', label: 'Experiments' },
  { id: 'exchange', label: 'Exchange' },
  { id: 'agents', label: 'Agents' },
  { id: 'activity', label: 'Activity' },
];

function HealthBadge({ health, error }: { health: Health | null; error: string | null }) {
  if (error || !health) {
    return (
      <Badge tone="red" title={error ?? 'No response from the collaboration backend'}>
        Backend unreachable
      </Badge>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge tone={health.ok ? 'green' : 'red'} title={`Schema v${health.schemaVersion}, auth: ${health.authMode}`}>
        {health.ok ? 'Backend connected' : 'Backend error'}
      </Badge>
      <Badge tone={health.hrm ? 'green' : 'slate'} title="HRM simulation engine availability">
        {health.hrm ? 'HRM ready' : 'HRM unavailable'}
      </Badge>
      <Badge tone={health.python ? 'green' : 'slate'} title="Python runtime availability">
        {health.python ? 'Python available' : 'Python unavailable'}
      </Badge>
    </span>
  );
}

export default function CollabWorkspace() {
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [missionsLoading, setMissionsLoading] = useState(true);
  const [missionsError, setMissionsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [showNew, setShowNew] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const loadHealth = async () => {
    try {
      const h = await getHealth();
      setHealth(h);
      setHealthError(null);
    } catch (e) {
      setHealth(null);
      setHealthError(e instanceof Error ? e.message : 'Health check failed');
    }
  };

  const loadMissions = async () => {
    setMissionsLoading(true);
    setMissionsError(null);
    try {
      const list = await listMissions();
      setMissions(list);
      setSelectedId((prev) => {
        if (prev && list.some((m) => m.id === prev)) return prev;
        return list.length > 0 ? list[0].id : null;
      });
    } catch (e) {
      setMissionsError(e instanceof Error ? e.message : 'Could not load missions');
    } finally {
      setMissionsLoading(false);
    }
  };

  useEffect(() => {
    loadHealth();
    loadMissions();
  }, []);

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const r = await seedDemo();
      await loadMissions();
      if (r && typeof r.missionId === 'string') setSelectedId(r.missionId);
    } catch (e) {
      setMissionsError(e instanceof Error ? e.message : 'Demo seeding failed');
    } finally {
      setSeeding(false);
    }
  };

  const selected = missions.find((m) => m.id === selectedId) ?? null;

  return (
    <div className="min-h-full bg-stone-50 text-slate-900">
      {/* Header */}
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="mr-auto">
            <h1 className="text-lg font-bold tracking-tight">Collaboration</h1>
            <p className="text-xs text-slate-600">Missions, evidence, experiments, and shared outcomes</p>
          </div>
          <HealthBadge health={health} error={healthError} />
        </div>
        {/* Mission switcher row */}
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 pb-3 sm:px-6">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-700" htmlFor="mission-switcher">
            Mission
          </label>
          {missionsLoading ? (
            <span className="text-sm text-slate-600">Loading missions…</span>
          ) : (
            <select
              id="mission-switcher"
              value={selectedId ?? ''}
              onChange={(e) => setSelectedId(e.target.value || null)}
              className="min-w-[12rem] rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
            >
              {missions.length === 0 && <option value="">No missions yet</option>}
              {missions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                  {m.status === 'archived' ? ' (archived)' : ''}
                </option>
              ))}
            </select>
          )}
          <Btn variant="ghost" onClick={() => setShowNew(true)}>
            New mission
          </Btn>
          {import.meta.env.DEV && (
            <Btn variant="subtle" onClick={handleSeed} disabled={seeding}>
              {seeding ? 'Seeding…' : 'Load demo mission'}
            </Btn>
          )}
        </div>
        {/* Tabs */}
        <nav aria-label="Workspace sections" className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? 'page' : undefined}
                className={cx(
                  'whitespace-nowrap rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                  tab === t.id
                    ? 'border-slate-900 bg-stone-50 text-slate-900'
                    : 'border-transparent text-slate-600 hover:border-stone-300 hover:text-slate-900',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </nav>
      </header>

      {/* Body */}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {missionsError && (
          <div className="mb-4">
            <ErrorState message={missionsError} onRetry={loadMissions} />
          </div>
        )}
        {missionsLoading ? (
          <LoadingState label="Loading missions…" />
        ) : !selected ? (
          <EmptyState
            title="No mission selected"
            hint="Create a mission to start organizing evidence, branches, experiments, and contributions — or load the labeled demo mission to explore the full workflow."
          >
            <Btn variant="primary" onClick={() => setShowNew(true)}>
              New mission
            </Btn>
            {import.meta.env.DEV && (
              <Btn variant="ghost" onClick={handleSeed} disabled={seeding}>
                {seeding ? 'Seeding…' : 'Load demo mission'}
              </Btn>
            )}
          </EmptyState>
        ) : (
          <div key={selected.id}>
            {tab === 'overview' && <MissionDashboard missionId={selected.id} onChanged={loadMissions} />}
            {tab === 'evidence' && <EvidenceMap missionId={selected.id} health={health} />}
            {tab === 'branches' && <BranchView missionId={selected.id} />}
            {tab === 'experiments' && <ExperimentLedger missionId={selected.id} health={health} />}
            {tab === 'exchange' && <ContributionExchange missionId={selected.id} allMissions={missions} />}
            {tab === 'agents' && <AgentWorkshop missionId={selected.id} health={health} />}
            {tab === 'activity' && <ActivityTimeline missionId={selected.id} />}
          </div>
        )}
      </main>

      {showNew && (
        <NewMissionModal
          onClose={() => setShowNew(false)}
          onCreated={(m) => {
            setShowNew(false);
            loadMissions().then(() => setSelectedId(m.id));
          }}
        />
      )}
    </div>
  );
}

function NewMissionModal({ onClose, onCreated }: { onClose: () => void; onCreated: (m: Mission) => void }) {
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!title.trim()) {
      setError('A title is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const m = await createMission({ title: title.trim(), objective: objective.trim(), description: description.trim() });
      onCreated(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create mission');
      setSaving(false);
    }
  };

  return (
    <Modal title="New mission" onClose={onClose}>
      <div className="space-y-4">
        {error && <ErrorState message={error} />}
        <Field label="Title">
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Urban Heat Mapping Pilot" />
        </Field>
        <Field label="Objective">
          <TextInput value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="What does success look like?" />
        </Field>
        <Field label="Description">
          <TextArea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Context, scope, background…" />
        </Field>
        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>
            {saving ? 'Creating…' : 'Create mission'}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
