import { CATEGORY_LABELS } from '../services/migrationCatalog';
import {
  MigrationAnalysis,
  formatMigrationAnalysisPromptSummary,
} from '../services/migrationAnalyzer';
import {
  MIGRATION_ANALYSIS_READ_HINT,
  MIGRATION_BUILD_INSTRUCTION,
  MIGRATION_SCOPE_CHECKLIST,
  buildDecisionRules,
  buildReportRequirements,
  buildSpringBoot3FixSection,
  FIX_CONTEXT_HINT,
  buildFixDecisionRules,
} from '../migrationPromptCore';
import { getAppConfig } from '../config/appConfig';
import { extractMavenFailureExcerpt } from '../services/mavenLogExcerpt';
import { MigrationValidationResult, formatValidationReport } from '../services/migrationValidator';
import {
  MIGRATION_FILE_NAMES,
  migrationOutputRelPath,
} from '../services/migrationOutputPaths';

export type MigrationPhaseId =
  | 'build-system'
  | 'dependencies-ecosystem'
  | 'source-code'
  | 'infrastructure';

export const MIGRATION_PHASES: MigrationPhaseId[] = [
  'build-system',
  'dependencies-ecosystem',
  'source-code',
  'infrastructure',
];

const PHASE_TITLES: Record<MigrationPhaseId, string> = {
  'build-system': 'Build system, POM & plugins',
  'dependencies-ecosystem': 'Dependencies, BOM & framework stack',
  'source-code': 'Source, test & config code',
  infrastructure: 'Docker, CI, scripts & docs',
};

function buildAnalysisPromptBlock(analysis: MigrationAnalysis): string {
  return `${MIGRATION_ANALYSIS_READ_HINT}

Quick summary:
${formatMigrationAnalysisPromptSummary(analysis)}`;
}

function phaseInstructions(phase: MigrationPhaseId, target: string): string {
  switch (phase) {
    case 'build-system':
      return `PHASE: Build system, POM & plugins
- Update ALL pom.xml (root + every module): java.version, maven.compiler.release/source/target.
- Parent POMs, dependencyManagement, BOMs, profiles, enforcer RequireJavaVersion for Java ${target}.
- Plugins: compiler, surefire, failsafe, jacoco, spotless/checkstyle/pmd, lombok, mapstruct, protobuf, openapi, jaxb, wsdl.
- Upgrade parent/BOM only when required for Java ${target} — do not bump working stacks unnecessarily.
- Replace only incompatible dependency declarations flagged in analysis.
- Do NOT run mvn commands.`;

    case 'dependencies-ecosystem':
      return `PHASE: Dependencies, BOM & framework stack
- Run FULL dependency ecosystem audit (same rigor as javax→jakarta for every item in the migration matrix).
- For EACH legacy dependency: update pom.xml in ALL modules, then fix imports in main + test + config — no mixed stacks.
- Upgrade libraries that block Java ${target}; keep compatible versions unchanged.
- Spring/Spring Boot/Spring Cloud/Hibernate/JPA/Jackson/Netty/Tomcat/Log4j/SLF4J/Lombok/MapStruct/Mockito/ByteBuddy — align to Boot BOM.
- javax→jakarta artifacts (servlet, persistence, validation, inject, jaxrs, jaxb, mail, jms) when Boot 3+/Java 17+.
- Replace: JUnit4, log4j1, commons-logging, httpclient4, codehaus jackson, springfox, powermock, hibernate5, legacy JDBC drivers.
- Resolve dependency conflicts; remove duplicate legacy + modern artifacts on same classpath.
- Do NOT run mvn commands.`;

    case 'source-code':
      return `PHASE: Source, test & config
- PRIORITY: fix ALL "cannot find symbol" and "package does not exist" errors in src/main AND src/test before other refactors.
- For each compiler error: open the exact file:line, fix import OR add correct pom dependency OR javax→jakarta rename.
- Fix src/main and src/test for Java ${target}: removed/deprecated JDK APIs, reflection, test engines, mocking.
- Migrate JUnit 4 → JUnit 5 and legacy Mockito runners in every test file flagged by analysis.
- Address only relevant signals from ${migrationOutputRelPath(MIGRATION_FILE_NAMES.analysis)} for this phase:
  ${Object.values(CATEGORY_LABELS)
    .map((l) => `  • ${l}`)
    .join('\n')}
- Spring Security/JPA/config property renames only when framework upgrade requires them.
- Never delete tests; never weaken assertions; minimal safe source changes.
- Do NOT run mvn commands.`;

    case 'infrastructure':
      return `PHASE: Docker, CI, scripts & documentation
- Dockerfile, devcontainer, CI workflows, Jenkinsfile: Java ${target}.
- Build scripts, .mvn/, wrapper, README, CONTRIBUTING.
- Complete ${migrationOutputRelPath(MIGRATION_FILE_NAMES.report)} per output requirements.
- Do NOT run mvn commands.`;
  }
}

export function buildPhasePrompt(
  phase: MigrationPhaseId,
  targetJavaVersion: string,
  sourceJavaVersion: string,
  analysis: MigrationAnalysis
): string {
  const boot3Playbook = buildSpringBoot3FixSection(
    analysis.springBootVersion,
    undefined,
    targetJavaVersion
  );

  return `You are a senior Java migration engineer executing a multi-phase upgrade.

Goal: Complete production-grade migration from Java ${sourceJavaVersion} to Java ${targetJavaVersion}.
This is a full repository migration, not a pom-only version bump.
Current phase: ${PHASE_TITLES[phase]}

${buildAnalysisPromptBlock(analysis)}

${MIGRATION_SCOPE_CHECKLIST}

${buildDecisionRules(targetJavaVersion)}
${boot3Playbook}
${phaseInstructions(phase, targetJavaVersion)}

${MIGRATION_BUILD_INSTRUCTION}

${buildReportRequirements(sourceJavaVersion, targetJavaVersion)}

Execute this phase now. Do not ask questions.`;
}

export interface MigrationContinuationContext {
  round: number;
  maxRounds: number;
  validation?: MigrationValidationResult;
  buildLog?: string;
  mavenBuildLogTailChars?: number;
}

export function buildMigrationContinuationPrompt(
  targetJavaVersion: string,
  sourceJavaVersion: string,
  analysis: MigrationAnalysis,
  context: MigrationContinuationContext
): string {
  const validationBlock = context.validation
    ? `\nPrevious validation failures (summary — full ${migrationOutputRelPath(MIGRATION_FILE_NAMES.validation)} on disk):\n${formatValidationReport(context.validation).slice(0, 2500)}\n`
    : '';
  const logTail = context.mavenBuildLogTailChars ?? getAppConfig().mavenBuildLogTailChars;
  const buildBlock = context.buildLog?.trim()
    ? `\nLast Maven failure excerpt:\n---\n${extractMavenFailureExcerpt(context.buildLog, logTail)}\n---\n`
    : '';
  const boot3Playbook = buildSpringBoot3FixSection(
    analysis.springBootVersion,
    context.buildLog,
    targetJavaVersion
  );

  return `You are a senior Java migration engineer continuing an INCOMPLETE migration.

Migration: Java ${sourceJavaVersion} → Java ${targetJavaVersion}
Round ${context.round} of ${context.maxRounds} — previous round did not fully succeed.

${buildAnalysisPromptBlock(analysis)}

${buildDecisionRules(targetJavaVersion)}

${MIGRATION_SCOPE_CHECKLIST}
${boot3Playbook}
Fix remaining issues with the smallest safe change set.
Do not repeat completed work; focus on blockers from validation and/or build failures.
${validationBlock}${buildBlock}

${MIGRATION_BUILD_INSTRUCTION}

${buildReportRequirements(sourceJavaVersion, targetJavaVersion)}

Execute immediately. Do not ask questions.`;
}

export function buildRemediationPrompt(
  targetJavaVersion: string,
  sourceJavaVersion: string,
  validation: MigrationValidationResult,
  analysis: MigrationAnalysis
): string {
  const boot3Playbook = buildSpringBoot3FixSection(
    analysis.springBootVersion,
    undefined,
    targetJavaVersion
  );

  return `You are a senior Java migration engineer fixing an INCOMPLETE migration.

Migration: Java ${sourceJavaVersion} → Java ${targetJavaVersion}
Validation FAILED after migration phases.

${FIX_CONTEXT_HINT}
${boot3Playbook}
${buildDecisionRules(targetJavaVersion)}

${buildFixDecisionRules(targetJavaVersion)}

Validation report (summary):
${formatValidationReport(validation).slice(0, 2500)}

${buildAnalysisPromptBlock(analysis)}

Fix every validation ERROR with the smallest safe change set.
Update ${migrationOutputRelPath(MIGRATION_FILE_NAMES.report)}. Execute immediately.`;
}
