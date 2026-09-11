import { spawn, SpawnOptionsWithoutStdio } from 'child_process';
import path from 'path';

export function shouldUseShell(executable: string): boolean {
  if (process.platform !== 'win32') {
    return false;
  }

  const ext = path.extname(executable).toLowerCase();
  if (ext === '.cmd' || ext === '.bat') {
    return true;
  }

  if (!path.isAbsolute(executable) && !executable.includes('\\') && !executable.includes('/')) {
    return true;
  }

  return false;
}

export function spawnCommand(
  executable: string,
  args: string[],
  options: SpawnOptionsWithoutStdio = {}
) {
  return spawn(executable, args, {
    ...options,
    shell: options.shell ?? shouldUseShell(executable),
  });
}
