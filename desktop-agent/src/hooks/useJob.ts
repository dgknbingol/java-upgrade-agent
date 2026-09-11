import { useCallback, useEffect, useState } from 'react';

import type { AnalyzeResult, JobRecord, SourceMode } from '../types/job';
import type { StartupRunMode } from '../types/electron';



export interface JobRunInput {

  sourceMode: SourceMode;

  repoUrl?: string;

  localRepoPath?: string;

  sourceBranch: string;

  targetJavaVersion: string;

  sourceJavaVersion?: string;

  workspaceRoot?: string;

  useNewBranch?: boolean;

  workBranchName?: string;

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

}



function isJobActionable(status: string): boolean {

  return ['completed', 'failed', 'cancelled', 'idle'].includes(status);

}

const JOB_RUNNING_STATUSES = [
  'cloning',
  'running-copilot',
  'building',
  'smoke-running',
  'pushing',
  'rolling-back',
] as const;

function isJobRunningStatus(status: string): boolean {
  return (JOB_RUNNING_STATUSES as readonly string[]).includes(status);
}



export function useJob() {

  const [logs, setLogs] = useState<string[]>([]);

  const [status, setStatus] = useState<string>('idle');

  const [jobId, setJobId] = useState<string | null>(null);

  const [upgradeBranch, setUpgradeBranch] = useState('');

  const [report, setReport] = useState('');

  const [diff, setDiff] = useState('');

  const [error, setError] = useState('');

  const [loading, setLoading] = useState(false);



  useEffect(() => {

    const unsubLog = window.electronAPI.onJobLog((line) => {

      setLogs((prev) => [...prev, line]);

    });

    const unsubStatus = window.electronAPI.onJobStatus((s) => setStatus(s));

    return () => {

      unsubLog();

      unsubStatus();

    };

  }, []);



  useEffect(() => {

    if (!loading) return;



    let cancelled = false;

    const syncActiveJob = async () => {

      const id = await window.electronAPI.getActiveJobId();

      if (!cancelled && id) {

        setJobId(id);

      }

    };



    void syncActiveJob();

    const interval = setInterval(() => {

      void syncActiveJob();

    }, 400);



    return () => {

      cancelled = true;

      clearInterval(interval);

    };

  }, [loading]);



  useEffect(() => {

    if (!jobId || !isJobRunningStatus(status)) return;



    let cancelled = false;



    const pollLiveArtifacts = async () => {

      try {

        const [liveReport, liveDiff] = await Promise.all([
          window.electronAPI.getLiveReport(jobId),
          window.electronAPI.getLiveDiff(jobId),
        ]);

        if (cancelled) return;

        if (liveReport) {
          setReport(liveReport);
        }

        if (liveDiff) {
          setDiff(liveDiff);
        }

      } catch {

        // ignore poll errors

      }

    };



    void pollLiveArtifacts();

    const interval = setInterval(() => {

      void pollLiveArtifacts();

    }, 1500);



    return () => {

      cancelled = true;

      clearInterval(interval);

    };

  }, [jobId, status]);



  useEffect(() => {

    if (!jobId || !isJobActionable(status)) return;



    let cancelled = false;



    const loadFinalArtifacts = async () => {

      try {

        const [liveReport, liveDiff] = await Promise.all([
          window.electronAPI.getLiveReport(jobId),
          window.electronAPI.getLiveDiff(jobId),
        ]);

        if (cancelled) return;

        if (liveReport) {
          setReport(liveReport);
        } else {
          const artifacts = await window.electronAPI.getArtifacts(jobId);
          if (!cancelled && artifacts?.report) {
            setReport(artifacts.report);
          }
        }

        if (liveDiff) {
          setDiff(liveDiff);
        } else {
          const artifacts = await window.electronAPI.getArtifacts(jobId);
          if (!cancelled) {
            setDiff(
              artifacts?.diff?.trim()
                ? artifacts.diff
                : 'Kaynak branch ile karşılaştırıldığında dosya değişikliği yok.'
            );
          }
        }

      } catch {

        // ignore

      }

    };



    void loadFinalArtifacts();



    return () => {

      cancelled = true;

    };

  }, [jobId, status]);



  const refreshArtifacts = useCallback(async (id: string) => {

    const artifacts = await window.electronAPI.getArtifacts(id);

    if (!artifacts) return;

    if (artifacts.report) {

      setReport(artifacts.report);

    }

    setDiff(

      artifacts.diff.trim()

        ? artifacts.diff

        : 'Kaynak branch ile karşılaştırıldığında dosya değişikliği yok.'

    );

    setUpgradeBranch(artifacts.upgradeBranch);

    setStatus(artifacts.status);

    setLogs(artifacts.logs);

  }, []);



  const analyze = useCallback(

    async (input: {

      sourceMode: SourceMode;

      repoUrl?: string;

      localRepoPath?: string;

      sourceBranch: string;
      workspaceRoot?: string;
      targetJavaVersion?: string;
    }): Promise<AnalyzeResult> => {

      setError('');

      setLoading(true);

      setLogs([]);

      try {

        return await window.electronAPI.analyze({

          sourceMode: input.sourceMode,

          repoUrl: input.repoUrl?.trim() || undefined,

          localRepoPath: input.localRepoPath?.trim() || undefined,

          sourceBranch: input.sourceBranch,
          workspaceRoot: input.workspaceRoot?.trim() || undefined,
          targetJavaVersion: input.targetJavaVersion?.trim() || undefined,
        });

      } catch (err) {

        const msg = err instanceof Error ? err.message : 'Analiz başarısız';

        setError(msg);

        throw err;

      } finally {

        setLoading(false);

      }

    },

    []

  );



  const startUpgrade = useCallback(

    async (input: JobRunInput): Promise<JobRecord> => {

      setError('');

      setLoading(true);

      setLogs([]);

      setReport('');

      setDiff('');

      setStatus('cloning');



      try {

        const job = await window.electronAPI.startUpgrade({

          sourceMode: input.sourceMode,

          repoUrl: input.repoUrl?.trim() || undefined,

          localRepoPath: input.localRepoPath?.trim() || undefined,

          sourceBranch: input.sourceBranch,

          targetJavaVersion: input.targetJavaVersion,

          sourceJavaVersion: input.sourceJavaVersion,

          workspaceRoot: input.workspaceRoot?.trim() || undefined,

          useNewBranch: input.useNewBranch,

          workBranchName: input.workBranchName?.trim() || undefined,

          maxMigrationRounds: input.maxMigrationRounds,

          maxBuildFixAttempts: input.maxBuildFixAttempts,

          mavenBuildLogTailChars: input.mavenBuildLogTailChars,

          smokeRunEnabled: input.smokeRunEnabled,

          smokeRunTimeoutSeconds: input.smokeRunTimeoutSeconds,

          smokeRunProfile: input.smokeRunProfile,

          maxSmokeFixAttempts: input.maxSmokeFixAttempts,

          startupRunMode: input.startupRunMode,

          startupPostSuccessSeconds: input.startupPostSuccessSeconds,

          useLocalPropertiesOverride: input.useLocalPropertiesOverride,

          localPropertiesFilePath: input.localPropertiesFilePath?.trim() || undefined,

          copilotModel: input.copilotModel?.trim() || undefined,

        });

        setJobId(job.id);

        setUpgradeBranch(job.upgradeBranch);

        if (job.report) {

          setReport(job.report);

        }

        setDiff(

          job.diff.trim()

            ? job.diff

            : 'Kaynak branch ile karşılaştırıldığında dosya değişikliği yok.'

        );

        setStatus(job.status);

        return job;

      } catch (err) {

        const msg = err instanceof Error ? err.message : 'Upgrade başarısız';

        setError(msg);

        const activeId = await window.electronAPI.getActiveJobId();

        if (activeId) {

          setJobId(activeId);

          await refreshArtifacts(activeId);

        }

        throw err;

      } finally {

        setLoading(false);

      }

    },

    [refreshArtifacts]

  );



  const runBuild = useCallback(

    async (input?: JobRunInput) => {

      setError('');

      setLoading(true);



      try {

        if (jobId && isJobActionable(status)) {

          const job = await window.electronAPI.runBuild(jobId, {
            skipTests: input?.skipTests === true,
          });

          if (job.report) {

            setReport(job.report);

          }

          setDiff(job.diff);

          setStatus(job.status);

          return;

        }



        if (!input) {

          setError('Build için önce analiz yapın veya geçerli bir job seçin.');

          return;

        }



        setLogs([]);

        setReport('');

        setDiff('');

        setStatus('cloning');



        const job = await window.electronAPI.runBuildJob({

          sourceMode: input.sourceMode,

          repoUrl: input.repoUrl?.trim() || undefined,

          localRepoPath: input.localRepoPath?.trim() || undefined,

          sourceBranch: input.sourceBranch,

          targetJavaVersion: input.targetJavaVersion,

          sourceJavaVersion: input.sourceJavaVersion,

          workspaceRoot: input.workspaceRoot?.trim() || undefined,

          useNewBranch: input.useNewBranch,

          workBranchName: input.workBranchName?.trim() || undefined,

          maxMigrationRounds: input.maxMigrationRounds,

          maxBuildFixAttempts: input.maxBuildFixAttempts,

          mavenBuildLogTailChars: input.mavenBuildLogTailChars,

          smokeRunEnabled: input.smokeRunEnabled,

          smokeRunTimeoutSeconds: input.smokeRunTimeoutSeconds,

          smokeRunProfile: input.smokeRunProfile,

          maxSmokeFixAttempts: input.maxSmokeFixAttempts,

          startupRunMode: input.startupRunMode,

          startupPostSuccessSeconds: input.startupPostSuccessSeconds,

          useLocalPropertiesOverride: input.useLocalPropertiesOverride,

          localPropertiesFilePath: input.localPropertiesFilePath?.trim() || undefined,

          skipTests: input.skipTests === true,

          copilotModel: input.copilotModel?.trim() || undefined,

        });

        setJobId(job.id);

        setUpgradeBranch(job.upgradeBranch);

        if (job.report) {

          setReport(job.report);

        }

        setDiff(

          job.diff.trim()

            ? job.diff

            : 'Kaynak branch ile karşılaştırıldığında dosya değişikliği yok.'

        );

        setStatus(job.status);

      } catch (err) {

        setError(err instanceof Error ? err.message : 'Build başarısız');

        const activeId = await window.electronAPI.getActiveJobId();

        if (activeId) {

          setJobId(activeId);

          await refreshArtifacts(activeId);

        }

      } finally {

        setLoading(false);

      }

    },

    [jobId, status, refreshArtifacts]

  );



  const runApp = useCallback(

    async (input?: JobRunInput) => {

      setError('');

      setLoading(true);



      try {

        if (jobId && isJobActionable(status)) {

          const job = await window.electronAPI.runStartup(jobId);

          if (job.report) {

            setReport(job.report);

          }

          setDiff(job.diff);

          setStatus(job.status);

          return;

        }



        if (!input) {

          setError('Run App için önce analiz yapın veya geçerli bir job seçin.');

          return;

        }



        setLogs([]);

        setReport('');

        setDiff('');

        setStatus('cloning');



        const job = await window.electronAPI.runStartupJob({

          sourceMode: input.sourceMode,

          repoUrl: input.repoUrl?.trim() || undefined,

          localRepoPath: input.localRepoPath?.trim() || undefined,

          sourceBranch: input.sourceBranch,

          targetJavaVersion: input.targetJavaVersion,

          sourceJavaVersion: input.sourceJavaVersion,

          workspaceRoot: input.workspaceRoot?.trim() || undefined,

          useNewBranch: input.useNewBranch,

          workBranchName: input.workBranchName?.trim() || undefined,

          maxMigrationRounds: input.maxMigrationRounds,

          maxBuildFixAttempts: input.maxBuildFixAttempts,

          mavenBuildLogTailChars: input.mavenBuildLogTailChars,

          smokeRunEnabled: input.smokeRunEnabled,

          smokeRunTimeoutSeconds: input.smokeRunTimeoutSeconds,

          smokeRunProfile: input.smokeRunProfile,

          maxSmokeFixAttempts: input.maxSmokeFixAttempts,

          startupRunMode: input.startupRunMode,

          startupPostSuccessSeconds: input.startupPostSuccessSeconds,

          useLocalPropertiesOverride: input.useLocalPropertiesOverride,

          localPropertiesFilePath: input.localPropertiesFilePath?.trim() || undefined,

          copilotModel: input.copilotModel?.trim() || undefined,

        });

        setJobId(job.id);

        setUpgradeBranch(job.upgradeBranch);

        if (job.report) {

          setReport(job.report);

        }

        setDiff(

          job.diff.trim()

            ? job.diff

            : 'Kaynak branch ile karşılaştırıldığında dosya değişikliği yok.'

        );

        setStatus(job.status);

      } catch (err) {

        setError(err instanceof Error ? err.message : 'Run App başarısız');

        const activeId = await window.electronAPI.getActiveJobId();

        if (activeId) {

          setJobId(activeId);

          await refreshArtifacts(activeId);

        }

      } finally {

        setLoading(false);

      }

    },

    [jobId, status, refreshArtifacts]

  );



  const pushBranch = useCallback(async () => {

    if (!jobId) return;

    setError('');

    setLoading(true);

    try {

      await window.electronAPI.pushBranch(jobId);

      await refreshArtifacts(jobId);

    } catch (err) {

      setError(err instanceof Error ? err.message : 'Push başarısız');

    } finally {

      setLoading(false);

    }

  }, [jobId, refreshArtifacts]);



  const rollback = useCallback(async () => {

    if (!jobId) return;

    setError('');

    setLoading(true);

    try {

      await window.electronAPI.rollback(jobId);

      await refreshArtifacts(jobId);

      setReport('');

      setDiff('Kaynak branch ile karşılaştırıldığında dosya değişikliği yok.');

      setUpgradeBranch('');

    } catch (err) {

      setError(err instanceof Error ? err.message : 'Rollback başarısız');

    } finally {

      setLoading(false);

    }

  }, [jobId, refreshArtifacts]);



  const stopJob = useCallback(async () => {

    const id = jobId || (await window.electronAPI.getActiveJobId());

    if (!id) return;



    setError('');

    try {

      await window.electronAPI.stopJob(id);

      setJobId(id);

    } catch (err) {

      setError(err instanceof Error ? err.message : 'Durdurma başarısız');

    }

  }, [jobId]);



  return {

    logs,

    status,

    jobId,

    upgradeBranch,

    report,

    diff,

    error,

    loading,

    analyze,

    startUpgrade,

    stopJob,

    runBuild,

    runApp,

    pushBranch,

    rollback,

  };

}


