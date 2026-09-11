import { getAppConfig } from '../config/appConfig';
import {
  buildSpringBoot3FixSection,
} from '../migrationPromptCore';

export interface MavenFixPromptOptions {
  springBootVersion?: string;
}

export function buildJavaUpgradePrompt(
  targetJavaVersion: string,
  sourceJavaVersion?: string
): string {
  const config = getAppConfig();

  const sourceLine = sourceJavaVersion
    ? config.renderTemplate(config.promptSourceLineTemplate, {
        sourceJavaVersion,
        targetJavaVersion,
      })
    : '';

  return config.renderTemplate(config.javaUpgradePromptTemplate, {
    targetJavaVersion,
    sourceJavaVersion: sourceJavaVersion ?? '',
    sourceLine,
  });
}

export function buildMavenFixPrompt(
  targetJavaVersion: string,
  sourceJavaVersion: string,
  buildLog: string,
  options: MavenFixPromptOptions = {}
): string {
  const config = getAppConfig();
  const trimmedLog = buildLog.slice(-config.mavenBuildLogTailChars);
  const boot3Playbook = buildSpringBoot3FixSection(
    options.springBootVersion ?? 'unknown',
    buildLog,
    targetJavaVersion
  );

  const base = config.renderTemplate(config.mavenFixPromptTemplate, {
    targetJavaVersion,
    sourceJavaVersion,
    buildLog: trimmedLog,
  });

  if (!boot3Playbook.trim()) {
    return base;
  }

  return base
    .replace(
      'Read the build log and fix the real root cause.',
      'Read the build log and fix the real root cause.\nIf the log contains "cannot find symbol" or "package does not exist", fix each reported file:line (import, dependency, or javax/jakarta) before other changes.'
    )
    .replace('\nMaven build log tail:', `${boot3Playbook}\nMaven build log tail:`);
}
