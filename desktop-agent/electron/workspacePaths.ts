import fs from 'fs';
import path from 'path';
import { getWorkspacesRoot } from './paths';

export function resolveJobWorkspacePath(jobId: string, workspaceRoot?: string): string {
  const root = workspaceRoot?.trim() ? path.resolve(workspaceRoot.trim()) : getWorkspacesRoot();

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

  if (!fs.existsSync(path.join(resolved, '.git'))) {
    throw new Error('Yerel klasör bir Git repository değil (.git bulunamadı).');
  }

  return resolved;
}

export function validateWorkspaceRoot(workspaceRoot: string): string {
  const resolved = path.resolve(workspaceRoot.trim());

  if (!fs.existsSync(resolved)) {
    throw new Error(`Workspace klasörü bulunamadı: ${resolved}`);
  }

  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error('Workspace yolu geçerli bir klasör olmalıdır.');
  }

  return resolved;
}
