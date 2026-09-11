import fs from 'fs';
import path from 'path';
import { analyzePom } from './mavenService';
import {
  CATEGORY_LABELS,
  CONFIG_LEGACY_PATTERNS,
  CompatibilityFinding,
  LEGACY_IMPORT_PREFIXES,
  POM_LEGACY_DEPENDENCIES,
  SOURCE_PATTERNS,
  getMandatoryUpgradeChecklist,
  groupFindingsByCategory,
} from './migrationCatalog';
import {
  ensureMigrationOutputDir,
  MIGRATION_FILE_NAMES,
  migrationOutputRelPath,
  resolveMigrationFilePath,
} from './migrationOutputPaths';
import { isSpringBoot3Plus } from '../migrationPromptCore';

export type { CompatibilityFinding } from './migrationCatalog';

export interface InfraJavaFinding {
  file: string;
  detectedVersion: string;
}

export interface MigrationAnalysis {
  sourceJavaVersion: string;
  targetJavaVersion: string;
  springBootVersion: string;
  mavenCompilerPluginVersion: string;
  moduleCount: number;
  javaFileCount: number;
  testFileCount: number;
  configFileCount: number;
  compatibilityFindings: CompatibilityFinding[];
  infraJavaVersions: InfraJavaFinding[];
  dependencyHints: string[];
  recommendations: string[];
}

const JAVA_EXTENSIONS = new Set(['.java', '.kt', '.groovy']);
const CONFIG_EXTENSIONS = new Set(['.properties', '.yml', '.yaml', '.xml']);
const SPRING_BOOT_JAVA21_MIN = '3.2';

function detectJavaVersionFromWorkspace(workspacePath: string): {
  currentJavaVersion: string;
} {
  const pom = analyzePom(workspacePath);
  return { currentJavaVersion: pom.javaVersion };
}

function listFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'target', 'build', '.git', '.idea'].includes(entry.name)) {
        continue;
      }
      listFiles(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

function relativePath(workspacePath: string, filePath: string): string {
  return path.relative(workspacePath, filePath).replace(/\\/g, '/');
}

function extractTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>\\s*([^<]+)\\s*</${tag}>`, 'i'));
  return m?.[1]?.trim() ?? null;
}

function extractParentVersion(xml: string, artifactId: string): string | null {
  const parent = xml.match(/<parent>[\s\S]*?<\/parent>/i);
  if (!parent) return null;
  if (!new RegExp(`<artifactId>${artifactId}<\\/artifactId>`, 'i').test(parent[0])) {
    return null;
  }
  return extractTag(parent[0], 'version');
}

function countModules(xml: string): number {
  const modules = xml.match(/<module>\s*([^<]+)\s*<\/module>/gi);
  return modules?.length ?? 1;
}

function compareSpringBootVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function scanLegacyImports(
  workspacePath: string,
  files: string[]
): CompatibilityFinding[] {
  const findings: CompatibilityFinding[] = [];

  for (const filePath of files) {
    if (!JAVA_EXTENSIONS.has(path.extname(filePath))) continue;
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      const importMatch = line.match(/^\s*import\s+([^;]+);/);
      if (!importMatch) return;

      const importPath = importMatch[1].trim();
      const sortedLegacy = [...LEGACY_IMPORT_PREFIXES].sort(
        (a, b) => b.prefix.length - a.prefix.length
      );
      for (const legacy of sortedLegacy) {
        if (importPath.startsWith(legacy.prefix)) {
          findings.push({
            category: legacy.category,
            id: `import:${legacy.prefix}`,
            file: relativePath(workspacePath, filePath),
            line: index + 1,
            detail: `${importPath} → ${legacy.upgradeNote}`,
          });
          break;
        }
      }
    });
  }

  return findings;
}

function scanSourcePatterns(
  workspacePath: string,
  files: string[]
): CompatibilityFinding[] {
  const findings: CompatibilityFinding[] = [];

  for (const filePath of files) {
    if (!JAVA_EXTENSIONS.has(path.extname(filePath))) continue;
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      for (const pattern of SOURCE_PATTERNS) {
        if (pattern.regex.test(line)) {
          findings.push({
            category: pattern.category,
            id: pattern.id,
            file: relativePath(workspacePath, filePath),
            line: index + 1,
            detail: `${line.trim().slice(0, 100)} → ${pattern.upgradeNote}`,
          });
        }
      }
    });
  }

  return findings;
}

function scanConfigFiles(
  workspacePath: string,
  files: string[]
): CompatibilityFinding[] {
  const findings: CompatibilityFinding[] = [];

  for (const filePath of files) {
    const rel = relativePath(workspacePath, filePath);
    if (!CONFIG_EXTENSIONS.has(path.extname(filePath))) continue;
    if (!rel.includes('/src/') && !rel.startsWith('src/')) continue;

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      for (const pattern of CONFIG_LEGACY_PATTERNS) {
        if (pattern.regex.test(line)) {
          findings.push({
            category: pattern.category,
            id: pattern.id,
            file: rel,
            line: index + 1,
            detail: `${pattern.upgradeNote}`,
          });
        }
      }
    });
  }

  return findings;
}

function scanPomDependencies(
  workspacePath: string,
  springBootVersion: string
): CompatibilityFinding[] {
  const findings: CompatibilityFinding[] = [];
  const pomFiles = listFiles(workspacePath).filter((f) => path.basename(f) === 'pom.xml');
  const boot3 = isSpringBoot3Plus(springBootVersion);

  for (const pomPath of pomFiles) {
    const xml = fs.readFileSync(pomPath, 'utf-8');
    const rel = relativePath(workspacePath, pomPath);

    findings.push(...scanJavaxGroupIdDependencies(xml, rel));

    for (const dep of POM_LEGACY_DEPENDENCIES) {
      if (dep.pattern.test(xml)) {
        findings.push({
          category: dep.category,
          id: `pom-dep:${dep.pattern.source}`,
          file: rel,
          detail: dep.upgradeNote,
        });
      }
    }

    if (boot3) {
      const hasValidation =
        /spring-boot-starter-validation/i.test(xml) || /jakarta\.validation-api/i.test(xml);
      const hasHibernateValidator = /<artifactId>\s*hibernate-validator\s*<\/artifactId>/i.test(
        xml
      );
      if (hasValidation && !hasHibernateValidator) {
        findings.push({
          category: 'incompatible-dependency',
          id: 'validation-provider-missing',
          file: rel,
          detail:
            'validation starter/API var ama hibernate-validator pom\'da yok — transitive exclude olabilir; org.hibernate.validator:hibernate-validator ekle veya exclude kaldır',
        });
      }
    }

    const pluginBlocks = xml.match(/<plugin>[\s\S]*?<\/plugin>/gi) ?? [];
    for (const block of pluginBlocks) {
      const versionMatch = block.match(/<version>\s*([^<]+)\s*<\/version>/i);
      const artifactMatch = block.match(/<artifactId>\s*([^<]+)\s*<\/artifactId>/i);
      if (!artifactMatch) continue;
      const artifact = artifactMatch[1].trim();
      if (
        ['maven-compiler-plugin', 'maven-surefire-plugin', 'maven-failsafe-plugin'].includes(
          artifact
        ) &&
        versionMatch
      ) {
        const major = parseInt(versionMatch[1].trim(), 10);
        if (!Number.isNaN(major) && major < 3) {
          findings.push({
            category: 'build-plugin',
            id: `plugin:${artifact}`,
            file: rel,
            detail: `${artifact} sürümü ${versionMatch[1].trim()} — hedef Java için güncel plugin sürümü gerekli`,
          });
        }
      }
    }
  }

  return findings;
}

function extractDependencyBlocks(xml: string): string[] {
  return xml.match(/<dependency>[\s\S]*?<\/dependency>/gi) ?? [];
}

function scanJavaxGroupIdDependencies(pomXml: string, rel: string): CompatibilityFinding[] {
  const findings: CompatibilityFinding[] = [];
  for (const block of extractDependencyBlocks(pomXml)) {
    if (/<groupId>\s*javax\.[^<]+<\/groupId>/i.test(block)) {
      findings.push({
        category: 'incompatible-dependency',
        id: 'pom-dep:javax-groupId',
        file: rel,
        detail: 'javax groupId — jakarta karşılığına geç',
      });
      break;
    }
  }
  return findings;
}

function extractWorkflowJavaVersions(content: string): string[] {
  const versions: string[] = [];
  for (const match of content.matchAll(/java-version:\s*['"]?([^'"\n#]+)['"]?/gi)) {
    versions.push(match[1].trim());
  }
  for (const match of content.matchAll(/\bjava:\s*\[([^\]]+)\]/gi)) {
    const parts = match[1].split(',').map((part) => part.replace(/['"\s]/g, ''));
    versions.push(...parts.filter(Boolean));
  }
  return versions;
}

function isCiJavaTemplate(value: string): boolean {
  return /\$\{\{/.test(value) || /matrix\./i.test(value);
}

function infraJavaVersionsBelowTarget(
  detectedVersions: string[],
  targetJavaVersion: string
): string | null {
  const target = Number.parseInt(targetJavaVersion, 10);
  if (!Number.isFinite(target)) return null;

  const concrete = detectedVersions.filter((value) => value && !isCiJavaTemplate(value));
  if (concrete.length === 0) return null;

  let worst: string | null = null;
  for (const value of concrete) {
    const major = Number.parseInt(value.split('.')[0] ?? '', 10);
    if (!Number.isFinite(major)) continue;
    if (major < target) {
      worst = value;
    }
  }
  return worst;
}

function scanSpringBoot3AdviceConflicts(
  workspacePath: string,
  javaFiles: string[],
  springBootVersion: string
): CompatibilityFinding[] {
  if (!isSpringBoot3Plus(springBootVersion)) {
    return [];
  }

  const findings: CompatibilityFinding[] = [];

  for (const filePath of javaFiles) {
    const rel = relativePath(workspacePath, filePath);
    if (!/\/src\/main\//i.test(rel)) continue;
    const content = fs.readFileSync(filePath, 'utf-8');
    const extendsReh = /ResponseEntityExceptionHandler/.test(content);
    const customMaxUpload =
      /@ExceptionHandler\s*\(\s*[^)]*MaxUploadSizeExceededException/.test(content);

    if (extendsReh && customMaxUpload) {
      findings.push({
        category: 'spring-boot-legacy',
        id: 'reh-max-upload-conflict',
        file: rel,
        detail:
          'ResponseEntityExceptionHandler + @ExceptionHandler(MaxUploadSizeExceededException) çakışması — override handleMaxUploadSizeExceeded kullan',
      });
    }
  }

  return findings;
}

function scanInfraJavaVersions(
  workspacePath: string,
  targetJavaVersion: string
): InfraJavaFinding[] {
  const findings: InfraJavaFinding[] = [];

  const dockerfile = path.join(workspacePath, 'Dockerfile');
  if (fs.existsSync(dockerfile)) {
    const content = fs.readFileSync(dockerfile, 'utf-8');
    const m =
      content.match(/eclipse-temurin:(\d+(?:\.\d+)?)/i) ??
      content.match(/openjdk:(\d+(?:\.\d+)?)/i) ??
      content.match(/java:(\d+(?:\.\d+)?)/i);
    if (m) {
      const belowTarget = infraJavaVersionsBelowTarget([m[1]], targetJavaVersion);
      if (belowTarget) {
        findings.push({ file: 'Dockerfile', detectedVersion: belowTarget });
      }
    }
  }

  const workflowsDir = path.join(workspacePath, '.github', 'workflows');
  if (fs.existsSync(workflowsDir)) {
    for (const file of fs.readdirSync(workflowsDir)) {
      if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;
      const content = fs.readFileSync(path.join(workflowsDir, file), 'utf-8');
      const versions = extractWorkflowJavaVersions(content);
      const belowTarget = infraJavaVersionsBelowTarget(versions, targetJavaVersion);
      if (belowTarget) {
        findings.push({
          file: `.github/workflows/${file}`,
          detectedVersion: belowTarget,
        });
      }
    }
  }

  return findings;
}

function buildDependencyHints(
  springBootVersion: string,
  targetJavaVersion: string,
  findingCount: number
): string[] {
  const hints: string[] = [];
  const target = parseInt(targetJavaVersion, 10);

  hints.push(
    `${findingCount} uyumluluk sinyali tespit edildi — yalnızca javax değil, tüm kategoriler ele alınmalı.`
  );

  if (target >= 21) {
    hints.push(`Java ${target}: Spring Boot ${SPRING_BOOT_JAVA21_MIN}+ önerilir (mevcut: ${springBootVersion}).`);
    if (springBootVersion.startsWith('2.')) {
      hints.push('Spring Boot 2.x → 3.x geçişi: Security, Hibernate 6, Jakarta namespace, property renames.');
    }
    if (
      springBootVersion.startsWith('3.') &&
      compareSpringBootVersions(springBootVersion, SPRING_BOOT_JAVA21_MIN) < 0
    ) {
      hints.push(`Spring Boot ${springBootVersion} Java 21 için yetersiz olabilir.`);
    }
  }

  hints.push('Jackson, Hibernate, Netty, Tomcat, Testcontainers sürümleri hedef stack ile hizalanmalı.');
  hints.push('JUnit 5, Mockito (javaagent), ByteBuddy sürümleri hedef JDK ile uyumlu olmalı.');

  return hints;
}

export function analyzeMigrationScope(
  workspacePath: string,
  targetJavaVersion: string
): MigrationAnalysis {
  const detected = detectJavaVersionFromWorkspace(workspacePath);
  const pomPath = path.join(workspacePath, 'pom.xml');
  const pomXml = fs.existsSync(pomPath) ? fs.readFileSync(pomPath, 'utf-8') : '';

  const springBootVersion =
    extractParentVersion(pomXml, 'spring-boot-starter-parent') ?? 'unknown';
  const mavenCompilerPluginVersion = (() => {
    const plugin = pomXml.match(
      /<plugin>[\s\S]*?<artifactId>maven-compiler-plugin<\/artifactId>[\s\S]*?<\/plugin>/i
    );
    if (!plugin) return 'unknown';
    return plugin[0].match(/<version>\s*([^<]+)\s*<\/version>/i)?.[1]?.trim() ?? 'unknown';
  })();

  const allFiles = listFiles(workspacePath);
  const javaFiles = allFiles.filter((f) => {
    const rel = relativePath(workspacePath, f);
    return JAVA_EXTENSIONS.has(path.extname(f)) && rel.includes('/src/');
  });
  const mainFiles = javaFiles.filter((f) => /\/src\/main\//i.test(relativePath(workspacePath, f)));
  const testFiles = javaFiles.filter((f) => /\/src\/test\//i.test(relativePath(workspacePath, f)));
  const configFiles = allFiles.filter((f) => CONFIG_EXTENSIONS.has(path.extname(f)));

  const compatibilityFindings: CompatibilityFinding[] = [
    ...scanLegacyImports(workspacePath, javaFiles),
    ...scanSourcePatterns(workspacePath, javaFiles),
    ...scanConfigFiles(workspacePath, configFiles),
    ...scanPomDependencies(workspacePath, springBootVersion),
    ...scanSpringBoot3AdviceConflicts(workspacePath, javaFiles, springBootVersion),
  ];

  const infraJavaVersions = scanInfraJavaVersions(workspacePath, targetJavaVersion);
  for (const infra of infraJavaVersions) {
    compatibilityFindings.push({
      category: 'infra-java-version',
      id: 'infra-java',
      file: infra.file,
      detail: `Java ${infra.detectedVersion} — hedef ${targetJavaVersion} olmalı`,
    });
  }

  const dependencyHints = buildDependencyHints(
    springBootVersion,
    targetJavaVersion,
    compatibilityFindings.length
  );

  const recommendations = getMandatoryUpgradeChecklist(
    detected.currentJavaVersion,
    targetJavaVersion
  );

  return {
    sourceJavaVersion: detected.currentJavaVersion,
    targetJavaVersion,
    springBootVersion,
    mavenCompilerPluginVersion,
    moduleCount: pomXml ? countModules(pomXml) : 1,
    javaFileCount: mainFiles.length,
    testFileCount: testFiles.length,
    configFileCount: configFiles.length,
    compatibilityFindings,
    infraJavaVersions,
    dependencyHints,
    recommendations,
  };
}

export function countFindingsByCategory(
  analysis: MigrationAnalysis
): Map<string, number> {
  const grouped = groupFindingsByCategory(analysis.compatibilityFindings);
  const counts = new Map<string, number>();
  for (const [cat, list] of grouped) {
    counts.set(cat, list.length);
  }
  return counts;
}

export function formatMigrationAnalysisReport(analysis: MigrationAnalysis): string {
  const grouped = groupFindingsByCategory(analysis.compatibilityFindings);
  const lines: string[] = [
    '# Migration Analysis (pre-upgrade)',
    '',
    '## Versions',
    `- Source Java: ${analysis.sourceJavaVersion}`,
    `- Target Java: ${analysis.targetJavaVersion}`,
    `- Spring Boot parent: ${analysis.springBootVersion}`,
    `- maven-compiler-plugin: ${analysis.mavenCompilerPluginVersion}`,
    `- Maven modules: ${analysis.moduleCount}`,
    `- Main source files: ${analysis.javaFileCount}`,
    `- Test source files: ${analysis.testFileCount}`,
    `- Config files scanned: ${analysis.configFileCount}`,
    `- Total compatibility signals: ${analysis.compatibilityFindings.length}`,
    '',
    '## Dependency / stack hints',
    ...analysis.dependencyHints.map((h) => `- ${h}`),
    '',
  ];

  for (const [category, findings] of grouped) {
    const label = CATEGORY_LABELS[category] ?? category;
    lines.push(`## ${label} (${findings.length})`);
    if (findings.length === 0) {
      lines.push('- None detected.');
    } else {
      findings.slice(0, 40).forEach((f) => {
        const loc = f.line ? `${f.file}:${f.line}` : f.file;
        lines.push(`- [${f.id}] ${loc} — ${f.detail}`);
      });
      if (findings.length > 40) {
        lines.push(`_(${findings.length - 40} more omitted)_`);
      }
    }
    lines.push('');
  }

  lines.push('## Mandatory migration checklist (all categories)');
  analysis.recommendations.forEach((r) => lines.push(`- ${r}`));
  lines.push('');

  return lines.join('\n');
}

const PROMPT_SUMMARY_MAX_FINDINGS = 12;

export function formatMigrationAnalysisPromptSummary(analysis: MigrationAnalysis): string {
  const grouped = groupFindingsByCategory(analysis.compatibilityFindings);
  const lines: string[] = [
    `- Source Java: ${analysis.sourceJavaVersion} → target ${analysis.targetJavaVersion}`,
    `- Spring Boot: ${analysis.springBootVersion}, modules: ${analysis.moduleCount}, signals: ${analysis.compatibilityFindings.length}`,
    '',
    `Top signals (see ${migrationOutputRelPath(MIGRATION_FILE_NAMES.analysis)} on disk for full list):`,
  ];

  let emitted = 0;
  for (const [category, findings] of grouped) {
    if (findings.length === 0 || emitted >= PROMPT_SUMMARY_MAX_FINDINGS) continue;
    const label = CATEGORY_LABELS[category] ?? category;
    for (const finding of findings.slice(0, 2)) {
      if (emitted >= PROMPT_SUMMARY_MAX_FINDINGS) break;
      const loc = finding.line ? `${finding.file}:${finding.line}` : finding.file;
      lines.push(`- [${label}] ${loc} — ${finding.detail.slice(0, 100)}`);
      emitted++;
    }
  }

  if (analysis.compatibilityFindings.length > emitted) {
    lines.push(
      `… ${analysis.compatibilityFindings.length - emitted} more in ${migrationOutputRelPath(MIGRATION_FILE_NAMES.analysis)}`
    );
  }

  return lines.join('\n');
}

export function writeMigrationAnalysisFile(
  workspacePath: string,
  analysis: MigrationAnalysis
): string {
  const report = formatMigrationAnalysisReport(analysis);
  ensureMigrationOutputDir(workspacePath);
  const filePath = resolveMigrationFilePath(workspacePath, MIGRATION_FILE_NAMES.analysis);
  fs.writeFileSync(filePath, report, 'utf-8');
  return filePath;
}
