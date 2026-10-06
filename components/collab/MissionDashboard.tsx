// components/collab/MissionDashboard.tsx
// Mission overview: progress, success measures, attention queue, inline editing.

import React, { useState } from 'react';
import {
  addContributor,
  archiveMission,
  getDashboard,
  patchMission,
  removeContributor,
  reopenMission,
  type Mission,
  type Role,
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
  ProgressBar,
  SectionTitle,
  TextArea,
  TextInput,
  fmtDue,
  useCollab,
} from './ui';

export default function MissionDashboard({
  missionId,
  onChanged,
}: {
  missionId: string;
  onChanged?: () => void;
}) {
  const { data, loading, error, reload } = useCollab(() => getDashboard(missionId), [missionId]);
  const [editing, setEditing] = useState(false);
  const [showMilestone, setShowMilestone] = useState(false);
  const [showTask, setShowTask] = useState(false);
  const [showMeasure, setShowMeasure] = useState(false);
  const [showContributor, setShowContributor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading) return <LoadingState label="Loading mission dashboard…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <EmptyState title="No dashboard data" />;

  const { mission, progress, unresolvedQuestions, upcomingMilestones, experimentsAwaitingResults } = data;
  const p = progress ?? { milestonesDone: 0, milestonesTotal: 0, tasksDone: 0, tasksTotal: 0 };

  const mutate = async (fn: () => Promise<Mission>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      reload();
      onChanged?.();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const toggleMilestone = (id: string, done: boolean) =>
    mutate(() =>
      patchMission(missionId, {
        milestones: mission.milestones.map((m) => (m.id === id ? { ...m, status: done ? 'done' : 'open' } : m)),
      }),
    );

  const toggleTask = (id: string, done: boolean) =>
    mutate(() =>
      patchMission(missionId, {
        tasks: mission.tasks.map((t) => (t.id === id ? { ...t, status: done ? 'done' : 'todo' } : t)),
      }),
    );

  const deleteMilestone = (id: string) =>
    mutate(() => patchMission(missionId, { milestones: mission.milestones.filter((m) => m.id !== id) }));

  const deleteTask = (id: string) =>
    mutate(() => patchMission(missionId, { tasks: mission.tasks.filter((t) => t.id !== id) }));

  const deleteMeasure = (id: string) =>
    mutate(() => patchMission(missionId, { successMeasures: mission.successMeasures.filter((s) => s.id !== id) }));

  const changeRole = (actor: string, role: Role) =>
    mutate(() => addContributor(missionId, { actor, role }));

  return (
    <div className="space-y-5">
      {actionError && <ErrorState message={actionError} />}

      {/* Header card */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight">{mission.title}</h2>
                <Badge tone={mission.status === 'active' ? 'green' : 'slate'}>{mission.status}</Badge>
                <span className="text-xs text-slate-600">v{mission.version}</span>
              </div>
              {mission.objective && (
                <p className="mt-1 text-sm font-medium text-slate-800">
                  <span className="font-semibold">Objective:</span> {mission.objective}
                </p>
              )}
              {mission.description && <p className="mt-1 max-w-3xl text-sm text-slate-600">{mission.description}</p>}
              <p className="mt-2 text-xs text-slate-600">
                Owner: <span className="font-medium text-slate-800">{mission.owner}</span>
              </p>
              <div className="mt-2">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-700">Contributors</span>
                  <Btn variant="subtle" onClick={() => setShowContributor(true)} disabled={busy}>
                    + Add
                  </Btn>
                </div>
                {mission.contributors.length === 0 ? (
                  <p className="text-xs text-slate-600">No contributors yet.</p>
                ) : (
                  <ul className="space-y-1">
                    {mission.contributors.map((c) => (
                      <li key={c.actor} className="flex items-center gap-2 text-xs">
                        <span className="font-medium text-slate-800">{c.actor}</span>
                        <select
                          value={c.role}
                          disabled={busy}
                          onChange={(e) => changeRole(c.actor, e.target.value as Role)}
                          aria-label={`Role for ${c.actor}`}
                          className="rounded border border-stone-300 bg-white px-1 py-0.5 text-xs"
                        >
                          <option value="owner">owner</option>
                          <option value="editor">editor</option>
                          <option value="viewer">viewer</option>
                        </select>
                        {c.actor !== mission.owner && (
                          <button
                            onClick={() => mutate(() => removeContributor(missionId, c.actor))}
                            disabled={busy}
                            aria-label={`Remove ${c.actor}`}
                            className="text-slate-500 hover:text-red-700"
                          >
                            ✕
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Btn variant="ghost" onClick={() => setEditing(true)} disabled={busy}>
                Edit
              </Btn>
              {mission.status === 'active' ? (
                <Btn variant="danger" onClick={() => mutate(() => archiveMission(missionId))} disabled={busy}>
                  Archive
                </Btn>
              ) : (
                <Btn variant="primary" onClick={() => mutate(() => reopenMission(missionId))} disabled={busy}>
                  Reopen
                </Btn>
              )}
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Progress + constraints */}
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardBody className="space-y-4">
            <SectionTitle>Progress</SectionTitle>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-800">Milestones</span>
                <Btn variant="subtle" onClick={() => setShowMilestone(true)}>
                  + Add
                </Btn>
              </div>
              <ProgressBar value={p.milestonesDone} max={p.milestonesTotal} />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-800">Tasks</span>
                <Btn variant="subtle" onClick={() => setShowTask(true)}>
                  + Add
                </Btn>
              </div>
              <ProgressBar value={p.tasksDone} max={p.tasksTotal} />
            </div>
            {mission.milestones.length > 0 && (
              <ul className="space-y-1.5">
                {mission.milestones.map((m) => (
                  <li key={m.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={m.status === 'done'}
                      disabled={busy}
                      onChange={(e) => toggleMilestone(m.id, e.target.checked)}
                      aria-label={`Mark milestone "${m.title}" ${m.status === 'done' ? 'open' : 'done'}`}
                      className="h-4 w-4 accent-slate-800"
                    />
                    <span className={m.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-900'}>
                      {m.title}
                    </span>
                    <span className="ml-auto text-xs text-slate-600">{fmtDue(m.due)}</span>
                    <button
                      onClick={() => deleteMilestone(m.id)}
                      disabled={busy}
                      aria-label={`Delete milestone "${m.title}"`}
                      className="text-slate-400 hover:text-red-700"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {mission.tasks.length > 0 && (
              <ul className="space-y-1.5 border-t border-stone-200 pt-3">
                {mission.tasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={t.status === 'done'}
                      disabled={busy}
                      onChange={(e) => toggleTask(t.id, e.target.checked)}
                      aria-label={`Mark task "${t.title}" ${t.status === 'done' ? 'open' : 'done'}`}
                      className="h-4 w-4 accent-slate-800"
                    />
                    <span className={t.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-900'}>
                      {t.title}
                    </span>
                    {t.assignee && <span className="text-xs text-slate-600">{t.assignee}</span>}
                    <button
                      onClick={() => deleteTask(t.id)}
                      disabled={busy}
                      aria-label={`Delete task "${t.title}"`}
                      className="ml-auto text-slate-400 hover:text-red-700"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-3">
            <SectionTitle>Constraints</SectionTitle>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {(
                [
                  ['Budget', mission.constraints.budget],
                  ['Time', mission.constraints.time],
                  ['Resources', mission.constraints.resources],
                  ['Permissions', mission.constraints.permissions],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="rounded-lg bg-stone-50 p-3">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-700">{k}</dt>
                  <dd className="mt-0.5 text-slate-900">{v || '—'}</dd>
                </div>
              ))}
            </dl>
            <div className="flex items-center justify-between pt-2">
              <SectionTitle>Success measures</SectionTitle>
              <Btn variant="subtle" onClick={() => setShowMeasure(true)} disabled={busy}>
                + Add
              </Btn>
            </div>
            {mission.successMeasures.length === 0 ? (
              <p className="text-sm text-slate-600">No success measures defined yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-slate-700">
                      <th className="py-2 pr-2">Measure</th>
                      <th className="py-2 pr-2">Baseline</th>
                      <th className="py-2 pr-2">Target</th>
                      <th className="py-2 pr-2">Method</th>
                      <th className="py-2"><span className="sr-only">Delete</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {mission.successMeasures.map((s) => (
                      <tr key={s.id} className="border-b border-stone-100 last:border-0">
                        <td className="py-2 pr-2 font-medium text-slate-900">
                          {s.name}
                          {s.unit && <span className="ml-1 text-xs font-normal text-slate-600">({s.unit})</span>}
                        </td>
                        <td className="py-2 pr-2 text-slate-800">{s.baseline || '—'}</td>
                        <td className="py-2 pr-2 text-slate-800">{s.target || '—'}</td>
                        <td className="py-2 pr-2 text-slate-600">{s.method || '—'}</td>
                        <td className="py-2">
                          <button
                            onClick={() => deleteMeasure(s.id)}
                            disabled={busy}
                            aria-label={`Delete measure "${s.name}"`}
                            className="text-slate-400 hover:text-red-700"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Attention queue */}
      <Card>
        <CardBody>
          <SectionTitle className="mb-3">Attention queue</SectionTitle>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <h4 className="mb-2 text-sm font-semibold text-slate-800">
                Unresolved questions ({unresolvedQuestions.length})
              </h4>
              {unresolvedQuestions.length === 0 ? (
                <p className="text-sm text-slate-600">None — every question links to a decision.</p>
              ) : (
                <ul className="space-y-1.5">
                  {unresolvedQuestions.map((q) => (
                    <li key={q.id} className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
                      {q.title}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h4 className="mb-2 text-sm font-semibold text-slate-800">
                Upcoming milestones ({upcomingMilestones.length})
              </h4>
              {upcomingMilestones.length === 0 ? (
                <p className="text-sm text-slate-600">Nothing due in the next 14 days.</p>
              ) : (
                <ul className="space-y-1.5">
                  {upcomingMilestones.map((m) => (
                    <li key={m.id} className="rounded-lg bg-blue-50 p-2 text-sm text-blue-900">
                      <span className="font-medium">{m.title}</span>
                      <span className="block text-xs">{fmtDue(m.due)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h4 className="mb-2 text-sm font-semibold text-slate-800">
                Experiments awaiting results ({experimentsAwaitingResults.length})
              </h4>
              {experimentsAwaitingResults.length === 0 ? (
                <p className="text-sm text-slate-600">No experiments in flight.</p>
              ) : (
                <ul className="space-y-1.5">
                  {experimentsAwaitingResults.map((e) => (
                    <li key={e.id} className="rounded-lg bg-purple-50 p-2 text-sm text-purple-900">
                      <span className="font-medium">{e.title}</span>
                      <span className="block text-xs">Status: {e.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </CardBody>
      </Card>

      {editing && (
        <EditMissionModal
          mission={mission}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
            onChanged?.();
          }}
        />
      )}
      {showMilestone && (
        <AddItemModal
          title="Add milestone"
          fields={[
            { key: 'title', label: 'Title', required: true },
            { key: 'due', label: 'Due date', type: 'date' },
          ]}
          onClose={() => setShowMilestone(false)}
          onSave={async (vals) => {
            await patchMission(missionId, {
              milestones: [...mission.milestones, { id: '', title: vals.title, due: vals.due || '', status: 'open', dependsOn: [] }],
            });
            setShowMilestone(false);
            reload();
          }}
        />
      )}
      {showTask && (
        <AddItemModal
          title="Add task"
          fields={[
            { key: 'title', label: 'Title', required: true },
            { key: 'assignee', label: 'Assignee' },
          ]}
          onClose={() => setShowTask(false)}
          onSave={async (vals) => {
            await patchMission(missionId, {
              tasks: [...mission.tasks, { id: '', title: vals.title, status: 'todo', dependsOn: [], assignee: vals.assignee || '' }],
            });
            setShowTask(false);
            reload();
          }}
        />
      )}
      {showMeasure && (
        <AddItemModal
          title="Add success measure"
          fields={[
            { key: 'name', label: 'Measure name', required: true },
            { key: 'baseline', label: 'Baseline' },
            { key: 'target', label: 'Target' },
            { key: 'unit', label: 'Unit (e.g. %, ms, count)' },
            { key: 'method', label: 'How it will be measured' },
          ]}
          onClose={() => setShowMeasure(false)}
          onSave={async (vals) => {
            await patchMission(missionId, {
              successMeasures: [
                ...mission.successMeasures,
                { id: '', name: vals.name, baseline: vals.baseline || '', target: vals.target || '', unit: vals.unit || '', method: vals.method || '' },
              ],
            });
            setShowMeasure(false);
            reload();
          }}
        />
      )}
      {showContributor && (
        <AddContributorModal
          onClose={() => setShowContributor(false)}
          onSaved={() => {
            setShowContributor(false);
            reload();
            onChanged?.();
          }}
          save={(actor, role) => addContributor(missionId, { actor, role })}
        />
      )}
    </div>
  );
}

function EditMissionModal({
  mission,
  onClose,
  onSaved,
}: {
  mission: Mission;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(mission.title);
  const [objective, setObjective] = useState(mission.objective);
  const [description, setDescription] = useState(mission.description);
  const [budget, setBudget] = useState(mission.constraints.budget);
  const [time, setTime] = useState(mission.constraints.time);
  const [resources, setResources] = useState(mission.constraints.resources);
  const [permissions, setPermissions] = useState(mission.constraints.permissions);
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
      await patchMission(mission.id, {
        title: title.trim(),
        objective: objective.trim(),
        description: description.trim(),
        constraints: { budget, time, resources, permissions },
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setSaving(false);
    }
  };

  return (
    <Modal title="Edit mission" onClose={onClose} wide>
      <div className="space-y-4">
        {error && <ErrorState message={error} />}
        <Field label="Title">
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Objective">
          <TextInput value={objective} onChange={(e) => setObjective(e.target.value)} />
        </Field>
        <Field label="Description">
          <TextArea value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Budget constraint">
            <TextInput value={budget} onChange={(e) => setBudget(e.target.value)} />
          </Field>
          <Field label="Time constraint">
            <TextInput value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field label="Resources constraint">
            <TextInput value={resources} onChange={(e) => setResources(e.target.value)} />
          </Field>
          <Field label="Permissions constraint">
            <TextInput value={permissions} onChange={(e) => setPermissions(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

function AddContributorModal({
  onClose,
  onSaved,
  save,
}: {
  onClose: () => void;
  onSaved: () => void;
  save: (actor: string, role: Role) => Promise<Mission>;
}) {
  const [actor, setActor] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!actor.trim()) {
      setError('Contributor name or id is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await save(actor.trim(), role);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setSaving(false);
    }
  };

  return (
    <Modal title="Add contributor" onClose={onClose}>
      <div className="space-y-4">
        {error && <ErrorState message={error} />}
        <Field label="Contributor (name or id)">
          <TextInput value={actor} onChange={(e) => setActor(e.target.value)} placeholder="e.g. ada" />
        </Field>
        <Field label="Role">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          >
            <option value="owner">owner — full control</option>
            <option value="editor">editor — can change mission content</option>
            <option value="viewer">viewer — read-only</option>
          </select>
        </Field>
        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : 'Add'}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

function AddItemModal({
  title,
  fields,
  onClose,
  onSave,
}: {
  title: string;
  fields: { key: string; label: string; required?: boolean; type?: string }[];
  onClose: () => void;
  onSave: (vals: Record<string, string>) => Promise<void>;
}) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    for (const f of fields) {
      if (f.required && !(vals[f.key] || '').trim()) {
        setError(`${f.label} is required.`);
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(vals);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setSaving(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-4">
        {error && <ErrorState message={error} />}
        {fields.map((f) => (
          <Field key={f.key} label={f.label}>
            <TextInput
              type={f.type ?? 'text'}
              value={vals[f.key] ?? ''}
              onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
            />
          </Field>
        ))}
        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Add'}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
