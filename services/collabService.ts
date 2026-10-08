// services/collabService.ts
// Typed client for the QuadraSeer collaboration API (all routes under /api/collab).
// Shapes mirror COLLAB_DESIGN.md section 2 exactly.

const BASE = '/api/collab';

export class CollabApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'CollabApiError';
    this.status = status;
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch {
    throw new CollabApiError(0, 'Backend unreachable. Start the server (node server.js) and try again.');
  }
  if (!res.ok) {
    let message = `Request failed (HTTP ${res.status})`;
    try {
      const data = await res.json();
      if (data && typeof (data as { error?: unknown }).error === 'string') {
        message = (data as { error: string }).error;
      }
    } catch {
      /* keep default message */
    }
    throw new CollabApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// ---------------------------------------------------------------------------
// Types (mirror design doc section 2)
// ---------------------------------------------------------------------------

export interface Health {
  ok: boolean;
  schemaVersion: number;
  authMode: string;
  python: boolean;
  hrm: boolean;
}

export type Role = 'owner' | 'editor' | 'viewer';

export interface Milestone {
  id: string;
  title: string;
  due: string;
  status: 'open' | 'done';
  dependsOn: string[];
}

export interface MissionTask {
  id: string;
  title: string;
  status: 'todo' | 'doing' | 'done';
  dependsOn: string[];
  assignee: string;
}

export interface SuccessMeasure {
  id: string;
  name: string;
  baseline: string;
  target: string;
  unit: string;
  method: string;
}

export interface HistoryEntry {
  v: number;
  at: string;
  actor: string;
  change: string;
}

export interface Mission {
  id: string;
  title: string;
  objective: string;
  description: string;
  owner: string;
  contributors: { actor: string; role: Role }[];
  constraints: { budget: string; time: string; resources: string; permissions: string };
  milestones: Milestone[];
  tasks: MissionTask[];
  successMeasures: SuccessMeasure[];
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
  version: number;
  history: HistoryEntry[];
}

export type EvidenceKind =
  | 'document'
  | 'dataset'
  | 'claim'
  | 'question'
  | 'assumption'
  | 'decision'
  | 'experiment-result';

export type ClaimStatus = 'unreviewed' | 'supported' | 'disputed' | 'insufficient-evidence';
export type ParseStatus = 'parsed' | 'stored-unparsed' | 'unsupported';

export interface Locator {
  page: number;
  sheet: string;
  row: number;
  excerpt: string;
}

export interface StatusChange {
  at: string;
  actor: string;
  from: string;
  to: string;
  why: string;
  aiSuggested: boolean;
}

export interface EvidenceItem {
  id: string;
  missionId: string;
  kind: EvidenceKind;
  title: string;
  source: string;
  author: string;
  createdAt: string;
  version: number;
  permissions: 'mission' | 'private';
  locator: Locator;
  content: { text: string; parseStatus: ParseStatus; format: string; uploadId: string };
  claimStatus: ClaimStatus;
  statusHistory: StatusChange[];
  importedFrom: { packageId: string; missionId: string; derivative: boolean } | null;
  history: HistoryEntry[];
}

export type RelationType = 'supports' | 'contradicts' | 'depends-on' | 'derived-from' | 'tests';

export interface Relation {
  id: string;
  missionId: string;
  from: string;
  to: string;
  type: RelationType;
  note: string;
  createdBy: string;
  createdAt: string;
}

export interface Branch {
  id: string;
  missionId: string;
  name: string;
  approach: string;
  rationale: string;
  assumptions: string[];
  constraints: string[];
  evidenceVersion: string;
  expectedBenefits: string[];
  risks: string[];
  openQuestions: string[];
  proposedExperiments: string[];
  contributors: string[];
  status: 'active' | 'archived' | 'merged';
  evidenceRefs: { supporting: string[]; conflicting: string[] };
  mergedInto: string;
  mergeProvenance: { element: string; fromBranch: string; fromVersion: number }[];
  createdAt: string;
  updatedAt: string;
  version: number;
  history: HistoryEntry[];
}

export interface CompareDiff {
  onlyA: string[];
  onlyB: string[];
  common: string[];
}

export interface BranchCompare {
  assumptions: CompareDiff;
  evidence: CompareDiff;
  risks: CompareDiff;
  predictions: { a: string; b: string };
}

export type ExperimentStatus = 'planned' | 'running' | 'awaiting-results' | 'complete' | 'inconclusive';
export type ExperimentKind = 'planned-test' | 'simulation' | 'real-world-observation';

export interface Measurement {
  name: string;
  value: string;
  unit: string;
}

export interface ExperimentResult {
  v: number;
  at: string;
  actor: string;
  observations: string;
  measurements: Measurement[];
  artifacts: string[];
  limitations: string;
  interpretation: string;
  recommendations: string[];
  kind: string;
}

export interface LinkedClaimUpdate {
  evidenceId: string;
  from: string;
  to: string;
  why: string;
  triggeredBy: string;
}

export interface Experiment {
  id: string;
  missionId: string;
  branchId: string;
  title: string;
  question: string;
  hypothesis: string;
  prediction: string;
  method: string;
  resources: string;
  baseline: string;
  successCriteria: string;
  kind: ExperimentKind;
  contributors: string[];
  status: ExperimentStatus;
  execution: { startedAt: string; endedAt: string };
  results: ExperimentResult[];
  linkedClaimUpdates: LinkedClaimUpdate[];
  outcomeSignal: { mapped: boolean; event: unknown; at: string };
  createdAt: string;
  updatedAt: string;
  version: number;
  history: HistoryEntry[];
}

export interface ContributionArtifact {
  kind: string;
  refId: string;
  version: number;
  label: string;
}

export interface ContributionPackage {
  id: string;
  title: string;
  summary: string;
  intendedUse: string;
  kind: 'finding' | 'dataset' | 'method' | 'experiment-result' | 'agent';
  artifacts: ContributionArtifact[];
  attribution: string;
  provenance: string;
  license: string;
  evidence: string[];
  limitations: string;
  reproduction: string;
  dependencies: string[];
  access: string[];
  sourceMissionId: string;
  status: 'draft' | 'published';
  scope: 'mission' | 'export';
  imports: { missionId: string; at: string; actor: string; derivative: boolean }[];
  createdAt: string;
  version: number;
  history: HistoryEntry[];
}

export interface AgentTestCase {
  name: string;
  input: string;
  expected: string;
}

export interface AgentRun {
  id: string;
  at: string;
  actor: string;
  input: string;
  tool: string;
  output: string;
  artifacts: string[];
  status: 'ok' | 'denied' | 'error';
  denialReason: string;
}

export interface Agent {
  id: string;
  missionId: string;
  branchId: string;
  name: string;
  purpose: string;
  instructions: string;
  version: number;
  allowedSources: string[];
  allowedTools: string[];
  permissions: { read: boolean; write: boolean; execute: boolean };
  model: { provider: string; model: string };
  limits: { maxRuntimeMs: number; maxSpend: string };
  testCases: AgentTestCase[];
  runs: AgentRun[];
  deployment: { target: string; status: string; detail: string; packageRef: string };
  createdAt: string;
  updatedAt: string;
  history: HistoryEntry[];
}

export interface ActivityItem {
  id: string;
  missionId: string;
  at: string;
  actor: string;
  type: string;
  summary: string;
  ref: { kind: string; id: string };
}

export interface Dashboard {
  mission: Mission;
  progress: { milestonesDone: number; milestonesTotal: number; tasksDone: number; tasksTotal: number };
  unresolvedQuestions: EvidenceItem[];
  upcomingMilestones: Milestone[];
  experimentsAwaitingResults: Experiment[];
}

export interface Attention {
  unresolvedQuestions: EvidenceItem[];
  upcomingMilestones: Milestone[];
  experimentsAwaitingResults: Experiment[];
}

export interface Impacted {
  claims: EvidenceItem[];
  decisions: EvidenceItem[];
}

export interface SeedResult {
  missionId: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Health & seed
// ---------------------------------------------------------------------------

export const getHealth = () => api<Health>('/health');
export const seedDemo = () => api<SeedResult>('/seed/demo', { method: 'POST' });

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

export const listMissions = () => api<Mission[]>('/missions');
export const createMission = (body: Partial<Mission>) =>
  api<Mission>('/missions', { method: 'POST', body });
export const getMission = (id: string) => api<Mission>(`/missions/${id}`);
export const patchMission = (id: string, body: Partial<Mission>) =>
  api<Mission>(`/missions/${id}`, { method: 'PATCH', body });
export const archiveMission = (id: string) =>
  api<Mission>(`/missions/${id}/archive`, { method: 'POST' });
export const reopenMission = (id: string) =>
  api<Mission>(`/missions/${id}/reopen`, { method: 'POST' });
export const addContributor = (id: string, body: { actor: string; role: Role }) =>
  api<Mission>(`/missions/${id}/contributors`, { method: 'POST', body });
export const removeContributor = (id: string, actorId: string) =>
  api<Mission>(`/missions/${id}/contributors/${encodeURIComponent(actorId)}`, { method: 'DELETE' });
export const getDashboard = (id: string) => api<Dashboard>(`/missions/${id}/dashboard`);
export const getActivity = (id: string) => api<ActivityItem[]>(`/missions/${id}/activity`);
export const getAttention = (id: string) => api<Attention>(`/missions/${id}/attention`);

// ---------------------------------------------------------------------------
// Evidence & relations
// ---------------------------------------------------------------------------

export interface EvidenceQuery {
  kind?: string;
  claimStatus?: string;
  q?: string;
}

export const listEvidence = (missionId: string, query: EvidenceQuery = {}) => {
  const params = new URLSearchParams();
  if (query.kind) params.set('kind', query.kind);
  if (query.claimStatus) params.set('claimStatus', query.claimStatus);
  if (query.q) params.set('q', query.q);
  const qs = params.toString();
  return api<EvidenceItem[]>(`/missions/${missionId}/evidence${qs ? `?${qs}` : ''}`);
};

export const createEvidence = (missionId: string, body: Partial<EvidenceItem>) =>
  api<EvidenceItem>(`/missions/${missionId}/evidence`, { method: 'POST', body });

export const getEvidence = (id: string) => api<EvidenceItem>(`/evidence/${id}`);

export const patchEvidence = (id: string, body: Partial<EvidenceItem> & { why?: string; aiSuggested?: boolean }) =>
  api<EvidenceItem>(`/evidence/${id}`, { method: 'PATCH', body });

export const deleteEvidence = (id: string) =>
  api<EvidenceItem>(`/evidence/${id}`, { method: 'DELETE' });

export interface RawUploadBody {
  filename: string;
  mimeType: string;
  contentBase64: string;
}

export const uploadEvidenceRaw = (missionId: string, body: RawUploadBody) =>
  api<EvidenceItem>(`/missions/${missionId}/evidence/upload`, { method: 'POST', body });

export const listRelations = (missionId: string) =>
  api<Relation[]>(`/missions/${missionId}/relations`);

export const createRelation = (
  missionId: string,
  body: { from: string; to: string; type: RelationType; note?: string },
) => api<Relation>(`/missions/${missionId}/relations`, { method: 'POST', body });

export const deleteRelation = (id: string) =>
  api<void>(`/relations/${id}`, { method: 'DELETE' });

export const getImpacted = (evidenceId: string) =>
  api<Impacted>(`/evidence/${evidenceId}/impacted`);

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

export const listBranches = (missionId: string) => api<Branch[]>(`/missions/${missionId}/branches`);
export const createBranch = (missionId: string, body: Partial<Branch>) =>
  api<Branch>(`/missions/${missionId}/branches`, { method: 'POST', body });
export const getBranch = (id: string) => api<Branch>(`/branches/${id}`);
export const patchBranch = (id: string, body: Partial<Branch>) =>
  api<Branch>(`/branches/${id}`, { method: 'PATCH', body });
export const duplicateBranch = (id: string) => api<Branch>(`/branches/${id}/duplicate`, { method: 'POST' });
export const archiveBranch = (id: string) => api<Branch>(`/branches/${id}/archive`, { method: 'POST' });
export const compareBranches = (a: string, b: string) =>
  api<BranchCompare>(`/branches/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
export const mergeBranch = (id: string, body: { targetBranchId: string; picks: Record<string, number[]> }) =>
  api<Branch>(`/branches/${id}/merge`, { method: 'POST', body });

// ---------------------------------------------------------------------------
// Experiments
// ---------------------------------------------------------------------------

export const listExperiments = (missionId: string) =>
  api<Experiment[]>(`/missions/${missionId}/experiments`);
export const createExperiment = (missionId: string, body: Partial<Experiment>) =>
  api<Experiment>(`/missions/${missionId}/experiments`, { method: 'POST', body });
export const getExperiment = (id: string) => api<Experiment>(`/experiments/${id}`);
export const patchExperiment = (id: string, body: Partial<Experiment>) =>
  api<Experiment>(`/experiments/${id}`, { method: 'PATCH', body });
export const startExperiment = (id: string) =>
  api<Experiment>(`/experiments/${id}/start`, { method: 'POST' });

export interface RecordResultsBody {
  observations: string;
  measurements: Measurement[];
  artifacts: string[];
  limitations: string;
  interpretation: string;
  recommendations: string[];
  kind: string;
  linkedClaimUpdates: LinkedClaimUpdate[];
}

export const recordResults = (id: string, body: RecordResultsBody) =>
  api<Experiment>(`/experiments/${id}/results`, { method: 'POST', body });

export const runHrm = (id: string, body: { steps: number; seed: number }) =>
  api<{ ok: boolean; result?: ExperimentResult; available?: boolean; reason?: string }>(
    `/experiments/${id}/run-hrm`,
    { method: 'POST', body },
  );

// ---------------------------------------------------------------------------
// Contributions
// ---------------------------------------------------------------------------

export const listContributions = (missionId: string) =>
  api<ContributionPackage[]>(`/missions/${missionId}/contributions`);
export const createContribution = (missionId: string, body: Partial<ContributionPackage>) =>
  api<ContributionPackage>(`/missions/${missionId}/contributions`, { method: 'POST', body });
export const getContribution = (id: string) => api<ContributionPackage>(`/contributions/${id}`);
export const previewContribution = (id: string) =>
  api<ContributionPackage>(`/contributions/${id}/preview`);
export const publishContribution = (id: string) =>
  api<ContributionPackage>(`/contributions/${id}/publish`, { method: 'POST' });
export const importContribution = (id: string, body: { targetMissionId: string; derivativeNote?: string }) =>
  api<{ imported: string[] }>(`/contributions/${id}/import`, { method: 'POST', body });

export async function downloadContributionExport(id: string, filename?: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/contributions/export/${id}`);
  } catch {
    throw new CollabApiError(0, 'Backend unreachable. Start the server (node server.js) and try again.');
  }
  if (!res.ok) throw new CollabApiError(res.status, `Export failed (HTTP ${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `contribution-${id}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export const listAgents = (missionId: string) => api<Agent[]>(`/missions/${missionId}/agents`);
export const createAgent = (missionId: string, body: Partial<Agent>) =>
  api<Agent>(`/missions/${missionId}/agents`, { method: 'POST', body });
export const getAgent = (id: string) => api<Agent>(`/agents/${id}`);
export const patchAgent = (id: string, body: Partial<Agent>) =>
  api<Agent>(`/agents/${id}`, { method: 'PATCH', body });
export const testAgent = (id: string) =>
  api<{ ok: boolean; results?: unknown }>(`/agents/${id}/test`, { method: 'POST' });
export const runAgent = (id: string, body: { tool: string; input: string; authorizeExternal?: boolean }) =>
  api<AgentRun>(`/agents/${id}/run`, { method: 'POST', body });
export const getAgentRuns = (id: string) => api<AgentRun[]>(`/agents/${id}/runs`);
export const packageAgent = (id: string) =>
  api<{ packageRef: string; manifest?: unknown }>(`/agents/${id}/package`, { method: 'POST' });
export const deployAgent = (id: string) =>
  api<Agent>(`/agents/${id}/deploy`, { method: 'POST' });
export const confirmDeploy = (id: string, url: string) =>
  api<Agent>(`/agents/${id}/deploy/confirm`, { method: 'POST', body: { url } });

// ---------------------------------------------------------------------------
// Client-side upload parsing (pdf / docx / xlsx).
// The design requires these formats to be parsed in the browser with the repo's
// existing pdfjs-dist, mammoth, and xlsx dependencies, then POSTed as evidence
// with locator references. txt/md/json/csv and anything else go to the raw
// upload route, where the server assigns an honest parse status.
// ---------------------------------------------------------------------------

const MAX_TEXT_CHARS = 200_000;

function truncateWithNote(text: string): string {
  if (text.length <= MAX_TEXT_CHARS) return text;
  return text.slice(0, MAX_TEXT_CHARS) + `\n\n[… truncated: ${text.length - MAX_TEXT_CHARS} more characters not shown]`;
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const lib = pdfjs as unknown as {
    getDocument: (src: { data: ArrayBuffer }) => { promise: Promise<PdfDoc> };
    GlobalWorkerOptions: { workerSrc: string };
  };
  interface PdfDoc {
    numPages: number;
    getPage: (n: number) => Promise<{
      getTextContent: () => Promise<{ items: { str?: string }[] }>;
    }>;
  }
  try {
    lib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
  } catch {
    /* worker URL best-effort; extraction still attempted */
  }
  const data = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= pdf.numPages; p += 1) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const line = content.items.map((it) => (typeof it.str === 'string' ? it.str : '')).join(' ');
    pages.push(`--- page ${p} of ${pdf.numPages} ---\n${line}`);
  }
  return pages.join('\n\n');
}

async function extractDocxText(file: File): Promise<string> {
  const mammoth = await import('mammoth');
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value || '';
}

async function extractXlsxText(file: File): Promise<string> {
  const XLSX = await import('xlsx');
  const arrayBuffer = await file.arrayBuffer();
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const sheets: string[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' }) as unknown[][];
    const lines = rows.slice(0, 50).map((r, i) => `row ${i + 1}: ${(r ?? []).map(String).join(' | ')}`);
    sheets.push(`--- sheet: ${name} ---\n${lines.join('\n')}`);
  }
  return sheets.join('\n\n');
}

function base64Of(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Upload a file as mission evidence.
 * - pdf/docx/xlsx: parsed client-side, then stored as a `document` evidence item
 *   with the extracted text and locator references (page/sheet/row markers).
 * - everything else: raw bytes go to POST /evidence/upload; the server assigns
 *   an honest parseStatus (parsed / stored-unparsed / unsupported).
 */
export async function uploadEvidence(missionId: string, file: File): Promise<EvidenceItem> {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const mime = file.type || '';
  const isPdf = mime === 'application/pdf' || ext === 'pdf';
  const isDocx = mime.includes('wordprocessingml') || ext === 'docx';
  const isXlsx = mime.includes('spreadsheetml') || ext === 'xlsx' || ext === 'xls';

  if (isPdf || isDocx || isXlsx) {
    let text: string;
    let format: string;
    if (isPdf) {
      text = await extractPdfText(file);
      format = 'pdf';
    } else if (isDocx) {
      text = await extractDocxText(file);
      format = 'docx';
    } else {
      text = await extractXlsxText(file);
      format = 'xlsx';
    }
    const clean = truncateWithNote(text.trim());
    if (!clean) {
      throw new Error(
        `No extractable text found in "${file.name}". The file was not uploaded — nothing was fabricated.`,
      );
    }
    return createEvidence(missionId, {
      kind: 'document',
      title: file.name,
      source: 'upload',
      permissions: 'mission',
      content: { text: clean, parseStatus: 'parsed', format, uploadId: '' },
      locator: { page: 0, sheet: '', row: 0, excerpt: clean.slice(0, 500) },
    });
  }

  const buffer = await file.arrayBuffer();
  return uploadEvidenceRaw(missionId, {
    filename: file.name,
    mimeType: mime || 'application/octet-stream',
    contentBase64: base64Of(buffer),
  });
}
