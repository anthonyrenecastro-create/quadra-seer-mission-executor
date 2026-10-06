import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mountCollab } from './index.js';
import { createStore } from './store.js';
import { seedDemo } from './seed.js';
import { resultToLearningEvent } from './adapters/outcomes.js';
import { checkAgentCapability } from './adapters/governance.js';
import { runHrmSimulation } from './adapters/hrm.js';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

let base;
let server;
let tmpDir;

function req(method, p, body, { token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${base}${p}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
}
const get = (p, opts) => req('GET', p, undefined, opts);
const post = (p, body, opts) => req('POST', p, body, opts);
const patch = (p, body, opts) => req('PATCH', p, body, opts);
const del = (p, opts) => req('DELETE', p, undefined, opts);

function setTokenMode() {
  process.env.COLLAB_AUTH = 'token';
  process.env.COLLAB_ACTORS = JSON.stringify({
    'tok-owner': { id: 'u-owner', name: 'Owner' },
    'tok-editor': { id: 'u-editor', name: 'Editor' },
    'tok-viewer': { id: 'u-viewer', name: 'Viewer' },
  });
}
function setDisabledMode() {
  process.env.COLLAB_AUTH = 'disabled';
  delete process.env.COLLAB_ACTORS;
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-test-'));
  process.env.COLLAB_DATA_DIR = tmpDir;
  setDisabledMode();
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  mountCollab(app);
  await new Promise((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${server.address().port}/api/collab`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.COLLAB_DATA_DIR;
  setDisabledMode();
});

describe('health + store', () => {
  it('health reports schema version and adapter availability', async () => {
    const { status, json } = await get('/health');
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.schemaVersion).toBe(1);
    expect(json.authMode).toBe('disabled');
    expect(typeof json.python).toBe('boolean');
    expect(typeof json.hrm).toBe('boolean');
  });

  it('store round-trips and runs the v1 migration', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-store-'));
    try {
      const s1 = createStore({ dataDir: dir });
      s1.load();
      expect(s1.schemaVersion()).toBe(1);
      s1.set('missions', 'm1', { id: 'm1', title: 't' });
      const s2 = createStore({ dataDir: dir });
      expect(s2.get('missions', 'm1')).toEqual({ id: 'm1', title: 't' });
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
      expect(meta.schemaVersion).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('missions', () => {
  it('creates a mission with owner auto-added; archive/reopen cycle', async () => {
    const { status, json } = await post('/missions', { title: 'M1', objective: 'obj' });
    expect(status).toBe(201);
    expect(json.mission.contributors).toEqual([{ actor: 'local-owner', role: 'owner' }]);
    const id = json.mission.id;

    const a = await post(`/missions/${id}/archive`);
    expect(a.json.mission.status).toBe('archived');
    const ro = await post(`/missions/${id}/reopen`);
    expect(ro.json.mission.status).toBe('active');

    const act = await get(`/missions/${id}/activity`);
    expect(act.json.activity.map((x) => x.type)).toContain('mission.archived');
  });

  it('dashboard + attention derive correctly', async () => {
    const { json } = await post('/missions', {
      title: 'M-dash',
      milestones: [{ title: 'Soon', due: new Date(Date.now() + 864e5).toISOString() }],
      tasks: [{ title: 'T1', status: 'done' }, { title: 'T2' }],
    });
    const id = json.mission.id;
    await post(`/missions/${id}/evidence`, { kind: 'question', title: 'Open Q?' });
    const exp = await post(`/missions/${id}/experiments`, { title: 'E1' });
    await post(`/experiments/${exp.json.experiment.id}/start`);

    const d = await get(`/missions/${id}/dashboard`);
    expect(d.json.progress.tasks).toMatchObject({ total: 2, done: 1 });
    expect(d.json.unresolvedQuestions).toHaveLength(1);
    expect(d.json.upcomingMilestones).toHaveLength(1);
    expect(d.json.experimentsAwaitingResults).toHaveLength(1);
  });
});

describe('auth', () => {
  let missionId;
  beforeAll(async () => {
    setTokenMode();
    const { json } = await post('/missions', { title: 'M-auth' }, { token: 'tok-owner' });
    missionId = json.mission.id;
    await post(`/missions/${missionId}/contributors`, { actor: 'u-editor', role: 'editor' }, { token: 'tok-owner' });
    await post(`/missions/${missionId}/contributors`, { actor: 'u-viewer', role: 'viewer' }, { token: 'tok-owner' });
  });
  afterAll(() => setDisabledMode());

  it('rejects missing and invalid tokens', async () => {
    expect((await get('/missions')).status).toBe(401);
    expect((await get('/missions', { token: 'nope' })).status).toBe(401);
  });

  it('viewer can read but cannot create', async () => {
    expect((await get(`/missions/${missionId}/evidence`, { token: 'tok-viewer' })).status).toBe(200);
    const denied = await post(`/missions/${missionId}/evidence`, { kind: 'document', title: 'x' }, { token: 'tok-viewer' });
    expect(denied.status).toBe(403);
    expect(denied.json.error).toMatch(/forbidden/);
  });

  it('editor can create; viewer cannot archive', async () => {
    const ok = await post(`/missions/${missionId}/evidence`, { kind: 'document', title: 'ed-doc' }, { token: 'tok-editor' });
    expect(ok.status).toBe(201);
    expect((await post(`/missions/${missionId}/archive`, {}, { token: 'tok-viewer' })).status).toBe(403);
    expect((await post(`/missions/${missionId}/archive`, {}, { token: 'tok-editor' })).status).toBe(403);
    expect((await post(`/missions/${missionId}/archive`, {}, { token: 'tok-owner' })).status).toBe(200);
  });

  it('non-contributor token cannot read the mission', async () => {
    process.env.COLLAB_ACTORS = JSON.stringify({ 'tok-stranger': { id: 'u-stranger', name: 'Stranger' } });
    expect((await get(`/missions/${missionId}`, { token: 'tok-stranger' })).status).toBe(403);
    setTokenMode();
  });
});

describe('evidence', () => {
  let missionId;
  let claimId;
  beforeAll(async () => {
    const { json } = await post('/missions', { title: 'M-ev' });
    missionId = json.mission.id;
    const c = await post(`/missions/${missionId}/evidence`, { kind: 'claim', title: 'Claim A' });
    claimId = c.json.evidence.id;
  });

  it('status change requires why and records actor', async () => {
    const noWhy = await patch(`/evidence/${claimId}`, { claimStatus: 'supported' });
    expect(noWhy.status).toBe(400);
    const ok = await patch(`/evidence/${claimId}`, { claimStatus: 'supported', why: 'verified by test' });
    expect(ok.status).toBe(200);
    expect(ok.json.evidence.claimStatus).toBe('supported');
    const h = ok.json.evidence.statusHistory;
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ from: 'unreviewed', to: 'supported', why: 'verified by test', actor: 'local-owner', aiSuggested: false });
  });

  it('tombstones keep the record but hide it from lists', async () => {
    const d = await del(`/evidence/${claimId}`);
    expect(d.json.evidence.deleted).toBe(true);
    const list = await get(`/missions/${missionId}/evidence`);
    expect(list.json.evidence.find((e) => e.id === claimId)).toBeUndefined();
  });

  it('relations + impacted downstream traversal', async () => {
    const doc = (await post(`/missions/${missionId}/evidence`, { kind: 'document', title: 'Doc' })).json.evidence;
    const claim = (await post(`/missions/${missionId}/evidence`, { kind: 'claim', title: 'Claim B' })).json.evidence;
    const decision = (await post(`/missions/${missionId}/evidence`, { kind: 'decision', title: 'Decide!' })).json.evidence;
    await post(`/missions/${missionId}/relations`, { from: doc.id, to: claim.id, type: 'supports' });
    await post(`/missions/${missionId}/relations`, { from: decision.id, to: claim.id, type: 'derived-from' });
    const imp = await get(`/evidence/${doc.id}/impacted`);
    expect(imp.json.claims.map((c) => c.id)).toContain(claim.id);
    expect(imp.json.decisions.map((x) => x.id)).toContain(decision.id);
  });

  it('upload parse statuses: txt parsed, pdf stored-unparsed, exe unsupported', async () => {
    const txt = await post(`/missions/${missionId}/evidence/upload`, {
      filename: 'notes.txt', mimeType: 'text/plain', contentBase64: b64('hello world'),
    });
    expect(txt.status).toBe(201);
    expect(txt.json.parseStatus).toBe('parsed');
    expect(txt.json.evidence.content.text).toBe('hello world');

    const pdf = await post(`/missions/${missionId}/evidence/upload`, {
      filename: 'paper.pdf', mimeType: 'application/pdf', contentBase64: b64('%PDF-1.4 fake'),
    });
    expect(pdf.status).toBe(201);
    expect(pdf.json.parseStatus).toBe('stored-unparsed');
    expect(pdf.json.evidence.content.text).toBe('');

    const exe = await post(`/missions/${missionId}/evidence/upload`, {
      filename: 'run.exe', mimeType: 'application/x-msdownload', contentBase64: b64('MZ fake'),
    });
    expect(exe.status).toBe(201);
    expect(exe.json.parseStatus).toBe('unsupported');

    const bad = await post(`/missions/${missionId}/evidence/upload`, {
      filename: 'x.txt', mimeType: 'text/plain', contentBase64: '!!!not-base64!!!',
    });
    expect(bad.status).toBe(400);
  });
});

describe('branches', () => {
  let missionId;
  let aId;
  let bId;
  beforeAll(async () => {
    const { json } = await post('/missions', { title: 'M-br' });
    missionId = json.mission.id;
    aId = (await post(`/missions/${missionId}/branches`, {
      name: 'A', assumptions: ['a1', 'a2'], risks: ['r1'], expectedBenefits: ['fast'],
    })).json.branch.id;
    bId = (await post(`/missions/${missionId}/branches`, {
      name: 'B', assumptions: ['a2', 'a3'], risks: ['r2'], expectedBenefits: ['fast', 'cheap'],
    })).json.branch.id;
  });

  it('compare exposes assumption/evidence/risk differences', async () => {
    const { json } = await get(`/branches/compare?a=${aId}&b=${bId}`);
    expect(json.assumptions).toMatchObject({ onlyA: ['a1'], onlyB: ['a3'], common: ['a2'] });
    expect(json.risks.onlyA).toEqual(['r1']);
    expect(json.predictions.onlyB).toEqual(['cheap']);
  });

  it('merge adopts picks with provenance and marks source merged', async () => {
    const { json } = await post(`/branches/${aId}/merge`, {
      targetBranchId: bId, picks: { assumptions: [0], risks: [0] },
    });
    expect(json.target.assumptions).toContain('a1');
    expect(json.target.risks).toContain('r1');
    const prov = json.target.mergeProvenance;
    expect(prov.find((p) => p.element === 'assumptions[0]' && p.fromBranch === aId)).toBeTruthy();
    expect(json.source.status).toBe('merged');
    expect(json.source.mergedInto).toBe(bId);
  });

  it('duplicate copies content with fresh identity', async () => {
    const { json } = await post(`/branches/${bId}/duplicate`);
    expect(json.branch.id).not.toBe(bId);
    expect(json.branch.name).toContain('(copy)');
    expect(json.branch.assumptions).toContain('a1');
  });
});

describe('experiments', () => {
  let missionId;
  let expId;
  beforeAll(async () => {
    const { json } = await post('/missions', { title: 'M-exp' });
    missionId = json.mission.id;
    expId = (await post(`/missions/${missionId}/experiments`, {
      title: 'E', prediction: 'it works',
    })).json.experiment.id;
    await post(`/experiments/${expId}/start`);
  });

  it('prediction is immutable after start', async () => {
    const r = await patch(`/experiments/${expId}`, { prediction: 'changed!' });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/immutable/);
  });

  it('results are append-only and versioned', async () => {
    const r1 = await post(`/experiments/${expId}/results`, { observations: 'first look' });
    expect(r1.status).toBe(201);
    expect(r1.json.result.v).toBe(1);
    const r2 = await post(`/experiments/${expId}/results`, { observations: 'second look' });
    expect(r2.json.result.v).toBe(2);
    const got = await get(`/experiments/${expId}`);
    expect(got.json.experiment.results).toHaveLength(2);
    expect(got.json.experiment.results[0].observations).toBe('first look');
    expect(got.json.experiment.results[0].v).toBe(1);
  });

  it('result records outcome signal via the pure adapter', async () => {
    const got = await get(`/experiments/${expId}`);
    const sig = got.json.experiment.outcomeSignal;
    expect(sig.mapped).toBe(true);
    expect(sig.event.event).toBe('experiment_outcome');
    expect(sig.event.event_data.prediction).toBe('it works');
  });

  it('run-hrm appends a labeled internal-simulation result', async () => {
    const r = await post(`/experiments/${expId}/run-hrm`, { steps: 3, seed: 7 });
    if (!r.json.available) {
      expect(r.json.reason).toBeTruthy(); // honest unavailability
      return;
    }
    expect(r.status).toBe(201);
    expect(r.json.result.kind).toBe('simulation');
    expect(r.json.result.label).toBe('internal-simulation');
  });
});

describe('contributions', () => {
  let m1;
  let m2;
  let pkgId;
  let evId;
  beforeAll(async () => {
    m1 = (await post('/missions', { title: 'M-pkg-src' })).json.mission.id;
    m2 = (await post('/missions', { title: 'M-pkg-dst' })).json.mission.id;
    evId = (await post(`/missions/${m1}/evidence`, { kind: 'document', title: 'Shared doc', text: 'body' })).json.evidence.id;
    const pkg = await post(`/missions/${m1}/contributions`, {
      title: 'Pkg1', kind: 'finding',
      artifacts: [{ kind: 'evidence', refId: evId, label: 'doc' }],
    });
    pkgId = pkg.json.contribution.id;
    // Frozen version captured at package time.
    expect(pkg.json.contribution.artifacts[0].version).toBe(1);
  });

  it('publish requires owner; import preserves attribution', async () => {
    const pub = await post(`/contributions/${pkgId}/publish`);
    expect(pub.status).toBe(200);
    const imp = await post(`/contributions/${pkgId}/import`, { targetMissionId: m2 });
    expect(imp.status).toBe(201);
    expect(imp.json.derivative).toBe(false);
    const [item] = imp.json.imported;
    expect(item.importedFrom).toMatchObject({ packageId: pkgId, missionId: m1, derivative: false });
    expect(item.title).toContain('Shared doc');
  });

  it('derivative flag set when importer notes modifications', async () => {
    const imp = await post(`/contributions/${pkgId}/import`, {
      targetMissionId: m2, derivativeNote: 'trimmed to summary',
    });
    expect(imp.json.derivative).toBe(true);
    expect(imp.json.imported[0].importedFrom.derivative).toBe(true);
  });

  it('private evidence cannot be packaged; export downloads JSON', async () => {
    const priv = (await post(`/missions/${m1}/evidence`, {
      kind: 'document', title: 'Secret', permissions: 'private',
    })).json.evidence;
    const bad = await post(`/missions/${m1}/contributions`, {
      title: 'Bad', kind: 'finding', artifacts: [{ kind: 'evidence', refId: priv.id }],
    });
    expect(bad.status).toBe(400);
    const exp = await get(`/contributions/export/${pkgId}`);
    expect(exp.status).toBe(200);
  });
});

describe('agents', () => {
  let missionId;
  let agentId;
  let docId;
  beforeAll(async () => {
    const { json } = await post('/missions', { title: 'M-agt' });
    missionId = json.mission.id;
    docId = (await post(`/missions/${missionId}/evidence`, { kind: 'document', title: 'Readable', text: 'abc' })).json.evidence.id;
    const a = await post(`/missions/${missionId}/agents`, {
      name: 'Reader',
      allowedSources: [docId],
      allowedTools: ['evidence.read', 'evidence.write'],
      permissions: { read: true, write: false, execute: false },
      testCases: [
        { name: 'read ok', tool: 'evidence.read', target: docId, expected: 'ok' },
        { name: 'write denied', tool: 'evidence.write', expected: 'denied' },
      ],
    });
    agentId = a.json.agent.id;
  });

  it('test runner evaluates capability checks without an LLM', async () => {
    const { json } = await post(`/agents/${agentId}/test`);
    expect(json.total).toBe(2);
    expect(json.passed).toBe(2);
  });

  it('denies write without permission and records the denial', async () => {
    const r = await post(`/agents/${agentId}/run`, { tool: 'evidence.write', input: { title: 'x', text: 'y' } });
    expect(r.status).toBe(403);
    expect(r.json.denialReason).toMatch(/write permission/);
    const runs = await get(`/agents/${agentId}/runs`);
    expect(runs.json.runs.find((x) => x.status === 'denied')).toBeTruthy();
  });

  it('denies external writes without explicit authorization', async () => {
    const a = await post(`/missions/${missionId}/agents`, {
      name: 'Writer', allowedTools: ['evidence.write'],
      permissions: { read: true, write: true, execute: false },
    });
    const id2 = a.json.agent.id;
    const denied = await post(`/agents/${id2}/run`, {
      tool: 'evidence.write', input: { title: 'ext', text: 't', external: true },
    });
    expect(denied.status).toBe(403);
    expect(denied.json.denialReason).toMatch(/authorizeExternal/);
  });

  it('reads allowed evidence through the tool', async () => {
    const r = await post(`/agents/${agentId}/run`, { tool: 'evidence.read', input: { evidenceId: docId } });
    expect(r.status).toBe(200);
    expect(r.json.run.output.title).toBe('Readable');
  });

  it('package + deploy intent + confirm flow stays honest', async () => {
    const p = await post(`/agents/${agentId}/package`);
    expect(p.status).toBe(200);
    expect(p.json.packageRef).toMatch(/\.zip$/);
    const d = await post(`/agents/${agentId}/deploy`, {});
    expect(d.status).toBe(403); // missing authorizeExternal
    const d2 = await post(`/agents/${agentId}/deploy`, { authorizeExternal: true });
    expect(d2.json.deployment.status).toBe('packaged');
    const c = await post(`/agents/${agentId}/deploy/confirm`, { url: 'https://example.vercel.app' });
    expect(c.json.deployment.status).toBe('deployed');
  });
});

describe('adapters (unit)', () => {
  it('outcomes adapter is pure and never invents match', () => {
    const exp = { id: 'exp_1', missionId: 'msn_1', prediction: 'up', successCriteria: 'x' };
    const withMatch = resultToLearningEvent(exp, { v: 1, observations: 'up a lot', matchedPrediction: true });
    expect(withMatch.event).toBe('experiment_outcome');
    expect(withMatch.event_data.match).toBe(true);
    const noMatch = resultToLearningEvent(exp, { v: 1, observations: 'unclear' });
    expect(noMatch.event_data.match).toBeNull();
  });

  it('governance denies unknown tools, missing perms, and unlisted sources', () => {
    const agent = { allowedTools: ['evidence.read'], permissions: { read: true, write: false, execute: false }, allowedSources: ['ev_1'] };
    expect(checkAgentCapability(agent, 'nope', null, {}).ok).toBe(false);
    expect(checkAgentCapability(agent, 'evidence.write', null, {}).ok).toBe(false);
    expect(checkAgentCapability(agent, 'evidence.read', 'ev_2', {}).ok).toBe(false);
    expect(checkAgentCapability(agent, 'evidence.read', 'ev_1', {}).ok).toBe(true);
    expect(checkAgentCapability(agent, 'evidence.read', null, { external: true }).ok).toBe(false);
  });

  it('hrm adapter labels internal-simulation or reports honest unavailability', async () => {
    const r = await runHrmSimulation({ steps: 3, seed: 7 });
    expect(typeof r.available).toBe('boolean');
    if (r.available) {
      expect(r.kind).toBe('internal-simulation');
      expect(r.engine).toBe('hrm');
      expect(r.snapshot).toBeTruthy();
    } else {
      expect(r.reason).toBeTruthy();
    }
  }, 60000);
});

describe('seed', () => {
  it('seedDemo is idempotent and exercises the full workflow', async () => {
    const store = createStore({ dataDir: tmpDir });
    const first = await seedDemo(store);
    expect(first.skipped).not.toBe(true);
    expect(first.missionId).toBeTruthy();
    const second = await seedDemo(store);
    expect(second.skipped).toBe(true);
    expect(second.missionId).toBe(first.missionId);

    // Spot-check the seeded workflow.
    const m = store.get('missions', first.missionId);
    expect(m.title).toBe('Urban Heat Mapping Pilot');
    const exp = store.get('experiments', first.experimentId);
    expect(exp.results).toHaveLength(1);
    expect(exp.outcomeSignal.mapped).toBe(true);
    const agent = store.get('agents', first.agentId);
    expect(agent.runs.some((x) => x.status === 'ok')).toBe(true);
    expect(agent.runs.some((x) => x.status === 'denied')).toBe(true);
  });

  it('POST /seed/demo seeds via HTTP and skips on repeat', async () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-seed-http-'));
    const prev = process.env.COLLAB_DATA_DIR;
    process.env.COLLAB_DATA_DIR = dir2;
    const app2 = express();
    app2.use(express.json({ limit: '20mb' }));
    mountCollab(app2);
    const s2 = await new Promise((resolve) => {
      const s = app2.listen(0, () => resolve(s));
    });
    try {
      const b2 = `http://127.0.0.1:${s2.address().port}/api/collab`;
      const r1 = await fetch(`${b2}/seed/demo`, { method: 'POST' });
      expect(r1.status).toBe(201);
      const r2 = await fetch(`${b2}/seed/demo`, { method: 'POST' });
      expect(r2.status).toBe(200);
      expect((await r2.json()).skipped).toBe(true);
    } finally {
      await new Promise((resolve) => s2.close(resolve));
      fs.rmSync(dir2, { recursive: true, force: true });
      process.env.COLLAB_DATA_DIR = prev;
    }
  });
});
