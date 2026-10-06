# QuadraSeer Collaboration Layer — Setup

## Prerequisites

- Node.js 22+ (repo already requires 22.x; verified on 24.x)
- `npm install` at the repo root (no new dependencies were added by this layer)
- Python 3 with the repo's existing requirements **only** for HRM simulation runs
  (`hrm/`); everything else works without Python.

## Quick start

```bash
npm install
npm run collab:seed   # seeds the [DEMO] mission (idempotent — safe to re-run)
npm start             # serves API on :3001 (needs GEMINI_API_KEY, pre-existing requirement)
npm run dev           # Vite frontend on :3000 → click "Missions" in the top nav
```

Open http://localhost:3000, switch to the **Missions** view, and pick the
`[DEMO] Urban Heat Mapping Pilot` mission.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `COLLAB_DATA_DIR` | `<repo>/collab-data/` | File-backed JSON store location (gitignored) |
| `COLLAB_AUTH` | `disabled` | `disabled` = single local owner, everything allowed. `token` = require `Authorization: Bearer <token>` |
| `COLLAB_API_TOKEN` | — | Bearer token accepted in `token` mode |
| `COLLAB_ACTORS` | — | Optional JSON map of token → `{id, name}` in `token` mode |

No database to provision. The store is a set of JSON files with atomic
write-tmp-then-rename semantics and a `meta.json` schema version; migrations run
automatically on load.

## Running tests

```bash
npx vitest run collab        # backend: 32 tests (store, auth, versioning, merge, import, agents)
npx vitest run components/collab  # frontend: workspace render tests
npx vitest run               # full suite (43 tests)
python tests/run_validation.py    # existing Python core regression (needs torch)
```

## Demo mission walkthrough

The seeded `[DEMO] Urban Heat Mapping Pilot` exercises the complete workflow:

1. **Mission** → Overview tab: milestones, tasks, success measures, attention queue.
2. **Evidence** → 5 items (document, dataset, 2 claims, 1 question) with relations
   (`supports`, `contradicts`, `derived-from`); switch List/Graph; open the inspector.
3. **Branches** → "Sensor network" vs "Satellite + modeling": compare them, then merge
   selectively and check provenance.
4. **Experiments** → `[DEMO] Sensor calibration run`: prediction (immutable), versioned
   result, linked claim update, outcome-signal mapping.
5. **Exchange** → `[DEMO] Sensor calibration findings` package: preview, then import
   into the second mission (`Heat Policy Review`) and verify attribution.
6. **Agents** → `[DEMO] Evidence librarian`: run a test case, observe the recorded
   denial on the write attempt (read-only agent).

## Resetting demo data

```bash
rm -rf collab-data && npm run collab:seed
```
