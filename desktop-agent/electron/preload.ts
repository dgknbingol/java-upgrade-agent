import { contextBridge, ipcRenderer } from 'electron';
import type {
  AnalyzeInput,
  AnalyzeResult,
  JobRecord,
  StartUpgradeInput,
} from './jobRunner';

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
  jiraBaseUrl: string;
  jiraToken: string;
}

export interface CopilotModelOptions {
  models: string[];
  selectedModel: string;
  cliPersistedModel: string | null;
}

export interface JiraSettingsInput {
  jiraBaseUrl: string;
  jiraToken: string;
}

const electronAPI = {
  getConfig: (): Promise<AppPublicConfig> => ipcRenderer.invoke('app:getConfig'),

  savePipelineConfig: (input: Partial<PipelineSettingsInput>): Promise<PipelineSettingsInput> =>
    ipcRenderer.invoke('app:savePipelineConfig', input),

  pickFolder: (title?: string): Promise<{ path: string | null }> =>
    ipcRenderer.invoke('app:pickFolder', title),

  pickFile: (options?: {
    title?: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<{ path: string | null }> => ipcRenderer.invoke('app:pickFile', options),

  saveTextFile: (options: {
    content: string;
    defaultFilename: string;
    title?: string;
  }): Promise<{ saved: boolean; path: string | null }> =>
    ipcRenderer.invoke('app:saveTextFile', options),

  checkHealth: (targetJavaVersion?: string): Promise<HealthToolStatus[]> =>
    ipcRenderer.invoke('health:check', targetJavaVersion),

  listCopilotModels: (): Promise<CopilotModelOptions> =>
    ipcRenderer.invoke('copilot:listModels'),

  saveCopilotModel: (model: string): Promise<string> =>
    ipcRenderer.invoke('app:saveCopilotModel', model),

  saveJiraConfig: (input: Partial<JiraSettingsInput>): Promise<JiraSettingsInput> =>
    ipcRenderer.invoke('app:saveJiraConfig', input),

  analyze: (input: AnalyzeInput): Promise<AnalyzeResult> =>
    ipcRenderer.invoke('job:analyze', input),

  startUpgrade: (input: StartUpgradeInput): Promise<JobRecord> =>
    ipcRenderer.invoke('job:start', input),

  startSecurityFix: (input: StartUpgradeInput): Promise<JobRecord> =>
    ipcRenderer.invoke('job:startSecurityFix', input),

  runBuild: (jobId: string, options?: { skipTests?: boolean }): Promise<JobRecord> =>
    ipcRenderer.invoke('job:runBuild', jobId, options),

  runBuildJob: (input: StartUpgradeInput): Promise<JobRecord> =>
    ipcRenderer.invoke('job:runBuildJob', input),

  runStartup: (jobId: string): Promise<JobRecord> =>
    ipcRenderer.invoke('job:runStartup', jobId),

  runStartupJob: (input: StartUpgradeInput): Promise<JobRecord> =>
    ipcRenderer.invoke('job:runStartupJob', input),

  pushBranch: (jobId: string): Promise<void> => ipcRenderer.invoke('job:push', jobId),

  rollback: (jobId: string): Promise<void> => ipcRenderer.invoke('job:rollback', jobId),

  stopJob: (jobId: string) => ipcRenderer.invoke('job:stop', jobId),

  getArtifacts: (jobId: string): Promise<JobArtifacts | null> =>
    ipcRenderer.invoke('job:getArtifacts', jobId),

  getLiveReport: (jobId: string): Promise<string> => ipcRenderer.invoke('job:getLiveReport', jobId),

  getLiveDiff: (jobId: string): Promise<string> => ipcRenderer.invoke('job:getLiveDiff', jobId),

  getActiveJobId: (): Promise<string | null> => ipcRenderer.invoke('job:getActiveId'),

  onJobLog: (callback: (line: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, line: string) => callback(line);
    ipcRenderer.on('job:log', handler);
    return () => ipcRenderer.removeListener('job:log', handler);
  },

  onJobStatus: (callback: (status: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: string) => callback(status);
    ipcRenderer.on('job:status', handler);
    return () => ipcRenderer.removeListener('job:status', handler);
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
