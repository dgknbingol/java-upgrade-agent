import { getAppConfig } from '../config/appConfig';
import { extractMavenFailureExcerpt } from '../services/mavenLogExcerpt';

export interface MavenFixPromptOptions {
  springBootVersion?: string;
  mavenBuildLogTailChars?: number;
  runAppLogRel?: string;
}

function isSpringContextFailure(log: string): boolean {
  return /APPLICATION FAILED TO START|Failed to load ApplicationContext|UnsatisfiedDependencyException|No qualifying bean/i.test(
    log
  );
}

function isCompileFailure(log: string): boolean {
  return /COMPILATION ERROR|cannot find symbol|package .+ does not exist/i.test(log);
}

/**
 * Log-driven hint classifier — generic failure families, not a single project case.
 * Only matching families are injected; unmatched → slim default.
 */
function buildFocusedBuildFixHints(buildLog: string): string {
  const hints: string[] = [];

  if (/APPLICATION FAILED TO START/i.test(buildLog)) {
    hints.push(
      'FAILURE ANALYSIS: Treat Spring "Description" + "Action" as the primary fix target.'
    );
  }

  if (/expected single matching bean but found|required a single bean, but \d+ were found/i.test(buildLog)) {
    hints.push(
      'DUPLICATE BEAN: Prefer @Primary, @Qualifier, remove duplicate @EnableConfigurationProperties / @ConfigurationPropertiesScan, or exclude conflicting auto-config.'
    );
  } else if (/No qualifying bean of type/i.test(buildLog)) {
    hints.push(
      'MISSING BEAN: Add/enable the missing bean, fix component scan, or provide a @MockBean/@TestConfiguration for tests.'
    );
  }

  if (/-parameters|parameter name information/i.test(buildLog)) {
    hints.push(
      'PARAMETER NAMES: Enable maven-compiler-plugin <parameters>true</parameters> (Boot 3 / Spring Framework 6).'
    );
  }

  if (
    /Could not resolve placeholder|Could not bind|Failed to bind properties|ConfigurationPropertiesBindException|missing required property|clientId cannot be null/i.test(
      buildLog
    )
  ) {
    hints.push(
      'CONFIG/PROPERTY: Add missing property (test profile / application-*.yml) or fix renamed Boot 3 property names.'
    );
  }

  if (
    /Failed to configure a DataSource|Cannot load driver class|Connection refused|Unknown database|jdbc\.SQLException/i.test(
      buildLog
    )
  ) {
    hints.push(
      'DATASOURCE: Fix test datasource (H2 / Testcontainers / exclude DataSource auto-config) — do not skip tests.'
    );
  }

  if (
    /NoClassDefFoundError|ClassNotFoundException/i.test(buildLog)
  ) {
    hints.push(
      'MISSING CLASS: Add the Maven dependency that provides the exact class in the stack (or remove an exclusion). Prefer Spring Boot BOM-managed deps with NO hardcoded wrong version; if the parent does not manage it, set an explicit <version>.'
    );
  } else if (/javax\.(servlet|persistence|validation|annotation)/i.test(buildLog)) {
    hints.push(
      'JAVAX→JAKARTA: Align dependency + imports for Boot 3.'
    );
  }

  if (
    /dependency\.version.*is missing|dependencies\.dependency\.version|is missing\. @ line/i.test(
      buildLog
    )
  ) {
    hints.push(
      'POM VERSION MISSING: Every dependency not managed by the Boot/Cloud BOM MUST have an explicit <version>. Do not add versionless deps unless the parent BOM manages that artifact.'
    );
  }

  if (
    /NoProviderFoundException|Unable to create a Configuration|jakarta\.validation|hibernate-validator/i.test(
      buildLog
    )
  ) {
    hints.push(
      'VALIDATION: Add spring-boot-starter-validation / hibernate-validator; align jakarta.validation imports.'
    );
  }

  if (
    /WebSecurityConfigurerAdapter|antMatchers|authorizeRequests|EnableGlobalMethodSecurity/i.test(
      buildLog
    )
  ) {
    hints.push(
      'SECURITY 6: Replace WebSecurityConfigurerAdapter / antMatchers with SecurityFilterChain + requestMatchers.'
    );
  }

  if (/cannot find symbol|package .+ does not exist|COMPILATION ERROR/i.test(buildLog)) {
    hints.push(
      'COMPILATION: Fix EVERY reported file:line (import, pom dependency, removed API). javax→jakarta only if the symbol requires it.'
    );
  }

  if (/org\.junit\.Test|org\.junit\.Assert|@RunWith|PowerMock|MockitoJUnitRunner/i.test(buildLog)) {
    hints.push(
      'TEST FRAMEWORK: Migrate JUnit 4 / PowerMock symbols to JUnit 5 + MockitoExtension; do not delete tests.'
    );
  }

  if (/Lombok|MapStruct|cannot find symbol.*Builder|Generated/i.test(buildLog) && isCompileFailure(buildLog)) {
    hints.push(
      'ANNOTATION PROCESSING: Align Lombok/MapStruct versions and maven-compiler-plugin annotationProcessorPaths.'
    );
  }

  if (/surefire|Tests run:/i.test(buildLog) && isSpringContextFailure(buildLog)) {
    hints.push(
      'SUREFIRE CASCADE: Many test errors share one ApplicationContext failure — fix context startup first; ignore "failure threshold exceeded" repeats.'
    );
  }

  if (hints.length === 0) {
    return [
      'No specialized hint matched. Still fix ONLY the ROOT CAUSE REGION / innermost Caused by.',
      'Smallest safe edit set; do not run a full ecosystem migration audit unless the log clearly requires it.',
    ].join('\n');
  }
  return `Targeted hints (matched from this log):\n${hints.map((h) => `- ${h}`).join('\n')}`;
}

function buildSlimBuildFixRules(targetJavaVersion: string): string {
  return `Constraints:
- Do not delete tests; do not weaken assertions; do not use -DskipTests; do not run mvn.
- When adding a Maven dependency: if Spring Boot/Cloud BOM does not manage it, you MUST set <version>. A versionless unmanaged dependency is an incomplete fix.
- Target Java: ${targetJavaVersion}. Briefly append root cause + files changed to .java-upgrade/MIGRATION_REPORT.md.`;
}

/**
 * Mirror manual Copilot Chat: paste the failure log + "fix this".
 * Keep the task file short so the model behaves like a human paste, not a migration audit.
 */
export function buildMavenFixPrompt(
  targetJavaVersion: string,
  sourceJavaVersion: string,
  buildLog: string,
  options: MavenFixPromptOptions = {}
): string {
  const logTail = options.mavenBuildLogTailChars ?? getAppConfig().mavenBuildLogTailChars;
  const trimmedLog = extractMavenFailureExcerpt(buildLog, logTail);
  const focusedHints = buildFocusedBuildFixHints(buildLog);

  // Only for pure compile failures: optional javax/jakarta symbol help (still no full matrix dump)
  const compileHint =
    isCompileFailure(buildLog) && !isSpringContextFailure(buildLog)
      ? '\nIf symbols are missing: fix imports/pom (javax→jakarta only when required by Boot 3).\n'
      : '';

  return `Fix this Maven \`mvn clean install\` failure by editing the project files now.

Same as a developer pasting the build log into Copilot Chat and saying "fix this error".
Do not write a migration plan. Do not ask questions. Edit source/config/tests with your tools.

Java context: ${sourceJavaVersion} → ${targetJavaVersion}.
Read KEY CAUSES first (NoClassDefFoundError / bean / POM). Then ROOT CAUSE REGION.
Ignore repeated "ApplicationContext failure threshold exceeded".

${focusedHints}
${compileHint}
${buildSlimBuildFixRules(targetJavaVersion)}

=== BUILD LOG ===
${trimmedLog}
=== END LOG ===

Apply a COMPLETE fix now (e.g. dependency without <version> when unmanaged = incomplete).`;
}

export function buildSmokeFixPrompt(
  targetJavaVersion: string,
  sourceJavaVersion: string,
  startupLog: string,
  options: MavenFixPromptOptions = {}
): string {
  const logTail = options.mavenBuildLogTailChars ?? getAppConfig().mavenBuildLogTailChars;
  const trimmedLog = extractMavenFailureExcerpt(startupLog, logTail);
  const focusedHints = buildFocusedBuildFixHints(startupLog);

  const logFileHint = options.runAppLogRel
    ? `Full log also at ${options.runAppLogRel} if excerpt is incomplete.\n`
    : '';

  return `Fix this application startup failure by editing the project files now.

Same as pasting the run log into Copilot Chat and saying "fix this".
Do not only explain. Edit files with your tools.

Java context: ${sourceJavaVersion} → ${targetJavaVersion}.
${logFileHint}
Prefer APPLICATION FAILED TO START Description/Action or innermost Caused by.

${focusedHints}

${buildSlimBuildFixRules(targetJavaVersion)}

=== STARTUP LOG ===
${trimmedLog}
=== END LOG ===

Apply the fix now.`;
}
