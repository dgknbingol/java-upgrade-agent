export type JobStatus =
  | 'idle'
  | 'analyzing'
  | 'cloning'
  | 'running-copilot'
  | 'building'
  | 'smoke-running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'pushing'
  | 'rolling-back';

export interface HealthToolStatus {
  name: string;
  available: boolean;
  version: string;
  installHint: string;
  requirement?: string;
}

export type SourceMode = 'remote' | 'local';

export interface AnalyzeResult {
  javaVersion: string;
  javaSource: string;
  mavenVersion: string;
  mavenCompilerVersion: string;
  springBootVersion: string;
  buildTool: string;
  displayVersion: string;
  repoName?: string;
  mendFindingsText?: string;
  fortifyFindingsText?: string;
  mendCount?: number;
  fortifyCount?: number;
}

export interface JobRecord {
  id: string;
  sourceMode: SourceMode;
  repoUrl: string;
  localRepoPath: string;
  sourceBranch: string;
  targetJavaVersion: string;
  sourceJavaVersion: string;
  upgradeBranch: string;
  useNewBranch: boolean;
  workspacePath: string;
  status: JobStatus;
  logs: string[];
  report: string;
  diff: string;
  mendFindingsText?: string;
  fortifyFindingsText?: string;
  error?: string;
}
