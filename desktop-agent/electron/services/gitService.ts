import fs from 'fs';
import path from 'path';
import { runCommand, runCommandStreaming } from './commandRunner';

export async function cloneRepositoryShallow(
  source: string,
  targetPath: string,
  branch: string,
  onLog?: (line: string) => void
): Promise<void> {
  const parentDir = path.dirname(targetPath);
  if (fs.existsSync(parentDir) && !fs.statSync(parentDir).isDirectory()) {
    throw new Error(`Workspace üst klasörü bir dizin değil: ${parentDir}`);
  }
  fs.mkdirSync(parentDir, { recursive: true });

  const code = await runCommandStreaming(
    'git',
    ['clone', '--depth', '1', '--branch', branch, '--single-branch', source, targetPath],
    {
      onStdout: (t) => logLines(t, onLog),
      onStderr: (t) => logLines(t, onLog, '[stderr] '),
    }
  );
  if (code !== 0) {
    throw new Error(
      `Repo klonlanamadı. Kaynak ve "${branch}" branch adını kontrol edin.`
    );
  }
}

export async function cloneRepository(
  repoUrl: string,
  targetPath: string,
  onLog?: (line: string) => void
): Promise<void> {
  const parentDir = path.dirname(targetPath);
  if (fs.existsSync(parentDir) && !fs.statSync(parentDir).isDirectory()) {
    throw new Error(`Workspace üst klasörü bir dizin değil: ${parentDir}`);
  }
  fs.mkdirSync(parentDir, { recursive: true });
  const code = await runCommandStreaming(
    'git',
    ['clone', repoUrl, targetPath],
    {
      onStdout: (t) => logLines(t, onLog),
      onStderr: (t) => logLines(t, onLog, '[stderr] '),
    }
  );
  if (code !== 0) throw new Error('git clone başarısız oldu');
}

export async function checkoutBranch(
  cwd: string,
  branch: string,
  onLog?: (line: string) => void
): Promise<void> {
  const code = await runCommandStreaming(
    'git',
    ['checkout', branch],
    {
      cwd,
      onStdout: (t) => logLines(t, onLog),
      onStderr: (t) => logLines(t, onLog, '[stderr] '),
    }
  );
  if (code !== 0) throw new Error(`Branch checkout başarısız: ${branch}`);
}

export async function fetchOrigin(cwd: string, onLog?: (line: string) => void): Promise<void> {
  await runCommandStreaming('git', ['fetch', 'origin'], {
    cwd,
    onStdout: (t) => logLines(t, onLog),
    onStderr: (t) => logLines(t, onLog, '[stderr] '),
  });
}

export async function branchExists(cwd: string, branchName: string): Promise<boolean> {
  const local = await runCommand('git', ['show-ref', '--verify', `refs/heads/${branchName}`], {
    cwd,
  });
  if (local.exitCode === 0) return true;

  const remote = await runCommand('git', ['ls-remote', '--heads', 'origin', branchName], {
    cwd,
  });
  return remote.stdout.trim().length > 0;
}

export async function getCurrentBranch(cwd: string): Promise<string> {
  const result = await runCommand('git', ['branch', '--show-current'], { cwd });
  return result.stdout.trim();
}

export async function checkoutWorkBranch(
  cwd: string,
  baseBranch: string,
  workBranch: string,
  onLog?: (line: string) => void
): Promise<void> {
  if (await branchExists(cwd, workBranch)) {
    onLog?.(`Mevcut branch açılıyor: ${workBranch}`);
    await checkoutBranch(cwd, workBranch, onLog);
    return;
  }

  await checkoutBranch(cwd, baseBranch, onLog);
  await createBranch(cwd, workBranch, onLog);
  onLog?.(`Yeni branch oluşturuldu: ${workBranch}`);
}

export async function createBranch(
  cwd: string,
  branchName: string,
  onLog?: (line: string) => void
): Promise<void> {
  const code = await runCommandStreaming(
    'git',
    ['checkout', '-b', branchName],
    {
      cwd,
      onStdout: (t) => logLines(t, onLog),
      onStderr: (t) => logLines(t, onLog, '[stderr] '),
    }
  );
  if (code !== 0) throw new Error(`Branch oluşturulamadı: ${branchName}`);
}

export async function getDiff(cwd: string, baseBranch: string): Promise<string> {
  const strategies = [
    ['diff', `${baseBranch}...HEAD`],
    ['diff', `${baseBranch}..HEAD`],
    ['diff', baseBranch],
    ['diff', 'HEAD'],
    ['diff'],
  ];

  for (const args of strategies) {
    const result = await runCommand('git', args, { cwd });
    if (result.stdout.trim()) {
      return result.stdout;
    }
  }

  return '';
}

export async function hasWorkingTreeChanges(cwd: string): Promise<boolean> {
  const result = await runCommand('git', ['status', '--porcelain'], { cwd });
  return result.stdout.trim().length > 0;
}

/** Working tree + untracked snapshot for before/after Copilot edit detection. */
export async function getWorkingTreeSnapshot(cwd: string): Promise<string> {
  const result = await runCommand('git', ['status', '--porcelain'], { cwd });
  return result.stdout.trim();
}

/**
 * Snapshot of project source changes (ignores .java-upgrade prompt dumps).
 * Uses git diff HEAD so further edits to already-dirty files are detected.
 */
export async function getProjectEditSnapshot(cwd: string): Promise<string> {
  const diff = await runCommand('git', ['diff', 'HEAD'], { cwd });
  const untracked = await runCommand('git', ['ls-files', '-o', '--exclude-standard'], {
    cwd,
  });

  const filterUpgradeDir = (text: string) =>
    text
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0 && !line.includes('.java-upgrade'))
      .join('\n');

  return `${filterUpgradeDir(diff.stdout)}\n--untracked--\n${filterUpgradeDir(untracked.stdout)}`;
}

export async function pushBranch(
  cwd: string,
  branchName: string,
  onLog?: (line: string) => void
): Promise<void> {
  const code = await runCommandStreaming(
    'git',
    ['push', '-u', 'origin', branchName],
    {
      cwd,
      onStdout: (t) => logLines(t, onLog),
      onStderr: (t) => logLines(t, onLog, '[stderr] '),
    }
  );
  if (code !== 0) throw new Error(`git push başarısız: ${branchName}`);
}

export async function commitAndPushBranch(
  cwd: string,
  branchName: string,
  commitMessage: string,
  onLog?: (line: string) => void
): Promise<void> {
  const current = await runCommand('git', ['branch', '--show-current'], { cwd });
  if (current.stdout.trim() !== branchName) {
    const checkoutCode = await runCommandStreaming(
      'git',
      ['checkout', branchName],
      {
        cwd,
        onStdout: (t) => logLines(t, onLog),
        onStderr: (t) => logLines(t, onLog, '[stderr] '),
      }
    );
    if (checkoutCode !== 0) {
      throw new Error(`Upgrade branch'e geçilemedi: ${branchName}`);
    }
  }

  if (await hasWorkingTreeChanges(cwd)) {
    onLog?.('Değişiklikler commit ediliyor...');
    const addCode = await runCommandStreaming(
      'git',
      ['add', '-A'],
      {
        cwd,
        onStdout: (t) => logLines(t, onLog),
        onStderr: (t) => logLines(t, onLog, '[stderr] '),
      }
    );
    if (addCode !== 0) throw new Error('git add başarısız');

    const commitCode = await runCommandStreaming(
      'git',
      ['commit', '-m', commitMessage],
      {
        cwd,
        onStdout: (t) => logLines(t, onLog),
        onStderr: (t) => logLines(t, onLog, '[stderr] '),
      }
    );
    if (commitCode !== 0) throw new Error('git commit başarısız');
    onLog?.('Commit oluşturuldu.');
  } else {
    onLog?.('Yerel değişiklik yok — mevcut commit push edilecek.');
  }

  await pushBranch(cwd, branchName, onLog);
}

export async function rollbackWorkspace(
  cwd: string,
  sourceBranch: string,
  upgradeBranch: string,
  onLog?: (line: string) => void
): Promise<void> {
  onLog?.('Yerel değişiklikler geri alınıyor...');

  const resetCode = await runCommandStreaming(
    'git',
    ['reset', '--hard', 'HEAD'],
    {
      cwd,
      onStdout: (t) => logLines(t, onLog),
      onStderr: (t) => logLines(t, onLog, '[stderr] '),
    }
  );
  if (resetCode !== 0) throw new Error('git reset başarısız');

  const cleanCode = await runCommandStreaming(
    'git',
    ['clean', '-fd'],
    {
      cwd,
      onStdout: (t) => logLines(t, onLog),
      onStderr: (t) => logLines(t, onLog, '[stderr] '),
    }
  );
  if (cleanCode !== 0) throw new Error('git clean başarısız');

  onLog?.(`Kaynak branch'e dönülüyor: ${sourceBranch}`);
  const checkoutCode = await runCommandStreaming(
    'git',
    ['checkout', sourceBranch],
    {
      cwd,
      onStdout: (t) => logLines(t, onLog),
      onStderr: (t) => logLines(t, onLog, '[stderr] '),
    }
  );
  if (checkoutCode !== 0) {
    throw new Error(`Kaynak branch'e dönülemedi: ${sourceBranch}`);
  }

  if (upgradeBranch && upgradeBranch !== sourceBranch) {
    const deleteResult = await runCommand('git', ['branch', '-D', upgradeBranch], { cwd });
    if (deleteResult.exitCode === 0) {
      onLog?.(`Upgrade branch silindi: ${upgradeBranch}`);
    }
  }

  onLog?.('Rollback tamamlandı.');
}

function logLines(text: string, onLog?: (line: string) => void, prefix = ''): void {
  if (!onLog) return;
  text.split(/\r?\n/).forEach((line) => {
    if (line.length > 0) onLog(`${prefix}${line}`);
  });
}
