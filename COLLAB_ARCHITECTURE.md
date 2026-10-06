# QuadraSeer Collaboration Layer — Architecture

## Where it lives

```
collab/                  # backend: Express router module, self-contained
  index.js               # mountCollab(app) — mounts /api/collab/*
  store.js               # file-backed JSON document store + migrations
  ids.js auth.js migrations.js uploads.js seed.js
  routes/                # missions, evidence, branches, experiments, contributions, agents
  adapters/              # hrm.js, outcomes.js, governance.js
components/collab/       # frontend: mission-centered workspace (7 views + shared ui kit)
services/collabService.ts# typed API client + client-side file parsing (pdf/docx/xlsx)
```

Two integration points only: `server.js` calls `mountCollab(app)` (existing routes
untouched); `App.tsx` adds a Chat/Missions view switch (existing chat untouched).

## What was preserved

- **Hot/cold memory** (`atlantean_core/`): untouched. The collab layer does not write to it.
- **State persistence / export / import / sync**: untouched; the collab store is a *separate*
  local-first JSON store following the same atomic-write discipline.
- **Feedback & outcome signals**: bridged via `adapters/outcomes.js` — experiment results are
  mapped to normalized learning-event records in the existing event vocabulary
  (`event_normalization.py` shape). The mapping is pure, reviewable, and logged with the
  triggering result version. It does **not** modulate the torch field.
- **HRM simulation engine** (`hrm/`): bridged via `adapters/hrm.js`, which spawns `python3`
  with a stdio-JSON script around `HRMAdapter`. Every result is labeled `internal-simulation`.
- **Symbolic reasoning / scheduler / compute governance**: untouched; agent execution is
  gated by `adapters/governance.js`, which enforces tool allowlists, read/write/execute
  permissions, allowed evidence sources, and per-run external-action authorization at the
  actual call boundary. Every check is recorded in run history.
- **Capability permissions & provider interfaces**: agent records carry `allowedTools`,
  `permissions`, `allowedSources`, and `model.provider` (default `unconfigured`).

## Data & identity model

- Stable ids (`msn_`, `ev_`, `rel_`, `br_`, `exp_`, `pkg_`, `agt_`, `run_`, `act_`).
- Every entity: `version` + append-only `history[]` (actor, timestamp, change).
- Experiments: predictions immutable after start; results append-only versions.
- Claim statuses: `unreviewed | supported | disputed | insufficient-evidence`; changes require
  a reason and record actor + `aiSuggested` flag (AI suggestions visually distinct in UI).
- Auth: `disabled` (local single-owner) or `token` (Bearer). Mission roles
  owner/editor/viewer enforced per route. This is intentionally minimal — not SSO.

## Request flow (example: record experiment result)

```
ExperimentLedger.tsx → collabService.recordResult()
  → PATCH /api/collab/experiments/:id/results
  → routes/experiments.js: append result version (vN), keep v1..vN-1 immutable
  → adapters/outcomes.js: resultToLearningEvent() → stored as outcomeSignal + activity
  → linkedClaimUpdates applied to evidence with statusHistory entries
  → activity log: experiment.result-recorded, evidence.status-changed, outcome.signal-mapped
```

## Uploads

Server parses `txt/md/json/csv` from base64 JSON bodies. `pdf/docx/xlsx` are parsed
**client-side** with the repo's existing `pdfjs-dist`/`mammoth`/`xlsx` (already vendored),
then submitted as evidence with page/sheet/row locators. Anything else is stored with an
honest `stored-unparsed`/`unsupported` status — extraction is never fabricated.

## Honesty boundaries (by design)

- HRM output = `internal-simulation` unless a domain model is separately validated (none is, in v1).
- Agent "runs" execute only the three implemented tools under capability checks; there is no
  LLM call in v1 (`model.provider: unconfigured`).
- User-authored code is editable/exportable but **not executed** (no isolated runtime).
- Vercel deployment = generated package + status tracking; `deployed` only on user confirmation
  with a URL. The user deploys in their own Vercel account.
- No public marketplace: contribution scope is mission-to-mission + portable export/import.
