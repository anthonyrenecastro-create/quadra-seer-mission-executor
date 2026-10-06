import { Router } from 'express';
import { id, nowIso } from '../ids.js';
import { needMission, needMissionFor, logActivity, touch } from './_util.js';
import { runHrmSimulation } from '../adapters/hrm.js';
import { resultToLearningEvent } from '../adapters/outcomes.js';

const STATUSES = ['planned', 'running', 'awaiting-results', 'complete', 'inconclusive'];
const KINDS = ['planned-test', 'simulation', 'real-world-observation'];
const CLAIM_STATUSES = ['unreviewed', 'supported', 'disputed', 'insufficient-evidence'];

export function createExperimentsRouter(store) {
  const r = Router();

  r.get('/missions/:id/experiments', (req, res) => {
    const m = needMission(req, res, store, 'read');
    if (!m) return;
    const items = store.all('experiments')
      .filter((e) => e.missionId === m.id)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    res.json({ experiments: items });
  });

  r.post('/missions/:id/experiments', (req, res) => {
    const m = needMission(req, res, store, 'create');
    if (!m) return;
    const b = req.body || {};
    if (!b.title || !String(b.title).trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    const branchId = b.branchId || '';
    if (branchId) {
      const br = store.get('branches', branchId);
      if (!br || br.missionId !== m.id) return res.status(400).json({ error: 'branchId must be a branch in this mission' });
    }
    const exp = {
      id: id('exp'),
      missionId: m.id,
      branchId,
      title: String(b.title),
      question: b.question || '',
      hypothesis: b.hypothesis || '',
      prediction: b.prediction || '',
      method: b.method || '',
      resources: b.resources || '',
      baseline: b.baseline || '',
      successCriteria: b.successCriteria || '',
      kind: KINDS.includes(b.kind) ? b.kind : 'planned-test',
      contributors: Array.isArray(b.contributors) ? b.contributors.map(String) : [req.actor.id],
      status: 'planned',
      execution: { startedAt: '', endedAt: '' },
      results: [],
      linkedClaimUpdates: [],
      outcomeSignal: { mapped: false, event: null, at: '' },
      createdAt: nowIso(),
      updatedAt: nowIso(),
      version: 1,
      history: [{ v: 1, at: nowIso(), actor: req.actor.id, change: 'experiment created' }],
    };
    store.set('experiments', exp.id, exp);
    logActivity(store, { missionId: m.id, actor: req.actor, type: 'experiment.created', summary: `Experiment created: ${exp.title}`, ref: { kind: 'experiment', id: exp.id } });
    res.status(201).json({ experiment: exp });
  });

  r.get('/experiments/:id', (req, res) => {
    const exp = store.get('experiments', req.params.id);
    const m = needMissionFor(store, exp, req, res, 'read');
    if (!m) return;
    res.json({ experiment: exp });
  });

  // Prediction is immutable once status != planned.
  r.patch('/experiments/:id', (req, res) => {
    let exp = store.get('experiments', req.params.id);
    const m = needMissionFor(store, exp, req, res, 'edit');
    if (!m) return;
    exp = store.get('experiments', req.params.id);
    const b = req.body || {};
    if (b.prediction !== undefined && b.prediction !== exp.prediction && exp.status !== 'planned') {
      return res.status(400).json({ error: 'prediction is immutable once the experiment has started' });
    }
    const changed = [];
    for (const f of ['title', 'question', 'hypothesis', 'prediction', 'method', 'resources', 'baseline', 'successCriteria', 'branchId', 'kind']) {
      if (b[f] !== undefined && b[f] !== exp[f]) {
        if (f === 'kind' && !KINDS.includes(b[f])) continue;
        exp[f] = b[f];
        changed.push(f);
      }
    }
    if (Array.isArray(b.contributors)) { exp.contributors = b.contributors.map(String); changed.push('contributors'); }
    if (b.status && b.status !== exp.status) {
      if (!STATUSES.includes(b.status)) return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
      exp.status = b.status;
      changed.push('status');
    }
    if (changed.length === 0) return res.status(400).json({ error: 'nothing to update' });
    touch(store, 'experiments', exp, req.actor, `updated: ${changed.join(', ')}`);
    res.json({ experiment: exp });
  });

  r.post('/experiments/:id/start', (req, res) => {
    let exp = store.get('experiments', req.params.id);
    const m = needMissionFor(store, exp, req, res, 'edit');
    if (!m) return;
    exp = store.get('experiments', req.params.id);
    if (exp.status !== 'planned') {
      return res.status(400).json({ error: `cannot start from status '${exp.status}'` });
    }
    exp.status = 'running';
    exp.execution.startedAt = nowIso();
    touch(store, 'experiments', exp, req.actor, 'experiment started');
    logActivity(store, { missionId: m.id, actor: req.actor, type: 'experiment.started', summary: `Experiment started: ${exp.title}`, ref: { kind: 'experiment', id: exp.id } });
    res.json({ experiment: exp });
  });

  // Record a result: append-only new version; optional linked claim updates;
  // outcome signal mapped via the pure outcomes adapter.
  r.post('/experiments/:id/results', (req, res) => {
    let exp = store.get('experiments', req.params.id);
    const m = needMissionFor(store, exp, req, res, 'edit');
    if (!m) return;
    exp = store.get('experiments', req.params.id);
    const b = req.body || {};
    const v = exp.results.length + 1;
    const result = {
      v,
      at: nowIso(),
      actor: req.actor.id,
      observations: b.observations || '',
      measurements: Array.isArray(b.measurements) ? b.measurements : [],
      artifacts: Array.isArray(b.artifacts) ? b.artifacts : [],
      limitations: b.limitations || '',
      interpretation: b.interpretation || '',
      recommendations: Array.isArray(b.recommendations) ? b.recommendations : [],
      matchedPrediction: typeof b.matchedPrediction === 'boolean' ? b.matchedPrediction : null,
      kind: b.kind || exp.kind,
    };
    exp.results.push(result);

    // Linked claim updates (each requires why; recorded with trigger).
    const claimUpdates = Array.isArray(b.claimUpdates) ? b.claimUpdates : [];
    for (const cu of claimUpdates) {
      const ev = store.get('evidence', cu.evidenceId);
      if (!ev || ev.missionId !== m.id || ev.deleted) continue;
      if (!CLAIM_STATUSES.includes(cu.to)) continue;
      if (!cu.why || !String(cu.why).trim()) continue;
      ev.statusHistory.push({
        at: nowIso(), actor: req.actor.id, from: ev.claimStatus, to: cu.to,
        why: String(cu.why), aiSuggested: false,
      });
      ev.claimStatus = cu.to;
      touch(store, 'evidence', ev, req.actor, `claim status → ${cu.to} (triggered by result v${v})`);
      exp.linkedClaimUpdates.push({
        evidenceId: ev.id, from: ev.statusHistory[ev.statusHistory.length - 1].from,
        to: cu.to, why: String(cu.why), triggeredBy: `result-v${v}`,
      });
    }

    // Outcome signal: pure mapping, stored on the experiment + activity entry.
    const event = resultToLearningEvent(exp, result);
    exp.outcomeSignal = { mapped: true, event, at: nowIso() };
    logActivity(store, {
      missionId: m.id, actor: req.actor, type: 'outcome.signal-mapped',
      summary: `Outcome signal mapped for ${exp.title} (trigger: result v${v})`,
      ref: { kind: 'experiment', id: exp.id },
    });

    const terminal = b.status === 'inconclusive' ? 'inconclusive' : 'complete';
    exp.status = terminal;
    exp.execution.endedAt = nowIso();
    touch(store, 'experiments', exp, req.actor, `result v${v} recorded; status → ${terminal}`);
    logActivity(store, { missionId: m.id, actor: req.actor, type: 'experiment.result-recorded', summary: `Result v${v} recorded for ${exp.title}`, ref: { kind: 'experiment', id: exp.id } });
    res.status(201).json({ experiment: exp, result, outcomeSignal: exp.outcomeSignal });
  });

  // Run an HRM simulation and append it as a labeled result version.
  r.post('/experiments/:id/run-hrm', async (req, res) => {
    let exp = store.get('experiments', req.params.id);
    const m = needMissionFor(store, exp, req, res, 'edit');
    if (!m) return;
    exp = store.get('experiments', req.params.id);
    const b = req.body || {};
    const sim = await runHrmSimulation({ steps: b.steps || 50, seed: b.seed ?? null, state_dim: b.state_dim ?? null });
    if (!sim.available) {
      return res.json({ available: false, reason: sim.reason });
    }
    const v = exp.results.length + 1;
    const result = {
      v,
      at: nowIso(),
      actor: req.actor.id,
      observations: `HRM internal simulation completed (${sim.steps} steps${sim.seed !== null ? `, seed ${sim.seed}` : ''}). Labeled internal-simulation: not a validated domain model.`,
      measurements: [
        { name: 'final_coherence', value: sim.snapshot && sim.snapshot.coherence },
        { name: 'final_energy', value: sim.snapshot && sim.snapshot.energy },
        { name: 'timeline_length', value: sim.timelineLength },
      ],
      artifacts: [],
      limitations: 'Internal simulation only; no domain model validation.',
      interpretation: '',
      recommendations: [],
      matchedPrediction: null,
      kind: 'simulation',
      engine: 'hrm',
      label: 'internal-simulation',
      snapshot: sim.snapshot,
    };
    exp.results.push(result);
    touch(store, 'experiments', exp, req.actor, `HRM simulation result v${v} recorded (internal-simulation)`);
    logActivity(store, { missionId: m.id, actor: req.actor, type: 'experiment.result-recorded', summary: `HRM simulation result v${v} for ${exp.title} (internal-simulation)`, ref: { kind: 'experiment', id: exp.id } });
    res.status(201).json({ available: true, result, experiment: exp });
  });

  return r;
}
