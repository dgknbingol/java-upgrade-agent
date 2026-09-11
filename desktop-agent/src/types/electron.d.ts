import type { AnalyzeResult, JobRecord, SourceMode } from './job';

export interface HealthToolStatus {
  name: string;
  available: boolean;
  version: string;
  installHint: string;
  requirement?: string;
}

export interface JobArtifacts {
  report: string;
  diff: string;
  status: string;
  upgradeBranch: string;
  logs: string[];
}

export type StartupRunMode = 'auto' | 'jar' | 'maven';

export interface PipelineSettingsInput {
  maxMigrationRounds: number;
  maxBuildFixAttempts: number;
  mavenBuildLogTailChars: number;
  smokeRunEnabled: boolean;
  smokeRunTimeoutSeconds: number;
  smokeRunProfile: string;
  maxSmokeFixAttempts: number;
  startupRunMode: StartupRunMode;
  startupPostSuccessSeconds: number;
}

export interface AppPublicConfig extends PipelineSettingsInput {
  upgradeBranchPattern: string;
  copilotModel: string;
}

export interface CopilotModelOptions {
  models: string[];
  selectedModel: string;
  cliPersistedModel: string | null;
}

export interface ElectronAPI {
  getConfig: () => Promise<AppPublicConfig>;
  savePipelineConfig: (
    input: Partial<PipelineSettingsInput>
  ) => Promise<PipelineSettingsInput>;
  pickFolder: (title?: string) => Promise<{ path: string | null }>;
  pickFile: (options?: {
    title?: string;
    filters?: { name: string; extensions: string[] }[];
  }) => Promise<{ path: string | null }>;
  saveTextFile: (options: {
    content: string;
    defaultFilename: string;
    title?: string;
  }) => Promise<{ saved: boolean; path: string | null }>;
  checkHealth: (targetJavaVersion?: string) => Promise<HealthToolStatus[]>;
  listCopilotModels: () => Promise<CopilotModelOptions>;
  saveCopilotModel: (model: string) => Promise<string>;
  analyze: (input: {
    sourceMode?: SourceMode;
    repoUrl?: string;
    localRepoPath?: string;
    sourceBranch: string;
    workspaceRoot?: string;
    targetJavaVersion?: string;
  }) => Promise<AnalyzeResult>;
  startUpgrade: (input: {
    sourceMode?: SourceMode;
    repoUrl?: string;
    localRepoPath?: string;
    sourceBranch: string;
    targetJavaVersion: string;
    sourceJavaVersion?: string;
    workspaceRoot?: string;
    useNewBranch?: boolean;
    workBranchName?: string;
    upgradeBranchName?: string;
    maxMigrationRounds?: number;
    maxBuildFixAttempts?: number;
    mavenBuildLogTailChars?: number;
    smokeRunEnabled?: boolean;
    smokeRunTimeoutSeconds?: number;
    smokeRunProfile?: string;
    maxSmokeFixAttempts?: number;
    startupRunMode?: StartupRunMode;
    startupPostSuccessSeconds?: number;
    useLocalPropertiesOverride?: boolean;
    localPropertiesFilePath?: string;
    copilotModel?: string;
  }) => Promise<JobRecord>;
  runBuild: (jobId: string, options?: { skipTests?: boolean }) => Promise<JobRecord>;
  runBuildJob: (input: {
    sourceMode?: SourceMode;
    repoUrl?: string;
    localRepoPath?: string;
    sourceBranch: string;
    targetJavaVersion: string;
    sourceJavaVersion?: string;
    workspaceRoot?: string;
    useNewBranch?: boolean;
    workBranchName?: string;
    upgradeBranchName?: string;
    maxMigrationRounds?: number;
    maxBuildFixAttempts?: number;
    mavenBuildLogTailChars?: number;
    smokeRunEnabled?: boolean;
    smokeRunTimeoutSeconds?: number;
    smokeRunProfile?: string;
    maxSmokeFixAttempts?: number;
    startupRunMode?: StartupRunMode;
    startupPostSuccessSeconds?: number;
    useLocalPropertiesOverride?: boolean;
    localPropertiesFilePath?: string;
    skipTests?: boolean;
    copilotModel?: string;
  }) => Promise<JobRecord>;
  runStartup: (jobId: string) => Promise<JobRecord>;
  runStartupJob: (input: {
    sourceMode?: SourceMode;
    repoUrl?: string;
    localRepoPath?: string;
    sourceBranch: string;
    targetJavaVersion: string;
    sourceJavaVersion?: string;
    workspaceRoot?: string;
    useNewBranch?: boolean;
    workBranchName?: string;
    upgradeBranchName?: string;
    maxMigrationRounds?: number;
    maxBuildFixAttempts?: number;
    mavenBuildLogTailChars?: number;
    smokeRunEnabled?: boolean;
    smokeRunTimeoutSeconds?: number;
    smokeRunProfile?: string;
    maxSmokeFixAttempts?: number;
    startupRunMode?: StartupRunMode;
    startupPostSuccessSeconds?: number;
    useLocalPropertiesOverride?: boolean;
    localPropertiesFilePath?: string;
    copilotModel?: string;
  }) => Promise<JobRecord>;
  pushBranch: (jobId: string) => Promise<void>;
  rollback: (jobId: string) => Promise<void>;
  stopJob: (jobId: string) => Promise<JobRecord>;
  getArtifacts: (jobId: string) => Promise<JobArtifacts | null>;
  getLiveReport: (jobId: string) => Promise<string>;
  getLiveDiff: (jobId: string) => Promise<string>;
  getActiveJobId: () => Promise<string | null>;
  onJobLog: (callback: (line: string) => void) => () => void;
  onJobStatus: (callback: (status: string) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
