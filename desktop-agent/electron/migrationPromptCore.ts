/** Shared migration prompt blocks — aligned with application.properties prompt.java-upgrade */

import {
  MIGRATION_FILE_NAMES,
  migrationOutputRelPath,
} from './services/migrationOutputPaths';
import { buildDependencyMigrationPlaybook } from './services/migrationCatalog';

const REPORT_REL = migrationOutputRelPath(MIGRATION_FILE_NAMES.report);
const ANALYSIS_REL = migrationOutputRelPath(MIGRATION_FILE_NAMES.analysis);
const VALIDATION_REL = migrationOutputRelPath(MIGRATION_FILE_NAMES.validation);

export function buildDecisionRules(targetJavaVersion: string): string {
  return `Decision rules:
1. Prefer the smallest safe migration path that reaches Java ${targetJavaVersion}.
2. If a dependency works with Java ${targetJavaVersion}, do not upgrade it unnecessarily.
3. If a dependency blocks Java ${targetJavaVersion}, upgrade it to the nearest compatible stable version.
4. If Spring Boot major upgrade is required, perform the related Spring ecosystem migration consistently.
5. If Spring Boot 3+ or Jakarta EE 9+ is selected, migrate javax.* to jakarta.* consistently — AND apply the same pom+import+code+test rigor to ALL ecosystem migrations in the dependency matrix (JUnit, Mockito, logging, HTTP, Jackson, Security, OpenAPI, DB drivers, Hibernate, etc.).
6. If jakarta migration is not required, do not convert javax.* imports.
7. Do not change business logic unless strictly required for compatibility.
8. Never delete tests.
9. Never weaken assertions.
10. Never skip tests or add -DskipTests.
11. Prefer minimal safe source changes.
12. Document every risky decision and every dependency replacement in ${REPORT_REL}.`;
}

export const MIGRATION_SCOPE_CHECKLIST = `You MUST inspect and update the entire repository where needed:
1. Parent POMs, child modules, dependencyManagement, BOMs, plugins, profiles, enforcer rules, compiler settings.
2. Maven compiler config: java.version, maven.compiler.source, maven.compiler.target, maven.compiler.release.
3. Build plugins: compiler, surefire, failsafe, jacoco, spotless/checkstyle/pmd, lombok, mapstruct, protobuf, openapi, jaxb, wsdl, annotation processors.
4. Dependencies and BOMs incompatible with the target Java version.
5. Source and test code: removed/deprecated JDK APIs, module restrictions, reflection, annotation processors, bytecode tooling, test engines, mocking libraries.
6. Framework compatibility: Spring/Spring Boot/Spring Cloud/Hibernate/JPA/Jackson/Netty/Tomcat/Jetty/Undertow/Log4j/SLF4J/Lombok/MapStruct/Mockito/ByteBuddy and similar.
7. javax.* to jakarta.* only when required by selected framework versions (especially Spring Boot 3+/Jakarta EE 9+).
8. Dockerfile, devcontainer, CI workflows, Jenkinsfile, scripts, README and documentation references to Java version.

Do not apply unrelated framework migrations unless required for compatibility, build success, or runtime correctness.`;

export const MIGRATION_BUILD_INSTRUCTION = `Build instruction:
Do NOT run mvn or mvnw. The pipeline will run mvn clean install after you.`;

export function buildReportRequirements(
  sourceJavaVersion: string,
  targetJavaVersion: string
): string {
  return `Output requirements:
Create or update ${REPORT_REL} with:
- source Java version: ${sourceJavaVersion}
- target Java version: ${targetJavaVersion}
- detected build tool
- detected framework versions
- migration decisions made
- changed files
- Maven property/plugin changes
- dependency and BOM upgrades with reasons
- source/test compatibility changes
- jakarta migration status and reason
- Docker/CI/script/doc changes
- risks
- blockers
- manual verification needed

If a safe migration is not possible, stop and document the blocker clearly in ${REPORT_REL}.`;
}

export const FIX_CONTEXT_HINT = `Read ${ANALYSIS_REL} and ${VALIDATION_REL} if present for prior context.`;

export function buildFixDecisionRules(targetJavaVersion: string): string {
  return `You MUST:
1. Identify whether the failure is caused by Maven config, plugin version, dependency incompatibility, annotation processing, source compilation, test compilation, runtime test failure, or environment.
2. Fix the smallest safe set of files needed.
3. Upgrade dependencies, BOMs, and plugins only when required for Java ${targetJavaVersion}.
4. Fix Java source and test code when required for Java ${targetJavaVersion}.
5. Apply javax/jakarta changes only if required by the selected framework versions.
6. Do not introduce unrelated framework major upgrades unless required to resolve the failure safely.
7. Do not change business logic unless required for compatibility.
8. Do not delete tests.
9. Do not weaken assertions.
10. Do not skip tests or add -DskipTests.
11. Update ${REPORT_REL} with the root cause and fixes applied.
12. If the issue is environmental or cannot be fixed safely, document it as a blocker.

Do NOT run mvn, mvnw, or any build command. The pipeline will rebuild automatically.`;
}

export function requiresJakartaMigration(springBootVersion: string): boolean {
  return /^[34]\./.test(springBootVersion.trim());
}

export function isSpringBoot3Plus(springBootVersion: string): boolean {
  const version = springBootVersion.trim();
  if (!version || version === 'unknown') return false;
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  return Number.isFinite(major) && major >= 3;
}

export const SPRING_BOOT3_FIX_PLAYBOOK = `Spring Boot 3 / Spring Framework 6 build-fix playbook:
- Validation provider missing (NoProviderFoundException, ValidatorFactory, jakarta.validation): spring-boot-starter-validation may not bring hibernate-validator if a transitive dependency excludes it — add org.hibernate.validator:hibernate-validator (version from Spring Boot BOM) OR remove the exclusion (mvn dependency:tree -Dincludes=org.hibernate.validator).
- Duplicate @ExceptionHandler(MaxUploadSizeExceededException) when extending ResponseEntityExceptionHandler: remove the duplicate handler; override handleMaxUploadSizeExceeded(...) instead.
- javax.validation vs jakarta.validation mismatch: align imports and dependencies to jakarta.* for Boot 3.
- Prefer fixing root cause (dependency excludes) over blind dependency adds; document excludes in ${REPORT_REL}.`;

export const COMPILE_SYMBOL_FIX_PLAYBOOK = `Compile-time "cannot find symbol" / "package does not exist" playbook:
- Parse EVERY compiler error: exact symbol name, kind (class/method/variable), file path, line number — fix those files first.
- "cannot find symbol" on a class/interface: wrong import, missing Maven dependency, javax→jakarta rename, or API removed in target Java/Spring.
- "package X does not exist": add the correct dependency to pom.xml OR fix the import package (common: javax.servlet→jakarta.servlet, javax.persistence→jakarta.persistence, javax.validation→jakarta.validation).
- If error is under src/test/java: fix test source AND test-scoped dependencies — do not only patch main code.
- JUnit 4 symbols (org.junit.Test, @RunWith, Assert): migrate to JUnit 5 (org.junit.jupiter.api.*, @ExtendWith, Assertions).
- Mockito symbols: add mockito-core + mockito-junit-jupiter; replace MockitoJUnitRunner with MockitoExtension.
- Spring Boot 3: WebSecurityConfigurerAdapter, ResourceServerConfigurerAdapter and similar removed types need Spring Security 6 replacements.
- Lombok/MapStruct "cannot find symbol" on generated types: align annotation processor versions in maven-compiler-plugin with dependency versions.
- Add a dependency only when the missing symbol is a third-party class; match artifact to package (do not guess random versions — use Spring Boot BOM when applicable).`;

export const RUNTIME_STARTUP_FIX_PLAYBOOK = `Application runtime startup fix playbook:
- Fix Spring ApplicationContext failures: missing beans, circular dependencies, wrong @Conditional, profile-specific property keys.
- DataSource / Flyway / Liquibase: align URLs and drivers for local/test profile; use embedded H2 or test profile config for smoke — do not weaken production config.
- Property renames across Spring Boot 2→3 / 3→4: spring.*, server.*, management.* keys (check Boot migration guide).
- Missing runtime dependencies not needed at compile time: jakarta.* APIs, JAXB runtime, Hibernate validator, JDBC driver on runtime classpath.
- Fix port/bind issues; prefer profile-specific application-test.properties for smoke.
- Never disable security or delete health checks just to green startup; fix root configuration.`;

export const TEST_FIX_PLAYBOOK = `Unit/integration test fix playbook:
- Fix test-compile errors before surefire runtime failures; all src/test/java must compile on target Java.
- Scan ALL test files for legacy imports (org.junit, junit.framework, org.mockito.runners, PowerMock) and migrate to JUnit 5 + MockitoExtension.
- PowerMock does not work on Java 17+ — refactor to plain Mockito or @MockBean; do not delete tests.
- @SpringBootTest / @WebMvcTest / @DataJpaTest: use jakarta.* imports; align spring-boot-starter-test with Boot version.
- maven-surefire-plugin 3.x for JUnit 5; junit-vintage-engine only if JUnit 4 must temporarily coexist.
- Never delete tests or weaken assertions to green the build; migrate APIs instead.`;

export function buildLogTriggeredFixHints(buildLog: string): string {
  const log = buildLog.toLowerCase();
  const hints: string[] = [];

  if (
    /cannot find symbol|symbol not found|package .+ does not exist|cannot access class|cannot resolve symbol/.test(
      log
    )
  ) {
    hints.push(
      '- Log has compile "cannot find symbol" / missing package — fix exact file:line from error; check import vs javax/jakarta vs missing pom dependency (see compile-symbol playbook).'
    );
  }
  if (/src\/test|test-compile|compiling .+test|tests run:|surefire|failsafe/.test(log)) {
    hints.push(
      '- Log involves test compile or surefire — prioritize src/test sources and test-scoped dependencies (see test fix playbook).'
    );
  }
  if (/applicationcontext failure threshold|failed to load applicationcontext/.test(log)) {
    hints.push(
      '- Spring test context failed to start: ignore repeated "failure threshold exceeded". Fix the FIRST Failed to load ApplicationContext and its innermost Caused by (bean, class, property, datasource).'
    );
  }
  if (/org\.junit\.(test|before|runwith|assert)|junit\.framework/.test(log)) {
    hints.push('- Log suggests JUnit 4 API in tests — migrate to JUnit 5 Jupiter.');
  }
  if (/mockito|bytebuddy|powermock/.test(log)) {
    hints.push('- Log suggests Mockito/ByteBuddy/PowerMock issue — align mockito-junit-jupiter; remove PowerMock on Java 17+.');
  }
  if (/noproviderfoundexception|validatorfactory|hibernate\.validator|jakarta\.validation/.test(log)) {
    hints.push(
      '- Log suggests missing Bean Validation provider — see validation playbook above.'
    );
  }
  if (/maxuploadsizeexceededexception|ambiguous.*exceptionhandler|handlemaxuploadsize/.test(log)) {
    hints.push(
      '- Log suggests @ControllerAdvice / MaxUploadSizeExceededException conflict — override ResponseEntityExceptionHandler.handleMaxUploadSizeExceeded.'
    );
  }
  if (/javax\.|package javax/.test(log)) {
    hints.push(
      '- Log mentions javax — audit ALL pom.xml + src/main + src/test for javax artifacts/imports; migrate full pairs per ecosystem matrix.'
    );
  }
  if (/springfox|swagger|openapi|springdoc/.test(log)) {
    hints.push('- Log suggests OpenAPI/Swagger — migrate Springfox → springdoc-openapi if present.');
  }
  if (/hibernate|jpa|persistence/.test(log)) {
    hints.push('- Log suggests JPA/Hibernate — verify Hibernate 6 + jakarta.persistence + BOM alignment.');
  }
  if (/oauth|websecurityconfigurer|securityfilterchain/.test(log)) {
    hints.push('- Log suggests Spring Security legacy API — apply Security 6 patterns from ecosystem matrix.');
  }
  if (/codehaus\.jackson|fasterxml/.test(log)) {
    hints.push('- Log suggests Jackson stack — ensure com.fasterxml.jackson only (no codehaus).');
  }

  if (hints.length === 0) return '';
  return `\nBuild-log triggered hints:\n${hints.join('\n')}\n`;
}

export function buildMigrationFixGuidance(
  springBootVersion: string,
  buildLog?: string,
  targetJavaVersion = '21'
): string {
  const sections = [
    buildDependencyMigrationPlaybook(targetJavaVersion, springBootVersion),
    COMPILE_SYMBOL_FIX_PLAYBOOK,
    TEST_FIX_PLAYBOOK,
  ];
  if (isSpringBoot3Plus(springBootVersion)) {
    sections.splice(1, 0, SPRING_BOOT3_FIX_PLAYBOOK);
  }
  const logHints = buildLog?.trim() ? buildLogTriggeredFixHints(buildLog) : '';
  return `\n${sections.join('\n\n')}${logHints}\n`;
}

export function buildSpringBoot3FixSection(
  springBootVersion: string,
  buildLog?: string,
  targetJavaVersion?: string
): string {
  return buildMigrationFixGuidance(springBootVersion, buildLog, targetJavaVersion);
}

export const MIGRATION_ANALYSIS_READ_HINT =
  `Read ${ANALYSIS_REL} in the workspace for the full analysis (authoritative). Do not rely on prompt alone.`;
