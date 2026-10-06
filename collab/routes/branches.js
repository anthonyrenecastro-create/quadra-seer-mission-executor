import { Router } from 'express';
import { id, nowIso } from '../ids.js';
import { needMission, needMissionFor, logActivity, touch, evidenceVersionStamp } from './_util.js';

const ARRAY_FIELDS = ['assumptions', 'constraints', 'expectedBenefits', 'risks', 'openQuestions', 'proposedExperiments'];

function normBranch(b, missionId, actor) {
  const o = b || {};
  const arr = (x) => (Array.isArray(x) ? x.map(String) : []);
  return {
    id: id('br'),
    missionId,
    name: String(o.name || 'Untitled branch'),
    approach: o.approach || '',
    rationale: o.rationale || '',
    assumptions: arr(o.assumptions),
    constraints: arr(o.constraints),
    evidenceVersion: o.evidenceVersion || '',
    expectedBenefits: arr(o.expectedBenefits),
    risks: arr(o.risks),
    openQuestions: arr(o.openQuestions),
    proposedExperiments: arr(o.proposedExperiments),
    contributors: Array.isArray(o.contributors) ? o.contributors.map(String) : [actor.id],
    status: 'active',
    evidenceRefs: {
      supporting: Array.isArray(o.evidenceRefs && o.evidenceRefs.supporting) ? o.evidenceRefs.supporting : [],
      conflicting: Array.isArray(o.evidenceRefs && o.evidenceRefs.conflicting) ? o.evidenceRefs.conflicting : [],
    },
    mergedInto: '',
    mergeProvenance: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    version: 1,
    history: [{ v: 1, at: nowIso(), actor: actor.id, change: 'branch created' }],
  };
}

function diffList(a, b) {
  const sa = new Set(a), sb = new Set(b);
  return {
    onlyA: a.filter((x) => !sb.has(x)),
    onlyB: b.filter((x) => !sa.has(x)),
    common: a.filter((x) => sb.has(x)),
  };
}

export function createBranchesRouter(store) {
  const r = Router();

  r.get('/missions/:id/branches', (req, res) => {
    const m = needMission(req, res, store, 'read');
    if (!m) return;
    const items = store.all('branches')
      .filter((b) => b.missionId === m.id)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    res.json({ branches: items });
  });

  r.post('/missions/:id/branches', (req, res) => {
    const m = needMission(req, res, store, 'create');
    if (!m) return;
    const b = normBranch(req.body || {}, m.id, req.actor);
    if (!b.evidenceVersion) b.evidenceVersion = evidenceVersionStamp(store, m.id);
    store.set('branches', b.id, b);
    logActivity(store, { missionId: m.id, actor: req.actor, type: 'branch.created', summary: `Branch created: ${b.name}`, ref: { kind: 'branch', id: b.id } });
    res.status(201).json({ branch: b });
  });

  // Compare must be registered before /branches/:id (else "compare" matches :id).
  r.get('/branches/compare', (req, res) => {
    const a = store.get('branches', req.query.a);
    const b = store.get('branches', req.query.b);
    if (!a || !b) return res.status(404).json({ error: 'both branches a and b are required' });
    if (a.missionId !== b.missionId) return res.status(400).json({ error: 'branches are in different missions' });
    const m = needMissionFor(store, { missionId: a.missionId }, req, res, 'read');
    if (!m) return;
    const evA = [...(a.evidenceRefs.supporting || []), ...(a.evidenceRefs.conflicting || [])];
    const evB = [...(b.evidenceRefs.supporting || []), ...(b.evidenceRefs.conflicting || [])];
    res.json({
      a: { id: a.id, name: a.name, version: a.version, evidenceVersion: a.evidenceVersion, status: a.status },
      b: { id: b.id, name: b.name, version: b.version, evidenceVersion: b.evidenceVersion, status: b.status },
      assumptions: diffList(a.assumptions || [], b.assumptions || []),
      evidence: diffList(evA, evB),
      risks: diffList(a.risks || [], b.risks || []),
      benefits: diffList(a.expectedBenefits || [], b.expectedBenefits || []),
      openQuestions: diffList(a.openQuestions || [], b.openQuestions || []),
      predictions: diffList(a.expectedBenefits || [], b.expectedBenefits || []),
    });
  });

  r.get('/branches/:id', (req, res) => {
    const b = store.get('branches', req.params.id);
    const m = needMissionFor(store, b, req, res, 'read');
    if (!m) return;
    res.json({ branch: b });
  });

  r.patch('/branches/:id', (req, res) => {
    let b = store.get('branches', req.params.id);
    const m = needMissionFor(store, b, req, res, 'edit');
    if (!m) return;
    b = store.get('branches', req.params.id);
    const body = req.body || {};
    const changed = [];
    for (const f of ['name', 'approach', 'rationale', 'status', 'evidenceVersion']) {
      if (typeof body[f] === 'string' && body[f] !== b[f]) { b[f] = body[f]; changed.push(f); }
    }
    for (const f of ARRAY_FIELDS) {
      if (Array.isArray(body[f])) { b[f] = body[f].map(String); changed.push(f); }
    }
    if (body.evidenceRefs && typeof body.evidenceRefs === 'object') {
      for (const k of ['supporting', 'conflicting']) {
        if (Array.isArray(body.evidenceRefs[k])) b.evidenceRefs[k] = body.evidenceRefs[k].map(String);
      }
      changed.push('evidenceRefs');
    }
    if (changed.length === 0) return res.status(400).json({ error: 'nothing to update' });
    touch(store, 'branches', b, req.actor, `updated: ${changed.join(', ')}`);
    res.json({ branch: b });
  });

  r.post('/branches/:id/duplicate', (req, res) => {
    let b = store.get('branches', req.params.id);
    const m = needMissionFor(store, b, req, res, 'create');
    if (!m) return;
    b = store.get('branches', req.params.id);
    const copy = JSON.parse(JSON.stringify(b));
    copy.id = id('br');
    copy.name = `${b.name} (copy)`;
    copy.status = 'active';
    copy.mergedInto = '';
    copy.createdAt = nowIso();
    copy.updatedAt = nowIso();
    copy.version = 1;
    copy.history = [{ v: 1, at: nowIso(), actor: req.actor.id, change: `duplicated from ${b.id} (v${b.version})` }];
    store.set('branches', copy.id, copy);
    logActivity(store, { missionId: m.id, actor: req.actor, type: 'branch.created', summary: `Branch duplicated: ${copy.name}`, ref: { kind: 'branch', id: copy.id } });
    res.status(201).json({ branch: copy });
  });

  r.post('/branches/:id/archive', (req, res) => {
    let b = store.get('branches', req.params.id);
    const m = needMissionFor(store, b, req, res, 'edit');
    if (!m) return;
    b = store.get('branches', req.params.id);
    b.status = 'archived';
    touch(store, 'branches', b, req.actor, 'branch archived');
    logActivity(store, { missionId: m.id, actor: req.actor, type: 'branch.archived', summary: `Branch archived: ${b.name}`, ref: { kind: 'branch', id: b.id } });
    res.json({ branch: b });
  });

  // Merge source branch :id INTO targetBranchId, adopting picked elements with provenance.
  r.post('/branches/:id/merge', (req, res) => {
    let src = store.get('branches', req.params.id);
    const m = needMissionFor(store, src, req, res, 'edit');
    if (!m) return;
    src = store.get('branches', req.params.id);
    const body = req.body || {};
    const target = store.get('branches', body.targetBranchId);
    if (!target || target.missionId !== m.id) {
      return res.status(400).json({ error: 'targetBranchId must be a branch in this mission' });
    }
    if (target.id === src.id) return res.status(400).json({ error: 'cannot merge a branch into itself' });
    if (src.status === 'merged') return res.status(400).json({ error: 'source branch is already merged' });
    const picks = body.picks && typeof body.picks === 'object' ? body.picks : {};
    const adopted = [];
    for (const field of ARRAY_FIELDS) {
      const idxs = Array.isArray(picks[field]) ? picks[field] : [];
      for (const i of idxs) {
        const val = (src[field] || [])[i];
        if (val === undefined) continue;
        if (!(target[field] || []).includes(val)) {
          target[field] = target[field] || [];
          target[field].push(val);
          target.mergeProvenance.push({ element: `${field}[${i}]`, value: val, fromBranch: src.id, fromVersion: src.version });
          adopted.push(`${field}[${i}]`);
        }
      }
    }
    for (const k of ['supporting', 'conflicting']) {
      const ids = Array.isArray(picks[k]) ? picks[k] : [];
      for (const eid of ids) {
        if ((src.evidenceRefs[k] || []).includes(eid) && !(target.evidenceRefs[k] || []).includes(eid)) {
          target.evidenceRefs[k].push(eid);
          target.mergeProvenance.push({ element: `evidenceRefs.${k}`, value: eid, fromBranch: src.id, fromVersion: src.version });
          adopted.push(`evidenceRefs.${k}:${eid}`);
        }
      }
    }
    src.status = 'merged';
    src.mergedInto = target.id;
    touch(store, 'branches', src, req.actor, `merged into ${target.id}; adopted: ${adopted.join(', ') || 'none'}`);
    touch(store, 'branches', target, req.actor, `merged from ${src.id} (v${src.version}); adopted ${adopted.length} element(s)`);
    logActivity(store, { missionId: m.id, actor: req.actor, type: 'branch.merged', summary: `Branch merged: ${src.name} → ${target.name} (${adopted.length} adopted)`, ref: { kind: 'branch', id: target.id } });
    res.json({ source: src, target, adopted });
  });

  return r;
}
