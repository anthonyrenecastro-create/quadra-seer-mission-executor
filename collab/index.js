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

  // Demo seed. In disabled mode the local owner may seed; in token mode any
  // authenticated actor may seed (they become owner of the demo missions).
  app.post('/api/collab/seed/demo', async (req, res) => {
    try {
      const out = await seedDemo(store, req.actor);
      res.status(out.skipped ? 200 : 201).json(out);
    } catch (e) {
      res.status(500).json({ error: String((e && e.message) || e).slice(0, 500) });
    }
  });

  // 404 for unknown /api/collab paths (JSON, not HTML).
  app.use('/api/collab', (req, res) => {
    res.status(404).json({ error: 'collab route not found' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use('/api/collab', (err, req, res, next) => {
    // JSON body parse errors etc.
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid JSON body' });
    }
    res.status(500).json({ error: 'internal collab error' });
  });

  return { store };
}
