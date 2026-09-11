import fs from 'fs';
import path from 'path';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'target', 'build', 'dist', '.idea', '.gradle']);

const LOCAL_PROPERTIES_REL = path.join('src', 'main', 'resources', 'application-local.properties');

export function findProjectLocalPropertiesFiles(workspacePath: string): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
        continue;
      }

      const filePath = path.join(dir, entry.name);
      const normalized = filePath.split(path.sep).join('/');
      if (!normalized.endsWith('src/main/resources/application-local.properties')) continue;
      results.push(filePath);
    }
  }

  walk(workspacePath);
  return results.sort();
}

export function resolveDefaultLocalPropertiesPath(workspacePath: string): string {
  return path.join(workspacePath, LOCAL_PROPERTIES_REL);
}

export function applyLocalPropertiesOverride(
  workspacePath: string,
  sourceFilePath: string
): { targets: string[]; created: boolean } {
  const resolvedSource = path.resolve(sourceFilePath);
  if (!fs.existsSync(resolvedSource)) {
    throw new Error(`Properties dosyası bulunamadı: ${resolvedSource}`);
  }

  const content = fs.readFileSync(resolvedSource, 'utf-8');
  const targets = findProjectLocalPropertiesFiles(workspacePath);

  if (targets.length === 0) {
    const defaultTarget = resolveDefaultLocalPropertiesPath(workspacePath);
    fs.mkdirSync(path.dirname(defaultTarget), { recursive: true });
    fs.writeFileSync(defaultTarget, content, 'utf-8');
    return { targets: [defaultTarget], created: true };
  }

  for (const target of targets) {
    fs.writeFileSync(target, content, 'utf-8');
  }

  return { targets, created: false };
}
