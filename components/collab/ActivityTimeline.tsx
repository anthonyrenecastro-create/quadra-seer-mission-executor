// components/collab/ActivityTimeline.tsx
// Chronological activity feed + attention queue for the mission.

import React from 'react';
import { getActivity, getAttention, type ActivityItem } from '../../services/collabService';
import {
  Badge,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  LoadingState,
  SectionTitle,
  fmtDate,
  useCollab,
} from './ui';

const TYPE_TONES: Record<string, 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'teal'> = {
  'mission.created': 'green',
  'mission.updated': 'slate',
  'mission.archived': 'amber',
  'mission.reopened': 'green',
  'evidence.added': 'blue',
  'evidence.status-changed': 'purple',
  'relation.added': 'slate',
  'branch.created': 'blue',
  'branch.merged': 'purple',
  'branch.archived': 'slate',
  'experiment.created': 'blue',
  'experiment.started': 'amber',
  'experiment.result-recorded': 'green',
  'contribution.published': 'teal',
  'contribution.imported': 'teal',
  'agent.created': 'blue',
  'agent.run': 'slate',
  'agent.deployed': 'green',
  'outcome.signal-mapped': 'green',
};

function toneFor(type: string) {
  return TYPE_TONES[type] ?? 'slate';
}

function ActivityRow({ item }: { item: ActivityItem }) {
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-slate-400" aria-hidden />
        <span className="w-px flex-1 bg-stone-200" aria-hidden />
      </div>
      <div className="pb-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={toneFor(item.type)}>{item.type}</Badge>
          <span className="text-xs text-slate-600">{fmtDate(item.at)} · {item.actor}</span>
        </div>
        <p className="mt-1 text-sm text-slate-800">{item.summary}</p>
        {item.ref?.id && (
          <p className="text-xs text-slate-600">
            ref: {item.ref.kind} {item.ref.id}
          </p>
        )}
      </div>
    </li>
  );
}

export default function ActivityTimeline({ missionId }: { missionId: string }) {
  const activity = useCollab(() => getActivity(missionId), [missionId]);
  const attention = useCollab(() => getAttention(missionId), [missionId]);

  const reloadAll = () => {
    activity.reload();
    attention.reload();
  };

  if (activity.loading || attention.loading) return <LoadingState label="Loading activity…" />;
  if (activity.error) return <ErrorState message={activity.error} onRetry={reloadAll} />;
  if (attention.error) return <ErrorState message={attention.error} onRetry={reloadAll} />;

  const feed = [...(activity.data ?? [])].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  );
  const att = attention.data;

  return (
    <div className="space-y-5">
      {/* Attention queue */}
      <Card>
        <CardBody>
          <SectionTitle className="mb-3">Attention queue</SectionTitle>
          {!att ||
          (att.unresolvedQuestions.length === 0 &&
            att.upcomingMilestones.length === 0 &&
            att.experimentsAwaitingResults.length === 0) ? (
            <p className="text-sm text-slate-600">All clear — no unresolved questions, upcoming milestones, or experiments awaiting results.</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <h4 className="mb-2 text-sm font-semibold text-slate-800">
                  Unresolved questions ({att.unresolvedQuestions.length})
                </h4>
                <ul className="space-y-1.5">
                  {att.unresolvedQuestions.map((q) => (
                    <li key={q.id} className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">{q.title}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="mb-2 text-sm font-semibold text-slate-800">
                  Upcoming milestones ({att.upcomingMilestones.length})
                </h4>
                <ul className="space-y-1.5">
                  {att.upcomingMilestones.map((m) => (
                    <li key={m.id} className="rounded-lg bg-blue-50 p-2 text-sm text-blue-900">
                      <span className="font-medium">{m.title}</span>
                      <span className="block text-xs">{m.due ? new Date(m.due).toLocaleDateString() : 'No due date'}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="mb-2 text-sm font-semibold text-slate-800">
                  Experiments awaiting results ({att.experimentsAwaitingResults.length})
                </h4>
                <ul className="space-y-1.5">
                  {att.experimentsAwaitingResults.map((e) => (
                    <li key={e.id} className="rounded-lg bg-purple-50 p-2 text-sm text-purple-900">
                      <span className="font-medium">{e.title}</span>
                      <span className="block text-xs">Status: {e.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Chronological feed */}
      <Card>
        <CardBody>
          <SectionTitle className="mb-3">Activity history</SectionTitle>
          {feed.length === 0 ? (
            <EmptyState title="No activity yet" hint="Every change in the mission — evidence, branches, experiments, contributions, agent runs — is recorded here." />
          ) : (
            <ul aria-label="Mission activity">
              {feed.map((item) => (
                <ActivityRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
