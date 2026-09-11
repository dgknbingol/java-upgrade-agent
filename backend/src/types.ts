export type JobStatus =
  | 'pending'
  | 'cloning'
  | 'checking-out'
  | 'creating-branch'
  | 'running-copilot'
  | 'building'
  | 'completed'
  | 'failed'
  | 'building-only'
  | 'pushing';

export type SourceMode = 'remote' | 'local';

export interface StartJobRequest {
  sourceMode?: SourceMode;
  repoUrl?: string;
  localRepoPath?: string;
  sourceBranch: string;
  targetJavaVersion: string;
  sourceJavaVersion?: string;
  workspaceRoot?: string;
}

export interface AnalyzeRequest {
  sourceMode?: SourceMode;
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

export interface SSEEvent {
  type: 'log' | 'status' | 'branch';
  data: string;
}

export interface Job {
  id: string;
  sourceMode: SourceMode;
  repoUrl: string;
  localRepoPath: string;
  workspaceRoot: string;
  sourceBranch: string;
  sourceJavaVersion: string;
  targetJavaVersion: string;
  status: JobStatus;
  logs: string[];
  diff: string;
  report: string | null;
  workspacePath: string;
  upgradeBranch: string;
  error?: string;
  listeners: Set<(event: SSEEvent) => void>;
}
