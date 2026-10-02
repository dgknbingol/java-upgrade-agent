import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { buildMavenFixPrompt, buildSmokeFixPrompt } from './prompts/javaUpgradePrompt';
import { buildSecurityRemediationPrompt } from './prompts/securityRemediationPrompt';
import {
  MIGRATION_PHASES,
  buildMigrationContinuationPrompt,
  buildPhasePrompt,
} from './prompts/migrationPrompts';
import { runCopilotFix, runCopilotMigration } from './services/copilotService';
import {
  analyzeMigrationScope,
  writeMigrationAnalysisFile,
} from './services/migrationAnalyzer';
import {
  validateMigration,
  writeValidationReport,
} from './services/migrationValidator';
import { assertHealth } from './services/healthService';
import { resolveCopilotModel } from './services/copilotModelService';
import { javaVersionsDiffer } from './javaVersionUtils';
import { resolveWorkBranchName } from './branchResolver';
import { getAppConfig, normalizePipelineSettings, type PipelineSettings } from './config/appConfig';
import {
  checkoutBranch,
  checkoutWorkBranch,
  cloneRepository,
  cloneRepositoryShallow,
  commitAndPushBranch,
  fetchOrigin,
  getDiff,
  getProjectEditSnapshot,
  hasWorkingTreeChanges,
  rollbackWorkspace,
} from './services/gitService';
import { JobCancelledError, assertJobNotCancelled, cancelJob, clearJobCancellation } from './jobCancellation';
import { withJobContext } from './jobContext';
import { logElapsed, formatDuration, timedStep } from './jobTiming';
import { removeDirectorySafe } from './workspaceCleanup';
import { resolveJobWorkspacePath, validateLocalRepoPath } from './workspacePaths';
import { analyzePom, getMavenVersion, runMavenBuild, runMavenPackage } from './services/mavenService';
import { detectSpringBootRunTarget, runStartupForWorkspace } from './services/smokeService';
import type { StartupRunMode } from './config/appConfig';
import { applyLocalPropertiesOverride } from './services/projectLocalProperties';
import { applyPomJavaUpgrade } from './services/pomUpgrader';
import {
  ensureMigrationOutputDir,
  readLiveMigrationReport,
  MIGRATION_FILE_NAMES,
  migrationOutputRelPath,
  resolveMigrationFilePath,
  resolveExistingMigrationFilePath,
} from './services/migrationOutputPaths';
import { deriveRepoName } from './services/repoIdentity';
import {
  fetchSecurityFindings,
  type SecurityFindingsResult,
} from './services/jiraSecurityService';

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

export type SourceMode = 'remote' | 'local';

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
  useLocalPropertiesOverride: boolean;
  localPropertiesFilePath: string;
  skipTests: boolean;
  copilotModel: string;
  pipelineSettings: PipelineSettings;
  workspacePath: string;
  status: JobStatus;
  logs: string[];
  report: string;
  diff: string;
  mendFindingsText?: string;
  fortifyFindingsText?: string;
  error?: string;
}

export interface AnalyzeInput {
  sourceMode?: SourceMode;
  repoUrl?: string;
  localRepoPath?: string;
  sourceBranch: string;
  workspaceRoot?: string;
  targetJavaVersion?: string;
  includeMend?: boolean;
  includeFortify?: boolean;
  jiraBaseUrl?: string;
  jiraToken?: string;
}

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

export interface StartUpgradeInput {
  sourceMode?: SourceMode;
  repoUrl?: string;
  localRepoPath?: string;
  sourceBranch: string;
  targetJavaVersion: string;
  sourceJavaVersion?: string;
  workspaceRoot?: string;
  useNewBranch?: boolean;
  workBranchName?: string;
  /** @deprecated use workBranchName */
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
  copilotModel?: string;
  useLocalPropertiesOverride?: boolean;
  localPropertiesFilePath?: string;
  skipTests?: boolean;
  includeMend?: boolean;
  includeFortify?: boolean;
  jiraBaseUrl?: string;
  jiraToken?: string;
}

const RUNNING_STATUSES: JobStatus[] = [
  'cloning',
  'running-copilot',
  'building',
  'smoke-running',
  'pushing',
  'rolling-back',
];

function isRunningStatus(status: JobStatus): boolean {
  return RUNNING_STATUSES.includes(status);
}

function handleJobFailure(
  job: JobRecord,
  err: unknown,
  onLog?: LogCallback,
  onStatus?: StatusCallback
): JobRecord {
  if (err instanceof JobCancelledError) {
    job.error = err.message;
    setStatus(job, 'cancelled', onStatus);
    appendLog(job, 'İşlem durduruldu.', onLog);
    return job;
  }

  job.error = err instanceof Error ? err.message : String(err);
  setStatus(job, 'failed', onStatus);
  appendLog(job, `HATA: ${job.error}`, onLog);
  return job;
}

type LogCallback = (line: string) => void;
type StatusCallback = (status: JobStatus) => void;

const jobs = new Map<string, JobRecord>();
let activeJobId: string | null = null;

function appendLog(job: JobRecord, line: string, onLog?: LogCallback): void {
  job.logs.push(line);
  onLog?.(line);
}

function setStatus(job: JobRecord, status: JobStatus, onStatus?: StatusCallback): void {
  job.status = status;
  onStatus?.(status);
}

function getWorkspacePath(jobId: string, workspaceRoot?: string): string {
  return resolveJobWorkspacePath(jobId, workspaceRoot);
}

function resolveWorkspacePath(
  jobId: string,
  input: StartUpgradeInput,
  sourceMode: SourceMode,
  cloneSource: string
): string {
  if (sourceMode === 'local') {
    return cloneSource;
  }

  const cloneTarget = input.workspaceRoot?.trim();
  if (cloneTarget) {
    return path.resolve(cloneTarget);
  }

  return getWorkspacePath(jobId, undefined);
}

async function prepareJobWorkspace(
  job: JobRecord,
  input: StartUpgradeInput,
  onLog?: LogCallback
): Promise<void> {
  const log = (line: string) => appendLog(job, line, onLog);

  await timedStep(log, 'Workspace hazırlığı', async () => {
  const { cloneSource } = resolveCloneSource({
    sourceMode: job.sourceMode,
    repoUrl: input.repoUrl,
    localRepoPath: input.localRepoPath,
  });

  if (job.sourceMode === 'local') {
    appendLog(job, `Yerel repo üzerinde çalışılıyor: ${job.workspacePath}`, onLog);
    await checkoutBranch(job.workspacePath, input.sourceBranch, (l) => appendLog(job, l, onLog));
  } else if (fs.existsSync(path.join(job.workspacePath, '.git'))) {
    appendLog(job, `Mevcut repo klasörü kullanılıyor: ${job.workspacePath}`, onLog);
    await fetchOrigin(job.workspacePath, (l) => appendLog(job, l, onLog));
    await checkoutBranch(job.workspacePath, input.sourceBranch, (l) => appendLog(job, l, onLog));
  } else {
    fs.mkdirSync(path.dirname(job.workspacePath), { recursive: true });
    appendLog(job, `Repo klonlanıyor: ${cloneSource} -> ${job.workspacePath}`, onLog);
    await cloneRepository(cloneSource, job.workspacePath, (l) => appendLog(job, l, onLog));
    await checkoutBranch(job.workspacePath, input.sourceBranch, (l) => appendLog(job, l, onLog));
    await fetchOrigin(job.workspacePath, (l) => appendLog(job, l, onLog));
  }

  const useNewBranch = input.useNewBranch === true;
  job.useNewBranch = useNewBranch;

  if (useNewBranch) {
    const workBranch = await resolveWorkBranchName(
      job.workspacePath,
      job.targetJavaVersion,
      input.workBranchName || input.upgradeBranchName
    );
    job.upgradeBranch = workBranch;
    appendLog(job, `Çalışma branch: ${workBranch}`, onLog);
    await checkoutWorkBranch(
      job.workspacePath,
      input.sourceBranch,
      workBranch,
      (l) => appendLog(job, l, onLog)
    );
  } else {
    job.upgradeBranch = input.sourceBranch;
    appendLog(job, `Kaynak branch üzerinde çalışılıyor: ${input.sourceBranch}`, onLog);
    await checkoutBranch(job.workspacePath, input.sourceBranch, (l) => appendLog(job, l, onLog));
  }
  });
}

function resolveJobPipelineSettings(input: StartUpgradeInput): PipelineSettings {
  return normalizePipelineSettings({
    maxMigrationRounds: input.maxMigrationRounds,
    maxBuildFixAttempts: input.maxBuildFixAttempts,
    mavenBuildLogTailChars: input.mavenBuildLogTailChars,
    smokeRunEnabled: input.smokeRunEnabled,
    smokeRunTimeoutSeconds: input.smokeRunTimeoutSeconds,
    smokeRunProfile: input.smokeRunProfile,
    maxSmokeFixAttempts: input.maxSmokeFixAttempts,
    startupRunMode: input.startupRunMode,
    startupPostSuccessSeconds: input.startupPostSuccessSeconds,
  });
}

function createJobRecord(
  jobId: string,
  input: StartUpgradeInput,
  sourceMode: SourceMode,
  cloneSource: string,
  workspacePath: string
): JobRecord {
  return {
    id: jobId,
    sourceMode,
    repoUrl: input.repoUrl?.trim() || '',
    localRepoPath: sourceMode === 'local' ? cloneSource : input.localRepoPath?.trim() || '',
    sourceBranch: input.sourceBranch,
    targetJavaVersion: input.targetJavaVersion || '21',
    sourceJavaVersion: input.sourceJavaVersion?.trim() || '',
    upgradeBranch: '',
    useNewBranch: input.useNewBranch === true,
    useLocalPropertiesOverride: input.useLocalPropertiesOverride === true,
    localPropertiesFilePath: input.localPropertiesFilePath?.trim() || '',
    skipTests: false,
    copilotModel: resolveCopilotModel(input.copilotModel),
    pipelineSettings: resolveJobPipelineSettings(input),
    workspacePath,
    status: 'cloning',
    logs: [],
    report: '',
    diff: '',
  };
}

function readReport(workspacePath: string): string {
  return readLiveMigrationReport(workspacePath);
}

export function getLiveMigrationReport(jobId: string): string {
  const job = jobs.get(jobId);
  if (!job || !fs.existsSync(job.workspacePath)) return '';
  return readLiveMigrationReport(job.workspacePath);
}

export async function getLiveMigrationDiff(jobId: string): Promise<string> {
  const job = jobs.get(jobId);
  if (!job || !fs.existsSync(job.workspacePath)) return '';
  try {
    return await getDiff(job.workspacePath, job.sourceBranch);
  } catch {
    return job.diff || '';
  }
}

async function syncJobArtifacts(job: JobRecord): Promise<void> {
  if (!fs.existsSync(job.workspacePath)) return;
  job.diff = await getDiff(job.workspacePath, job.sourceBranch);
  job.report = readReport(job.workspacePath);
}

export function getJob(jobId: string): JobRecord | undefined {
  return jobs.get(jobId);
}

export function getActiveJobId(): string | null {
  return activeJobId;
}

function resolveCloneSource(input: {
  sourceMode?: SourceMode;
  repoUrl?: string;
  localRepoPath?: string;
}): { sourceMode: SourceMode; cloneSource: string } {
  const sourceMode: SourceMode = input.sourceMode === 'local' ? 'local' : 'remote';

  if (sourceMode === 'local') {
    return {
      sourceMode,
      cloneSource: validateLocalRepoPath(input.localRepoPath || ''),
    };
  }

  const repoUrl = input.repoUrl?.trim();
  if (!repoUrl) {
    throw new Error('Git Repository URL gerekli.');
  }
  return { sourceMode, cloneSource: repoUrl };
}

function resolveJiraCredentials(input: {
  jiraBaseUrl?: string;
  jiraToken?: string;
}): { jiraBaseUrl: string; jiraToken: string } {
  const config = getAppConfig();
  return {
    jiraBaseUrl: (input.jiraBaseUrl || config.jiraBaseUrl || '').trim().replace(/\/+$/, ''),
    jiraToken: (input.jiraToken || config.jiraToken || '').trim(),
  };
}

async function maybeFetchSecurityFindings(
  input: {
    sourceMode?: SourceMode;
    repoUrl?: string;
    localRepoPath?: string;
    includeMend?: boolean;
    includeFortify?: boolean;
    jiraBaseUrl?: string;
    jiraToken?: string;
  },
  onLog?: LogCallback
): Promise<SecurityFindingsResult | null> {
  const includeMend = input.includeMend === true;
  const includeFortify = input.includeFortify === true;
  if (!includeMend && !includeFortify) {
    onLog?.('Mend & Fortify: checkbox seçili değil — Jira sorgusu atlandı.');
    return null;
  }

  const { jiraBaseUrl, jiraToken } = resolveJiraCredentials(input);
  if (!jiraToken) {
    throw new Error(
      'Mend/Fortify için Jira personal token gerekli. Sol panelde token girin.'
    );
  }
  if (!jiraBaseUrl) {
    throw new Error('Jira base URL gerekli.');
  }

  const repoName = deriveRepoName(input);
  onLog?.(
    `Mend & Fortify: Jira sorgusu başlıyor (repo=${repoName}, mend=${includeMend}, fortify=${includeFortify})...`
  );

  const findings = await fetchSecurityFindings({
    jiraBaseUrl,
    jiraToken,
    repoName,
    includeMend,
    includeFortify,
  });

  if (includeMend) {
    onLog?.(`Mend bulguları: ${findings.mend.length} (JQL: ${findings.mendJql})`);
  }
  if (includeFortify) {
    onLog?.(`Fortify bulguları: ${findings.fortify.length} (JQL: ${findings.fortifyJql})`);
  }

  return findings;
}

function writeSecurityFindingArtifacts(
  workspacePath: string,
  findings: SecurityFindingsResult
): void {
  ensureMigrationOutputDir(workspacePath);
  fs.writeFileSync(
    resolveMigrationFilePath(workspacePath, MIGRATION_FILE_NAMES.mendFindings),
    findings.mendText,
    'utf-8'
  );
  fs.writeFileSync(
    resolveMigrationFilePath(workspacePath, MIGRATION_FILE_NAMES.fortifyFindings),
    findings.fortifyText,
    'utf-8'
  );
}

function readSecurityRemediationReport(workspacePath: string): string {
  const preferred = resolveExistingMigrationFilePath(
    workspacePath,
    MIGRATION_FILE_NAMES.securityReport
  );
  if (preferred) {
    return fs.readFileSync(preferred, 'utf-8');
  }
  const root = path.join(workspacePath, MIGRATION_FILE_NAMES.securityReport);
  if (fs.existsSync(root)) {
    return fs.readFileSync(root, 'utf-8');
  }
  return '';
}

function toAnalyzeResultFromPom(
  pom: ReturnType<typeof analyzePom>,
  mavenVersion: string,
  security: SecurityFindingsResult | null
): AnalyzeResult {
  return {
    javaVersion: pom.javaVersion,
    javaSource: pom.javaSource,
    mavenVersion,
    mavenCompilerVersion: pom.mavenCompilerVersion,
    springBootVersion: pom.springBootVersion,
    buildTool: pom.buildTool,
    displayVersion: pom.javaVersion === 'unknown' ? '?' : `Java ${pom.javaVersion}`,
    repoName: security?.repoName || '',
    mendFindingsText: security?.mendText || '',
    fortifyFindingsText: security?.fortifyText || '',
    mendCount: security?.mend.length || 0,
    fortifyCount: security?.fortify.length || 0,
  };
}

export async function analyzeRepository(
  input: AnalyzeInput,
  onLog?: LogCallback
): Promise<AnalyzeResult> {
  await assertHealth(input.targetJavaVersion);

  const { sourceMode, cloneSource } = resolveCloneSource(input);
  const log = (line: string) => onLog?.(line);

  if (sourceMode === 'local') {
    return timedStep(log, 'Analyze', async () => {
      onLog?.(`Yerel repo analiz ediliyor: ${cloneSource}`);
      await checkoutBranch(cloneSource, input.sourceBranch, onLog);

      const pom = analyzePom(cloneSource);
      const mavenVersion = await getMavenVersion(onLog);

      onLog?.(`Java sürümü: ${pom.javaVersion} (${pom.javaSource})`);
      onLog?.(`Maven: ${mavenVersion}`);
      onLog?.(`Spring Boot parent: ${pom.springBootVersion}`);

      let security: SecurityFindingsResult | null = null;
      try {
        security = await maybeFetchSecurityFindings(
          {
            sourceMode,
            repoUrl: input.repoUrl,
            localRepoPath: cloneSource,
            includeMend: input.includeMend,
            includeFortify: input.includeFortify,
            jiraBaseUrl: input.jiraBaseUrl,
            jiraToken: input.jiraToken,
          },
          onLog
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        onLog?.(`Mend & Fortify Jira hatası: ${msg}`);
        security = {
          repoName: deriveRepoName({
            sourceMode,
            repoUrl: input.repoUrl,
            localRepoPath: cloneSource,
          }),
          mend: [],
          fortify: [],
          mendJql: null,
          fortifyJql: null,
          mendText: input.includeMend
            ? `# Mend Findings\n\nJira hatası: ${msg}`
            : '',
          fortifyText: input.includeFortify
            ? `# Fortify Findings\n\nJira hatası: ${msg}`
            : '',
        };
      }

      return toAnalyzeResultFromPom(pom, mavenVersion, security);
    });
  }

  const jobId = `analyze-${uuidv4()}`;
  const workspacePath = getWorkspacePath(jobId, input.workspaceRoot);

  return timedStep(log, 'Analyze', async () => {
    onLog?.(`Uzak repodan analiz klonu: ${cloneSource}`);

    try {
      await cloneRepositoryShallow(cloneSource, workspacePath, input.sourceBranch, onLog);

      const pom = analyzePom(workspacePath);
      const mavenVersion = await getMavenVersion(onLog);

      onLog?.(`Java sürümü: ${pom.javaVersion} (${pom.javaSource})`);
      onLog?.(`Maven: ${mavenVersion}`);
      onLog?.(`Spring Boot parent: ${pom.springBootVersion}`);

      let security: SecurityFindingsResult | null = null;
      try {
        security = await maybeFetchSecurityFindings(
          {
            sourceMode,
            repoUrl: cloneSource,
            localRepoPath: input.localRepoPath,
            includeMend: input.includeMend,
            includeFortify: input.includeFortify,
            jiraBaseUrl: input.jiraBaseUrl,
            jiraToken: input.jiraToken,
          },
          onLog
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        onLog?.(`Mend & Fortify Jira hatası: ${msg}`);
        security = {
          repoName: deriveRepoName({
            sourceMode,
            repoUrl: cloneSource,
            localRepoPath: input.localRepoPath,
          }),
          mend: [],
          fortify: [],
          mendJql: null,
          fortifyJql: null,
          mendText: input.includeMend
            ? `# Mend Findings\n\nJira hatası: ${msg}`
            : '',
          fortifyText: input.includeFortify
            ? `# Fortify Findings\n\nJira hatası: ${msg}`
            : '',
        };
      }

      return toAnalyzeResultFromPom(pom, mavenVersion, security);
    } finally {
      await removeDirectorySafe(workspacePath);
    }
  });
}

export async function startSecurityRemediation(
  input: StartUpgradeInput,
  onLog?: LogCallback,
  onStatus?: StatusCallback
): Promise<JobRecord> {
  await assertHealth(input.targetJavaVersion);

  const includeMend = input.includeMend === true;
  const includeFortify = input.includeFortify === true;
  if (!includeMend && !includeFortify) {
    throw new Error('Mend & Fortify Fix için en az bir checkbox seçili olmalı.');
  }

  const jobId = uuidv4();
  const sourceMode: SourceMode = input.sourceMode === 'local' ? 'local' : 'remote';
  const { cloneSource } = resolveCloneSource(input);
  const workspacePath = resolveWorkspacePath(jobId, input, sourceMode, cloneSource);
  const job = createJobRecord(jobId, input, sourceMode, cloneSource, workspacePath);

  jobs.set(jobId, job);
  activeJobId = jobId;
  clearJobCancellation(jobId);
  setStatus(job, 'cloning', onStatus);
  const jobStart = Date.now();

  try {
    return await withJobContext(jobId, async () => {
      await prepareJobWorkspace(job, input, onLog);

      const findings = await maybeFetchSecurityFindings(
        {
          sourceMode: job.sourceMode,
          repoUrl: job.repoUrl || input.repoUrl,
          localRepoPath: job.localRepoPath || input.localRepoPath,
          includeMend,
          includeFortify,
          jiraBaseUrl: input.jiraBaseUrl,
          jiraToken: input.jiraToken,
        },
        (line) => appendLog(job, line, onLog)
      );

      if (!findings) {
        throw new Error('Güvenlik bulguları alınamadı.');
      }

      writeSecurityFindingArtifacts(job.workspacePath, findings);
      job.mendFindingsText = findings.mendText;
      job.fortifyFindingsText = findings.fortifyText;

      const inScopeCount =
        (includeMend ? findings.mend.length : 0) +
        (includeFortify ? findings.fortify.length : 0);

      if (inScopeCount === 0) {
        appendLog(
          job,
          'Seçili tarayıcılar için açık Jira bulgusu yok — Copilot fix atlandı.',
          onLog
        );
        job.report = [
          '# Security Remediation Report',
          '',
          `Repository: ${findings.repoName}`,
          `Branch: ${job.upgradeBranch || job.sourceBranch}`,
          '',
          'No in-scope open findings were returned from Jira.',
        ].join('\n');
        ensureMigrationOutputDir(job.workspacePath);
        fs.writeFileSync(
          resolveMigrationFilePath(job.workspacePath, MIGRATION_FILE_NAMES.securityReport),
          job.report,
          'utf-8'
        );
        await syncJobArtifacts(job);
        setStatus(job, 'completed', onStatus);
        logElapsed((l) => appendLog(job, l, onLog), 'Mend & Fortify Fix (toplam)', jobStart);
        return job;
      }

      const prompt = buildSecurityRemediationPrompt({
        repoName: findings.repoName,
        branch: job.upgradeBranch || job.sourceBranch,
        includeMend,
        includeFortify,
        mendFindings: includeMend ? findings.mend : [],
        fortifyFindings: includeFortify ? findings.fortify : [],
      });

      setStatus(job, 'running-copilot', onStatus);
      appendLog(
        job,
        `Mend & Fortify Fix: ${inScopeCount} bulgu için Copilot remediation başlıyor...`,
        onLog
      );

      const code = await runCopilotFix(
        job.workspacePath,
        prompt,
        (line) => appendLog(job, line, onLog),
        job.copilotModel,
        'security fix prompt',
        'security-fix'
      );

      assertJobNotCancelled(job.id);
      if (code !== 0) {
        appendLog(job, `UYARI: Copilot security fix exit code ${code}`, onLog);
      }

      const securityReport = readSecurityRemediationReport(job.workspacePath);
      if (securityReport.trim()) {
        job.report = securityReport;
      } else {
        job.report = readReport(job.workspacePath) || job.report;
      }

      await syncJobArtifacts(job);
      if (securityReport.trim()) {
        job.report = securityReport;
      }

      setStatus(job, 'completed', onStatus);
      appendLog(job, 'Mend & Fortify Fix tamamlandı.', onLog);
      logElapsed((l) => appendLog(job, l, onLog), 'Mend & Fortify Fix (toplam)', jobStart);
      return job;
    });
  } catch (err) {
    try {
      await syncJobArtifacts(job);
    } catch {
      // ignore
    }
    const failedJob = handleJobFailure(job, err, onLog, onStatus);
    if (err instanceof JobCancelledError) {
      return failedJob;
    }
    throw err;
  } finally {
    if (activeJobId === jobId) {
      activeJobId = null;
    }
  }
}

export async function startUpgrade(
  input: StartUpgradeInput,
  onLog?: LogCallback,
  onStatus?: StatusCallback
): Promise<JobRecord> {
  await assertHealth(input.targetJavaVersion);

  const jobId = uuidv4();
  const sourceMode: SourceMode = input.sourceMode === 'local' ? 'local' : 'remote';
  const { cloneSource } = resolveCloneSource(input);
  const workspacePath = resolveWorkspacePath(jobId, input, sourceMode, cloneSource);
  const job = createJobRecord(jobId, input, sourceMode, cloneSource, workspacePath);

  jobs.set(jobId, job);
  activeJobId = jobId;
  clearJobCancellation(jobId);
  setStatus(job, 'cloning', onStatus);
  const jobStart = Date.now();

  try {
    return await withJobContext(jobId, async () => {
    await prepareJobWorkspace(job, input, onLog);

    if (!job.sourceJavaVersion) {
      const pom = analyzePom(job.workspacePath);
      job.sourceJavaVersion = pom.javaVersion;
      appendLog(job, `Kaynak Java tespit edildi: ${pom.javaVersion}`, onLog);
    }

    const baselineAnalysis = analyzeMigrationScope(job.workspacePath, job.targetJavaVersion);
    await runMigrationOrchestration(job, baselineAnalysis, onLog, onStatus);

    await syncJobArtifacts(job);

    setStatus(job, 'completed', onStatus);
    appendLog(job, 'Upgrade tamamlandı.', onLog);
    logElapsed((l) => appendLog(job, l, onLog), 'Start Upgrade (toplam)', jobStart);
    return job;
    });
  } catch (err) {
    try {
      await syncJobArtifacts(job);
    } catch {
      // workspace okunamazsa UI boş kalabilir
    }
    const failedJob = handleJobFailure(job, err, onLog, onStatus);
    if (err instanceof JobCancelledError) {
      return failedJob;
    }
    throw err;
  } finally {
    if (activeJobId === jobId) {
      activeJobId = null;
    }
  }
}

interface MavenBuildLoopResult {
  success: boolean;
  lastOutput: string;
}

function applyJobLocalPropertiesIfConfigured(job: JobRecord, onLog?: LogCallback): void {
  if (!job.useLocalPropertiesOverride) return;

  const sourcePath = job.localPropertiesFilePath.trim();
  if (!sourcePath) {
    appendLog(
      job,
      'Local properties seçili ancak dosya belirtilmedi — projedeki mevcut application-local.properties kullanılacak.',
      onLog
    );
    return;
  }

  const { targets, created } = applyLocalPropertiesOverride(job.workspacePath, sourcePath);
  const action = created ? 'oluşturuldu' : 'güncellendi';
  for (const target of targets) {
    appendLog(
      job,
      `application-local.properties ${action} (${sourcePath} → ${target})`,
      onLog
    );
  }
}

async function runMavenBuildWithFixLoop(
  job: JobRecord,
  onLog?: LogCallback,
  onStatus?: StatusCallback,
  options: { throwOnExhausted?: boolean; roundLabel?: string } = {}
): Promise<MavenBuildLoopResult> {
  const { maxBuildFixAttempts } = job.pipelineSettings;
  const throwOnExhausted = options.throwOnExhausted ?? true;
  const roundPrefix = options.roundLabel ? `${options.roundLabel} ` : '';
  let lastOutput = '';

  for (let attempt = 1; attempt <= maxBuildFixAttempts; attempt++) {
    assertJobNotCancelled(job.id);
    setStatus(job, 'building', onStatus);
    appendLog(
      job,
      `${roundPrefix}Maven build denemesi ${attempt}/${maxBuildFixAttempts}...`,
      onLog
    );

    applyJobLocalPropertiesIfConfigured(job, onLog);

    if (job.skipTests) {
      appendLog(job, `${roundPrefix}Maven: testler atlanıyor (-DskipTests)`, onLog);
    }

    const buildStart = Date.now();
    const { success, output } = await runMavenBuild(
      job.workspacePath,
      (line) => appendLog(job, line, onLog),
      { skipTests: job.skipTests }
    );
    appendLog(
      job,
      `[süre] ${roundPrefix}Maven build (${attempt}/${maxBuildFixAttempts}): ${formatDuration(Date.now() - buildStart)} ${success ? '✓' : '✗'}`,
      onLog
    );
    lastOutput = output;

    if (success) {
      appendLog(job, `${roundPrefix}Maven build başarılı.`, onLog);
      return { success: true, lastOutput };
    }

    if (attempt >= maxBuildFixAttempts) {
      if (throwOnExhausted) {
        throw new Error(
          `mvn clean install ${maxBuildFixAttempts} denemeden sonra başarısız oldu.`
        );
      }
      appendLog(
        job,
        `${roundPrefix}Inner build loop tükendi — sonraki migration turuna geçilebilir.`,
        onLog
      );
      return { success: false, lastOutput };
    }

    setStatus(job, 'running-copilot', onStatus);
    appendLog(
      job,
      `${roundPrefix}Build başarısız. Copilot fix (${attempt}/${maxBuildFixAttempts - 1})...`,
      onLog
    );

    const fixPrompt = buildMavenFixPrompt(
      job.targetJavaVersion,
      job.sourceJavaVersion || 'unknown',
      output,
      {
        springBootVersion: analyzePom(job.workspacePath).springBootVersion,
        mavenBuildLogTailChars: job.pipelineSettings.mavenBuildLogTailChars,
      }
    );
    const beforeFix = await getProjectEditSnapshot(job.workspacePath);
    await timedStep(
      (l) => appendLog(job, l, onLog),
      `${roundPrefix}Copilot build fix (${attempt}/${maxBuildFixAttempts - 1})`,
      () =>
        runCopilotFix(
          job.workspacePath,
          fixPrompt,
          (line) => appendLog(job, line, onLog),
          job.copilotModel,
          'build fix prompt',
          'build-fix'
        )
    );
    const afterFix = await getProjectEditSnapshot(job.workspacePath);
    if (beforeFix === afterFix) {
      appendLog(
        job,
        'UYARI: Copilot build fix proje dosyası değiştirmedi. CLI edit etmemiş olabilir — .java-upgrade/BUILD_FIX_TASK.md içeriğini kontrol edin.',
        onLog
      );
    } else {
      appendLog(job, 'Copilot build fix proje dosyalarında değişiklik üretti.', onLog);
    }
  }

  return { success: false, lastOutput };
}

interface SmokeLoopResult {
  success: boolean;
  skipped: boolean;
  lastOutput: string;
}

function writeRunAppLog(workspacePath: string, log: string): string {
  ensureMigrationOutputDir(workspacePath);
  const filePath = resolveMigrationFilePath(workspacePath, MIGRATION_FILE_NAMES.runAppLog);
  fs.writeFileSync(filePath, log, 'utf-8');
  return migrationOutputRelPath(MIGRATION_FILE_NAMES.runAppLog);
}

async function rebuildRunnableJar(
  job: JobRecord,
  onLog?: LogCallback
): Promise<void> {
  const target = detectSpringBootRunTarget(job.workspacePath);
  if (!target) return;

  appendLog(job, 'Copilot fix sonrası mvn package (java -jar için yeniden derleme)...', onLog);
  const { success } = await runMavenPackage(
    job.workspacePath,
    (line) => appendLog(job, line, onLog),
    { modulePath: target.modulePath }
  );
  if (!success) {
    appendLog(job, 'UYARI: mvn package başarısız — run yine de denenecek.', onLog);
  }
}

async function runStartupWithFixLoop(
  job: JobRecord,
  onLog?: LogCallback,
  onStatus?: StatusCallback
): Promise<SmokeLoopResult> {
  const {
    smokeRunEnabled,
    smokeRunTimeoutSeconds,
    smokeRunProfile,
    maxSmokeFixAttempts,
    mavenBuildLogTailChars,
    startupRunMode,
    startupPostSuccessSeconds,
  } = job.pipelineSettings;

  if (!smokeRunEnabled) {
    throw new Error('Run App kapalı — Pipeline ayarlarından etkinleştirin.');
  }

  const maxAttempts = Math.max(1, maxSmokeFixAttempts);
  let lastOutput = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    assertJobNotCancelled(job.id);
    setStatus(job, 'smoke-running', onStatus);
    appendLog(
      job,
      `Uygulama run denemesi ${attempt}/${maxAttempts} (mode: ${startupRunMode})...`,
      onLog
    );

    applyJobLocalPropertiesIfConfigured(job, onLog);

    const startupStart = Date.now();
    const result = await runStartupForWorkspace(
      job.workspacePath,
      {
        profile: smokeRunProfile,
        timeoutSeconds: smokeRunTimeoutSeconds,
        runMode: startupRunMode,
        postSuccessSeconds: startupPostSuccessSeconds,
        jobId: job.id,
      },
      (line) => appendLog(job, line, onLog)
    );
    const startupMark = result.skipped ? '⊘' : result.success ? '✓' : '✗';
    appendLog(
      job,
      `[süre] Run App startup (${attempt}/${maxAttempts}): ${formatDuration(Date.now() - startupStart)} ${startupMark}`,
      onLog
    );

    lastOutput = result.output;

    if (result.skipped) {
      if (result.reason === 'not-spring-boot') {
        return { success: true, skipped: true, lastOutput };
      }
      appendLog(
        job,
        `Run hazırlığı başarısız (${result.reason ?? 'bilinmeyen'}) — log Copilot'a gönderilecek.`,
        onLog
      );
      lastOutput = result.output;
    } else if (result.success) {
      const via = result.runMethod === 'jar' ? 'java -jar' : 'spring-boot:run';
      appendLog(job, `Run başarılı (${via}) — uygulama ayağa kalktı.`, onLog);
      return { success: true, skipped: false, lastOutput };
    }

    const reason =
      result.reason === 'timeout'
        ? 'zaman aşımı'
        : result.reason === 'runtime-failed'
          ? 'çalışma sırasında hata'
          : 'başlangıç hatası';
    appendLog(
      job,
      `Run başarısız (${reason}) — log Copilot CLI'a gönderiliyor (VS Code chat gibi otomatik fix).`,
      onLog
    );

    const runAppLogRel = writeRunAppLog(job.workspacePath, lastOutput);
    appendLog(job, `Run log kaydedildi: ${runAppLogRel}`, onLog);

    if (attempt >= maxAttempts) {
      throw new Error(`Startup run ${maxAttempts} denemeden sonra başarısız.`);
    }

    setStatus(job, 'running-copilot', onStatus);
    appendLog(
      job,
      `Startup başarısız. Copilot runtime fix (${attempt}/${maxAttempts - 1})...`,
      onLog
    );

    const fixPrompt = buildSmokeFixPrompt(
      job.targetJavaVersion,
      job.sourceJavaVersion || 'unknown',
      lastOutput,
      {
        springBootVersion: analyzePom(job.workspacePath).springBootVersion,
        mavenBuildLogTailChars,
        runAppLogRel,
      }
    );
    const beforeFix = await getProjectEditSnapshot(job.workspacePath);
    await timedStep(
      (l) => appendLog(job, l, onLog),
      `Copilot runtime fix (${attempt}/${maxAttempts - 1})`,
      () =>
        runCopilotFix(
          job.workspacePath,
          fixPrompt,
          (line) => appendLog(job, line, onLog),
          job.copilotModel,
          'runtime fix prompt',
          'runtime-fix'
        )
    );
    const afterFix = await getProjectEditSnapshot(job.workspacePath);
    if (beforeFix === afterFix) {
      appendLog(
        job,
        'UYARI: Copilot runtime fix proje dosyası değiştirmedi. CLI edit etmemiş olabilir — .java-upgrade/RUNTIME_FIX_TASK.md içeriğini kontrol edin.',
        onLog
      );
    } else {
      appendLog(job, 'Copilot runtime fix proje dosyalarında değişiklik üretti.', onLog);
    }

    await rebuildRunnableJar(job, onLog);
  }

  return { success: false, skipped: false, lastOutput };
}

async function runMigrationPhases(
  job: JobRecord,
  analysis: ReturnType<typeof analyzeMigrationScope>,
  onLog?: LogCallback,
  onStatus?: StatusCallback
): Promise<void> {
  for (const phase of MIGRATION_PHASES) {
    assertJobNotCancelled(job.id);
    appendLog(job, `=== Migration fazı: ${phase} ===`, onLog);
    setStatus(job, 'running-copilot', onStatus);

    const prompt = buildPhasePrompt(
      phase,
      job.targetJavaVersion,
      job.sourceJavaVersion || analysis.sourceJavaVersion,
      analysis
    );

    const copilotCode = await timedStep(
      (l) => appendLog(job, l, onLog),
      `Migration fazı: ${phase}`,
      async () => {
        const code = await runCopilotMigration(
          job.workspacePath,
          prompt,
          (line) => appendLog(job, line, onLog),
          job.copilotModel
        );
        return code;
      }
    );

    if (copilotCode !== 0) {
      appendLog(
        job,
        `UYARI: Faz "${phase}" Copilot exit ${copilotCode} — sonraki faza devam ediliyor`,
        onLog
      );
    }
  }
}

async function runMigrationOrchestration(
  job: JobRecord,
  baselineAnalysis: ReturnType<typeof analyzeMigrationScope>,
  onLog?: LogCallback,
  onStatus?: StatusCallback
): Promise<void> {
  ensureMigrationOutputDir(job.workspacePath);
  const { maxMigrationRounds } = job.pipelineSettings;
  let lastValidation: Awaited<ReturnType<typeof validateMigration>> | null = null;
  let lastBuildLog = '';

  for (let round = 1; round <= maxMigrationRounds; round++) {
    assertJobNotCancelled(job.id);
    const roundLabel = `Tur ${round}/${maxMigrationRounds}`;
    appendLog(job, `========== Migration ${roundLabel} ==========`, onLog);

    const analysis = analyzeMigrationScope(job.workspacePath, job.targetJavaVersion);
    writeMigrationAnalysisFile(job.workspacePath, analysis);
    appendLog(
      job,
      `${roundLabel} analiz: ${analysis.compatibilityFindings.length} uyumluluk sinyali`,
      onLog
    );

    setStatus(job, 'running-copilot', onStatus);

    if (round === 1) {
      if (javaVersionsDiffer(job.sourceJavaVersion, job.targetJavaVersion)) {
        appendLog(job, 'Temel pom.xml Java ayarları (baseline)...', onLog);
        if (applyPomJavaUpgrade(job.workspacePath, job.targetJavaVersion)) {
          appendLog(job, `pom.xml Java ${job.targetJavaVersion} baseline olarak ayarlandı.`, onLog);
        }
      }
      await runMigrationPhases(job, analysis, onLog, onStatus);
      await ensureMigrationChanges(job, onLog, { round });
    } else {
      const prompt = buildMigrationContinuationPrompt(
        job.targetJavaVersion,
        job.sourceJavaVersion || analysis.sourceJavaVersion,
        analysis,
        {
          round,
          maxRounds: maxMigrationRounds,
          validation: lastValidation ?? undefined,
          buildLog: lastBuildLog || undefined,
          mavenBuildLogTailChars: job.pipelineSettings.mavenBuildLogTailChars,
        }
      );
      const copilotCode = await timedStep(
        (l) => appendLog(job, l, onLog),
        `${roundLabel} Copilot migration devam`,
        async () => {
          const code = await runCopilotMigration(
            job.workspacePath,
            prompt,
            (line) => appendLog(job, line, onLog),
            job.copilotModel
          );
          return code;
        }
      );
      if (copilotCode !== 0) {
        appendLog(job, `UYARI: ${roundLabel} Copilot exit ${copilotCode} — build denenecek`, onLog);
      }
      await ensureMigrationChanges(job, onLog, { round });
    }

    const buildResult = await runMavenBuildWithFixLoop(job, onLog, onStatus, {
      throwOnExhausted: false,
      roundLabel,
    });
    lastBuildLog = buildResult.lastOutput;

    if (!buildResult.success) {
      if (round >= maxMigrationRounds) {
        throw new Error(
          `mvn clean install ${maxMigrationRounds} migration turu sonunda başarısız.`
        );
      }
      appendLog(job, `${roundLabel} build tamamlanamadı — sonraki turda devam edilecek.`, onLog);
      continue;
    }

    lastValidation = await timedStep(
      (l) => appendLog(job, l, onLog),
      `${roundLabel} validation`,
      () =>
        validateMigration(
          job.workspacePath,
          job.targetJavaVersion,
          job.sourceBranch,
          baselineAnalysis
        )
    );
    writeValidationReport(job.workspacePath, lastValidation);

    if (lastValidation.passed) {
      appendLog(job, `${roundLabel}: validation geçti — migration tamam.`, onLog);
      lastValidation.warnings.forEach((w) => appendLog(job, `[uyarı] ${w.message}`, onLog));
      return;
    }

    appendLog(
      job,
      `${roundLabel}: validation başarısız (${lastValidation.errors.length} hata).`,
      onLog
    );
    lastValidation.errors.forEach((e) => appendLog(job, `[validation] ${e.message}`, onLog));

    if (round >= maxMigrationRounds) {
      const softCodes = new Set(['NO_COMPATIBILITY_PROGRESS', 'NO_SOURCE_CHANGES']);
      const blocking = lastValidation.errors.filter((e) => !softCodes.has(e.code));
      if (blocking.length === 0) {
        appendLog(
          job,
          `${maxMigrationRounds} tur: Maven build başarılı — migration tamam (validation uyarıları logda).`,
          onLog
        );
        lastValidation.warnings.forEach((w) => appendLog(job, `[uyarı] ${w.message}`, onLog));
        return;
      }
      const summary = blocking.map((e) => e.message).join('; ');
      throw new Error(
        `Migration validation ${maxMigrationRounds} tur sonunda başarısız: ${summary}`
      );
    }

    appendLog(
      job,
      `${roundLabel} tamamlanmadı — sonraki turda analyze + copilot devam edecek.`,
      onLog
    );
  }
}

async function ensureMigrationChanges(
  job: JobRecord,
  onLog?: LogCallback,
  options: { round?: number } = {}
): Promise<void> {
  const upgradeNeeded = javaVersionsDiffer(job.sourceJavaVersion, job.targetJavaVersion);

  if (!upgradeNeeded) {
    appendLog(
      job,
      `Proje zaten Java ${job.targetJavaVersion} üzerinde görünüyor; migration atlanabilir.`,
      onLog
    );
    return;
  }

  let hasChanges = await hasWorkingTreeChanges(job.workspacePath);

  if (!hasChanges) {
    appendLog(
      job,
      'UYARI: Copilot dosya değiştirmedi. Otomatik pom.xml güncellemesi deneniyor...',
      onLog
    );
    const applied = applyPomJavaUpgrade(job.workspacePath, job.targetJavaVersion);
    if (applied) {
      appendLog(job, 'pom.xml otomatik güncellendi (yedek mekanizma).', onLog);
      hasChanges = true;
    }
  }

  if (options.round && options.round > 1) {
    appendLog(
      job,
      `UYARI: Tur ${options.round} yeni dosya değişikliği üretmedi — önceki tur değişiklikleri korunuyor.`,
      onLog
    );
    return;
  }

  if (!hasChanges) {
    throw new Error(
      `Migration yapılmadı: kaynak Java ${job.sourceJavaVersion}, hedef Java ${job.targetJavaVersion}. ` +
        'Copilot dosya düzenlemedi. Copilot CLI oturumunu ve --allow-all-tools izinlerini kontrol edin.'
    );
  }
}

export async function runBuildJob(
  input: StartUpgradeInput,
  onLog?: LogCallback,
  onStatus?: StatusCallback
): Promise<JobRecord> {
  await assertHealth(input.targetJavaVersion);

  const jobId = uuidv4();
  const sourceMode: SourceMode = input.sourceMode === 'local' ? 'local' : 'remote';
  const { cloneSource } = resolveCloneSource(input);
  const workspacePath = resolveWorkspacePath(jobId, input, sourceMode, cloneSource);
  const job = createJobRecord(jobId, input, sourceMode, cloneSource, workspacePath);

  jobs.set(jobId, job);
  activeJobId = jobId;
  clearJobCancellation(jobId);
  setStatus(job, 'cloning', onStatus);
  const jobStart = Date.now();

  try {
    return await withJobContext(jobId, async () => {
      await prepareJobWorkspace(job, input, onLog);

      if (!job.sourceJavaVersion) {
        const pom = analyzePom(job.workspacePath);
        job.sourceJavaVersion = pom.javaVersion;
        appendLog(job, `Kaynak Java tespit edildi: ${pom.javaVersion}`, onLog);
      }

      appendLog(job, 'Migration atlanıyor — yalnızca Maven build çalıştırılıyor.', onLog);
      job.skipTests = input.skipTests === true;
      await runMavenBuildWithFixLoop(job, onLog, onStatus);
      await syncJobArtifacts(job);
      setStatus(job, 'completed', onStatus);
      appendLog(job, 'Build tamamlandı.', onLog);
      logElapsed((l) => appendLog(job, l, onLog), 'Fix/Run Build (toplam)', jobStart);
      return job;
    });
  } catch (err) {
    try {
      await syncJobArtifacts(job);
    } catch {
      // ignore
    }
    const failedJob = handleJobFailure(job, err, onLog, onStatus);
    if (err instanceof JobCancelledError) {
      return failedJob;
    }
    throw err;
  } finally {
    if (activeJobId === jobId) {
      activeJobId = null;
    }
  }
}

export async function runStartupAgain(
  jobId: string,
  onLog?: LogCallback,
  onStatus?: StatusCallback
): Promise<JobRecord> {
  const job = jobs.get(jobId);
  if (!job) throw new Error('Job bulunamadı');
  if (!fs.existsSync(job.workspacePath)) throw new Error('Workspace bulunamadı');

  activeJobId = jobId;
  clearJobCancellation(jobId);
  const jobStart = Date.now();

  try {
    return await withJobContext(jobId, async () => {
      appendLog(job, 'Run App — uygulama başlatma testi.', onLog);
      await runStartupWithFixLoop(job, onLog, onStatus);
      await syncJobArtifacts(job);
      setStatus(job, 'completed', onStatus);
      appendLog(job, 'Run App tamamlandı.', onLog);
      logElapsed((l) => appendLog(job, l, onLog), 'Run App (toplam)', jobStart);
      return job;
    });
  } catch (err) {
    try {
      await syncJobArtifacts(job);
    } catch {
      // ignore
    }
    const failedJob = handleJobFailure(job, err, onLog, onStatus);
    if (err instanceof JobCancelledError) {
      return failedJob;
    }
    throw err;
  } finally {
    if (activeJobId === jobId) {
      activeJobId = null;
    }
  }
}

export async function runStartupJob(
  input: StartUpgradeInput,
  onLog?: LogCallback,
  onStatus?: StatusCallback
): Promise<JobRecord> {
  await assertHealth(input.targetJavaVersion);

  const jobId = uuidv4();
  const sourceMode: SourceMode = input.sourceMode === 'local' ? 'local' : 'remote';
  const { cloneSource } = resolveCloneSource(input);
  const workspacePath = resolveWorkspacePath(jobId, input, sourceMode, cloneSource);
  const job = createJobRecord(jobId, input, sourceMode, cloneSource, workspacePath);

  jobs.set(jobId, job);
  activeJobId = jobId;
  clearJobCancellation(jobId);
  setStatus(job, 'cloning', onStatus);
  const jobStart = Date.now();

  try {
    return await withJobContext(jobId, async () => {
      await prepareJobWorkspace(job, input, onLog);

      if (!job.sourceJavaVersion) {
        const pom = analyzePom(job.workspacePath);
        job.sourceJavaVersion = pom.javaVersion;
        appendLog(job, `Kaynak Java tespit edildi: ${pom.javaVersion}`, onLog);
      }

      appendLog(job, 'Migration ve build atlanıyor — yalnızca Run App çalıştırılıyor.', onLog);
      await runStartupWithFixLoop(job, onLog, onStatus);
      await syncJobArtifacts(job);
      setStatus(job, 'completed', onStatus);
      appendLog(job, 'Run App tamamlandı.', onLog);
      logElapsed((l) => appendLog(job, l, onLog), 'Run App (toplam)', jobStart);
      return job;
    });
  } catch (err) {
    try {
      await syncJobArtifacts(job);
    } catch {
      // ignore
    }
    const failedJob = handleJobFailure(job, err, onLog, onStatus);
    if (err instanceof JobCancelledError) {
      return failedJob;
    }
    throw err;
  } finally {
    if (activeJobId === jobId) {
      activeJobId = null;
    }
  }
}

export async function runBuildAgain(
  jobId: string,
  onLog?: LogCallback,
  onStatus?: StatusCallback,
  options: { skipTests?: boolean } = {}
): Promise<JobRecord> {
  const job = jobs.get(jobId);
  if (!job) throw new Error('Job bulunamadı');
  if (!fs.existsSync(job.workspacePath)) throw new Error('Workspace bulunamadı');

  job.skipTests = options.skipTests === true;

  activeJobId = jobId;
  clearJobCancellation(jobId);
  const jobStart = Date.now();

  try {
    return await withJobContext(jobId, async () => {
      await runMavenBuildWithFixLoop(job, onLog, onStatus);
      await syncJobArtifacts(job);
      setStatus(job, 'completed', onStatus);
      appendLog(job, 'Build yeniden tamamlandı.', onLog);
      logElapsed((l) => appendLog(job, l, onLog), 'Fix/Run Build (toplam)', jobStart);
      return job;
    });
  } catch (err) {
    try {
      await syncJobArtifacts(job);
    } catch {
      // ignore
    }
    const failedJob = handleJobFailure(job, err, onLog, onStatus);
    if (err instanceof JobCancelledError) {
      return failedJob;
    }
    throw err;
  } finally {
    if (activeJobId === jobId) {
      activeJobId = null;
    }
  }
}

export function stopJob(
  jobId: string,
  onLog?: LogCallback,
  onStatus?: StatusCallback
): JobRecord {
  const job = jobs.get(jobId);
  if (!job) throw new Error('Job bulunamadı');
  if (!isRunningStatus(job.status)) {
    throw new Error('Durdurulacak aktif bir işlem yok.');
  }

  cancelJob(jobId);
  appendLog(job, 'Durdurma isteği alındı — çalışan süreçler sonlandırılıyor...', onLog);
  onStatus?.(job.status);
  return job;
}

export async function pushUpgradeBranch(
  jobId: string,
  onLog?: LogCallback,
  onStatus?: StatusCallback
): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) throw new Error('Job bulunamadı');
  if (!job.upgradeBranch) throw new Error('Upgrade branch tanımlı değil');

  setStatus(job, 'pushing', onStatus);
  appendLog(job, `Push başlatılıyor: ${job.upgradeBranch}`, onLog);

  const commitMessage = `chore(java): upgrade to Java ${job.targetJavaVersion}`;

  try {
    await timedStep(
      (l) => appendLog(job, l, onLog),
      'Push branch',
      () =>
        commitAndPushBranch(
          job.workspacePath,
          job.upgradeBranch,
          commitMessage,
          (line) => appendLog(job, line, onLog)
        )
    );
    await syncJobArtifacts(job);
    setStatus(job, 'completed', onStatus);
    appendLog(job, 'Commit ve push başarılı.', onLog);
  } catch (err) {
    job.error = err instanceof Error ? err.message : String(err);
    setStatus(job, 'failed', onStatus);
    appendLog(job, `HATA: ${job.error}`, onLog);
    throw err;
  }
}

export async function rollbackUpgrade(
  jobId: string,
  onLog?: LogCallback,
  onStatus?: StatusCallback
): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) throw new Error('Job bulunamadı');
  if (!fs.existsSync(job.workspacePath)) throw new Error('Workspace bulunamadı');

  setStatus(job, 'rolling-back', onStatus);
  appendLog(job, 'Rollback başlatılıyor...', onLog);

  try {
    await timedStep(
      (l) => appendLog(job, l, onLog),
      'Rollback',
      () =>
        rollbackWorkspace(
          job.workspacePath,
          job.sourceBranch,
          job.upgradeBranch,
          (line) => appendLog(job, line, onLog)
        )
    );

    job.upgradeBranch = '';
    job.report = '';
    job.diff = '';
    job.error = '';
    setStatus(job, 'idle', onStatus);
    appendLog(
      job,
      `Tüm migration değişiklikleri silindi. Aktif branch: ${job.sourceBranch}`,
      onLog
    );
  } catch (err) {
    job.error = err instanceof Error ? err.message : String(err);
    setStatus(job, 'failed', onStatus);
    appendLog(job, `HATA: ${job.error}`, onLog);
    throw err;
  }
}

export async function getArtifacts(jobId: string): Promise<{
  report: string;
  diff: string;
  status: JobStatus;
  upgradeBranch: string;
  logs: string[];
} | null> {
  const job = jobs.get(jobId);
  if (!job) return null;

  try {
    await syncJobArtifacts(job);
  } catch {
    // önbellekteki değerlerle devam et
  }

  return {
    report: job.report,
    diff: job.diff,
    status: job.status,
    upgradeBranch: job.upgradeBranch,
    logs: job.logs,
  };
}
