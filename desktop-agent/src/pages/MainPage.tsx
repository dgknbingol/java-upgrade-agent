import { useEffect, useState } from 'react';
import type { SourceMode } from '../types/job';
import vodafoneLogo from '../assets/vodafone-logo.png';
import { ActionButtons } from '../components/ActionButtons';
import { CopilotModelSection } from '../components/CopilotModelSection';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { HealthCheck } from '../components/HealthCheck';
import { OutputTabs } from '../components/OutputTabs';
import { BranchSection } from '../components/BranchSection';
import { PipelineSettingsSection } from '../components/PipelineSettingsSection';
import { LocalPropertiesSection } from '../components/LocalPropertiesSection';
import { MendFortifySection } from '../components/MendFortifySection';
import type { PipelineSettingsInput } from '../types/electron';
import { RepositoryForm } from '../components/RepositoryForm';
import { WorkspaceSection } from '../components/WorkspaceSection';
import { useAppConfig } from '../hooks/useAppConfig';
import { useHealth } from '../hooks/useHealth';
import { useJob, type JobRunInput } from '../hooks/useJob';
import { DEFAULT_TARGET_JAVA } from '../constants/javaVersions';

function isJobRunningLike(status: string): boolean {
  return [
    'cloning',
    'running-copilot',
    'building',
    'smoke-running',
    'pushing',
    'rolling-back',
  ].includes(status);
}

export function MainPage() {
  const { config: appConfig, savePipelineSettings, saveCopilotModel, saveJiraSettings } =
    useAppConfig();
  const {
    logs,
    status,
    jobId,
    upgradeBranch,
    report,
    diff,
    mendFindings,
    fortifyFindings,
    error: jobError,
    loading: jobLoading,
    analyze,
    startSecurityFix,
    startUpgrade,
    stopJob,
    runBuild,
    runApp,
    pushBranch,
    rollback,
  } = useJob();

  const [sourceMode, setSourceMode] = useState<SourceMode>('remote');
  const [repoUrl, setRepoUrl] = useState('');
  const [localRepoPath, setLocalRepoPath] = useState('');
  const [sourceBranch, setSourceBranch] = useState('main');
  const [targetJavaVersion, setTargetJavaVersion] = useState(DEFAULT_TARGET_JAVA);
  const { tools, loading: healthLoading, error: healthError, allReady, refresh } =
    useHealth(targetJavaVersion);
  const [skipTests, setSkipTests] = useState(false);
  const [useNewBranch, setUseNewBranch] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState<{
    displayVersion: string;
    mavenVersion: string;
    springBootVersion: string;
    javaVersion: string;
  } | null>(null);
  const [sourceJavaVersion, setSourceJavaVersion] = useState('');
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [workBranchName, setWorkBranchName] = useState('');
  const [useLocalPropertiesOverride, setUseLocalPropertiesOverride] = useState(false);
  const [localPropertiesFilePath, setLocalPropertiesFilePath] = useState('');
  const [includeMend, setIncludeMend] = useState(false);
  const [includeFortify, setIncludeFortify] = useState(false);
  const [jiraBaseUrl, setJiraBaseUrl] = useState('https://itjira.vodafone.local');
  const [jiraToken, setJiraToken] = useState('');
  const [pipelineSettings, setPipelineSettings] = useState<PipelineSettingsInput>({
    maxMigrationRounds: 3,
    maxBuildFixAttempts: 2,
    mavenBuildLogTailChars: 6000,
    smokeRunEnabled: true,
    smokeRunTimeoutSeconds: 120,
    smokeRunProfile: '',
    maxSmokeFixAttempts: 2,
    startupRunMode: 'jar',
    startupPostSuccessSeconds: 15,
  });
  const [copilotModel, setCopilotModel] = useState('auto');
  const [outputExpanded, setOutputExpanded] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<'push' | 'rollback' | null>(null);

  useEffect(() => {
    setPipelineSettings({
      maxMigrationRounds: appConfig.maxMigrationRounds,
      maxBuildFixAttempts: appConfig.maxBuildFixAttempts,
      mavenBuildLogTailChars: appConfig.mavenBuildLogTailChars,
      smokeRunEnabled: appConfig.smokeRunEnabled,
      smokeRunTimeoutSeconds: appConfig.smokeRunTimeoutSeconds,
      smokeRunProfile: appConfig.smokeRunProfile,
      maxSmokeFixAttempts: appConfig.maxSmokeFixAttempts,
      startupRunMode: appConfig.startupRunMode,
      startupPostSuccessSeconds: appConfig.startupPostSuccessSeconds,
    });
  }, [
    appConfig.maxMigrationRounds,
    appConfig.maxBuildFixAttempts,
    appConfig.mavenBuildLogTailChars,
    appConfig.smokeRunEnabled,
    appConfig.smokeRunTimeoutSeconds,
    appConfig.smokeRunProfile,
    appConfig.maxSmokeFixAttempts,
    appConfig.startupRunMode,
    appConfig.startupPostSuccessSeconds,
  ]);

  useEffect(() => {
    if (appConfig.copilotModel) {
      setCopilotModel(appConfig.copilotModel);
    }
  }, [appConfig.copilotModel]);

  useEffect(() => {
    if (appConfig.jiraBaseUrl) {
      setJiraBaseUrl(appConfig.jiraBaseUrl);
    }
    setJiraToken(appConfig.jiraToken || '');
  }, [appConfig.jiraBaseUrl, appConfig.jiraToken]);

  useEffect(() => {
    setAnalyzed(false);
    setAnalyzeResult(null);
    setSourceJavaVersion('');
  }, [sourceMode, repoUrl, localRepoPath, sourceBranch]);

  const loading = healthLoading || jobLoading;
  const hasSource =
    sourceMode === 'remote' ? Boolean(repoUrl.trim()) : Boolean(localRepoPath.trim());
  const canAnalyze = Boolean(hasSource && sourceBranch.trim() && allReady);
  const canStart = canAnalyze && analyzed;
  const isJobRunning = isJobRunningLike(status);
  const hasSecurityScope = includeMend || includeFortify;
  const canSecurityFix = Boolean(
    canAnalyze && hasSecurityScope && jiraToken.trim() && !isJobRunning
  );
  const jobActionable = ['completed', 'failed', 'cancelled', 'idle'].includes(status);
  const canStop = Boolean(isJobRunning && (jobId || jobLoading));
  const canBuild = Boolean((canStart || (jobId && jobActionable)) && !isJobRunning);
  const canRunApp = Boolean(
    pipelineSettings.smokeRunEnabled && (canStart || (jobId && jobActionable)) && !isJobRunning
  );
  const canPush = Boolean(jobId && upgradeBranch && jobActionable);
  const canRollback = Boolean(jobId && upgradeBranch && jobActionable);

  async function handleAnalyze() {
    setAnalyzed(false);
    setAnalyzeResult(null);
    try {
      const result = await analyze({
        sourceMode,
        repoUrl: repoUrl.trim() || undefined,
        localRepoPath: localRepoPath.trim() || undefined,
        sourceBranch: sourceBranch.trim(),
        workspaceRoot: workspaceRoot.trim() || undefined,
        targetJavaVersion: targetJavaVersion.trim(),
        includeMend,
        includeFortify,
        jiraBaseUrl: jiraBaseUrl.trim() || undefined,
        jiraToken: jiraToken.trim() || undefined,
      });
      setAnalyzeResult({
        displayVersion: result.displayVersion,
        mavenVersion: result.mavenVersion,
        springBootVersion: result.springBootVersion,
        javaVersion: result.javaVersion,
      });
      setSourceJavaVersion(result.javaVersion);
      setAnalyzed(true);
    } catch {
      setAnalyzed(false);
    }
  }

  function buildJobInput(): JobRunInput {
    return {
      sourceMode,
      repoUrl: repoUrl.trim() || undefined,
      localRepoPath: localRepoPath.trim() || undefined,
      sourceBranch: sourceBranch.trim(),
      targetJavaVersion: targetJavaVersion.trim(),
      sourceJavaVersion,
      workspaceRoot: workspaceRoot.trim() || undefined,
      useNewBranch,
      workBranchName: useNewBranch ? workBranchName.trim() || undefined : undefined,
      maxMigrationRounds: pipelineSettings.maxMigrationRounds,
      maxBuildFixAttempts: pipelineSettings.maxBuildFixAttempts,
      mavenBuildLogTailChars: pipelineSettings.mavenBuildLogTailChars,
      smokeRunEnabled: pipelineSettings.smokeRunEnabled,
      smokeRunTimeoutSeconds: pipelineSettings.smokeRunTimeoutSeconds,
      smokeRunProfile: pipelineSettings.smokeRunProfile,
      maxSmokeFixAttempts: pipelineSettings.maxSmokeFixAttempts,
      startupRunMode: pipelineSettings.startupRunMode,
      startupPostSuccessSeconds: pipelineSettings.startupPostSuccessSeconds,
      copilotModel: copilotModel.trim() || 'auto',
      useLocalPropertiesOverride,
      localPropertiesFilePath: useLocalPropertiesOverride
        ? localPropertiesFilePath.trim() || undefined
        : undefined,
      includeMend,
      includeFortify,
      jiraBaseUrl: jiraBaseUrl.trim() || undefined,
      jiraToken: jiraToken.trim() || undefined,
    };
  }

  function buildRunInput(): JobRunInput {
    return {
      ...buildJobInput(),
      skipTests,
    };
  }

  async function handleSecurityFix() {
    try {
      await startSecurityFix(buildJobInput());
    } catch {
      // error state handled in hook
    }
  }

  async function handleStart() {
    try {
      await startUpgrade(buildJobInput());
    } catch {
      // error state handled in hook
    }
  }

  async function handleRunBuild() {
    try {
      if (canStart) {
        await runBuild(buildRunInput());
        return;
      }
      if (jobId && jobActionable) {
        await runBuild({ skipTests });
      }
    } catch {
      // error state handled in hook
    }
  }

  async function handleRunApp() {
    try {
      if (canStart) {
        await runApp(buildJobInput());
        return;
      }
      if (jobId && jobActionable) {
        await runApp();
      }
    } catch {
      // error state handled in hook
    }
  }

  async function handleConfirmAction() {
    const action = pendingConfirm;
    setPendingConfirm(null);
    if (action === 'push') {
      await pushBranch();
    } else if (action === 'rollback') {
      await rollback();
    }
  }

  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand">
            <div className="logo-box">
              <img src={vodafoneLogo} alt="Vodafone" className="brand-logo" />
            </div>
            <h1>Paytion Java Upgrade Desktop Agent</h1>
          </div>
        </div>
      </header>

      <div className={`main-body${outputExpanded ? ' main-body--output-expanded' : ''}`}>
        <div className="content-grid">
          <div className="left-column">
            <HealthCheck
              tools={tools}
              loading={healthLoading}
              error={healthError}
              targetJavaVersion={targetJavaVersion}
              onRefresh={refresh}
            />

            <RepositoryForm
              sourceMode={sourceMode}
              repoUrl={repoUrl}
              localRepoPath={localRepoPath}
              sourceBranch={sourceBranch}
              targetJavaVersion={targetJavaVersion}
              onSourceModeChange={setSourceMode}
              onRepoUrlChange={setRepoUrl}
              onLocalRepoPathChange={setLocalRepoPath}
              onSourceBranchChange={setSourceBranch}
              onTargetJavaVersionChange={setTargetJavaVersion}
              skipTests={skipTests}
              onSkipTestsChange={setSkipTests}
              analyzedVersion={analyzeResult?.displayVersion}
              analyzedMaven={analyzeResult?.mavenVersion}
              analyzedSpringBoot={
                analyzeResult?.springBootVersion !== 'unknown'
                  ? analyzeResult?.springBootVersion
                  : undefined
              }
            />

            {sourceMode === 'remote' && (
              <WorkspaceSection
                workspaceRoot={workspaceRoot}
                onWorkspaceRootChange={setWorkspaceRoot}
                remoteMode
              />
            )}

            <BranchSection
              useNewBranch={useNewBranch}
              workBranchName={workBranchName}
              targetJavaVersion={targetJavaVersion}
              defaultBranchPattern={appConfig.upgradeBranchPattern}
              onUseNewBranchChange={setUseNewBranch}
              onWorkBranchNameChange={setWorkBranchName}
            />

            <MendFortifySection
              includeMend={includeMend}
              includeFortify={includeFortify}
              jiraBaseUrl={jiraBaseUrl}
              jiraToken={jiraToken}
              disabled={isJobRunning}
              onIncludeMendChange={setIncludeMend}
              onIncludeFortifyChange={setIncludeFortify}
              onJiraBaseUrlChange={setJiraBaseUrl}
              onJiraTokenChange={setJiraToken}
              onSave={saveJiraSettings}
            />

            <LocalPropertiesSection
              useLocalPropertiesOverride={useLocalPropertiesOverride}
              localPropertiesFilePath={localPropertiesFilePath}
              disabled={isJobRunning}
              onUseLocalPropertiesOverrideChange={setUseLocalPropertiesOverride}
              onLocalPropertiesFilePathChange={setLocalPropertiesFilePath}
            />

            <PipelineSettingsSection
              settings={pipelineSettings}
              disabled={isJobRunning}
              onChange={setPipelineSettings}
              onSave={savePipelineSettings}
            />

            <CopilotModelSection
              model={copilotModel}
              disabled={isJobRunning}
              onModelChange={setCopilotModel}
              onSave={async (model) => {
                const saved = await saveCopilotModel(model);
                void refresh();
                return saved;
              }}
            />

            <ActionButtons
              loading={loading}
              canAnalyze={canAnalyze}
              canSecurityFix={canSecurityFix}
              canStart={canStart}
              canStop={canStop}
              canBuild={canBuild}
              canRunApp={canRunApp}
              canPush={canPush}
              canRollback={canRollback}
              onAnalyze={handleAnalyze}
              onSecurityFix={handleSecurityFix}
              onStart={handleStart}
              onStop={stopJob}
              onRunBuild={handleRunBuild}
              onRunApp={handleRunApp}
              onPush={() => setPendingConfirm('push')}
              onRollback={() => setPendingConfirm('rollback')}
            />

            <ConfirmDialog
              open={pendingConfirm === 'push'}
              title="Push Branch"
              message={`${upgradeBranch || 'Upgrade'} branch'indeki değişiklikler commit edilip origin'e push edilecek. Devam etmek istiyor musunuz?`}
              onConfirm={handleConfirmAction}
              onCancel={() => setPendingConfirm(null)}
            />

            <ConfirmDialog
              open={pendingConfirm === 'rollback'}
              title="Rollback"
              message="Tüm migration değişiklikleri silinecek ve kaynak branch'e dönülecek. Bu işlem geri alınamaz. Rollback yapmak istediğinize emin misiniz?"
              confirmLabel="Evet, rollback yap"
              onConfirm={handleConfirmAction}
              onCancel={() => setPendingConfirm(null)}
            />

            {(jobError || (!allReady && !healthLoading)) && (
              <p className="error-msg">
                {jobError ||
                  'Tüm araçlar hazır değil. Git, Java, Maven, GitHub CLI ve gh copilot kurulu olmalı.'}
              </p>
            )}
          </div>

          <div className="right-column">
            <OutputTabs
              report={report}
              diff={diff}
              logs={logs}
              mendFindings={mendFindings}
              fortifyFindings={fortifyFindings}
              status={status}
              upgradeBranch={upgradeBranch}
              onExpandChange={setOutputExpanded}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
