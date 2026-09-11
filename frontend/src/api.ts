/** Merkezi UI (OpenShift) bile olsa API her zaman geliştiricinin lokal agent'ına gider. */
export const API_BASE =
  import.meta.env.VITE_API_BASE?.trim() || 'http://localhost:4000';

export interface PrerequisiteStatus {
  name: string;
  available: boolean;
  installHint: string;
}

export interface PrerequisitesResponse {
  tools: PrerequisiteStatus[];
  ready: boolean;
}

export interface PickFolderResponse {
  path?: string;
  cancelled?: boolean;
}

export async function pickFolder(title?: string): Promise<PickFolderResponse> {
  const res = await fetch(`${API_BASE}/api/pick-folder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Klasör seçilemedi');
  }

  return res.json();
}

export async function fetchPrerequisites(): Promise<PrerequisitesResponse> {
  const res = await fetch(`${API_BASE}/api/prerequisites`);
  if (!res.ok) throw new Error('Ön koşullar kontrol edilemedi');
  return res.json();
}

export type SourceMode = 'remote' | 'local';

export interface AnalyzePayload {
  sourceMode: SourceMode;
  repoUrl?: string;
  localRepoPath?: string;
  sourceBranch: string;
}

export interface AnalyzeResponse {
  currentJavaVersion: string;
  displayVersion: string;
  detectedFrom: string;
  buildTool: string;
}

export async function analyzeRepository(
  payload: AnalyzePayload
): Promise<AnalyzeResponse> {
  const res = await fetch(`${API_BASE}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Analiz başarısız oldu');
  }
  return res.json();
}

export interface StartJobPayload {
  sourceMode: SourceMode;
  repoUrl?: string;
  localRepoPath?: string;
  sourceBranch: string;
  targetJavaVersion: string;
  sourceJavaVersion?: string;
  workspaceRoot?: string;
}

export interface StartJobResponse {
  jobId: string;
  upgradeBranch: string;
}

export async function startJob(payload: StartJobPayload): Promise<StartJobResponse> {
  const res = await fetch(`${API_BASE}/api/jobs/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to start job');
  }
  return res.json();
}

export async function runBuild(jobId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/jobs/${jobId}/build`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to start build');
  }
}

export async function pushBranch(jobId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/jobs/${jobId}/push`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to push branch');
  }
}

export async function fetchReport(jobId: string): Promise<string | null> {
  const res = await fetch(`${API_BASE}/api/jobs/${jobId}/report`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.content ?? null;
}

export async function fetchDiff(jobId: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/jobs/${jobId}/diff`);
  if (!res.ok) return '';
  const data = await res.json();
  return data.diff ?? '';
}

export function subscribeToJobEvents(
  jobId: string,
  onLog: (line: string) => void,
  onStatus: (status: string) => void,
  onBranch: (branch: string) => void
): EventSource {
  const source = new EventSource(`${API_BASE}/api/jobs/${jobId}/events`);

  source.addEventListener('log', (e) => {
    try {
      onLog(JSON.parse(e.data));
    } catch {
      onLog(e.data);
    }
  });

  source.addEventListener('status', (e) => {
    try {
      onStatus(JSON.parse(e.data));
    } catch {
      onStatus(e.data);
    }
  });

  source.addEventListener('branch', (e) => {
    try {
      onBranch(JSON.parse(e.data));
    } catch {
      onBranch(e.data);
    }
  });

  return source;
}
