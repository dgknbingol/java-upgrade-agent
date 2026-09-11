import { execSync } from 'child_process';
import fs from 'fs';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearWindowsReadonlyFlags(dirPath: string): void {
  if (process.platform !== 'win32') return;
  try {
    execSync(`attrib -R "${dirPath}\\*.*" /S /D`, { stdio: 'ignore' });
  } catch {
    // best effort
  }
}

export async function removeDirectorySafe(dirPath: string): Promise<void> {
  if (!fs.existsSync(dirPath)) return;

  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      clearWindowsReadonlyFlags(dirPath);
      fs.rmSync(dirPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
      return;
    } catch {
      if (attempt === 6) return;
      await sleep(250 * attempt);
    }
  }
}
