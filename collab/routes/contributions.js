import { Router } from 'express';
import { id, nowIso } from '../ids.js';
import { needMission, needMissionFor, logActivity, touch } from './_util.js';

const PKG_KINDS = ['finding', 'dataset', 'method', 'experiment-result', 'agent'];
const ARTIFACT_KINDS = ['evidence', 'branch', 'experiment', 'agent'];

function resolveArtifact(store, art) {
  if (!art || !ARTIFACT_KINDS.includes(art.kind) || !art.refId) return null;
  const coll = art.kind === 'evidence' ? 'evidence' : art.kind === 'branch' ? 'branches' : art.kind === 'experiment' ? 'experiments' : 'agents';
  const rec = store.get(coll, art.refId);
  if (!rec || rec.deleted) return null;
  return { coll, rec };
}

function artifactSnapshot(store, art) {
  const found = resolveArtifact(store, art);
  if (!found) return null;
  const { rec } = found;
  return {
    kind: art.kind,
    refId: rec.id,
    version: rec.version || 1,
    label: art.label || rec.title || rec.name || rec.id,
    title: rec.title || rec.name || '',
  };
}

// Import one artifact into the target mission as a NEW evidence item.
function importArtifact(store, pkg, art, targetMissionId, actor, derivative, derivativeNote) {
  const found = resolveArtifact(store, art);
  if (!found) return null;
  const { rec } = found;
  const base = {
    id: id('ev'),
    missionId: targetMissionId,
    author: rec.author || rec.owner || actor.name || actor.id,
    createdAt: nowIso(),
    version: 1,
    permissions: 'mission',
    locator: rec.locator || { page: 0, sheet: '', row: 0, excerpt: '' },
    claimStatus: 'unreviewed',
    statusHistory: [],
    importedFrom: {
      packageId: pkg.id,
      missionId: pkg.sourceMissionId,
      derivative: !!derivative,
      derivativeNote: derivativeNote || '',
      sourceKind: art.kind,
      sourceId: rec.id,
      sourceVersion: art.version,
    },
    history: [{ v: 1, at: nowIso(), actor: actor.id, change: `imported from package ${pkg.id}${derivative ? ' (derivative)' : ''}` }],
  };
  let ev;
  if (art.kind === 'evidence') {
    ev = {
      ...base,
      kind: rec.kind,
      title: `[imported] ${rec.title || rec.kind}`,
      source: `package:${pkg.id} ← ${rec.source || pkg.sourceMissionId}`,
      content: JSON.parse(JSON.stringify(rec.content || { text: '', parseStatus: 'parsed', format: '', uploadId: '' })),
    };
  } else if (art.kind === 'branch') {
    ev = {
      ...base,
      kind: 'document',
      title: `[imported] Branch: ${rec.name}`,
      source: `package:${pkg.id} ← branch ${rec.id}`,
      content: {
        text: `Approach: ${rec.approach || ''}\nRationale: ${rec.rationale || ''}\nAssumptions: ${(rec.assumptions || []).join('; ')}\nRisks: ${(rec.risks || []).join('; ')}`,
        parseStatus: 'parsed', format: 'text', uploadId: '',
      },
    };
  } else if (art.kind === 'experiment') {
    const last = (rec.results || [])[rec.results.length - 1];
    ev = {
      ...base,
      kind: 'experiment-result',
      title: `[imported] Experiment: ${rec.title}`,
      source: `package:${pkg.id} ← experiment ${rec.id}`,
      content: {
        text: `Question: ${rec.question || ''}\nHypothesis: ${rec.hypothesis || ''}\nPrediction: ${rec.prediction || ''}\nLatest result: ${last ? last.observations : 'none recorded'}`,
        parseStatus: 'parsed', format: 'text', uploadId: '',
      },
    };
  } else {
    ev = {
      ...base,
      kind: 'document',
      title: `[imported] Agent: ${rec.name}`,
      source: `package:${pkg.id} ← agent ${rec.id}`,
      content: {
        text: `Purpose: ${rec.purpose || ''}\nInstructions: ${rec.instructions || ''}\nTools: ${(rec.allowedTools || []).join(', ')}`,
        parseStatus: 'parsed', format: 'text', uploadId: '',
      },
    };
  }
  store.set('evidence', ev.id, ev);
  return ev;
}

export function createContributionsRouter(store) {
  const r = Router();

  r.get('/missions/:id/contributions', (req, res) => {
    const m = needMission(req, res, store, 'read');
    if (!m) return;
    const items = store.all('contributions')
      .filter((p) => p.sourceMissionId === m.id)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    res.json({ contributions: items });
  });

  // Create package draft. Artifacts must be explicitly selected; versions frozen.
  r.post('/missions/:id/contributions', (req, res) => {
    const m = needMission(req, res, store, 'create');
    if (!m) return;
    const b = req.body || {};
    if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: 'title is required' });
    if (!PKG_KINDS.includes(b.kind)) return res.status(400).json({ error: `kind must be one of ${PKG_KINDS.join(', ')}` });
    if (!Array.isArray(b.artifacts)) return res.status(400).json({ error: 'artifacts array is required (explicit selection)' });
    const artifacts = [];
    for (const a of b.artifacts) {
      const snap = artifactSnapshot(store, a);
      if (!snap) return res.status(400).json({ error: `artifact not found: ${a && a.kind}:${a && a.refId}` });
      const found = resolveArtifact(store, a);
      if (found.rec.missionId !== m.id) {
        return res.status(400).json({ error: `artifact ${a.refId} is not in this mission` });
      }
      if (found.coll === 'evidence' && found.rec.permissions === 'private') {
        return res.status(400).json({ error: `artifact ${a.refId} is private and cannot be packaged` });
      }
      artifacts.push(snap);
    }
    const pkg = {
      id: id('pkg'),
      title: String(b.title),
      summary: b.summary || '',
      intendedUse: b.intendedUse || '',
      kind: b.kind,
      artifacts,
      attribution: b.attribution || req.actor.name || req.actor.id,
      provenance: b.provenance || `mission ${m.id}`,
      license: b.license || '',
      evidence: Array.isArray(b.evidence) ? b.evidence : [],
      limitations: b.limitations || '',
      reproduction: b.reproduction || '',
      dependencies: Array.isArray(b.dependencies) ? b.dependencies : [],
      access: Array.isArray(b.access) ? b.access : [],
      sourceMissionId: m.id,
      status: 'draft',
      scope: b.scope === 'export' ? 'export' : 'mission',
      imports: [],
      createdAt: nowIso(),
      version: 1,
      history: [{ v: 1, at: nowIso(), actor: req.actor.id, change: 'package created' }],
    };
    store.set('contributions', pkg.id, pkg);
    logActivity(store, { missionId: m.id, actor: req.actor, type: 'contribution.published', summary: `Contribution draft created: ${pkg.title}`, ref: { kind: 'contribution', id: pkg.id } });
    res.status(201).json({ contribution: pkg });
  });

  r.get('/contributions/:id', (req, res) => {
    const pkg = store.get('contributions', req.params.id);
    if (!pkg) return res.status(404).json({ error: 'contribution not found' });
    const m = needMissionFor(store, { missionId: pkg.sourceMissionId }, req, res, 'read');
    if (!m) return;
    res.json({ contribution: pkg });
  });

  r.get('/contributions/:id/preview', (req, res) => {
    const pkg = store.get('contributions', req.params.id);
    if (!pkg) return res.status(404).json({ error: 'contribution not found' });
    const m = needMissionFor(store, { missionId: pkg.sourceMissionId }, req, res, 'read');
    if (!m) return;
    const resolved = pkg.artifacts.map((a) => {
      const found = resolveArtifact(store, a);
      return {
        ...a,
        currentVersion: found ? found.rec.version || 1 : null,
        stale: found ? (found.rec.version || 1) !== a.version : null,
        liveTitle: found ? found.rec.title || found.rec.name : null,
      };
    });
    res.json({ contribution: pkg, artifacts: resolved });
  });

  // Publish: owner only.
  r.post('/contributions/:id/publish', (req, res) => {
    const pkg = store.get('contributions', req.params.id);
    if (!pkg) return res.status(404).json({ error: 'contribution not found' });
    const m = needMissionFor(store, { missionId: pkg.sourceMissionId }, req, res, 'publish');
    if (!m) return;
    if (pkg.artifacts.length === 0) return res.status(400).json({ error: 'cannot publish a package with no artifacts' });
    pkg.status = 'published';
    touch(store, 'contributions', pkg, req.actor, 'package published');
    logActivity(store, { missionId: m.id, actor: req.actor, type: 'contribution.published', summary: `Contribution published: ${pkg.title}`, ref: { kind: 'contribution', id: pkg.id } });
    res.json({ contribution: pkg });
  });

  // Import into another mission. Artifacts become NEW evidence items with attribution.
  r.post('/contributions/:id/import', (req, res) => {
    const pkg = store.get('contributions', req.params.id);
    if (!pkg) return res.status(404).json({ error: 'contribution not found' });
    if (pkg.status !== 'published') return res.status(400).json({ error: 'only published packages can be imported' });
    const b = req.body || {};
    const target = store.get('missions', b.targetMissionId);
    if (!target || target.deleted) return res.status(400).json({ error: 'targetMissionId must be a valid mission' });
    const m = needMissionFor(store, { missionId: target.id }, req, res, 'create');
    if (!m) return;
    const derivative = !!(b.derivativeNote || b.edits);
    const imported = [];
    for (const art of pkg.artifacts) {
      const ev = importArtifact(store, pkg, art, target.id, req.actor, derivative, b.derivativeNote);
      if (ev) imported.push(ev);
    }
    pkg.imports.push({ missionId: target.id, at: nowIso(), actor: req.actor.id, derivative: !!derivative });
    touch(store, 'contributions', pkg, req.actor, `imported into mission ${target.id}${derivative ? ' (derivative)' : ''}`);
    logActivity(store, { missionId: target.id, actor: req.actor, type: 'contribution.imported', summary: `Imported package '${pkg.title}' (${imported.length} item(s), attribution: ${pkg.attribution})`, ref: { kind: 'contribution', id: pkg.id } });
    res.status(201).json({ imported, derivative, package: pkg });
  });

  // Downloadable JSON package.
  r.get('/contributions/export/:id', (req, res) => {
    const pkg = store.get('contributions', req.params.id);
    if (!pkg) return res.status(404).json({ error: 'contribution not found' });
    const m = needMissionFor(store, { missionId: pkg.sourceMissionId }, req, res, 'read');
    if (!m) return;
    const payload = {
      format: 'quadra-seer-contribution/v1',
      exportedAt: nowIso(),
      package: pkg,
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${pkg.id}.json"`);
    res.send(JSON.stringify(payload, null, 2));
  });

  return r;
}
