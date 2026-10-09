import path from 'node:path';
import { createStore } from './store.js';
import { authMiddleware, authMode } from './auth.js';
import { detectPython } from './adapters/hrm.js';
import { createMissionsRouter } from './routes/missions.js';
import { createEvidenceRouter } from './routes/evidence.js';
import { createBranchesRouter } from './routes/branches.js';
import { createExperimentsRouter } from './routes/experiments.js';
import { createContributionsRouter } from './routes/contributions.js';
import { createAgentsRouter } from './routes/agents.js';
import { seedDemo } from './seed.js';

// mountCollab(app, opts) -> { store }
// Mounts every collab route under /api/collab on the passed express app.
// opts: { dataDir } (overrides COLLAB_DATA_DIR env).
export function mountCollab(app, opts = {}) {
  const store = createStore(opts);

  // Public health (no auth).
  app.get('/api/collab/health', async (req, res) => {
    const det = await detectPython().catch(() => ({ python: false, hrm: false }));
    res.json({
      ok: true,
      schemaVersion: store.schemaVersion(),
      authMode: authMode(),
      python: !!det.python,
      hrm: !!det.hrm,
    });
  });

  // Everything else under /api/collab requires auth (mode-dependent).
  app.use('/api/collab', authMiddleware);

  app.use('/api/collab', createMissionsRouter(store));
  app.use('/api/collab', createEvidenceRouter(store));
  app.use('/api/collab', createBranchesRouter(store));
  app.use('/api/collab', createExperimentsRouter(store));
  app.use('/api/collab', createContributionsRouter(store));
  app.use('/api/collab', createAgentsRouter(store));

  // Demo seed. Destructive write: in token mode (production) it requires
  // explicit opt-in via COLLAB_ALLOW_SEED=1. In disabled mode (local dev)
  // the local owner may seed freely.
  app.post('/api/collab/seed/demo', async (req, res) => {
    if (authMode() === 'token' && process.env.COLLAB_ALLOW_SEED !== '1') {
      return res.status(403).json({
        error: 'demo seeding is disabled in token mode (set COLLAB_ALLOW_SEED=1 to enable)',
      });
    }
    try {
      const out = await seedDemo(store, req.actor);
      res.status(out.skipped ? 200 : 201).json(out);
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e).slice(0, 500) });
    }
  });

  // Admin: whole-store export (any authenticated actor — they can already read
  // everything via the API, so export grants no new access).
  app.get('/api/collab/admin/export', async (req, res) => {
    const data = store.exportAll();
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="quadra-seer-export-${new Date().toISOString().slice(0, 10)}.json"`,
    );
    res.json(data);
  });

  // Admin: snapshots. Restore/import are destructive: in token mode they
  // require explicit opt-in via COLLAB_ALLOW_RESTORE=1.
  app.post('/api/collab/admin/snapshots', async (req, res) => {
    const dest = store.snapshot((req.body && req.body.label) || 'manual');
    res.status(201).json({ snapshot: path.basename(dest) });
  });

  app.get('/api/collab/admin/snapshots', async (req, res) => {
    res.json({ snapshots: store.listSnapshots() });
  });

  function restoreGate(res) {
    if (authMode() === 'token' && process.env.COLLAB_ALLOW_RESTORE !== '1') {
      res.status(403).json({
        error: 'store restore is disabled in token mode (set COLLAB_ALLOW_RESTORE=1 to enable)',
      });
      return false;
    }
    return true;
  }

  app.post('/api/collab/admin/snapshots/:name/restore', async (req, res) => {
    if (!restoreGate(res)) return;
    try {
      const out = store.restoreSnapshot(req.params.name);
      res.json({ ok: true, ...out });
    } catch (e) {
      const status = e.code === 'ENOSNAPSHOT' ? 404 : 500;
      res.status(status).json({ error: String((e && e.message) || e).slice(0, 500) });
    }
  });

  app.post('/api/collab/admin/import', async (req, res) => {
    if (!restoreGate(res)) return;
    try {
      const out = store.importAll(req.body);
      res.json({ ok: true, ...out });
    } catch (e) {
      const status = e.code === 'EBADEXPORT' ? 400 : 500;
      res.status(status).json({ error: String((e && e.message) || e).slice(0, 500) });
    }
  });

  // 404 for unknown /api/collab paths (JSON, not HTML).
  app.use('/api/collab', (req, res) => {
    res.status(404).json({ error: 'collab route not found' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use('/api/collab', (err, req, res, next) => {
    // Never swallow errors silently: log with request context, then respond.
    console.error('[collab] request failed:', {
      method: req.method,
      path: req.path,
      actor: req.actor && req.actor.id,
      error: err && err.stack ? err.stack : String(err),
    });
    // JSON body parse errors etc.
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid JSON body' });
    }
    res.status(500).json({ error: 'internal collab error' });
  });

  return { store };
}
