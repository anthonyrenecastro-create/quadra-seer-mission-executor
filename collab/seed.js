import { createStore } from './store.js';
import { id, nowIso } from './ids.js';
import { fileURLToPath } from 'node:url';
import { resultToLearningEvent } from './adapters/outcomes.js';
import { runAgentTool } from './routes/agents.js';
import { checkAgentCapability } from './adapters/governance.js';

const DEMO_MISSION_TITLE = 'Urban Heat Mapping Pilot';
const DEMO_MISSION_2_TITLE = 'Heat Policy Review';

function act(store, missionId, actor, type, summary, ref) {
  store.log({
    id: id('act'), missionId, at: nowIso(),
    actor: actor.id, type, summary, ref: ref || { kind: '', id: '' },
  });
}

function mkEvidence(store, missionId, actor, fields) {
  const ev = {
    id: id('ev'),
    missionId,
    kind: 'document',
    title: '',
    source: '',
    author: actor.name || actor.id,
    createdAt: nowIso(),
    version: 1,
    permissions: 'mission',
    locator: { page: 0, sheet: '', row: 0, excerpt: '' },
    content: { text: '', parseStatus: 'parsed', format: 'text', uploadId: '' },
    claimStatus: 'unreviewed',
    statusHistory: [],
    importedFrom: null,
    history: [{ v: 1, at: nowIso(), actor: actor.id, change: 'evidence created (seed)' }],
    ...fields,
  };
  store.set('evidence', ev.id, ev);
  act(store, missionId, actor, 'evidence.added', `Evidence added: ${ev.title}`, { kind: 'evidence', id: ev.id });
  return ev;
}

function mkRelation(store, missionId, actor, from, to, type, note) {
  const rel = {
    id: id('rel'), missionId, from: from.id, to: to.id, type,
    note: note || '', createdBy: actor.id, createdAt: nowIso(),
  };
  store.set('relations', rel.id, rel);
  return rel;
}

// seedDemo(store, actor) -> { skipped?, missionId, ... }. Idempotent.
export async function seedDemo(store, actor) {
  const who = actor && actor.id ? actor : { id: 'local-owner', name: 'Local owner' };
  const existing = store.all('missions').find((m) => m.title === DEMO_MISSION_TITLE && !m.deleted);
  if (existing) {
    return { skipped: true, missionId: existing.id, reason: 'demo mission already exists' };
  }

  // 1. Mission
  const mission = {
    id: id('msn'),
    title: DEMO_MISSION_TITLE,
    objective: 'Pilot a neighborhood-scale urban heat mapping workflow and share what works.',
    description: '[DEMO] Demonstration mission exercising the full collaboration workflow.',
    owner: who.id,
    contributors: [{ actor: who.id, role: 'owner' }],
    constraints: { budget: '$5k pilot', time: '6 weeks', resources: '2 sensor kits, satellite API quota', permissions: 'demo only' },
    milestones: [
      { id: id('mls'), title: 'Deploy pilot sensor network', due: new Date(Date.now() + 7 * 864e5).toISOString(), status: 'open', dependsOn: [] },
      { id: id('mls'), title: 'Publish pilot findings', due: new Date(Date.now() + 35 * 864e5).toISOString(), status: 'open', dependsOn: [] },
    ],
    tasks: [
      { id: id('tsk'), title: 'Calibrate sensors', status: 'done', dependsOn: [], assignee: who.id },
      { id: id('tsk'), title: 'Collect 2 weeks of readings', status: 'doing', dependsOn: [], assignee: who.id },
    ],
    successMeasures: [
      { id: id('sm'), name: 'Neighborhood coverage', baseline: '0', target: '80', unit: '%', method: 'sensor grid count' },
      { id: id('sm'), name: 'Peak heat delta mapped', baseline: '0', target: '3', unit: '°C', method: 'sensor max vs suburb baseline' },
    ],
    status: 'active',
    createdAt: nowIso(), updatedAt: nowIso(), version: 1,
    history: [{ v: 1, at: nowIso(), actor: who.id, change: 'mission created (seed)' }],
  };
  store.set('missions', mission.id, mission);
  act(store, mission.id, who, 'mission.created', `Mission created: ${mission.title}`, { kind: 'mission', id: mission.id });

  // 2. Evidence
  const doc = mkEvidence(store, mission.id, who, {
    kind: 'document',
    title: '[DEMO] Heat sensor readings — downtown grid (txt)',
    source: 'upload:downtown-sensors.txt',
    content: { text: 'Downtown sensor grid, 14-day sample.\nPeak reading: 41.2C at station D-07 (2026-07-18 15:00).\nSuburb baseline: 38.0C same window.\nDelta: +3.2C downtown.', parseStatus: 'parsed', format: 'txt', uploadId: '' },
    locator: { excerpt: 'Peak reading: 41.2C at station D-07' },
  });
  const dataset = mkEvidence(store, mission.id, who, {
    kind: 'dataset',
    title: '[DEMO] Satellite land-surface temperatures (sample csv)',
    source: 'upload:lst-sample.csv',
    content: { text: 'block,lst_c\nD-01,39.8\nD-07,40.1\nS-03,37.9', parseStatus: 'parsed', format: 'csv', uploadId: '' },
    locator: { row: 1, rowCount: 4, excerpt: 'block,lst_c' },
  });
  const claim1 = mkEvidence(store, mission.id, who, {
    kind: 'claim',
    title: '[DEMO] Claim: Downtown runs ~3.2°C hotter than suburbs at peak',
    source: 'sensor analysis',
    claimStatus: 'supported',
    statusHistory: [
      { at: nowIso(), actor: who.id, from: 'unreviewed', to: 'supported', why: 'Confirmed by 14-day sensor sample (D-07 peak 41.2C vs 38.0C suburb baseline).', aiSuggested: false },
    ],
  });
  const claim2 = mkEvidence(store, mission.id, who, {
    kind: 'claim',
    title: '[DEMO] Claim: Satellite-only mapping is sufficient for block-level decisions',
    source: 'initial hypothesis',
    claimStatus: 'disputed',
    statusHistory: [
      { at: nowIso(), actor: 'demo-agent', from: 'unreviewed', to: 'disputed', why: 'AI suggestion: satellite LST sample under-resolves station D-07 hotspot vs ground sensors.', aiSuggested: true },
    ],
  });
  const question = mkEvidence(store, mission.id, who, {
    kind: 'question',
    title: '[DEMO] Question: Which blocks need priority cooling interventions?',
    source: 'mission planning',
  });
  mkRelation(store, mission.id, who, doc, claim1, 'supports', 'Sensor readings back the downtown heat delta.');
  mkRelation(store, mission.id, who, dataset, claim2, 'contradicts', 'Satellite sample misses the D-07 hotspot.');
  mkRelation(store, mission.id, who, claim1, doc, 'derived-from', 'Claim derived from the sensor document.');

  // 3. Branches
  const evStamp = `${nowIso()}|${store.all('evidence').filter((e) => e.missionId === mission.id).length}-items`;
  const mkBranch = (fields) => {
    const b = {
      id: id('br'), missionId: mission.id, name: '', approach: '', rationale: '',
      assumptions: [], constraints: [], evidenceVersion: evStamp,
      expectedBenefits: [], risks: [], openQuestions: [], proposedExperiments: [],
      contributors: [who.id], status: 'active',
      evidenceRefs: { supporting: [], conflicting: [] },
      mergedInto: '', mergeProvenance: [],
      createdAt: nowIso(), updatedAt: nowIso(), version: 1,
      history: [{ v: 1, at: nowIso(), actor: who.id, change: 'branch created (seed)' }],
      ...fields,
    };
    store.set('branches', b.id, b);
    act(store, mission.id, who, 'branch.created', `Branch created: ${b.name}`, { kind: 'branch', id: b.id });
    return b;
  };
  const branchA = mkBranch({
    name: 'Sensor network',
    approach: 'Dense low-cost ground sensors on every block.',
    rationale: 'Ground truth at block resolution; validated against D-07 hotspot.',
    assumptions: ['Sensors stay calibrated for 6 weeks', 'Volunteers host stations'],
    constraints: ['Hardware budget $5k'],
    evidenceRefs: { supporting: [doc.id], conflicting: [] },
    expectedBenefits: ['Block-level accuracy', 'Community participation'],
    risks: ['Sensor theft/damage', 'Maintenance burden'],
    openQuestions: ['Optimal station density?'],
    proposedExperiments: ['Two-week side-by-side calibration run'],
  });
  mkBranch({
    name: 'Satellite + modeling',
    approach: 'Satellite LST plus statistical downscaling.',
    rationale: 'Cheaper citywide coverage; no hardware maintenance.',
    assumptions: ['Downscaling model validates against ground truth'],
    constraints: ['API quota limits'],
    evidenceRefs: { supporting: [dataset.id], conflicting: [claim1.id] },
    expectedBenefits: ['Citywide coverage', 'Low marginal cost'],
    risks: ['Misses micro-hotspots (see D-07)', 'Model bias'],
    openQuestions: ['Can downscaling resolve sub-block features?'],
    proposedExperiments: ['Validate model against sensor pilot'],
  });

  // 4. Experiment on branch A: prediction -> running -> result v1 -> claim update -> outcome signal
  const exp = {
    id: id('exp'), missionId: mission.id, branchId: branchA.id,
    title: '[DEMO] Sensor calibration run',
    question: 'Do low-cost sensors track reference-grade stations within 0.5°C?',
    hypothesis: 'Calibrated low-cost sensors stay within 0.5°C of reference.',
    prediction: 'Mean absolute error vs reference will be ≤ 0.5°C over 14 days.',
    method: 'Side-by-side deployment at 3 reference stations; daily comparison.',
    resources: '3 reference stations, 9 low-cost sensors',
    baseline: 'Uncalibrated error ~1.8°C',
    successCriteria: 'MAE ≤ 0.5°C',
    kind: 'planned-test',
    contributors: [who.id],
    status: 'running',
    execution: { startedAt: nowIso(), endedAt: '' },
    results: [],
    linkedClaimUpdates: [],
    outcomeSignal: { mapped: false, event: null, at: '' },
    createdAt: nowIso(), updatedAt: nowIso(), version: 2,
    history: [
      { v: 1, at: nowIso(), actor: who.id, change: 'experiment created (seed)' },
      { v: 2, at: nowIso(), actor: who.id, change: 'experiment started (seed)' },
    ],
  };
  store.set('experiments', exp.id, exp);
  act(store, mission.id, who, 'experiment.created', `Experiment created: ${exp.title}`, { kind: 'experiment', id: exp.id });

  const result = {
    v: 1, at: nowIso(), actor: who.id,
    observations: 'MAE vs reference was 0.34°C over 14 days; worst station 0.61°C on one humid day.',
    measurements: [
      { name: 'mae_c', value: 0.34 },
      { name: 'worst_station_mae_c', value: 0.61 },
      { name: 'days', value: 14 },
    ],
    artifacts: [],
    limitations: 'Single humid-day outlier; reference stations only 3.',
    interpretation: 'Prediction held: low-cost sensors are viable for block-level mapping.',
    recommendations: ['Add humidity correction', 'Expand to 12 stations'],
    matchedPrediction: true,
    kind: 'planned-test',
  };
  exp.results.push(result);
  // Linked claim update: claim2 -> insufficient-evidence (triggered by result v1)
  claim2.statusHistory.push({
    at: nowIso(), actor: who.id, from: 'disputed', to: 'insufficient-evidence',
    why: 'Sensor calibration succeeded; satellite-only sufficiency claim lacks supporting evidence.', aiSuggested: false,
  });
  claim2.claimStatus = 'insufficient-evidence';
  claim2.version += 1;
  claim2.updatedAt = nowIso();
  claim2.history.push({ v: claim2.version, at: nowIso(), actor: who.id, change: 'claim status → insufficient-evidence (triggered by result v1)' });
  store.set('evidence', claim2.id, claim2);
  exp.linkedClaimUpdates.push({
    evidenceId: claim2.id, from: 'disputed', to: 'insufficient-evidence',
    why: 'Sensor calibration succeeded; satellite-only sufficiency claim lacks supporting evidence.',
    triggeredBy: 'result-v1',
  });
  const event = resultToLearningEvent(exp, result);
  exp.outcomeSignal = { mapped: true, event, at: nowIso() };
  act(store, mission.id, who, 'outcome.signal-mapped', `Outcome signal mapped for ${exp.title} (trigger: result v1)`, { kind: 'experiment', id: exp.id });
  exp.status = 'complete';
  exp.execution.endedAt = nowIso();
  exp.version += 1;
  exp.updatedAt = nowIso();
  exp.history.push({ v: exp.version, at: nowIso(), actor: who.id, change: 'result v1 recorded; status → complete (seed)' });
  store.set('experiments', exp.id, exp);
  act(store, mission.id, who, 'experiment.result-recorded', `Result v1 recorded for ${exp.title}`, { kind: 'experiment', id: exp.id });

  // 5. Contribution package from the experiment; publish; import into mission 2.
  const pkg = {
    id: id('pkg'),
    title: '[DEMO] Sensor calibration findings',
    summary: 'Low-cost sensors track reference stations within 0.5°C MAE over 14 days.',
    intendedUse: 'Justify sensor-network branch in heat-mapping missions.',
    kind: 'finding',
    artifacts: [{ kind: 'experiment', refId: exp.id, version: exp.version, label: exp.title, title: exp.title }],
    attribution: who.name || who.id,
    provenance: `mission ${mission.id}`,
    license: 'CC-BY-4.0',
    evidence: [], limitations: 'Single-city pilot; 3 reference stations.',
    reproduction: 'Repeat side-by-side calibration per method.',
    dependencies: [], access: [],
    sourceMissionId: mission.id,
    status: 'published',
    scope: 'mission',
    imports: [],
    createdAt: nowIso(), version: 2,
    history: [
      { v: 1, at: nowIso(), actor: who.id, change: 'package created (seed)' },
      { v: 2, at: nowIso(), actor: who.id, change: 'package published (seed)' },
    ],
  };
  store.set('contributions', pkg.id, pkg);
  act(store, mission.id, who, 'contribution.published', `Contribution published: ${pkg.title}`, { kind: 'contribution', id: pkg.id });

  const mission2 = {
    id: id('msn'),
    title: DEMO_MISSION_2_TITLE,
    objective: 'Turn heat-mapping findings into cooling policy.',
    description: '[DEMO] Second mission receiving the contribution import.',
    owner: who.id,
    contributors: [{ actor: who.id, role: 'owner' }],
    constraints: { budget: '', time: '', resources: '', permissions: '' },
    milestones: [], tasks: [], successMeasures: [],
    status: 'active',
    createdAt: nowIso(), updatedAt: nowIso(), version: 1,
    history: [{ v: 1, at: nowIso(), actor: who.id, change: 'mission created (seed)' }],
  };
  store.set('missions', mission2.id, mission2);
  act(store, mission2.id, who, 'mission.created', `Mission created: ${mission2.title}`, { kind: 'mission', id: mission2.id });

  const importedEv = {
    id: id('ev'),
    missionId: mission2.id,
    kind: 'experiment-result',
    title: `[imported] Experiment: ${exp.title}`,
    source: `package:${pkg.id} ← experiment ${exp.id}`,
    author: who.name || who.id,
    createdAt: nowIso(), version: 1,
    permissions: 'mission',
    locator: { page: 0, sheet: '', row: 0, excerpt: '' },
    content: {
      text: `Question: ${exp.question}\nHypothesis: ${exp.hypothesis}\nPrediction: ${exp.prediction}\nLatest result: ${result.observations}`,
      parseStatus: 'parsed', format: 'text', uploadId: '',
    },
    claimStatus: 'unreviewed',
    statusHistory: [],
    importedFrom: { packageId: pkg.id, missionId: mission.id, derivative: false, derivativeNote: '', sourceKind: 'experiment', sourceId: exp.id, sourceVersion: exp.version },
    history: [{ v: 1, at: nowIso(), actor: who.id, change: 'imported from package (seed)' }],
  };
  store.set('evidence', importedEv.id, importedEv);
  pkg.imports.push({ missionId: mission2.id, at: nowIso(), actor: who.id, derivative: false });
  pkg.version += 1;
  pkg.history.push({ v: pkg.version, at: nowIso(), actor: who.id, change: `imported into mission ${mission2.id} (seed)` });
  store.set('contributions', pkg.id, pkg);
  act(store, mission2.id, who, 'contribution.imported', `Imported package '${pkg.title}' (attribution: ${pkg.attribution})`, { kind: 'contribution', id: pkg.id });

  // 6. Bounded agent: evidence.read only; one passing run + one denied write.
  const agent = {
    id: id('agt'),
    missionId: mission.id,
    branchId: branchA.id,
    name: '[DEMO] Evidence librarian',
    purpose: 'Read mission evidence and summarize it.',
    instructions: 'Only read evidence. Never write.',
    version: 1,
    allowedSources: [doc.id],
    allowedTools: ['evidence.read'],
    permissions: { read: true, write: false, execute: false },
    model: { provider: 'unconfigured', model: '' },
    limits: { maxRuntimeMs: 60000, maxSpend: '' },
    testCases: [
      { name: 'can read allowed source', tool: 'evidence.read', target: doc.id, expected: 'ok' },
      { name: 'cannot write', tool: 'evidence.write', expected: 'denied' },
    ],
    runs: [],
    deployment: { target: 'vercel', status: 'not-deployed', detail: '', packageRef: '' },
    createdAt: nowIso(), updatedAt: nowIso(),
    history: [{ v: 1, at: nowIso(), actor: who.id, change: 'agent created (seed)' }],
  };
  store.set('agents', agent.id, agent);
  act(store, mission.id, who, 'agent.created', `Agent created: ${agent.name}`, { kind: 'agent', id: agent.id });

  // Passing run: evidence.read on the allowed source.
  const check = checkAgentCapability(agent, 'evidence.read', doc.id, { actor: who, mission });
  const readRun = {
    id: id('run'), at: nowIso(), actor: who.id,
    input: { evidenceId: doc.id }, tool: 'evidence.read',
    output: check.ok ? { id: doc.id, title: doc.title, excerpt: doc.content.text.slice(0, 200) } : null,
    artifacts: [], status: check.ok ? 'ok' : 'denied', denialReason: check.ok ? '' : check.reason,
  };
  agent.runs.push(readRun);
  // Denied run: evidence.write without permission.
  await runAgentTool(store, agent, { tool: 'evidence.write', input: { title: 'x', text: 'y' }, actor: who, mission, authorizeExternal: false });

  return {
    skipped: false,
    missionId: mission.id,
    mission2Id: mission2.id,
    evidenceIds: [doc.id, dataset.id, claim1.id, claim2.id, question.id],
    branchIds: [branchA.id],
    experimentId: exp.id,
    packageId: pkg.id,
    agentId: agent.id,
  };
}

// Runnable: node collab/seed.js (creates its own store instance).
const isMain = !!process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const store = createStore();
  store.load();
  const out = await seedDemo(store);
  console.log(JSON.stringify(out, null, 2));
}

export { isMain };
