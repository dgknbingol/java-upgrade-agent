import fs from 'fs';
import path from 'path';
import {
  CATEGORY_LABELS,
  CompatibilityCategory,
  groupFindingsByCategory,
} from './migrationCatalog';
import { requiresJakartaMigration } from '../migrationPromptCore';
import {
  MigrationAnalysis,
  analyzeMigrationScope,
  countFindingsByCategory,
} from './migrationAnalyzer';
import { analyzePom } from './mavenService';
import { runCommand } from './commandRunner';
import {
  ensureMigrationOutputDir,
  MIGRATION_FILE_NAMES,
  resolveMigrationFilePath,
} from './migrationOutputPaths';

function normalizeJavaVersion(version: string): string {
  const trimmed = version.trim();
  if (trimmed === '1.8') return '8';
  if (trimmed.startsWith('1.')) return trimmed.slice(2);
  return trimmed;
}

function javaVersionsDiffer(source: string, target: string): boolean {
  return normalizeJavaVersion(source) !== normalizeJavaVersion(target);
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface MigrationValidationResult {
  passed: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  changedFiles: string[];
  javaSourceFilesChanged: number;
  configFilesChanged: number;
  pomConfiguredVersion: string;
  remainingFindingCounts: Map<string, number>;
}

const ERROR_IF_REMAINING: CompatibilityCategory[] = [
  'legacy-namespace',
  'removed-jdk-api',
  'internal-jdk-api',
  'incompatible-dependency',
  'spring-boot-legacy',
];

const WARN_IF_REMAINING: CompatibilityCategory[] = [
  'deprecated-jdk-api',
  'legacy-test-api',
  'legacy-logging',
  'config-legacy',
  'infra-java-version',
  'build-plugin',
  'reflection-instrumentation',
];

async function runGitDiffNameOnly(
  workspacePath: string,
  baseRef: string
): Promise<string[]> {
  const attempts = [
    ['diff', '--name-only', `${baseRef}...HEAD`],
    ['diff', '--name-only', `${baseRef}..HEAD`],
    ['diff', '--name-only'],
    ['status', '--porcelain'],
  ];

  for (const args of attempts) {
    let output = '';
    try {
      const result = await runCommand('git', args, { cwd: workspacePath });
      output = result.stdout;
    } catch {
      output = '';
    }

    if (!output.trim()) continue;

    if (args[0] === 'status') {
      return output
        .split(/\r?\n/)
        .map((line) => line.trim().slice(3).trim())
        .filter(Boolean);
    }

    return output
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  }

  return [];
}

function readPomJavaVersion(workspacePath: string): string {
  return analyzePom(workspacePath).javaVersion;
}

function countCategoryInMain(
  analysis: MigrationAnalysis,
  category: CompatibilityCategory
): number {
  return analysis.compatibilityFindings.filter(
    (f) => f.category === category && f.file.includes('/src/main/')
  ).length;
}

function hasBlockingMainFindings(
  analysis: MigrationAnalysis,
  jakartaRequired: boolean
): boolean {
  for (const category of ERROR_IF_REMAINING) {
    const inMain = countCategoryInMain(analysis, category);
    if (inMain === 0) continue;
    if (category === 'legacy-namespace' && !jakartaRequired) continue;
    return true;
  }

  const incompatibleDeps =
    analysis.compatibilityFindings.filter((f) => f.category === 'incompatible-dependency')
      .length;
  return incompatibleDeps > 0;
}

export async function validateMigration(
  workspacePath: string,
  targetJavaVersion: string,
  sourceBranch: string,
  preAnalysis?: MigrationAnalysis
): Promise<MigrationValidationResult> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const pomConfiguredVersion = readPomJavaVersion(workspacePath);
  const changedFiles = await runGitDiffNameOnly(workspacePath, sourceBranch);
  const norm = (f: string) => f.replace(/\\/g, '/');

  const javaSourceFilesChanged = changedFiles.filter((f) =>
    /src\/(main|test)\/.*\.(java|kt|groovy)$/i.test(norm(f))
  ).length;

  const configFilesChanged = changedFiles.filter((f) =>
    /src\/.*\.(properties|yml|yaml|xml)$/i.test(norm(f)) ||
    /^application\.(properties|ya?ml)$/i.test(norm(f))
  ).length;

  if (javaVersionsDiffer(pomConfiguredVersion, targetJavaVersion)) {
    errors.push({
      severity: 'error',
      code: 'POM_JAVA_MISMATCH',
      message: `pom.xml Java ${pomConfiguredVersion}; hedef ${targetJavaVersion} olmalı.`,
    });
  }

  if (changedFiles.length === 0) {
    errors.push({
      severity: 'error',
      code: 'NO_CHANGES',
      message: 'Hiçbir dosya değiştirilmedi — migration gerçekleşmedi.',
    });
  } else if (javaSourceFilesChanged === 0) {
    const onlyMeta = changedFiles.every((f) =>
      /^(pom\.xml|\.github\/|Dockerfile|\.java-upgrade\/|MIGRATION_|README)/i.test(norm(f))
    );
    if (onlyMeta) {
      if (javaVersionsDiffer(pomConfiguredVersion, targetJavaVersion)) {
        errors.push({
          severity: 'error',
          code: 'NO_SOURCE_CHANGES',
          message: 'Kaynak/test kodu güncellenmedi — sadece meta dosyalar değişti.',
        });
      } else {
        warnings.push({
          severity: 'warning',
          code: 'NO_SOURCE_CHANGES',
          message:
            'Kaynak/test kodu değişmedi; POM hedef Java ile uyumlu ve build geçtiyse bu kabul edilebilir.',
        });
      }
    }
  }

  const postAnalysis = analyzeMigrationScope(workspacePath, targetJavaVersion);
  const remainingFindingCounts = countFindingsByCategory(postAnalysis);
  const preCounts = preAnalysis ? countFindingsByCategory(preAnalysis) : null;

  const sourceJava = preAnalysis?.sourceJavaVersion ?? pomConfiguredVersion;
  const migrationRequired = javaVersionsDiffer(sourceJava, targetJavaVersion);
  const jakartaRequired = requiresJakartaMigration(postAnalysis.springBootVersion);

  for (const category of ERROR_IF_REMAINING) {
    const remaining = remainingFindingCounts.get(category) ?? 0;
    const inMain = countCategoryInMain(postAnalysis, category);

    if (category === 'legacy-namespace' && inMain > 0) {
      if (jakartaRequired) {
        errors.push({
          severity: 'error',
          code: `REMAINING_${category.toUpperCase()}`,
          message: `${inMain} adet ${CATEGORY_LABELS[category]} sinyali src/main altında kaldı (Jakarta migration gerekli).`,
        });
      } else {
        warnings.push({
          severity: 'warning',
          code: `REMAINING_${category.toUpperCase()}`,
          message: `${inMain} legacy namespace sinyali var — Jakarta migration gerekli değilse dokunmayın.`,
        });
      }
    } else if (inMain > 0 && category !== 'legacy-namespace') {
      errors.push({
        severity: 'error',
        code: `REMAINING_${category.toUpperCase()}`,
        message: `${inMain} adet ${CATEGORY_LABELS[category]} sinyali src/main altında kaldı.`,
      });
    } else if (remaining > 0 && category === 'incompatible-dependency') {
      errors.push({
        severity: 'error',
        code: 'LEGACY_DEPENDENCIES',
        message: `${remaining} uyumsuz/legacy dependency pom.xml içinde kaldı.`,
      });
    }

    if (preCounts && preCounts.get(category) !== undefined) {
      const before = preCounts.get(category) ?? 0;
      const skipNoProgress =
        category === 'legacy-namespace' && !jakartaRequired;
      if (before > 0 && remaining >= before && !skipNoProgress) {
        errors.push({
          severity: 'error',
          code: `NO_PROGRESS_${category.toUpperCase()}`,
          message: `${CATEGORY_LABELS[category]}: ${before} → ${remaining} (ilerleme yok).`,
        });
      }
    }
  }

  for (const category of WARN_IF_REMAINING) {
    const remaining = remainingFindingCounts.get(category) ?? 0;
    if (remaining > 0) {
      warnings.push({
        severity: 'warning',
        code: `REMAINING_${category.toUpperCase()}`,
        message: `${remaining} adet ${CATEGORY_LABELS[category]} sinyali kaldı.`,
      });
    }
  }

  const target = parseInt(normalizeJavaVersion(targetJavaVersion), 10);
  if (target >= 21 && postAnalysis.springBootVersion.startsWith('2.')) {
    errors.push({
      severity: 'error',
      code: 'SPRING_BOOT_2_ON_JAVA_21',
      message: 'Spring Boot 2.x Java 21 ile uyumlu değil — Boot 3.x geçişi gerekli.',
    });
  }

  if (preAnalysis && preAnalysis.compatibilityFindings.length > 0) {
    const totalBefore = preAnalysis.compatibilityFindings.length;
    const totalAfter = postAnalysis.compatibilityFindings.length;
    const blocking = hasBlockingMainFindings(postAnalysis, jakartaRequired);

    if (migrationRequired && totalAfter >= totalBefore && javaSourceFilesChanged === 0 && blocking) {
      errors.push({
        severity: 'error',
        code: 'NO_COMPATIBILITY_PROGRESS',
        message: `Uyumluluk sinyalleri azalmadı (${totalBefore} → ${totalAfter}) ve src/main'de kritik bulgu var.`,
      });
    } else if (totalAfter >= totalBefore && javaSourceFilesChanged === 0) {
      warnings.push({
        severity: 'warning',
        code: 'COMPATIBILITY_SCAN_UNCHANGED',
        message: migrationRequired
          ? `Tarayıcı ${totalBefore} sinyal gösteriyor; src/main'de kritik bulgu yok — build geçtiyse migration yeterli sayılabilir.`
          : `Kaynak ve hedef Java aynı (${targetJavaVersion}) — statik tarayıcı sinyalleri build'i engellemez.`,
      });
    }
  }

  if (!migrationRequired) {
    const scannerNoiseCodes = new Set([
      'LEGACY_DEPENDENCIES',
      'NO_PROGRESS_INCOMPATIBLE-DEPENDENCY',
      'NO_COMPATIBILITY_PROGRESS',
      'NO_SOURCE_CHANGES',
    ]);
    const demoted = errors.filter((issue) => scannerNoiseCodes.has(issue.code));
    const kept = errors.filter((issue) => !scannerNoiseCodes.has(issue.code));
    errors.length = 0;
    errors.push(...kept);
    for (const issue of demoted) {
      warnings.push({
        severity: 'warning',
        code: issue.code,
        message: `${issue.message} (kaynak=hedef Java ${targetJavaVersion}, build geçtiyse yok sayılabilir)`,
      });
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
    changedFiles,
    javaSourceFilesChanged,
    configFilesChanged,
    pomConfiguredVersion,
    remainingFindingCounts,
  };
}

export function formatValidationReport(result: MigrationValidationResult): string {
  const lines = [
    '# Migration Validation Report',
    '',
    `Status: ${result.passed ? 'PASSED' : 'FAILED'}`,
    `POM Java version: ${result.pomConfiguredVersion}`,
    `Changed files: ${result.changedFiles.length}`,
    `Java source files changed: ${result.javaSourceFilesChanged}`,
    `Config files changed: ${result.configFilesChanged}`,
    '',
  ];

  if (result.remainingFindingCounts.size) {
    lines.push('## Remaining compatibility signals by category');
    for (const [cat, count] of result.remainingFindingCounts) {
      if (count > 0) {
        lines.push(`- ${CATEGORY_LABELS[cat as CompatibilityCategory] ?? cat}: ${count}`);
      }
    }
    lines.push('');
  }

  if (result.errors.length) {
    lines.push('## Errors');
    result.errors.forEach((e) => lines.push(`- [${e.code}] ${e.message}`));
    lines.push('');
  }

  if (result.warnings.length) {
    lines.push('## Warnings');
    result.warnings.forEach((w) => lines.push(`- [${w.code}] ${w.message}`));
    lines.push('');
  }

  if (result.changedFiles.length) {
    lines.push('## Changed files');
    result.changedFiles.slice(0, 100).forEach((f) => lines.push(`- ${f}`));
    if (result.changedFiles.length > 100) {
      lines.push(`_(${result.changedFiles.length - 100} more omitted)_`);
    }
  }

  return lines.join('\n');
}

export function writeValidationReport(
  workspacePath: string,
  result: MigrationValidationResult
): void {
  ensureMigrationOutputDir(workspacePath);
  fs.writeFileSync(
    resolveMigrationFilePath(workspacePath, MIGRATION_FILE_NAMES.validation),
    formatValidationReport(result),
    'utf-8'
  );
}
