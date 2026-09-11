import { getAppConfig } from './config/appConfig';
import { getProcessEnv, resolveCommand } from './processEnv';
import { spawnCommand } from './spawnUtil';

export function buildUpgradeBranchBase(version: string): string {
  const config = getAppConfig();
  return config.renderTemplate(config.upgradeBranchPattern, { version });
}

function gitExitCode(command: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawnCommand(resolveCommand(command), args, {
      cwd,
      env: getProcessEnv(),
      shell: false,
    });

    child.stdin?.end();
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

function readProcessOutput(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(resolveCommand(command), args, {
      cwd,
      env: getProcessEnv(),
    });
    let output = '';

    child.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    child.on('error', reject);
    child.on('close', () => resolve(output));
  });
}

async function localBranchExists(cwd: string, branchName: string): Promise<boolean> {
  const code = await gitExitCode('git', ['show-ref', '--verify', `refs/heads/${branchName}`], cwd);
  return code === 0;
}

async function remoteBranchExists(cwd: string, branchName: string): Promise<boolean> {
  const output = await readProcessOutput(
    'git',
    ['ls-remote', '--heads', 'origin', branchName],
    cwd
  );
  return output.trim().length > 0;
}

async function branchExists(cwd: string, branchName: string): Promise<boolean> {
  const [local, remote] = await Promise.all([
    localBranchExists(cwd, branchName),
    remoteBranchExists(cwd, branchName),
  ]);
  return local || remote;
}

export async function resolveAvailableUpgradeBranch(
  cwd: string,
  version: string
): Promise<string> {
  const base = buildUpgradeBranchBase(version);
  const candidates = [base];

  for (let suffix = 2; suffix <= 999; suffix++) {
    candidates.push(`${base}-${suffix}`);
  }

  for (const name of candidates) {
    if (!(await branchExists(cwd, name))) {
      return name;
    }
  }

  throw new Error('Kullanılabilir upgrade branch adı bulunamadı');
}
