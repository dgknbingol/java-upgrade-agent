import { execSync } from 'child_process';
import fs from 'fs';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearWindowsReadonlyFlags(dirPath: string): void {
  if (process.platform !== 'win32') {
    return;
  }

  try {
    execSync(`attrib -R "${dirPath}\\*.*" /S /D`, { stdio: 'ignore' });
  } catch {
    // Best effort only.
  }
}

export async function removeDirectorySafe(dirPath: string): Promise<void> {
  if (!fs.existsSync(dirPath)) {
    return;
  }

  const maxAttempts = 6;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      clearWindowsReadonlyFlags(dirPath);
      fs.rmSync(dirPath, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 300,
      });
      return;
    } catch (err) {
      if (attempt === maxAttempts) {
        console.warn(
          `[workspace-cleanup] Klasör silinemedi (analiz sonucu yine de döndürüldü): ${dirPath}`,
          err instanceof Error ? err.message : err
        );
        return;
      }
      await sleep(250 * attempt);
    }
  }
}
