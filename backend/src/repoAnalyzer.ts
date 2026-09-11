import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { detectJavaVersion, JavaVersionDetection } from './javaVersionAnalyzer';
import { getProcessEnv, resolveCommand } from './processEnv';
import { spawnCommand } from './spawnUtil';
import { removeDirectorySafe } from './workspaceCleanup';
import { getDefaultWorkspacesDir, validateLocalRepoPath } from './workspacePaths';
import { SourceMode } from './types';

function runGit(args: string[], cwd?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(resolveCommand('git'), args, {
      cwd,
      env: getProcessEnv(),
    });

    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function cloneForAnalysis(
  source: string,
  sourceBranch: string,
  analyzePath: string
): Promise<void> {
  const cloneCode = await runGit(
    [
      'clone',
      '--depth',
      '1',
      '--branch',
      sourceBranch,
      '--single-branch',
      source,
      analyzePath,
    ],
    undefined
  );

  if (cloneCode !== 0) {
    throw new Error(
      `Repo klonlanamadı. Kaynak ve "${sourceBranch}" branch adını kontrol edin.`
    );
  }
}

export async function analyzeRepository(
  sourceMode: SourceMode,
  sourceBranch: string,
  options: { repoUrl?: string; localRepoPath?: string }
): Promise<JavaVersionDetection> {
  const workspacesDir = getDefaultWorkspacesDir();
  fs.mkdirSync(workspacesDir, { recursive: true });

  const analyzePath = path.join(workspacesDir, `analyze-${uuidv4()}`);

  try {
    if (sourceMode === 'local') {
      const localPath = validateLocalRepoPath(options.localRepoPath || '');
      await cloneForAnalysis(localPath, sourceBranch, analyzePath);
    } else {
      const repoUrl = options.repoUrl?.trim();
      if (!repoUrl) {
        throw new Error('Git Repository URL gerekli.');
      }
      await cloneForAnalysis(repoUrl, sourceBranch, analyzePath);
    }

    return detectJavaVersion(analyzePath);
  } finally {
    await removeDirectorySafe(analyzePath);
  }
}
