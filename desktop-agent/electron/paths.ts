import { app } from 'electron';
import fs from 'fs';
import path from 'path';

/**
 * Packaged .exe içinde __dirname app.asar altındadır — oraya clone yazılamaz.
 * Kurulumda: %APPDATA%/java-upgrade-desktop-agent/workspaces
 * Geliştirmede: desktop-agent/workspaces
 */
export function getWorkspacesRoot(): string {
  const root = app.isPackaged
    ? path.join(app.getPath('userData'), 'workspaces')
    : path.join(__dirname, '..', 'workspaces');

  fs.mkdirSync(root, { recursive: true });
  return root;
}

export function resolveWorkspacePath(jobId: string): string {
  return path.join(getWorkspacesRoot(), jobId);
}
