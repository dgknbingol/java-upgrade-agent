import { spawn, type ChildProcess, type SpawnOptionsWithoutStdio } from 'child_process';
import path from 'path';

function isWindowsBatchFile(executable: string): boolean {
  if (process.platform !== 'win32') return false;
  const ext = path.extname(executable).toLowerCase();
  return ext === '.cmd' || ext === '.bat';
}

/**
 * Windows: .cmd/.bat cannot be spawned with shell:false (EINVAL).
 * Use cmd.exe wrapper. .exe tools (git, java) stay shell:false so paths with spaces work.
 */
export function spawnCommand(
  executable: string,
  args: string[],
  options: SpawnOptionsWithoutStdio = {}
): ChildProcess {
  if (isWindowsBatchFile(executable)) {
    return spawn('cmd.exe', ['/d', '/s', '/c', executable, ...args], {
      ...options,
      shell: false,
      windowsHide: options.windowsHide ?? true,
    });
  }

  return spawn(executable, args, {
    ...options,
    shell: false,
    windowsHide: options.windowsHide ?? true,
  });
}
