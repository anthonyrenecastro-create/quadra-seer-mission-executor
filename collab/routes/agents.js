import { Router } from 'express';
import JSZip from 'jszip';
import { id, nowIso } from '../ids.js';
import { needMission, needMissionFor, logActivity, touch } from './_util.js';
import { checkAgentCapability, KNOWN_TOOLS } from '../adapters/governance.js';
import { runHrmSimulation } from '../adapters/hrm.js';

const MAX_RUNS = 200;

function newAgent(b, missionId, actor) {
  return {
    id: id('agt'),
    missionId,
    branchId: b.branchId || '',
    name: String(b.name || 'Untitled agent'),
    purpose: b.purpose || '',
    instructions: b.instructions || '',
    version: 1,
    allowedSources: Array.isArray(b.allowedSources) ? b.allowedSources.map(String) : [],
    allowedTools: Array.isArray(b.allowedTools) ? b.allowedTools.filter((t) => KNOWN_TOOLS.includes(t)) : ['evidence.read'],
    permissions: {
      read: b.permissions && typeof b.permissions.read === 'boolean' ? b.permissions.read : true,
      write: !!(b.permissions && b.permissions.write),
      execute: !!(b.permissions && b.permissions.execute),
    },
    model: {
      provider: (b.model && b.model.provider) || 'unconfigured',
      model: (b.model && b.model.model) || '',
    },
    limits: {
      maxRuntimeMs: (b.limits && b.limits.maxRuntimeMs) || 60000,
      maxSpend: (b.limits && b.limits.maxSpend) || '',
    },
    testCases: Array.isArray(b.testCases) ? b.testCases : [],
    runs: [],
    deployment: { target: 'vercel', status: 'not-deployed', detail: '', packageRef: '' },
    createdAt: nowIso(),
    updatedAt: nowIso(),
    history: [{ v: 1, at: nowIso(), actor: actor.id, change: 'agent created' }],
  };
}

function recordRun(store, agent, run) {
  agent.runs = agent.runs || [];
  agent.runs.push(run);
  if (agent.runs.length > MAX_RUNS) agent.runs = agent.runs.slice(-MAX_RUNS);
  store.set('agents', agent.id, agent);
  return run;
}

// Core tool execution, shared by the route and the demo seed.
// Returns { statusCode, body }.
export async function runAgentTool(store, agent, { tool, input, actor, mission, authorizeExternal }) {
  const inp = input && typeof input === 'object' ? input : {};
  const run = {
    id: id('run'),
    at: nowIso(),
    actor: actor.id,
    input: inp,
    tool: tool || '',
    output: null,
    artifacts: [],
    status: 'ok',
    denialReason: '',
  };

  const check = checkAgentCapability(agent, tool, inp.evidenceId || null, {
    authorizeExternal: !!authorizeExternal,
    actor,
    mission,
    external: inp.external === true,
  });
  if (!check.ok) {
    run.status = 'denied';
    run.denialReason = check.reason;
    recordRun(store, agent, run);
    return { statusCode: 403, body: { error: check.reason, denialReason: check.reason, run } };
  }

  try {
    if (tool === 'evidence.read') {
      if (!inp.evidenceId) {
        run.status = 'error';
        run.output = { error: 'input.evidenceId is required' };
      } else {
        const ev = store.get('evidence', inp.evidenceId);
        if (!ev || ev.deleted || ev.missionId !== agent.missionId) {
          run.status = 'error';
          run.output = { error: 'evidence not found in this mission' };
        } else {
          run.output = {
            id: ev.id, kind: ev.kind, title: ev.title, source: ev.source,
            excerpt: String((ev.content && ev.content.text) || '').slice(0, 2000),
            claimStatus: ev.claimStatus, version: ev.version,
          };
        }
      }
    } else if (tool === 'evidence.write') {
      const ev = {
        id: id('ev'),
        missionId: agent.missionId,
        kind: ['document', 'dataset', 'claim', 'question', 'assumption', 'decision', 'experiment-result'].includes(inp.kind) ? inp.kind : 'document',
        title: inp.title || `Agent output (${agent.name})`,
        source: `agent:${agent.id}`,
        author: agent.name,
        createdAt: nowIso(),
        version: 1,
        permissions: 'mission',
        locator: { page: 0, sheet: '', row: 0, excerpt: '' },
        content: { text: typeof inp.text === 'string' ? inp.text : '', parseStatus: 'parsed', format: 'text', uploadId: '' },
        claimStatus: 'unreviewed',
        statusHistory: [],
        importedFrom: null,
        history: [{ v: 1, at: nowIso(), actor: actor.id, change: `created by agent ${agent.id} via evidence.write` }],
      };
      store.set('evidence', ev.id, ev);
      run.artifacts.push({ kind: 'evidence', id: ev.id });
      run.output = { created: ev.id, title: ev.title, claimStatus: ev.claimStatus };
      logActivity(store, { missionId: agent.missionId, actor, type: 'evidence.added', summary: `Agent ${agent.name} wrote evidence: ${ev.title}`, ref: { kind: 'evidence', id: ev.id } });
    } else if (tool === 'hrm.simulate') {
      const sim = await runHrmSimulation({ steps: inp.steps || 50, seed: inp.seed ?? null, state_dim: inp.state_dim ?? null });
      if (!sim.available) {
        run.status = 'error';
        run.output = { available: false, reason: sim.reason };
      } else {
        run.output = {
          label: 'internal-simulation',
          engine: 'hrm',
          steps: sim.steps,
          seed: sim.seed,
          snapshot: sim.snapshot,
          timelineLength: sim.timelineLength,
          note: 'Internal simulation only; not a validated domain model.',
        };
      }
    }
  } catch (e) {
    run.status = 'error';
    run.output = { error: String((e && e.message) || e).slice(0, 500) };
  }

  recordRun(store, agent, run);
  return { statusCode: 200, body: { ok: run.status === 'ok', run } };
}

export function createAgentsRouter(store) {
  const r = Router();

  r.get('/missions/:id/agents', (req, res) => {
    const m = needMission(req, res, store, 'read');
    if (!m) return;
    const items = store.all('agents')
      .filter((a) => a.missionId === m.id)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    res.json({ agents: items });
  });

  r.post('/missions/:id/agents', (req, res) => {
    const m = needMission(req, res, store, 'create');
    if (!m) return;
    const b = req.body || {};
    if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'name is required' });
    const agent = newAgent(b, m.id, req.actor);
    store.set('agents', agent.id, agent);
    logActivity(store, { missionId: m.id, actor: req.actor, type: 'agent.created', summary: `Agent created: ${agent.name}`, ref: { kind: 'agent', id: agent.id } });
    res.status(201).json({ agent });
  });

  r.get('/agents/:id', (req, res) => {
    const agent = store.get('agents', req.params.id);
    const m = needMissionFor(store, agent, req, res, 'read');
    if (!m) return;
    res.json({ agent });
  });

  r.patch('/agents/:id', (req, res) => {
    let agent = store.get('agents', req.params.id);
    const m = needMissionFor(store, agent, req, res, 'edit');
    if (!m) return;
    agent = store.get('agents', req.params.id);
    const b = req.body || {};
    const changed = [];
    for (const f of ['name', 'purpose', 'instructions', 'branchId']) {
      if (typeof b[f] === 'string' && b[f] !== agent[f]) { agent[f] = b[f]; changed.push(f); }
    }
    if (Array.isArray(b.allowedSources)) { agent.allowedSources = b.allowedSources.map(String); changed.push('allowedSources'); }
    if (Array.isArray(b.allowedTools)) { agent.allowedTools = b.allowedTools.filter((t) => KNOWN_TOOLS.includes(t)); changed.push('allowedTools'); }
    if (b.permissions && typeof b.permissions === 'object') {
      for (const k of ['read', 'write', 'execute']) {
        if (typeof b.permissions[k] === 'boolean') agent.permissions[k] = b.permissions[k];
      }
      changed.push('permissions');
    }
    if (b.model && typeof b.model === 'object') {
      if (typeof b.model.provider === 'string') agent.model.provider = b.model.provider;
      if (typeof b.model.model === 'string') agent.model.model = b.model.model;
      changed.push('model');
    }
    if (b.limits && typeof b.limits === 'object') {
      if (b.limits.maxRuntimeMs) agent.limits.maxRuntimeMs = b.limits.maxRuntimeMs;
      if (typeof b.limits.maxSpend === 'string') agent.limits.maxSpend = b.limits.maxSpend;
      changed.push('limits');
    }
    if (Array.isArray(b.testCases)) { agent.testCases = b.testCases; changed.push('testCases'); }
    if (changed.length === 0) return res.status(400).json({ error: 'nothing to update' });
    touch(store, 'agents', agent, req.actor, `updated: ${changed.join(', ')}`);
    res.json({ agent });
  });

  // Test runner: each test case is evaluated through capability checks (no LLM in v1).
  r.post('/agents/:id/test', (req, res) => {
    let agent = store.get('agents', req.params.id);
    const m = needMissionFor(store, agent, req, res, 'edit');
    if (!m) return;
    agent = store.get('agents', req.params.id);
    const results = (agent.testCases || []).map((tc, i) => {
      const tool = tc.tool || 'evidence.read';
      const expected = tc.expected === 'denied' ? 'denied' : 'ok';
      const check = checkAgentCapability(agent, tool, tc.target || null, { actor: req.actor, mission: m });
      const actual = check.ok ? 'ok' : 'denied';
      return { name: tc.name || `case-${i + 1}`, tool, expected, actual, pass: actual === expected, reason: check.reason || '' };
    });
    const passed = results.filter((x) => x.pass).length;
    const run = {
      id: id('run'), at: nowIso(), actor: req.actor.id, input: { testCases: results.length },
      tool: 'test', output: { passed, total: results.length, results }, artifacts: [],
      status: passed === results.length ? 'ok' : 'error', denialReason: '',
    };
    recordRun(store, agent, run);
    res.json({ passed, total: results.length, results, run });
  });

  r.post('/agents/:id/run', async (req, res) => {
    let agent = store.get('agents', req.params.id);
    const m = needMissionFor(store, agent, req, res, 'edit');
    if (!m) return;
    agent = store.get('agents', req.params.id);
    const b = req.body || {};
    const out = await runAgentTool(store, agent, {
      tool: b.tool, input: b.input, actor: req.actor, mission: m, authorizeExternal: b.authorizeExternal,
    });
    res.status(out.statusCode).json(out.body);
  });

  r.get('/agents/:id/runs', (req, res) => {
    const agent = store.get('agents', req.params.id);
    const m = needMissionFor(store, agent, req, res, 'read');
    if (!m) return;
    const runs = (agent.runs || []).slice().sort((a, b) => (a.at < b.at ? 1 : -1));
    res.json({ runs });
  });

  // Package: JSON manifest + zip (jszip) saved under collab-data/packages/.
  r.post('/agents/:id/package', async (req, res) => {
    let agent = store.get('agents', req.params.id);
    const m = needMissionFor(store, agent, req, res, 'edit');
    if (!m) return;
    agent = store.get('agents', req.params.id);
    const manifest = {
      format: 'quadra-seer-agent-package/v1',
      exportedAt: nowIso(),
      agent: {
        id: agent.id, name: agent.name, version: agent.version, purpose: agent.purpose,
        instructions: agent.instructions, allowedTools: agent.allowedTools,
        permissions: agent.permissions, limits: agent.limits, model: agent.model,
      },
      deploy: { target: 'vercel', note: 'Deploy this package to your own Vercel account; see README.' },
    };
    const zip = new JSZip();
    zip.file('agent.json', JSON.stringify(manifest, null, 2));
    zip.file('README.txt',
      `Quadra Seer agent package: ${agent.name} (v${agent.version})\n\n` +
      `This package describes the agent. To deploy: create a project in YOUR OWN Vercel account,\n` +
      `add a serverless function that loads agent.json, and configure credentials server-side.\n` +
      `Quadra Seer never deploys to Vercel on your behalf; confirm deployment via the API.\n`);
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const filename = `${agent.id}-v${agent.version}.zip`;
    store.savePackage(filename, buffer);
    const packageRef = `packages/${filename}`;
    agent.deployment = {
      target: 'vercel', status: 'packaged', packageRef,
      detail: 'Package generated. Deploy it to your own Vercel account, then confirm with the deploy/confirm endpoint.',
    };
    touch(store, 'agents', agent, req.actor, 'agent packaged for deployment');
    logActivity(store, { missionId: m.id, actor: req.actor, type: 'agent.deployed', summary: `Agent packaged: ${agent.name}`, ref: { kind: 'agent', id: agent.id } });
    res.json({ manifest, packageRef, filename, bytes: buffer.length });
  });

  // Deploy: records deployment INTENT. Requires explicit authorization + owner/editor.
  r.post('/agents/:id/deploy', (req, res) => {
    let agent = store.get('agents', req.params.id);
    const m = needMissionFor(store, agent, req, res, 'authorizeExternal');
    if (!m) return;
    agent = store.get('agents', req.params.id);
    const b = req.body || {};
    if (b.authorizeExternal !== true) {
      return res.status(403).json({ error: 'deployment requires authorizeExternal: true in the request body' });
    }
    agent.deployment = {
      target: 'vercel',
      status: 'packaged',
      packageRef: agent.deployment.packageRef || '',
      detail: 'Deployment intent recorded. Deploy the generated package to your own Vercel account from your dashboard; Quadra Seer does not deploy on your behalf. Confirm with deploy/confirm once live.',
    };
    touch(store, 'agents', agent, req.actor, 'deployment intent recorded (packaged)');
    logActivity(store, { missionId: m.id, actor: req.actor, type: 'agent.deployed', summary: `Deployment intent recorded for ${agent.name} (packaged)`, ref: { kind: 'agent', id: agent.id } });
    res.json({ deployment: agent.deployment });
  });

  // Confirm: only mark deployed when the user confirms with a live URL.
  r.post('/agents/:id/deploy/confirm', (req, res) => {
    let agent = store.get('agents', req.params.id);
    const m = needMissionFor(store, agent, req, res, 'edit');
    if (!m) return;
    agent = store.get('agents', req.params.id);
    const b = req.body || {};
    if (!b.url || !/^https?:\/\//.test(String(b.url))) {
      return res.status(400).json({ error: 'a live http(s) url is required to confirm deployment' });
    }
    agent.deployment = {
      target: 'vercel', status: 'deployed', packageRef: agent.deployment.packageRef || '',
      detail: String(b.url),
    };
    touch(store, 'agents', agent, req.actor, `deployment confirmed live at ${b.url}`);
    logActivity(store, { missionId: m.id, actor: req.actor, type: 'agent.deployed', summary: `Agent deployed: ${agent.name} → ${b.url}`, ref: { kind: 'agent', id: agent.id } });
    res.json({ deployment: agent.deployment });
  });

  return r;
}
