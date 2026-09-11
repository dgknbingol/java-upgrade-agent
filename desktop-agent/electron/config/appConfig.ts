import { loadAllProperties, resolveUserLocalConfigPath, type ConfigLoadResult } from './configLoader';
import { parseProperties } from './propertiesParser';
import fs from 'fs';
import path from 'path';

export type StartupRunMode = 'auto' | 'jar' | 'maven';

export interface PipelineSettings {
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

export interface AppConfig extends PipelineSettings {
  upgradeBranchPattern: string;
  copilotCommand: string;
  copilotIdleHeartbeatSeconds: number;
  copilotModel: string;
  configSources: string[];
  renderTemplate(template: string, variables: Record<string, string>): string;
}

let cachedConfig: AppConfig | null = null;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function normalizePipelineSettings(
  input: Partial<PipelineSettings> = {}
): PipelineSettings {
  const defaults = cachedConfig ?? buildConfig(loadAllProperties());
  return {
    maxMigrationRounds: clampInt(
      input.maxMigrationRounds ?? defaults.maxMigrationRounds,
      1,
      10
    ),
    maxBuildFixAttempts: clampInt(
      input.maxBuildFixAttempts ?? defaults.maxBuildFixAttempts,
      1,
      10
    ),
    mavenBuildLogTailChars: clampInt(
      input.mavenBuildLogTailChars ?? defaults.mavenBuildLogTailChars,
      1000,
      30000
    ),
    smokeRunEnabled: input.smokeRunEnabled ?? defaults.smokeRunEnabled,
    smokeRunTimeoutSeconds: clampInt(
      input.smokeRunTimeoutSeconds ?? defaults.smokeRunTimeoutSeconds,
      30,
      600
    ),
    smokeRunProfile: (input.smokeRunProfile ?? defaults.smokeRunProfile).trim(),
    maxSmokeFixAttempts: clampInt(
      input.maxSmokeFixAttempts ?? defaults.maxSmokeFixAttempts,
      1,
      5
    ),
    startupRunMode: normalizeStartupRunMode(
      input.startupRunMode ?? defaults.startupRunMode
    ),
    startupPostSuccessSeconds: clampInt(
      input.startupPostSuccessSeconds ?? defaults.startupPostSuccessSeconds,
      0,
      120
    ),
  };
}

function normalizeStartupRunMode(value: string): StartupRunMode {
  const v = value.trim().toLowerCase();
  if (v === 'jar' || v === 'maven') return v;
  return 'auto';
}
function getString(
  properties: Record<string, string>,
  key: string,
  fallback: string
): string {
  const value = properties[key];
  return value !== undefined && value.trim() !== '' ? value.trim() : fallback;
}

function getBool(
  properties: Record<string, string>,
  key: string,
  fallback: boolean
): boolean {
  const raw = properties[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const v = raw.trim().toLowerCase();
  if (['true', 'yes', '1', 'on'].includes(v)) return true;
  if (['false', 'no', '0', 'off'].includes(v)) return false;
  return fallback;
}

function getInt(
  properties: Record<string, string>,
  key: string,
  fallback: number
): number {
  const raw = properties[key];
  if (!raw?.trim()) {
    return fallback;
  }

  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildConfig(loadResult: ConfigLoadResult): AppConfig {
  const { properties, sources } = loadResult;

  const renderTemplate = (template: string, variables: Record<string, string>) => {
    let result = template;
    for (const [name, value] of Object.entries(variables)) {
      result = result.split(`{${name}}`).join(value);
    }
    return result;
  };

  return {
    maxBuildFixAttempts: getInt(properties, 'job.max-build-fix-attempts', 2),
    maxMigrationRounds: getInt(properties, 'job.max-migration-rounds', 3),
    mavenBuildLogTailChars: getInt(properties, 'job.maven-build-log-tail-chars', 6000),
    smokeRunEnabled: getBool(properties, 'job.smoke-run-enabled', true),
    smokeRunTimeoutSeconds: getInt(properties, 'job.smoke-run-timeout-seconds', 120),
    smokeRunProfile: getString(properties, 'job.smoke-run-profile', ''),
    maxSmokeFixAttempts: getInt(properties, 'job.max-smoke-fix-attempts', 2),
    startupRunMode: normalizeStartupRunMode(
      getString(properties, 'job.startup-run-mode', 'jar')
    ),
    startupPostSuccessSeconds: getInt(properties, 'job.startup-post-success-seconds', 15),
    upgradeBranchPattern: getString(
      properties,
      'job.upgrade-branch-pattern',
      'feature/java-{version}-upgrade'
    ),
    copilotCommand: getString(properties, 'copilot.command', 'copilot'),
    copilotIdleHeartbeatSeconds: getInt(properties, 'copilot.idle-heartbeat-seconds', 20),
    copilotModel: getString(properties, 'copilot.model', 'auto'),
    configSources: sources,
    renderTemplate,
  };
}

export function initAppConfig(): AppConfig {
  const loadResult = loadAllProperties();
  cachedConfig = buildConfig(loadResult);
  return cachedConfig;
}

export function getAppConfig(): AppConfig {
  if (!cachedConfig) {
    cachedConfig = buildConfig(loadAllProperties());
  }
  return cachedConfig;
}

export function getPublicAppConfig(): PipelineSettings & {
  upgradeBranchPattern: string;
  copilotModel: string;
} {
  const config = getAppConfig();
  return {
    maxBuildFixAttempts: config.maxBuildFixAttempts,
    maxMigrationRounds: config.maxMigrationRounds,
    mavenBuildLogTailChars: config.mavenBuildLogTailChars,
    smokeRunEnabled: config.smokeRunEnabled,
    smokeRunTimeoutSeconds: config.smokeRunTimeoutSeconds,
    smokeRunProfile: config.smokeRunProfile,
    maxSmokeFixAttempts: config.maxSmokeFixAttempts,
    startupRunMode: config.startupRunMode,
    startupPostSuccessSeconds: config.startupPostSuccessSeconds,
    upgradeBranchPattern: config.upgradeBranchPattern,
    copilotModel: config.copilotModel,
  };
}

function readUserLocalProperties(): Record<string, string> {
  const userPath = resolveUserLocalConfigPath();
  if (!fs.existsSync(userPath)) return {};
  return parseProperties(fs.readFileSync(userPath, 'utf-8'));
}

function persistUserLocalConfig(updates: Record<string, string>): void {
  const config = getAppConfig();
  const merged = { ...readUserLocalProperties(), ...updates };
  const userPath = resolveUserLocalConfigPath();

  const content = [
    '# Paytion Java Upgrade — kullanıcı ayarları (Desktop Agent)',
    `job.max-migration-rounds=${merged['job.max-migration-rounds'] ?? String(config.maxMigrationRounds)}`,
    `job.max-build-fix-attempts=${merged['job.max-build-fix-attempts'] ?? String(config.maxBuildFixAttempts)}`,
    `job.maven-build-log-tail-chars=${merged['job.maven-build-log-tail-chars'] ?? String(config.mavenBuildLogTailChars)}`,
    `job.smoke-run-enabled=${merged['job.smoke-run-enabled'] ?? String(config.smokeRunEnabled)}`,
    `job.smoke-run-timeout-seconds=${merged['job.smoke-run-timeout-seconds'] ?? String(config.smokeRunTimeoutSeconds)}`,
    `job.smoke-run-profile=${merged['job.smoke-run-profile'] ?? config.smokeRunProfile}`,
    `job.max-smoke-fix-attempts=${merged['job.max-smoke-fix-attempts'] ?? String(config.maxSmokeFixAttempts)}`,
    `job.startup-run-mode=${merged['job.startup-run-mode'] ?? config.startupRunMode}`,
    `job.startup-post-success-seconds=${merged['job.startup-post-success-seconds'] ?? String(config.startupPostSuccessSeconds)}`,
    `copilot.model=${merged['copilot.model'] ?? config.copilotModel ?? 'auto'}`,
    '',
  ].join('\n');

  fs.mkdirSync(path.dirname(userPath), { recursive: true });
  fs.writeFileSync(userPath, content, 'utf-8');
  cachedConfig = buildConfig(loadAllProperties());
}

export function saveCopilotModel(model: string): string {
  const normalized = model.trim() || 'auto';
  persistUserLocalConfig({ 'copilot.model': normalized });
  return getAppConfig().copilotModel;
}

export function savePipelineSettings(input: Partial<PipelineSettings>): PipelineSettings {
  const normalized = normalizePipelineSettings(input);
  persistUserLocalConfig({
    'job.max-migration-rounds': String(normalized.maxMigrationRounds),
    'job.max-build-fix-attempts': String(normalized.maxBuildFixAttempts),
    'job.maven-build-log-tail-chars': String(normalized.mavenBuildLogTailChars),
    'job.smoke-run-enabled': String(normalized.smokeRunEnabled),
    'job.smoke-run-timeout-seconds': String(normalized.smokeRunTimeoutSeconds),
    'job.smoke-run-profile': normalized.smokeRunProfile,
    'job.max-smoke-fix-attempts': String(normalized.maxSmokeFixAttempts),
    'job.startup-run-mode': normalized.startupRunMode,
    'job.startup-post-success-seconds': String(normalized.startupPostSuccessSeconds),
  });
  return normalizePipelineSettings(normalized);
}
