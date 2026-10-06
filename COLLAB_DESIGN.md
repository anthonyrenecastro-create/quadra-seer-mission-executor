# QuadraSeer Collaboration Layer — Design & Build Contract

## 0. Non-negotiable principles

1. **Preserve the core.** Do NOT modify `atlantean_core/`, `hrm/`, existing `server.js` routes,
   existing `components/`, `services/`, `hooks/`, `context/`, or Python tests. New backend code lives
   in `collab/`; new frontend code lives in `components/collab/` + `services/collabService.ts`.
   The only edits to existing files allowed are the two integration points handled by the main agent:
   `server.js` (mount collab router + extend CORS methods) and `App.tsx` (add Chat/Missions nav).
2. **Adapters, not replacements.** HRM, outcome signals, governance, and memory stay where they are.
   The collab layer calls them through explicit adapter modules.
3. **Honesty.** Label simulations as simulations. Unsupported uploads get an honest
   `stored-unparsed`/`unsupported` status — never fabricated extracted content. External integrations
   show a clear configuration state. Never substitute simulated success for a real operation.
   Do not present internal coherence scores as factual confidence or scientific validation.
4. **Mission scoping.** Every feature operates within a mission context. No global cross-mission
   reads except explicit contribution import/export.

## 1. Backend: `collab/` (Node 24, ESM — package.json has `"type": "module"`)

```
collab/
  index.js          # exports mountCollab(app) -> { store }; mounts all routes under /api/collab
  store.js          # file-backed JSON document store, schema version + migrations, atomic writes
  ids.js            # id(prefix) -> e.g. "msn_9f3k..." using crypto.randomUUID
  auth.js           # resolveActor(req) -> { id, name }; can(req, action, mission)
  migrations.js     # [{ version, up(store) }]
  uploads.js        # parseUpload({filename, mimeType, contentBase64}) -> { text, parseStatus, locator }
  seed.js           # exports seedDemo(store) -> { missionId, ... }; runnable: node collab/seed.js
  routes/
    missions.js     # missions + dashboard + activity + attention
    evidence.js     # evidence + relations + uploads
    branches.js     # branches + compare + merge
    experiments.js  # experiments + results + hrm run
    contributions.js
    agents.js
  adapters/
    hrm.js          # runHrmSimulation(config) -> spawns python3 stdio JSON helper; labels result
    outcomes.js     # resultToLearningEvent(experiment, resultVersion) -> normalized event record
    governance.js   # checkAgentCapability(agent, tool, target) -> { ok, reason }
  collab.test.js    # vitest tests (store, auth, merge provenance, experiment versioning, import attribution, agent denial)
```

**Storage.** `COLLAB_DATA_DIR` env (default `<repo>/collab-data/`). Files:
`meta.json { schemaVersion }`, `missions.json`, `evidence.json`, `relations.json`, `branches.json`,
`experiments.json`, `contributions.json`, `agents.json`, `activity.json` (array, append-only),
`uploads/` (raw files by id). All maps keyed by id. Writes: `JSON.stringify` to `<file>.tmp` +
`fs.renameSync` (atomic). On load: if `meta.json` missing → init v1; run pending migrations.

**IDs.** `ids.js`: `export function id(prefix) { return prefix + "_" + crypto.randomUUID().slice(0,8) }`.
Prefixes: `msn`, `ev`, `rel`, `br`, `mls`, `tsk`, `sm`, `exp`, `pkg`, `agt`, `run`, `act`.

**Auth (`auth.js`).**
- `COLLAB_AUTH` env: `disabled` (default) → actor = `{ id: "local-owner", name: "Local owner" }`,
  all actions allowed. `token` → require `Authorization: Bearer <COLLAB_API_TOKEN>`; actor id from
  `COLLAB_ACTORS` JSON env (`{"token-id": {"id","name"}}`) or the raw token as id.
- Mission roles: `contributors: [{ actor, role }]` with `owner | editor | viewer`. Owner is
  auto-added. Permission matrix:
  - viewer: read mission-scoped data
  - editor: + create/edit evidence, branches, experiments, agents, tasks, milestones
  - owner: + archive/reopen/delete, manage contributors, publish contributions, authorize external
- `can(actor, action, mission)` enforced in every route. 403 with `{ error }` on denial.

**Health.** `GET /api/collab/health` → `{ ok, schemaVersion, authMode, python: bool, hrm: bool }`.
Python detection: `python3 -c "import hrm"` from repo root (best-effort, cached 60s).

## 2. Data model (exact shapes — frontend depends on these)

### Mission
```json
{ "id":"msn_", "title":"", "objective":"", "description":"", "owner":"actor-id",
  "contributors":[{"actor":"","role":"owner|editor|viewer"}],
  "constraints":{"budget":"","time":"","resources":"","permissions":""},
  "milestones":[{"id":"mls_","title":"","due":"","status":"open|done","dependsOn":[]}],
  "tasks":[{"id":"tsk_","title":"","status":"todo|doing|done","dependsOn":[],"assignee":""}],
  "successMeasures":[{"id":"sm_","name":"","baseline":"","target":"","unit":"","method":""}],
  "status":"active|archived", "createdAt":"", "updatedAt":"", "version":1,
  "history":[{"v":1,"at":"","actor":"","change":""}] }
```

### Evidence item
```json
{ "id":"ev_", "missionId":"", "kind":"document|dataset|claim|question|assumption|decision|experiment-result",
  "title":"", "source":"", "author":"", "createdAt":"", "version":1,
  "permissions":"mission|private",
  "locator":{"page":0,"sheet":"","row":0,"excerpt":""},
  "content":{"text":"","parseStatus":"parsed|stored-unparsed|unsupported","format":"","uploadId":""},
  "claimStatus":"unreviewed|supported|disputed|insufficient-evidence",
  "statusHistory":[{"at":"","actor":"","from":"","to":"","why":"","aiSuggested":false}],
  "importedFrom":{"packageId":"","missionId":"","derivative":false},
  "history":[] }
```
- `claimStatus` only meaningful for `kind: claim`; default `unreviewed`.
- Status changes REQUIRE `why`; record `actor` and `aiSuggested` flag.

### Relation
```json
{ "id":"rel_", "missionId":"", "from":"","to":"", "type":"supports|contradicts|depends-on|derived-from|tests",
  "note":"", "createdBy":"", "createdAt":"" }
```

### Branch
```json
{ "id":"br_", "missionId":"", "name":"", "approach":"", "rationale":"", "assumptions":[""],
  "constraints":[""], "evidenceVersion":"", "expectedBenefits":[""], "risks":[""], "openQuestions":[""],
  "proposedExperiments":[""], "contributors":[""], "status":"active|archived|merged",
  "evidenceRefs":{"supporting":[],"conflicting":[]},
  "mergedInto":"", "mergeProvenance":[{"element":"","fromBranch":"","fromVersion":0}],
  "createdAt":"","updatedAt":"","version":1,"history":[] }
```

### Experiment
```json
{ "id":"exp_", "missionId":"", "branchId":"", "title":"", "question":"", "hypothesis":"",
  "prediction":"", "method":"", "resources":"", "baseline":"", "successCriteria":"",
  "kind":"planned-test|simulation|real-world-observation", "contributors":[""],
  "status":"planned|running|awaiting-results|complete|inconclusive",
  "execution":{"startedAt":"","endedAt":""},
  "results":[{"v":1,"at":"","actor":"","observations":"","measurements":[],"artifacts":[],
              "limitations":"","interpretation":"","recommendations":[],"kind":""}],
  "linkedClaimUpdates":[{"evidenceId":"","from":"","to":"","why":"","triggeredBy":"result-v1"}],
  "outcomeSignal":{"mapped":false,"event":null,"at":""},
  "createdAt":"","updatedAt":"","version":1,"history":[] }
```
Rules: `prediction` immutable once status != planned (reject with 400). Results append-only
(new version object, never overwrite v1). `inconclusive` is a terminal status distinct from failure.

### Contribution package
```json
{ "id":"pkg_", "title":"","summary":"","intendedUse":"","kind":"finding|dataset|method|experiment-result|agent",
  "artifacts":[{"kind":"","refId":"","version":0,"label":""}],
  "attribution":"","provenance":"","license":"","evidence":[],"limitations":"","reproduction":"",
  "dependencies":[],"access":[],
  "sourceMissionId":"","status":"draft|published","scope":"mission|export",
  "imports":[{"missionId":"","at":"","actor":"","derivative":false}],
  "createdAt":"","version":1,"history":[] }
```
- Artifacts reference evidence/branch/experiment/agent ids + their version at package time (frozen).
- Import copies artifacts into target mission as NEW evidence items with `importedFrom` set,
  attribution preserved. If importer edits on import → `derivative: true`.

### Agent
```json
{ "id":"agt_", "missionId":"", "branchId":"", "name":"", "purpose":"", "instructions":"",
  "version":1, "allowedSources":[], "allowedTools":["evidence.read"],
  "permissions":{"read":true,"write":false,"execute":false},
  "model":{"provider":"unconfigured","model":""},
  "limits":{"maxRuntimeMs":60000,"maxSpend":""},
  "testCases":[{"name":"","input":"","expected":""}],
  "runs":[{"id":"run_","at":"","actor":"","input":"","tool":"","output":"","artifacts":[],
           "status":"ok|denied|error","denialReason":""}],
  "deployment":{"target":"vercel","status":"not-deployed","detail":"","packageRef":""},
  "createdAt":"","updatedAt":"","history":[] }
```
- Allowed tools in this implementation: `evidence.read`, `evidence.write`, `hrm.simulate`.
  `evidence.write` creates evidence with `claimStatus: unreviewed` and author = agent name.
  `hrm.simulate` runs the HRM adapter; output labeled `internal-simulation`.
- `model.provider: unconfigured` by default → runs execute tools only (no LLM call); if
  `GEMINI_API_KEY` present the adapter may note provider `gemini-ready` but MUST NOT call it
  without explicit per-run authorization. Keep it simple: no LLM calls in v1; runs are
  tool-bounded and every denial/output is recorded.
- External writes/deployments: require `authorizeExternal: true` in the run request AND
  actor with owner/editor role; otherwise `denied`.
- User-authored code execution: NOT executed (no isolated runtime). Editor + export supported;
  execution status honestly `unavailable`.
- Vercel: `POST /agents/:id/package` generates a JSON package manifest (+ zip if `jszip`
  available — it is a dependency) describing the agent; `POST /agents/:id/deploy` records
  deployment intent with status `packaged` and instructions for the user's own Vercel account.
  Only mark `deployed` when the user confirms via `POST /agents/:id/deploy/confirm { url }`.

### Activity
```json
{ "id":"act_", "missionId":"", "at":"", "actor":"", "type":"", "summary":"", "ref":{"kind":"","id":""} }
```
Append-only. Types: `mission.created|updated|archived|reopened`, `evidence.added|status-changed`,
`relation.added`, `branch.created|merged|archived`, `experiment.created|started|result-recorded`,
`contribution.published|imported`, `agent.created|run|deployed`, `outcome.signal-mapped`.

**Attention queue** (derived, `GET /missions/:id/attention`): 
- `unresolvedQuestions`: evidence kind=question with no `decision` linked via relations
- `upcomingMilestones`: milestones open with due within 14 days (or overdue)
- `experimentsAwaitingResults`: status running|awaiting-results

## 3. API routes (all JSON, under `/api/collab`)

- `GET /health` → `{ ok, schemaVersion, authMode, python, hrm }`
- `GET /missions` `POST /missions` | `GET /missions/:id` `PATCH /missions/:id`
  `POST /missions/:id/archive` `POST /missions/:id/reopen`
  `GET /missions/:id/dashboard` → `{ mission, progress:{...}, unresolvedQuestions:[], upcomingMilestones:[], experimentsAwaitingResults:[] }`
  `GET /missions/:id/activity` `GET /missions/:id/attention`
- `GET /missions/:id/evidence?kind=&claimStatus=&q=` `POST /missions/:id/evidence`
  `GET /evidence/:id` `PATCH /evidence/:id` `DELETE /evidence/:id` (tombstone via history, keep record)
  `POST /missions/:id/evidence/upload` body `{ filename, mimeType, contentBase64 }`
  `GET /missions/:id/relations` `POST /missions/:id/relations` `DELETE /relations/:id`
  `GET /evidence/:id/impacted` → downstream `{ claims:[], decisions:[] }` via relations
- `GET /missions/:id/branches` `POST /missions/:id/branches` `GET /branches/:id`
  `PATCH /branches/:id` `POST /branches/:id/duplicate` `POST /branches/:id/archive`
  `GET /branches/compare?a=<id>&b=<id>` → `{ assumptions:{onlyA,onlyB,common}, evidence:{...}, risks:{...}, predictions }`
  `POST /branches/:id/merge` body `{ targetBranchId, picks: { assumptions:[idx], risks:[idx], ... } }`
- `GET /missions/:id/experiments` `POST /missions/:id/experiments` `GET /experiments/:id`
  `PATCH /experiments/:id` `POST /experiments/:id/start` `POST /experiments/:id/results`
  `POST /experiments/:id/run-hrm` body `{ steps, seed }` → adapter; appends result version with kind `simulation`
- `GET /missions/:id/contributions` `POST /missions/:id/contributions`
  `GET /contributions/:id` `GET /contributions/:id/preview` `POST /contributions/:id/publish`
  `POST /contributions/:id/import` body `{ targetMissionId, derivativeNote? }`
  `GET /contributions/export/:id` → downloadable JSON package
- `GET /missions/:id/agents` `POST /missions/:id/agents` `GET /agents/:id` `PATCH /agents/:id`
  `POST /agents/:id/test` `POST /agents/:id/run` body `{ tool, input, authorizeExternal? }`
  `GET /agents/:id/runs` `POST /agents/:id/package` `POST /agents/:id/deploy`
  `POST /agents/:id/deploy/confirm` body `{ url }`
- `POST /seed/demo` → seeds demo mission (owner only), returns ids

**Upload parsing (`uploads.js`):**
- `text/plain`, `text/markdown`, `.md`, `.txt` → full text, `parsed`
- `application/json` → pretty text + note, `parsed`
- `text/csv` → first 50 rows as text + row refs, `parsed`
- `application/pdf`, `...wordprocessingml` (docx), `...spreadsheetml` (xlsx) → `stored-unparsed`,
  note: "Server extraction not implemented; parse client-side with the app's existing pdf/mammoth/xlsx
  libraries and attach extracted text." Store raw bytes under `uploads/`.
- anything else → `unsupported` with honest message. Never fabricate content.

**HRM adapter (`adapters/hrm.js`):** spawns `python3` with `-c` script that imports
`hrm.api_adapter.HRMAdapter`, applies `{steps, seed, state_dim?}`, prints JSON to stdout.
Timeout 120s. Result labeled `{ kind: "internal-simulation", engine: "hrm", ... }`.
If python3 missing or import fails → `{ available: false, reason }` — honest.
The instruction "An HRM simulation should be labeled as an internal simulation unless a domain
model has been separately validated" — ALWAYS label `internal-simulation` in v1.

**Outcomes adapter (`adapters/outcomes.js`):** `resultToLearningEvent(experiment, result)` builds a
normalized learning-event record following the shape of `event_normalization.py`
(`normalize_learning_event_payload`) WITHOUT importing torch or touching hot memory:
`{ event: "experiment_outcome", event_data: { experimentId, prediction, outcome, match }, ... }`.
Stored on the experiment as `outcomeSignal` + appended to mission activity as
`outcome.signal-mapped` with the trigger (`result vN`). Reviewable: the mapping function is
pure and unit-tested. Do NOT claim hot-memory modulation.

**Governance adapter (`adapters/governance.js`):** `checkAgentCapability(agent, tool, target)`:
- tool not in `agent.allowedTools` → deny
- `evidence.write` without `permissions.write` → deny
- `hrm.simulate` without `permissions.execute` → deny
- target evidence not in `agent.allowedSources` (for read/write) → deny
- external/deploy actions without per-run `authorizeExternal` + owner/editor actor → deny
Every check logged to agent run history.

## 4. Frontend: `components/collab/` + `services/collabService.ts`

`collabService.ts`: typed client for every route above (`api<T>(path, opts)` with base `/api/collab`).
File upload helper: for pdf/docx/xlsx, parse CLIENT-SIDE using the repo's existing
`pdfjs-dist`, `mammoth`, `xlsx` (already dependencies + vendor chunks), then POST extracted text
as a `document` evidence item with locator refs (page/sheet/row). For txt/md/json/csv, POST raw
to `/evidence/upload`.

Views (all in `components/collab/`, Tailwind classes — Tailwind is via CDN in index.html):
- `CollabWorkspace.tsx` — mission switcher (dropdown + "New mission"), tab nav:
  Overview | Evidence | Branches | Experiments | Exchange | Agents | Activity.
  Props: none (self-contained, uses collabService). Export default.
- `MissionDashboard.tsx` — title/objective/owner, progress bars (milestones/tasks done %),
  success measures table, attention queue (unresolved questions, upcoming milestones,
  experiments awaiting results), constraints card. Edit mission inline (title/objective/description,
  milestones/tasks add+toggle).
- `EvidenceMap.tsx` — filter bar (kind, claimStatus, search), view toggle List/Graph.
  List: cards with kind badge, claim status badge (human vs AI-suggested marker), source/author,
  excerpt. Graph: simple SVG force-ish layout (deterministic radial layout is fine — no lib),
  nodes colored by kind, edges labeled by relation type. Inspector panel: full detail,
  status change (requires reason + records actor), relations list, "impacted" downstream list,
  upload button. Honest parse-status badges.
- `BranchView.tsx` — branch cards, create/duplicate/archive, compare view (side-by-side diff of
  assumptions/evidence/risks), merge UI (checkboxes per element → POST merge with picks),
  provenance display on merged branches.
- `ExperimentLedger.tsx` — experiment cards with status pipeline, prediction shown immutable
  once started, result form (observations, measurements, limitations, interpretation,
  recommendations, linked claim updates), "Run HRM simulation" button (labels output
  internal-simulation), version history of results, outcome-signal mapping display.
- `ContributionExchange.tsx` — package builder (select artifacts from mission evidence/branches/
  experiments/agents with checkboxes — explicit selection), preview, publish, import into another
  mission (mission picker), export JSON download, import attribution display.
- `AgentWorkshop.tsx` — agent list + editor (name/purpose/instructions/allowedSources/allowedTools/
  permissions/limits/testCases), test runner (runs test cases through capability checks),
  run inspector (history with ok/denied/error), package + deploy UI with honest status
  (not-deployed → packaged → deployed only on user confirm with URL).
- `ActivityTimeline.tsx` — chronological feed + attention queue.
- Keep every view functional WITHOUT the Python backend (collab API is Node-only). Show backend
  health in workspace header (`GET /health`); if Python unavailable, HRM buttons show
  "unavailable" honestly.

Design: restrained, cohesive. The app shell is dark; use a light "paper" workspace surface
(bg-stone-50/slate-50, dark slate text) for readability, clear sans typography, accessible
contrast (no gray-on-gray below 4.5:1), responsive (grid → stack), purposeful motion only
(transitions on tab/inspector). No gradients/gimmicks.

## 5. Demo seed (`seed.js`)

`POST /api/collab/seed/demo` (or `node collab/seed.js`) creates, all labeled `[DEMO]`:
1. Mission "Urban Heat Mapping Pilot" (owner local-owner) with milestones/tasks/success measures.
2. Evidence: 1 document (uploaded txt), 1 dataset (csv), 2 claims (one `supported`, one `disputed`
   with statusHistory incl. an AI-suggested entry marked as such), 1 question, relations
   (doc supports claim1, dataset contradicts claim2, claim1 derived-from doc).
3. Two branches: "Sensor network" vs "Satellite + modeling", each with assumptions/risks/evidence refs.
4. One experiment on branch A: prediction recorded, status running → result v1 recorded
   (measurements + interpretation), linked claim update (claim2 → insufficient-evidence),
   outcome signal mapped via adapter.
5. Contribution package published from branch A experiment; imported into a second mission
   "Heat Policy Review" with attribution + derivative=false.
6. One bounded agent (`evidence.read` only) with a passing test run and one denied write attempt.
Idempotent-ish: skip if a demo mission already exists (check by title).

## 6. Tests

- `collab/collab.test.js` (vitest, runs with `npx vitest run collab`): store round-trip +
  migration, auth denials (viewer cannot create; token mode), evidence status change requires
  reason + records actor, branch merge provenance, experiment prediction immutability,
  result versioning append-only, contribution import attribution + derivative flag,
  agent capability denial (write without permission; external without authorization),
  upload parse statuses (txt parsed, pdf stored-unparsed, exe unsupported).
- Python: no changes → run `python tests/run_validation.py` at the end to confirm green.
- Frontend: at least one vitest component test for the workspace (e.g., CollabWorkspace renders
  tabs; mock collabService).

## 7. What the main agent wires up (NOT the subagents)

- `server.js`: `import { mountCollab } from './collab/index.js';` + `mountCollab(app);`
  before `app.listen`; extend CORS `methods` to include `PUT, PATCH, DELETE`.
- `App.tsx`: nav toggle between existing ChatInterface and new CollabWorkspace.
- `package.json`: add `"collab:seed": "node collab/seed.js"`.
- Docs: `COLLAB_SETUP.md`, `COLLAB_ARCHITECTURE.md`, `COLLAB_STATUS.md` (working vs limitations).

## 8. Deliverables per subagent

**Backend builder:** complete `collab/` module as specified + `collab.test.js` passing
(`npx vitest run collab` green). No changes outside `collab/` and `collab-data/` (gitignored).
Verify with a quick node smoke script hitting the routes (or supertest-style direct calls —
no new deps: import the app? server.js throws without GEMINI_API_KEY... so test routes by
importing `collab/index.js` mount on a fresh express instance in the test file. express IS a
dependency. In tests, `import express from 'express'` + `mountCollab(app)` + use `app.listen(0)`
and fetch. That works without dotenv/Gemini.)

**Frontend builder:** complete `components/collab/` + `services/collabService.ts` as specified,
TypeScript compiles (`npx tsc --noEmit` clean for new files), one vitest component test green.
No changes outside those paths. Client-side pdf/docx/xlsx parsing reusing existing deps.
