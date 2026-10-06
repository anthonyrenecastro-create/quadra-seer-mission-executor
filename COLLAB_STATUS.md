# QuadraSeer Collaboration Layer — Working features vs. limitations

Verified 2026-10-06. Test suite: 43/43 vitest green. Existing Python core: untouched
(4 pre-existing `torch` import errors in `tests/run_validation.py`, identical on the clean tree).

## Working

- **Missions**: create/edit/archive/reopen; milestones, tasks (with dependencies), success
  measures, constraints; dashboard with progress + attention queue; chronological activity log.
- **Evidence map**: typed items (document/dataset/claim/question/assumption/decision/
  experiment-result) with source, author, timestamps, version, permissions, locators
  (page/sheet/row/excerpt); relations (supports/contradicts/depends-on/derived-from/tests);
  list + SVG graph + inspector; search/filter; claim statuses with required reason and
  actor/aiSuggested attribution; downstream "impacted" flags when evidence changes.
- **Perspective branches**: create/duplicate/archive/compare/merge; selective merge with
  per-element provenance; comparison diffs across assumptions, evidence, risks, benefits.
- **Experiment ledger**: prediction immutability enforced (400 after start); append-only
  versioned results; `inconclusive` distinct from failure; HRM simulation runs via the
  Python bridge (verified working where python3 + deps exist); outcome-signal mapping to
  normalized learning events with trigger provenance.
- **Contribution exchange**: explicit artifact selection; preview/publish; cross-mission
  import preserving attribution; derivative marking; portable JSON export.
- **Agent workshop**: editor, version history, capability-checked test runs with recorded
  denials, run inspector, deployable package generation, honest deploy statuses.
- **Uploads**: txt/md/json/csv parsed server-side; pdf/docx/xlsx parsed client-side with
  existing libs; everything else gets an honest stored-unparsed/unsupported status.
- **Persistence**: file-backed store, atomic writes, schema version + migrations, stable ids,
  entity version history; verified across process restarts (seed → kill → reload).
- **Auth**: disabled (local-owner) and token modes; mission roles enforced per route
  (viewer/editor/owner); 401/403 tested.

## Remaining limitations (candid)

1. **Auth is minimal** — token-or-open only. No SSO/OAuth, no per-user password accounts.
   Fine for local/small-team use; not an enterprise identity story.
2. **Agent runs don't call an LLM in v1.** The three tools (`evidence.read/write`,
   `hrm.simulate`) execute under capability checks, but `model.provider` defaults to
   `unconfigured` and no model call is made. Wiring a provider is future work with explicit
   per-run authorization.
3. **User-authored code is not executed.** Editing + export work; execution is marked
   unavailable (no isolated runtime). Policy flags are not isolation, so we don't pretend.
4. **Vercel deploy is a handoff, not a push.** The workshop generates the package and tracks
   status; the user deploys in their own Vercel account and confirms the URL.
5. **HRM results are internal simulations.** Labeled as such everywhere; no validated domain
   model exists, and coherence scores are not presented as confidence.
6. **No public discovery.** Contribution exchange is mission-to-mission + portable export by
   design; no marketplace.
7. **Store is single-file JSON per collection.** Fine for the intended scale; not a
   multi-writer database. Concurrent writers could interleave (last-write-wins per file).
8. **Python bridge needs a working Python env** with numpy/torch for HRM; otherwise the
   health endpoint honestly reports `hrm: false` and the UI disables simulation runs.

## Not attempted (out of scope for this iteration)

- Real-time multi-user sync (operational transform / CRDT).
- SSO, audit-log immutability proofs, encrypted-at-rest store.
- Public contribution marketplace UI.
