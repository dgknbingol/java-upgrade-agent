import fs from 'fs';
import path from 'path';

/** Workspace içinde migration MD dosyalarının yazıldığı klasör (repo köküne göre). */
export const MIGRATION_OUTPUT_DIR = '.java-upgrade';

export const MIGRATION_FILE_NAMES = {
  report: 'MIGRATION_REPORT.md',
  analysis: 'MIGRATION_ANALYSIS.md',
  validation: 'MIGRATION_VALIDATION.md',
  /** Migration / upgrade phases */
  promptTask: 'JAVA_UPGRADE_TASK.md',
  /** mvn clean install fail → Copilot build fix */
  buildFixTask: 'BUILD_FIX_TASK.md',
  /** Run App / startup fail → Copilot runtime fix */
  runtimeFixTask: 'RUNTIME_FIX_TASK.md',
  /** Mend & Fortify security remediation */
  securityFixTask: 'SECURITY_FIX_TASK.md',
  securityReport: 'SECURITY_REMEDIATION_REPORT.md',
  mendFindings: 'MEND_FINDINGS.md',
  fortifyFindings: 'FORTIFY_FINDINGS.md',
  runAppLog: 'RUN_APP_LOG.txt',
} as const;

export function migrationOutputRelPath(fileName: string): string {
  return path.posix.join(MIGRATION_OUTPUT_DIR, fileName);
}

export function getMigrationOutputDir(workspacePath: string): string {
  return path.join(workspacePath, MIGRATION_OUTPUT_DIR);
}

export function ensureMigrationOutputDir(workspacePath: string): string {
  const dir = getMigrationOutputDir(workspacePath);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolveMigrationFilePath(workspacePath: string, fileName: string): string {
  return path.join(getMigrationOutputDir(workspacePath), fileName);
}

/** Önce .java-upgrade/, yoksa workspace kökündeki legacy dosyalar. */
export function resolveExistingMigrationFilePath(
  workspacePath: string,
  fileName: string
): string | null {
  const primary = resolveMigrationFilePath(workspacePath, fileName);
  if (fs.existsSync(primary)) return primary;

  const legacy = path.join(workspacePath, fileName);
  if (fs.existsSync(legacy)) return legacy;

  return null;
}

export function readLiveMigrationReport(workspacePath: string): string {
  const reportPath = resolveExistingMigrationFilePath(
    workspacePath,
    MIGRATION_FILE_NAMES.report
  );
  if (reportPath) {
    return fs.readFileSync(reportPath, 'utf-8');
  }

  const fallbackParts: string[] = [];
  for (const name of [MIGRATION_FILE_NAMES.validation, MIGRATION_FILE_NAMES.analysis]) {
    const filePath = resolveExistingMigrationFilePath(workspacePath, name);
    if (filePath) {
      const rel = filePath.includes(MIGRATION_OUTPUT_DIR)
        ? migrationOutputRelPath(name)
        : name;
      fallbackParts.push(`# ${rel}\n\n${fs.readFileSync(filePath, 'utf-8')}`);
    }
  }
  if (fallbackParts.length > 0) {
    return fallbackParts.join('\n\n---\n\n');
  }

  return '';
}
