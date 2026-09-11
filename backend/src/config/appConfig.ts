import {
  loadAllProperties,
  readPromptTemplate,
  type ConfigLoadResult,
} from './configLoader';

export interface AppConfig {
  serverPort: number;
  corsOrigin: string;
  maxBuildFixAttempts: number;
  maxMigrationRounds: number;
  mavenBuildLogTailChars: number;
  upgradeBranchPattern: string;
  copilotCommand: string;
  copilotIdleHeartbeatSeconds: number;
  promptSourceLineTemplate: string;
  javaUpgradePromptTemplate: string;
  mavenFixPromptTemplate: string;
  configSources: string[];
  renderTemplate(template: string, variables: Record<string, string>): string;
}

let cachedConfig: AppConfig | null = null;

function getString(
  properties: Record<string, string>,
  key: string,
  fallback: string
): string {
  const value = properties[key];
  return value !== undefined && value.trim() !== '' ? value.trim() : fallback;
}

function requireString(properties: Record<string, string>, key: string): string {
  const value = properties[key]?.trim();
  if (!value) {
    throw new Error(
      `Zorunlu yapılandırma eksik: ${key} (application.properties veya Config Server)`
    );
  }
  return value;
}

function requireInt(properties: Record<string, string>, key: string): number {
  const raw = properties[key]?.trim();
  if (!raw) {
    throw new Error(
      `Zorunlu yapılandırma eksik: ${key} (application.properties veya Config Server)`
    );
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Geçersiz sayısal yapılandırma: ${key}=${raw}`);
  }

  return parsed;
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
    serverPort: requireInt(properties, 'server.port'),
    corsOrigin: requireString(properties, 'server.cors.origin'),
    maxBuildFixAttempts: getInt(properties, 'job.max-build-fix-attempts', 2),
    maxMigrationRounds: getInt(properties, 'job.max-migration-rounds', 3),
    mavenBuildLogTailChars: getInt(properties, 'job.maven-build-log-tail-chars', 6000),
    upgradeBranchPattern: getString(
      properties,
      'job.upgrade-branch-pattern',
      'feature/java-{version}-upgrade'
    ),
    copilotCommand: getString(properties, 'copilot.command', 'copilot'),
    copilotIdleHeartbeatSeconds: getInt(properties, 'copilot.idle-heartbeat-seconds', 20),
    promptSourceLineTemplate: getString(
      properties,
      'prompt.source-line.template',
      '\nDetected current Java version: {sourceJavaVersion}\nYou MUST upgrade from Java {sourceJavaVersion} to Java {targetJavaVersion}.\n'
    ),
    javaUpgradePromptTemplate: readPromptTemplate(
      properties,
      'prompt.java-upgrade',
      'prompt.java-upgrade.file'
    ),
    mavenFixPromptTemplate: readPromptTemplate(
      properties,
      'prompt.maven-fix',
      'prompt.maven-fix.file'
    ),
    configSources: sources,
    renderTemplate,
  };
}

export async function initAppConfig(): Promise<AppConfig> {
  const loadResult = await loadAllProperties();
  cachedConfig = buildConfig(loadResult);
  return cachedConfig;
}

export function getAppConfig(): AppConfig {
  if (!cachedConfig) {
    throw new Error('Uygulama yapılandırması henüz yüklenmedi. initAppConfig() çağrılmalı.');
  }
  return cachedConfig;
}
