export type CompatibilityCategory =
  | 'legacy-namespace'
  | 'removed-jdk-api'
  | 'deprecated-jdk-api'
  | 'internal-jdk-api'
  | 'legacy-test-api'
  | 'legacy-logging'
  | 'legacy-http-client'
  | 'legacy-serialization'
  | 'legacy-security'
  | 'spring-boot-legacy'
  | 'incompatible-dependency'
  | 'build-plugin'
  | 'config-legacy'
  | 'infra-java-version'
  | 'reflection-instrumentation';

export interface CompatibilityFinding {
  category: CompatibilityCategory;
  id: string;
  file: string;
  line?: number;
  detail: string;
}

export const CATEGORY_LABELS: Record<CompatibilityCategory, string> = {
  'legacy-namespace': 'Legacy namespace / package (EE, JAXB, JAX-RS, vb.)',
  'removed-jdk-api': 'Kaldırılmış JDK API',
  'deprecated-jdk-api': 'Deprecated JDK API',
  'internal-jdk-api': 'Internal / unsupported JDK API',
  'legacy-test-api': 'Legacy test framework (JUnit4, vb.)',
  'legacy-logging': 'Legacy logging (log4j 1, commons-logging)',
  'legacy-http-client': 'Legacy HTTP client (Apache HttpClient 4, vb.)',
  'legacy-serialization': 'Legacy serialization (Serializable, XML binding)',
  'legacy-security': 'Legacy security API',
  'spring-boot-legacy': 'Spring Boot 2 / legacy Spring config',
  'incompatible-dependency': 'Hedef Java ile uyumsuz dependency',
  'build-plugin': 'Eski / uyumsuz Maven plugin',
  'config-legacy': 'Legacy config (properties, yaml, xml)',
  'infra-java-version': 'Docker / CI eski Java sürümü',
  'reflection-instrumentation': 'Reflection / agent / module erişimi',
};

/** Import prefix → hedef ekosistem notu */
export const LEGACY_IMPORT_PREFIXES: Array<{
  prefix: string;
  category: CompatibilityCategory;
  upgradeNote: string;
}> = [
  { prefix: 'javaee.', category: 'legacy-namespace', upgradeNote: 'jakarta.enterprise / jakarta.*' },
  { prefix: 'com.sun.', category: 'internal-jdk-api', upgradeNote: 'Desteklenen public API veya dependency' },
  { prefix: 'sun.', category: 'internal-jdk-api', upgradeNote: 'Desteklenen public API' },
  { prefix: 'jdk.internal.', category: 'internal-jdk-api', upgradeNote: 'Kaldır veya desteklenen API kullan' },
  { prefix: 'org.junit.', category: 'legacy-test-api', upgradeNote: 'org.junit.jupiter.* (JUnit 5)' },
  { prefix: 'junit.framework', category: 'legacy-test-api', upgradeNote: 'JUnit 5 Jupiter' },
  { prefix: 'org.apache.log4j.', category: 'legacy-logging', upgradeNote: 'Log4j2 veya SLF4J' },
  { prefix: 'org.apache.commons.logging', category: 'legacy-logging', upgradeNote: 'SLF4J + Logback' },
  { prefix: 'org.apache.http.', category: 'legacy-http-client', upgradeNote: 'HttpClient 5 (org.apache.hc.client5) veya java.net.http' },
  { prefix: 'javax.servlet.', category: 'legacy-namespace', upgradeNote: 'jakarta.servlet.*' },
  { prefix: 'javax.persistence.', category: 'legacy-namespace', upgradeNote: 'jakarta.persistence.*' },
  { prefix: 'javax.validation.', category: 'legacy-namespace', upgradeNote: 'jakarta.validation.*' },
  { prefix: 'javax.inject.', category: 'legacy-namespace', upgradeNote: 'jakarta.inject.*' },
  { prefix: 'javax.annotation.', category: 'legacy-namespace', upgradeNote: 'jakarta.annotation.*' },
  { prefix: 'javax.transaction.', category: 'legacy-namespace', upgradeNote: 'jakarta.transaction.*' },
  { prefix: 'javax.ws.rs.', category: 'legacy-namespace', upgradeNote: 'jakarta.ws.rs.*' },
  { prefix: 'javax.xml.bind.', category: 'legacy-namespace', upgradeNote: 'jakarta.xml.bind.* + runtime (jaxb-runtime)' },
  { prefix: 'javax.activation.', category: 'legacy-namespace', upgradeNote: 'jakarta.activation.*' },
  { prefix: 'javax.mail.', category: 'legacy-namespace', upgradeNote: 'jakarta.mail.* (angus-mail)' },
  { prefix: 'javax.jms.', category: 'legacy-namespace', upgradeNote: 'jakarta.jms.*' },
  { prefix: 'javax.ejb.', category: 'legacy-namespace', upgradeNote: 'jakarta.ejb.* veya Spring karşılığı' },
  { prefix: 'javax.json.', category: 'legacy-namespace', upgradeNote: 'jakarta.json.*' },
  { prefix: 'javax.', category: 'legacy-namespace', upgradeNote: 'jakarta.* karşılığı — pom + import + test birlikte' },
  { prefix: 'org.hamcrest.', category: 'legacy-test-api', upgradeNote: 'Hamcrest 2.x (org.hamcrest) veya AssertJ' },
  { prefix: 'org.mockito.runners.', category: 'legacy-test-api', upgradeNote: 'MockitoExtension (JUnit 5)' },
  { prefix: 'org.powermock.', category: 'legacy-test-api', upgradeNote: 'Kaldır — Mockito / @MockBean kullan (Java 17+ uyumsuz)' },
  { prefix: 'org.codehaus.jackson.', category: 'incompatible-dependency', upgradeNote: 'com.fasterxml.jackson.*' },
  { prefix: 'org.springframework.security.config.annotation.web.configuration.WebSecurityConfigurerAdapter', category: 'spring-boot-legacy', upgradeNote: 'SecurityFilterChain @Bean (Spring Security 6)' },
  { prefix: 'springfox.', category: 'incompatible-dependency', upgradeNote: 'springdoc-openapi (Springfox bakımsız)' },
  { prefix: 'io.swagger.annotations.', category: 'incompatible-dependency', upgradeNote: 'io.swagger.core.v3 (OpenAPI 3) + springdoc' },
];

export const SOURCE_PATTERNS: Array<{
  id: string;
  category: CompatibilityCategory;
  regex: RegExp;
  upgradeNote: string;
}> = [
  { id: 'Thread.stop()', category: 'removed-jdk-api', regex: /\.stop\s*\(/, upgradeNote: 'Güvenli shutdown mekanizması' },
  { id: 'Thread.suspend/resume', category: 'removed-jdk-api', regex: /\.(suspend|resume)\s*\(/, upgradeNote: 'java.util.concurrent kullan' },
  { id: 'finalize()', category: 'deprecated-jdk-api', regex: /\bfinalize\s*\(/, upgradeNote: 'Cleaner / try-with-resources' },
  { id: 'SecurityManager', category: 'removed-jdk-api', regex: /\bSecurityManager\b/, upgradeNote: 'Kaldırıldı (Java 17+)' },
  { id: 'runFinalizersOnExit', category: 'removed-jdk-api', regex: /runFinalizersOnExit/, upgradeNote: 'Kaldır' },
  { id: 'sun.misc.Unsafe', category: 'internal-jdk-api', regex: /sun\.misc\.Unsafe/, upgradeNote: 'VarHandle / Foreign Memory API' },
  { id: 'new Date(epoch)', category: 'deprecated-jdk-api', regex: /new\s+Date\s*\(\s*\d/, upgradeNote: 'Instant / LocalDateTime' },
  { id: 'Class.newInstance()', category: 'deprecated-jdk-api', regex: /\.newInstance\s*\(/, upgradeNote: 'getDeclaredConstructor().newInstance()' },
  { id: 'ThreadGroup.destroy', category: 'deprecated-jdk-api', regex: /ThreadGroup/, upgradeNote: 'Modern concurrency API' },
  { id: 'URL(String) legacy', category: 'deprecated-jdk-api', regex: /new\s+URL\s*\(\s*"/, upgradeNote: 'URI.toURL()' },
  { id: 'Runtime.getRuntime().exec', category: 'deprecated-jdk-api', regex: /Runtime\.getRuntime\(\)\.exec/, upgradeNote: 'ProcessBuilder' },
  { id: 'setAccessible(true)', category: 'reflection-instrumentation', regex: /\.setAccessible\s*\(\s*true/, upgradeNote: 'Module / MethodHandles kontrolü' },
  { id: 'AccessibleObject', category: 'reflection-instrumentation', regex: /AccessibleObject/, upgradeNote: 'Java module kurallarına uy' },
  { id: 'javax.annotation.PostConstruct', category: 'legacy-namespace', regex: /javax\.annotation\.(PostConstruct|PreDestroy|Resource)/, upgradeNote: 'jakarta.annotation.*' },
  { id: 'WebSecurityConfigurerAdapter', category: 'spring-boot-legacy', regex: /WebSecurityConfigurerAdapter/, upgradeNote: 'Spring Security 6 SecurityFilterChain bean' },
  { id: 'antMatchers', category: 'spring-boot-legacy', regex: /antMatchers\s*\(/, upgradeNote: 'requestMatchers()' },
  { id: 'mvcMatchers', category: 'spring-boot-legacy', regex: /mvcMatchers\s*\(/, upgradeNote: 'requestMatchers()' },
  { id: 'EnableGlobalMethodSecurity', category: 'spring-boot-legacy', regex: /EnableGlobalMethodSecurity/, upgradeNote: 'EnableMethodSecurity' },
  { id: 'spring.jpa.hibernate.naming.strategy', category: 'spring-boot-legacy', regex: /hibernate\.naming\.strategy/, upgradeNote: 'Spring Boot 3 property adları' },
  { id: 'management.metrics', category: 'spring-boot-legacy', regex: /management\.metrics\.binders/, upgradeNote: 'Spring Boot 3 actuator property' },
  {
    id: 'MaxUploadSizeExceededException @ExceptionHandler',
    category: 'spring-boot-legacy',
    regex: /@ExceptionHandler\s*\(\s*[^)]*MaxUploadSizeExceededException/,
    upgradeNote: 'SF6 ResponseEntityExceptionHandler zaten handle eder — override handleMaxUploadSizeExceeded',
  },
  { id: 'ObjectInputStream legacy', category: 'legacy-serialization', regex: /ObjectInputStream/, upgradeNote: 'Güvenli deserialization veya alternatif format' },
  { id: 'XStream', category: 'legacy-serialization', regex: /\bXStream\b/, upgradeNote: 'Güncel sürüm + güvenlik allowlist' },
];

/** pom.xml dependency artifactId patterns incompatible with modern Java / Boot 3 */
export const POM_LEGACY_DEPENDENCIES: Array<{
  pattern: RegExp;
  category: CompatibilityCategory;
  upgradeNote: string;
}> = [
  { pattern: /javax\.servlet/i, category: 'incompatible-dependency', upgradeNote: 'jakarta.servlet-api' },
  { pattern: /javax\.persistence/i, category: 'incompatible-dependency', upgradeNote: 'jakarta.persistence-api' },
  { pattern: /javax\.validation/i, category: 'incompatible-dependency', upgradeNote: 'jakarta.validation-api' },
  { pattern: /javax\.annotation/i, category: 'incompatible-dependency', upgradeNote: 'jakarta.annotation-api' },
  { pattern: /javax\.xml\.bind/i, category: 'incompatible-dependency', upgradeNote: 'jakarta.xml.bind-api + runtime' },
  { pattern: /javax\.activation/i, category: 'incompatible-dependency', upgradeNote: 'jakarta.activation-api' },
  { pattern: /javax\.ws\.rs/i, category: 'incompatible-dependency', upgradeNote: 'jakarta.ws.rs-api' },
  { pattern: /hibernate-java8/i, category: 'incompatible-dependency', upgradeNote: 'Hibernate 6 / jakarta' },
  { pattern: /hibernate-entitymanager/i, category: 'incompatible-dependency', upgradeNote: 'hibernate-core (Jakarta)' },
  { pattern: /spring-boot-starter-parent.*2\./i, category: 'incompatible-dependency', upgradeNote: 'Spring Boot 3.x for Java 17+' },
  { pattern: /<artifactId>junit<\/artifactId>/i, category: 'legacy-test-api', upgradeNote: 'junit-jupiter' },
  { pattern: /log4j:log4j/i, category: 'legacy-logging', upgradeNote: 'log4j-core 2.x' },
  { pattern: /commons-logging/i, category: 'legacy-logging', upgradeNote: 'spring-jcl veya slf4j' },
  { pattern: /mysql-connector-java/i, category: 'incompatible-dependency', upgradeNote: 'com.mysql:mysql-connector-j' },
  { pattern: /postgresql:.*jdbc42/i, category: 'incompatible-dependency', upgradeNote: 'Güncel PostgreSQL driver' },
  { pattern: /<groupId>\s*javax\./i, category: 'incompatible-dependency', upgradeNote: 'javax groupId — jakarta karşılığına geç' },
  { pattern: /javax\.inject/i, category: 'incompatible-dependency', upgradeNote: 'jakarta.inject-api' },
  { pattern: /javax\.transaction/i, category: 'incompatible-dependency', upgradeNote: 'jakarta.transaction-api' },
  { pattern: /javax\.ejb/i, category: 'incompatible-dependency', upgradeNote: 'jakarta.ejb-api veya Spring' },
  { pattern: /javax\.jms/i, category: 'incompatible-dependency', upgradeNote: 'jakarta.jms-api' },
  { pattern: /javax\.mail/i, category: 'incompatible-dependency', upgradeNote: 'jakarta.mail-api / angus-mail' },
  { pattern: /jersey-container-servlet/i, category: 'incompatible-dependency', upgradeNote: 'Jersey 3+ (jakarta)' },
  { pattern: /jersey-hk2/i, category: 'incompatible-dependency', upgradeNote: 'Jersey 3+ jakarta stack' },
  { pattern: /springfox-/i, category: 'incompatible-dependency', upgradeNote: 'springdoc-openapi-starter-webmvc-ui' },
  { pattern: /swagger-annotations(?!.*v3)/i, category: 'incompatible-dependency', upgradeNote: 'io.swagger.core.v3:swagger-annotations' },
  { pattern: /powermock/i, category: 'legacy-test-api', upgradeNote: 'Kaldır — Mockito / @MockBean' },
  { pattern: /mockito-all/i, category: 'legacy-test-api', upgradeNote: 'mockito-core + mockito-junit-jupiter' },
  { pattern: /junit-vintage-engine/i, category: 'legacy-test-api', upgradeNote: 'JUnit 5 Jupiter\'e tam geçiş tercih et' },
  { pattern: /org\.codehaus\.jackson/i, category: 'incompatible-dependency', upgradeNote: 'com.fasterxml.jackson' },
  { pattern: /httpclient(?!5)/i, category: 'legacy-http-client', upgradeNote: 'httpclient5 veya java.net.http' },
  { pattern: /hibernate-core.*5\./i, category: 'incompatible-dependency', upgradeNote: 'Hibernate 6.x (Jakarta)' },
  { pattern: /spring-security-oauth2/i, category: 'legacy-security', upgradeNote: 'Spring Authorization Server / Spring Security 6 resource server' },
  { pattern: /spring-cloud-starter-netflix-hystrix/i, category: 'incompatible-dependency', upgradeNote: 'Resilience4j / Spring Cloud Circuit Breaker' },
  { pattern: /elasticsearch-rest-high-level-client/i, category: 'incompatible-dependency', upgradeNote: 'Elasticsearch Java API Client 8+' },
  { pattern: /mariadb-java-client.*2\./i, category: 'incompatible-dependency', upgradeNote: 'Güncel mariadb-java-client' },
  { pattern: /ojdbc[0-9]/i, category: 'incompatible-dependency', upgradeNote: 'com.oracle.database.jdbc:ojdbc11 (veya uyumlu sürüm)' },
  { pattern: /flyway-core.*[56]\./i, category: 'incompatible-dependency', upgradeNote: 'Flyway 9+ / Boot BOM sürümü' },
  { pattern: /liquibase-core.*3\./i, category: 'incompatible-dependency', upgradeNote: 'Liquibase 4+ / Boot BOM' },
  { pattern: /mapstruct.*1\.[0-3]\./i, category: 'incompatible-dependency', upgradeNote: 'MapStruct 1.5+ ve processor uyumu' },
];

/** Tüm ekosistem geçişleri — javax/jakarta ile aynı titizlikte pom + import + kod + test + config birlikte kontrol */
export const ECOSYSTEM_MIGRATION_RULES: Array<{
  id: string;
  area: string;
  legacy: string;
  modern: string;
}> = [
  { id: 'jakarta-servlet', area: 'Jakarta EE', legacy: 'javax.servlet / javax.servlet-api', modern: 'jakarta.servlet-api + jakarta imports (main + test)' },
  { id: 'jakarta-persistence', area: 'Jakarta EE', legacy: 'javax.persistence / hibernate-entitymanager', modern: 'jakarta.persistence-api + Hibernate 6 jakarta' },
  { id: 'jakarta-validation', area: 'Jakarta EE', legacy: 'javax.validation / validation-api', modern: 'jakarta.validation-api + hibernate-validator (explicit if excluded)' },
  { id: 'jakarta-inject', area: 'Jakarta EE', legacy: 'javax.inject', modern: 'jakarta.inject-api' },
  { id: 'jakarta-annotation', area: 'Jakarta EE', legacy: 'javax.annotation (PostConstruct, Resource)', modern: 'jakarta.annotation-api' },
  { id: 'jakarta-transaction', area: 'Jakarta EE', legacy: 'javax.transaction', modern: 'jakarta.transaction-api' },
  { id: 'jakarta-jaxrs', area: 'Jakarta EE', legacy: 'javax.ws.rs / Jersey 2 javax', modern: 'jakarta.ws.rs-api + Jersey 3+' },
  { id: 'jakarta-jaxb', area: 'Jakarta EE', legacy: 'javax.xml.bind / JAXB on JDK', modern: 'jakarta.xml.bind-api + jaxb-runtime dependency' },
  { id: 'jakarta-mail', area: 'Jakarta EE', legacy: 'javax.mail', modern: 'jakarta.mail-api / angus-mail' },
  { id: 'junit5', area: 'Testing', legacy: 'JUnit 4 (junit, @RunWith, Assert)', modern: 'JUnit 5 Jupiter + junit-jupiter + surefire 3.x' },
  { id: 'mockito', area: 'Testing', legacy: 'mockito-all, MockitoJUnitRunner, PowerMock', modern: 'mockito-core + mockito-junit-jupiter; no PowerMock' },
  { id: 'hamcrest', area: 'Testing', legacy: 'hamcrest-core 1.x', modern: 'Hamcrest 2.x veya AssertJ' },
  { id: 'spring-test', area: 'Testing', legacy: 'Spring Test 5 / javax in @WebMvcTest', modern: 'spring-boot-starter-test (Boot BOM) + jakarta imports' },
  { id: 'log4j1', area: 'Logging', legacy: 'log4j 1.x / log4j:log4j', modern: 'Log4j2 veya SLF4J + Logback (Boot default)' },
  { id: 'commons-logging', area: 'Logging', legacy: 'commons-logging', modern: 'spring-jcl bridge veya slf4j-jcl' },
  { id: 'httpclient4', area: 'HTTP', legacy: 'Apache HttpClient 4.x', modern: 'httpclient5 veya java.net.http.HttpClient' },
  { id: 'jackson1', area: 'Serialization', legacy: 'org.codehaus.jackson', modern: 'com.fasterxml.jackson (Boot BOM)' },
  { id: 'spring-security6', area: 'Spring Security', legacy: 'WebSecurityConfigurerAdapter, antMatchers, EnableGlobalMethodSecurity', modern: 'SecurityFilterChain bean, requestMatchers, @EnableMethodSecurity' },
  { id: 'spring-boot3-props', area: 'Spring Boot', legacy: 'Boot 2 property names / spring.factories', modern: 'Boot 3 property renames + AutoConfiguration.imports' },
  { id: 'hibernate6', area: 'Hibernate', legacy: 'Hibernate 5 / hibernate-java8 / javax persistence', modern: 'Hibernate 6.x jakarta namespace' },
  { id: 'swagger', area: 'OpenAPI', legacy: 'Springfox / swagger-annotations 1.x', modern: 'springdoc-openapi + OpenAPI 3 annotations' },
  { id: 'mysql-driver', area: 'Database', legacy: 'mysql-connector-java', modern: 'com.mysql:mysql-connector-j' },
  { id: 'oracle-driver', area: 'Database', legacy: 'ojdbc6/7/8 artifact', modern: 'com.oracle.database.jdbc:ojdbc11+' },
  { id: 'oauth-legacy', area: 'Security', legacy: 'spring-security-oauth2 (legacy)', modern: 'Spring Authorization Server / OAuth2 Resource Server (Boot 3)' },
  { id: 'hystrix', area: 'Resilience', legacy: 'Netflix Hystrix', modern: 'Resilience4j + Spring Cloud Circuit Breaker' },
  { id: 'elasticsearch', area: 'Search', legacy: 'elasticsearch-rest-high-level-client', modern: 'co.elastic.clients:elasticsearch-java' },
  { id: 'mapstruct', area: 'Codegen', legacy: 'MapStruct < 1.5', modern: 'MapStruct 1.5+ + annotationProcessorPaths uyumu' },
  { id: 'lombok', area: 'Codegen', legacy: 'Eski Lombok + eski compiler plugin', modern: 'Lombok sürümü = hedef Java; processor path pom\'da' },
];

export function buildDependencyMigrationPlaybook(
  targetJavaVersion: string,
  springBootVersion: string
): string {
  const target = Number.parseInt(targetJavaVersion, 10) || 0;
  const bootMajor = Number.parseInt(springBootVersion.split('.')[0] ?? '', 10);
  const boot3 = Number.isFinite(bootMajor) && bootMajor >= 3;

  const lines = [
    'DEPENDENCY & ECOSYSTEM MIGRATION AUDIT (mandatory — same rigor as javax→jakarta for EVERY rule below):',
    '- For EACH rule: search ALL pom.xml (every module), src/main/java, src/test/java, resources, and config files.',
    '- Fix pom dependency + Java/Kotlin imports + fully-qualified names + test code + properties TOGETHER — never leave mixed legacy/modern.',
    '- Cross-check MIGRATION_ANALYSIS.md findings — every flagged category must be resolved or documented as blocker.',
    '- After changes: no remaining javax.* imports (when Boot 3+ / Jakarta required), no JUnit 4, no PowerMock, no Springfox.',
    '',
    '## Ecosystem migration matrix (legacy → modern)',
    ...ECOSYSTEM_MIGRATION_RULES.map(
      (r) => `- [${r.area}] ${r.legacy} → ${r.modern}`
    ),
    '',
    '## Audit procedure (do not skip)',
    '1. List every dependency in all pom.xml — flag legacy groupId/artifactId (javax.*, junit 4, log4j1, springfox, powermock, codehaus jackson, httpclient4, hibernate5).',
    '2. Grep src/main and src/test for legacy import prefixes (javax., org.junit., powermock, springfox, codehaus.jackson).',
    '3. Align Spring Boot BOM / parent — one consistent stack version across modules.',
    '4. Verify test-scoped deps separately (starter-test, junit-jupiter, mockito-junit-jupiter).',
    '5. Update MIGRATION_REPORT.md with EVERY dependency change and any remaining risk.',
  ];

  if (boot3 || target >= 17) {
    lines.push(
      '',
      '## Jakarta EE (Boot 3 / Java 17+)',
      '- ZERO javax.servlet|persistence|validation|inject|annotation|transaction|ws.rs|xml.bind in code when jakarta stack is required.',
      '- Remove javax.* Maven artifacts; use jakarta.* or Spring Boot starters from BOM.'
    );
  }

  if (target >= 17) {
    lines.push(
      '',
      '## Java 17+ module / internal API',
      '- No com.sun.*, sun.*, jdk.internal.* — replace with supported APIs or add explicit module opens only as last resort.'
    );
  }

  return lines.join('\n');
}

export const CONFIG_LEGACY_PATTERNS: Array<{
  id: string;
  category: CompatibilityCategory;
  regex: RegExp;
  upgradeNote: string;
}> = [
  { id: 'spring.jpa.hibernate.ddl-auto legacy', category: 'config-legacy', regex: /spring\.jpa\.hibernate\.ddl-auto/, upgradeNote: 'Spring Boot 3 property path doğrula' },
  { id: 'server.servlet.context-path', category: 'config-legacy', regex: /server\.servlet\.context-path/, upgradeNote: 'server.servlet.context-path (Boot 3 uyumlu)' },
  { id: 'management.endpoints.web.exposure', category: 'config-legacy', regex: /management\.endpoints\.web\.exposure/, upgradeNote: 'Actuator exposure property' },
  { id: 'spring.mvc.pathmatch', category: 'spring-boot-legacy', regex: /spring\.mvc\.pathmatch/, upgradeNote: 'Boot 3 default PathPatternParser' },
  { id: 'logging.config log4j1', category: 'legacy-logging', regex: /log4j\.properties/, upgradeNote: 'Logback / Log4j2 config' },
];

export function getMandatoryUpgradeChecklist(
  sourceJava: string,
  targetJava: string
): string[] {
  const target = parseInt(targetJava, 10);
  const source = parseInt(sourceJava, 10);

  const items = [
    'Tüm modül pom.xml dosyalarında Java compiler release/source/target = hedef sürüm.',
    'Maven plugin sürümleri (compiler, surefire, failsafe, enforcer, spring-boot) hedef Java ile uyumlu.',
    'Parent POM / BOM sürümleri hedef Java ve framework ile uyumlu (Spring Boot, Hibernate, Jackson, vb.).',
    'Tüm üçüncü parti dependency sürümleri hedef Java ile test edilmiş güncel sürümlere yükseltilmeli.',
    'Legacy namespace ve dependency geçişleri (javax→jakarta, JUnit4→5, logging, HTTP, Jackson, Security, OpenAPI, DB drivers) pom+import+kod+test birlikte — hiçbiri atlanmamalı.',
    'Kaldırılmış ve deprecated JDK API kullanımları kaynak ve test kodunda düzeltilmeli.',
    'Spring / Hibernate / Security breaking change’leri (config + kod) hedef stack’e göre güncellenmeli.',
    'application.properties / application.yml / XML config eski property adları güncellenmeli.',
    'Test framework (JUnit 4→5, Mockito, Testcontainers) hedef Java ile uyumlu sürüme çekilmeli.',
    'Dockerfile, CI pipeline, Gradle/Maven wrapper, README ve script dosyaları hedef Java ile hizalanmalı.',
    'MIGRATION_REPORT.md: her değişen dosya, dependency upgrade, API değişikliği ve kalan risk listelenmeli.',
  ];

  if (target >= 21) {
    items.push('Java 21: virtual threads, pattern matching, record patterns — yalnızca uyumluluk gerektiriyorsa kullan.');
    items.push('Java 21: SecurityManager, finalize, Thread.stop gibi kaldırılmış API tamamen temizlenmeli.');
  }

  if (source < 17 && target >= 17) {
    items.push('Java 17+ geçişi: strong encapsulation — internal JDK API ve illegal reflection temizlenmeli.');
  }

  if (target >= 17) {
    items.push('Jakarta EE namespace (javax.* → jakarta.*) ve uyumlu servlet/JPA/validation dependency seti.');
    items.push(
      'Spring Boot 3+: hibernate-validator implementasyonu classpath\'te olmalı; starter-validation yetmezse explicit dependency veya exclude düzeltmesi.'
    );
    items.push(
      'Spring Boot 3 / SF6: ResponseEntityExceptionHandler extend eden @ControllerAdvice sınıflarında duplicate @ExceptionHandler(MaxUploadSizeExceededException) kullanma.'
    );
  }

  return items;
}

export function groupFindingsByCategory(
  findings: CompatibilityFinding[]
): Map<CompatibilityCategory, CompatibilityFinding[]> {
  const map = new Map<CompatibilityCategory, CompatibilityFinding[]>();
  for (const f of findings) {
    const list = map.get(f.category) ?? [];
    list.push(f);
    map.set(f.category, list);
  }
  return map;
}
