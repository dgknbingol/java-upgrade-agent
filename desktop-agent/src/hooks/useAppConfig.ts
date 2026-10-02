import { useCallback, useEffect, useState } from 'react';
import type {
  AppPublicConfig,
  CopilotModelOptions,
  JiraSettingsInput,
  PipelineSettingsInput,
} from '../types/electron';

const DEFAULT_CONFIG: AppPublicConfig = {
  maxBuildFixAttempts: 2,
  maxMigrationRounds: 3,
  mavenBuildLogTailChars: 6000,
  smokeRunEnabled: true,
  smokeRunTimeoutSeconds: 120,
  smokeRunProfile: '',
  maxSmokeFixAttempts: 2,
  startupRunMode: 'jar',
  startupPostSuccessSeconds: 15,
  upgradeBranchPattern: 'feature/java-{version}-upgrade',
  copilotModel: 'auto',
  jiraBaseUrl: 'https://itjira.vodafone.local',
  jiraToken: '',
};

export function useAppConfig() {
  const [config, setConfig] = useState<AppPublicConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const loaded = await window.electronAPI.getConfig();
    setConfig(loaded);
    return loaded;
  }, []);

  useEffect(() => {
    let cancelled = false;

    reload()
      .catch(() => {
        if (!cancelled) setConfig(DEFAULT_CONFIG);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reload]);

  const savePipelineSettings = useCallback(async (input: PipelineSettingsInput) => {
    const saved = await window.electronAPI.savePipelineConfig(input);
    setConfig((prev) => ({ ...prev, ...saved }));
    return saved;
  }, []);

  const saveCopilotModel = useCallback(async (model: string) => {
    const saved = await window.electronAPI.saveCopilotModel(model);
    setConfig((prev) => ({ ...prev, copilotModel: saved }));
    return saved;
  }, []);

  const saveJiraSettings = useCallback(async (input: JiraSettingsInput) => {
    const saved = await window.electronAPI.saveJiraConfig(input);
    setConfig((prev) => ({
      ...prev,
      jiraBaseUrl: saved.jiraBaseUrl,
      jiraToken: saved.jiraToken,
    }));
    return saved;
  }, []);

  const listCopilotModels = useCallback(async (): Promise<CopilotModelOptions> => {
    return window.electronAPI.listCopilotModels();
  }, []);

  return {
    config,
    loading,
    reload,
    savePipelineSettings,
    saveCopilotModel,
    saveJiraSettings,
    listCopilotModels,
  };
}
