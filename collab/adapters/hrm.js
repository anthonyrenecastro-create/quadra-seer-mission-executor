import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// HRM adapter: runs the repo's hrm.api_adapter.HRMAdapter in a python3 subprocess
// (stdio-JSON via HRM_JOB_JSON env + stdout JSON). Results are ALWAYS labeled
// internal-simulation in v1. Honest { available: false, reason } when Python or
// the hrm package is missing. Never throws.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TIMEOUT_MS = 120000;
// Phase 2 hardening: user-controlled simulation cost is bounded.
export const MAX_HRM_STEPS = 500; // hard cap on user-supplied steps
const MAX_CONCURRENT_HRM = 4; // max simultaneous python3 spawns; beyond this we shed load

let detectCache = null;
let detectAt = 0;
let activeHrmRuns = 0;

function runPython(args, env, timeoutMs) {
  return new Promise((resolve) => {
    execFile('python3', args, { cwd: REPO_ROOT, env, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, error: err, stdout: String(stdout || ''), stderr: String(stderr || '') });
      else resolve({ ok: true, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

// Best-effort detection of python3 + importable hrm package. Cached 60s.
export async function detectPython() {
  const now = Date.now();
  if (detectCache && now - detectAt < 60000) return detectCache;
  const r = await runPython(['-c', 'import hrm; print("ok")'], process.env, 15000);
  // Distinguish "no python3 binary" from "python3 exists but hrm import failed".
  const noBinary = !!(r.error && r.error.code === 'ENOENT');
  detectCache = {
    python: !noBinary,
    hrm: r.ok && r.stdout.trim() === 'ok',
  };
  detectAt = now;
  return detectCache;
}

const HELPER = `
import json, os, sys
try:
    job = json.loads(os.environ.get('HRM_JOB_JSON', '{}'))
    from hrm.api_adapter import HRMAdapter
    from hrm.config import HRMConfig
    cfg = HRMConfig()
    if job.get('state_dim'):
        cfg.state_dim = int(job['state_dim'])
    adapter = HRMAdapter(cfg)
    if job.get('seed') is not None:
        adapter.reset(seed=int(job['seed']))
    # Defense in depth: clamp server-side even though Node clamps first.
    steps = min(max(1, int(job.get('steps', 50))), 500)
    out = adapter.run(steps=steps)
    snap = out.get('snapshot', {})
    tl = out.get('timeline') or []
    print(json.dumps({'ok': True, 'snapshot': snap, 'timelineLength': len(tl)}))
except Exception as e:
    print(json.dumps({'ok': False, 'error': '%s: %s' % (type(e).__name__, e)}))
`;

// runHrmSimulation({ steps, seed, state_dim, timeoutMs }) -> result object.
// Always { available: bool, ... }. Success adds kind: 'internal-simulation'.
// steps is clamped to MAX_HRM_STEPS; concurrent spawns are capped at
// MAX_CONCURRENT_HRM (excess load is shed, not queued); timeoutMs lets callers
// enforce per-agent maxRuntimeMs.
export async function runHrmSimulation({ steps = 50, seed = null, state_dim = null, timeoutMs = TIMEOUT_MS } = {}) {
  const det = await detectPython();
  if (!det.python) return { available: false, reason: 'python3 not found on PATH' };
  if (!det.hrm) return { available: false, reason: 'hrm package not importable from repo root' };

  const clampedSteps = Math.min(Math.max(1, parseInt(steps, 10) || 50), MAX_HRM_STEPS);
  if (activeHrmRuns >= MAX_CONCURRENT_HRM) {
    return { available: false, reason: `hrm busy (${activeHrmRuns} running), try again later` };
  }
  const effectiveTimeout = Math.min(Math.max(1000, timeoutMs || TIMEOUT_MS), TIMEOUT_MS);

  const job = { steps: clampedSteps, seed, state_dim };
  activeHrmRuns += 1;
  let r;
  try {
    r = await runPython(['-c', HELPER], { ...process.env, HRM_JOB_JSON: JSON.stringify(job) }, effectiveTimeout);
  } finally {
    activeHrmRuns -= 1;
  }
  if (!r.ok) {
    const msg = r.error && r.error.killed ? 'hrm simulation timed out' : String((r.error && r.error.message) || r.stderr || 'unknown error');
    return { available: false, reason: `hrm subprocess failed: ${msg}`.slice(0, 500) };
  }
  let parsed;
  try {
    parsed = JSON.parse(r.stdout.trim().split('\n').pop());
  } catch {
    return { available: false, reason: 'hrm helper produced invalid JSON' };
  }
  if (!parsed.ok) {
    return { available: false, reason: `hrm helper error: ${parsed.error || 'unknown'}`.slice(0, 500) };
  }
  return {
    available: true,
    kind: 'internal-simulation',
    engine: 'hrm',
    label: 'internal-simulation',
    steps: clampedSteps,
    seed: seed === null || seed === undefined ? null : seed,
    snapshot: parsed.snapshot,
    timelineLength: parsed.timelineLength,
  };
}
