import fs from 'fs';
import path from 'path';
import {
  CATEGORY_LABELS,
  CompatibilityCategory,
  groupFindingsByCategory,
} from './migrationCatalog';
import { requiresJakartaMigration } from './migrationPromptCore';
import {
  MigrationAnalysis,
  analyzeMigrationScope,
  countFindingsByCategory,
} from './migrationAnalyzer';
import { detectJavaVersion } from './javaVersionAnalyzer';
import { javaVersionsDiffer, normalizeJavaVersion } from './javaVersionUtils';
import { getProcessEnv, resolveCommand } from './processEnv';
import { spawnCommand } from './spawnUtil';

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
    const output = await new Promise<string>((resolve) => {
      const child = spawnCommand(resolveCommand('git'), args, {
        cwd: workspacePath,
        env: getProcessEnv(),
      });
      let text = '';
      child.stdout?.on('data', (data: Buffer) => {
        text += data.toString();
      });
      child.on('close', () => resolve(text));
      child.on('error', () => resolve(''));
    });

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
  return detectJavaVersion(workspacePath).currentJavaVersion;
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
      /^(pom\.xml|\.github\/|Dockerfile|MIGRATION_|README)/i.test(norm(f))
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

    if (totalAfter >= totalBefore && javaSourceFilesChanged === 0 && blocking) {
      errors.push({
        severity: 'error',
        code: 'NO_COMPATIBILITY_PROGRESS',
        message: `Uyumluluk sinyalleri azalmadı (${totalBefore} → ${totalAfter}) ve src/main'de kritik bulgu var.`,
      });
    } else if (totalAfter >= totalBefore && javaSourceFilesChanged === 0) {
      warnings.push({
        severity: 'warning',
        code: 'COMPATIBILITY_SCAN_UNCHANGED',
        message: `Tarayıcı ${totalBefore} sinyal gösteriyor; src/main'de kritik bulgu yok — build geçtiyse migration yeterli sayılabilir.`,
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
  fs.writeFileSync(
    path.join(workspacePath, 'MIGRATION_VALIDATION.md'),
    formatValidationReport(result),
    'utf-8'
  );
}
