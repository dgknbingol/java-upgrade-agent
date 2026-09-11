import fs from 'fs';
import path from 'path';

const defaultWorkspacesDir = path.join(__dirname, '..', 'workspaces');

export function getDefaultWorkspacesDir(): string {
  return defaultWorkspacesDir;
}

export function resolveJobWorkspacePath(jobId: string, workspaceRoot?: string): string {
  const root = workspaceRoot?.trim()
    ? path.resolve(workspaceRoot.trim())
    : defaultWorkspacesDir;

  fs.mkdirSync(root, { recursive: true });
  return path.join(root, jobId);
}

export function validateLocalRepoPath(localPath: string): string {
  const resolved = path.resolve(localPath.trim());

  if (!fs.existsSync(resolved)) {
    throw new Error(`Yerel klasör bulunamadı: ${resolved}`);
  }

  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error('Yerel kaynak geçerli bir klasör olmalıdır.');
  }

  const gitDir = path.join(resolved, '.git');
  if (!fs.existsSync(gitDir)) {
    throw new Error('Yerel klasör bir Git repository değil (.git bulunamadı).');
  }

  return resolved;
}
