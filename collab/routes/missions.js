import { Router } from 'express';
import { id, nowIso } from '../ids.js';
import { requirePerm, validRoles } from '../auth.js';
import { needMission, logActivity, touch, getMission } from './_util.js';

export function createMissionsRouter(store) {
  const r = Router();

  const publicMission = (m) => m;

  // List missions visible to the actor.
  r.get('/missions', (req, res) => {
    const all = store.all('missions').filter((m) => !m.deleted);
    if (process.env.COLLAB_AUTH === 'token') {
      const mine = all.filter((m) => (m.contributors || []).some((c) => c.actor === req.actor.id));
      return res.json({ missions: mine });
    }
    res.json({ missions: all });
  });

  // Create mission. Owner auto-added.
  r.post('/missions', (req, res) => {
    const b = req.body || {};
    if (!b.title || !String(b.title).trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    const m = {
      id: id('msn'),
      title: String(b.title),
      objective: b.objective || '',
      description: b.description || '',
      owner: req.actor.id,
      contributors: [{ actor: req.actor.id, role: 'owner' }],
      constraints: b.constraints && typeof b.constraints === 'object' ? b.constraints : { budget: '', time: '', resources: '', permissions: '' },
      milestones: Array.isArray(b.milestones) ? b.milestones.map(normMilestone) : [],
      tasks: Array.isArray(b.tasks) ? b.tasks.map(normTask) : [],
      successMeasures: Array.isArray(b.successMeasures) ? b.successMeasures.map(normMeasure) : [],
      status: 'active',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      version: 1,
      history: [{ v: 1, at: nowIso(), actor: req.actor.id, change: 'mission created' }],
    };
    // Extra contributors (owner only meaningful here; creator is owner).
    if (Array.isArray(b.contributors)) {
      for (const c of b.contributors) {
        if (c && c.actor && c.actor !== req.actor.id && validRoles().includes(c.role) && c.role !== 'owner') {
          m.contributors.push({ actor: String(c.actor), role: c.role });
        }
      }
    }
    store.set('missions', m.id, m);
    logActivity(store, { missionId: m.id, actor: req.actor, type: 'mission.created', summary: `Mission created: ${m.title}`, ref: { kind: 'mission', id: m.id } });
    res.status(201).json({ mission: publicMission(m) });
  });

  r.get('/missions/:id', (req, res) => {
    const m = needMission(req, res, store, 'read');
    if (!m) return;
    res.json({ mission: publicMission(m) });
  });

  r.patch('/missions/:id', (req, res) => {
    const m = needMission(req, res, store, 'edit');
    if (!m) return;
    const b = req.body || {};
    const changed = [];
    for (const f of ['title', 'objective', 'description']) {
      if (typeof b[f] === 'string' && b[f] !== m[f]) { m[f] = b[f]; changed.push(f); }
    }
    if (b.constraints && typeof b.constraints === 'object') { m.constraints = { ...m.constraints, ...b.constraints }; changed.push('constraints'); }
    if (Array.isArray(b.milestones)) { m.milestones = b.milestones.map(normMilestone); changed.push('milestones'); }
    if (Array.isArray(b.tasks)) { m.tasks = b.tasks.map(normTask); changed.push('tasks'); }
    if (Array.isArray(b.successMeasures)) { m.successMeasures = b.successMeasures.map(normMeasure); changed.push('successMeasures'); }
    if (changed.length === 0) return res.status(400).json({ error: 'nothing to update' });
    touch(store, 'missions', m, req.actor, `updated: ${changed.join(', ')}`);
    logActivity(store, { missionId: m.id, actor: req.actor, type: 'mission.updated', summary: `Mission updated (${changed.join(', ')})`, ref: { kind: 'mission', id: m.id } });
    res.json({ mission: publicMission(m) });
  });

  r.post('/missions/:id/archive', (req, res) => {
    const m = needMission(req, res, store, 'archive');
    if (!m) return;
    m.status = 'archived';
    touch(store, 'missions', m, req.actor, 'mission archived');
    logActivity(store, { missionId: m.id, actor: req.actor, type: 'mission.archived', summary: 'Mission archived', ref: { kind: 'mission', id: m.id } });
    res.json({ mission: publicMission(m) });
  });

  r.post('/missions/:id/reopen', (req, res) => {
    const m = needMission(req, res, store, 'reopen');
    if (!m) return;
    m.status = 'active';
    touch(store, 'missions', m, req.actor, 'mission reopened');
    logActivity(store, { missionId: m.id, actor: req.actor, type: 'mission.reopened', summary: 'Mission reopened', ref: { kind: 'mission', id: m.id } });
    res.json({ mission: publicMission(m) });
  });

  // Manage contributors (owner only).
  r.post('/missions/:id/contributors', (req, res) => {
    const m = needMission(req, res, store, 'manageContributors');
    if (!m) return;
    const b = req.body || {};
    if (!b.actor || !validRoles().includes(b.role)) {
      return res.status(400).json({ error: 'actor and valid role (owner|editor|viewer) required' });
    }
    const existing = m.contributors.find((c) => c.actor === b.actor);
    if (existing) existing.role = b.role;
    else m.contributors.push({ actor: String(b.actor), role: b.role });
    touch(store, 'missions', m, req.actor, `contributor ${b.actor} set to ${b.role}`);
    logActivity(store, { missionId: m.id, actor: req.actor, type: 'mission.updated', summary: `Contributor ${b.actor} → ${b.role}`, ref: { kind: 'mission', id: m.id } });
    res.json({ mission: publicMission(m) });
  });

  r.delete('/missions/:id/contributors/:actorId', (req, res) => {
    const m = needMission(req, res, store, 'manageContributors');
    if (!m) return;
    if (req.params.actorId === m.owner) {
      return res.status(400).json({ error: 'cannot remove the mission owner' });
    }
    m.contributors = m.contributors.filter((c) => c.actor !== req.params.actorId);
    touch(store, 'missions', m, req.actor, `contributor ${req.params.actorId} removed`);
    res.json({ mission: publicMission(m) });
  });

  r.get('/missions/:id/dashboard', (req, res) => {
    const m = needMission(req, res, store, 'read');
    if (!m) return;
    res.json({ mission: publicMission(m), ...buildDashboard(store, m) });
  });

  r.get('/missions/:id/attention', (req, res) => {
    const m = needMission(req, res, store, 'read');
    if (!m) return;
    res.json(buildAttention(store, m));
  });

  r.get('/missions/:id/activity', (req, res) => {
    const m = needMission(req, res, store, 'read');
    if (!m) return;
    const items = store.activity()
      .filter((a) => a.missionId === m.id)
      .sort((a, b) => (a.at < b.at ? 1 : -1));
    res.json({ activity: items });
  });

  return r;
}

function normMilestone(x, i) {
  const o = x && typeof x === 'object' ? x : { title: String(x || '') };
  return {
    id: o.id || id('mls'),
    title: o.title || `Milestone ${i + 1}`,
    due: o.due || '',
    status: o.status === 'done' ? 'done' : 'open',
    dependsOn: Array.isArray(o.dependsOn) ? o.dependsOn : [],
  };
}

function normTask(x, i) {
  const o = x && typeof x === 'object' ? x : { title: String(x || '') };
  return {
    id: o.id || id('tsk'),
    title: o.title || `Task ${i + 1}`,
    status: ['todo', 'doing', 'done'].includes(o.status) ? o.status : 'todo',
    dependsOn: Array.isArray(o.dependsOn) ? o.dependsOn : [],
    assignee: o.assignee || '',
  };
}

function normMeasure(x, i) {
  const o = x && typeof x === 'object' ? x : { name: String(x || '') };
  return {
    id: o.id || id('sm'),
    name: o.name || `Measure ${i + 1}`,
    baseline: o.baseline || '',
    target: o.target || '',
    unit: o.unit || '',
    method: o.method || '',
  };
}

function buildDashboard(store, m) {
  const ms = m.milestones || [];
  const tasks = m.tasks || [];
  const experiments = store.all('experiments').filter((e) => e.missionId === m.id);
  const evidence = store.all('evidence').filter((e) => e.missionId === m.id && !e.deleted);
  const branches = store.all('branches').filter((b) => b.missionId === m.id);
  const byStatus = {};
  for (const e of experiments) byStatus[e.status] = (byStatus[e.status] || 0) + 1;
  const pct = (done, total) => (total === 0 ? 0 : Math.round((done / total) * 100));
  const msDone = ms.filter((x) => x.status === 'done').length;
  const tDone = tasks.filter((x) => x.status === 'done').length;
  return {
    progress: {
      milestones: { total: ms.length, done: msDone, pct: pct(msDone, ms.length) },
      tasks: { total: tasks.length, done: tDone, pct: pct(tDone, tasks.length) },
      experiments: { total: experiments.length, byStatus },
      evidence: evidence.length,
      branches: branches.length,
    },
    ...buildAttention(store, m),
  };
}

export function buildAttention(store, m) {
  const evidence = store.all('evidence').filter((e) => e.missionId === m.id && !e.deleted);
  const relations = store.all('relations').filter((x) => x.missionId === m.id);
  const decisionIds = new Set(evidence.filter((e) => e.kind === 'decision').map((e) => e.id));
  const unresolvedQuestions = evidence.filter((e) => {
    if (e.kind !== 'question') return false;
    return !relations.some((rel) => {
      const other = rel.from === e.id ? rel.to : rel.to === e.id ? rel.from : null;
      return other && decisionIds.has(other);
    });
  }).map((e) => ({ id: e.id, title: e.title }));

  const now = Date.now();
  const upcomingMilestones = (m.milestones || [])
    .filter((x) => x.status !== 'done' && x.due)
    .map((x) => ({ ...x, overdue: new Date(x.due).getTime() < now }))
    .filter((x) => x.overdue || new Date(x.due).getTime() - now <= 14 * 24 * 3600 * 1000);

  const experimentsAwaitingResults = store.all('experiments')
    .filter((e) => e.missionId === m.id && (e.status === 'running' || e.status === 'awaiting-results'))
    .map((e) => ({ id: e.id, title: e.title, status: e.status }));

  return { unresolvedQuestions, upcomingMilestones, experimentsAwaitingResults };
}
