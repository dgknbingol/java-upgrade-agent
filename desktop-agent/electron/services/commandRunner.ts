import { JobCancelledError, isJobCancelled, trackJobProcess } from '../jobCancellation';
import { getCurrentJobId } from '../jobContext';
import { getProcessEnv, resolveCommand } from './processEnv';
import { spawnCommand } from './spawnUtil';

export interface RunCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  jobId?: string;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface RunCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions = {}
): Promise<RunCommandResult> {
  const jobId = options.jobId ?? getCurrentJobId() ?? undefined;
  if (jobId && isJobCancelled(jobId)) {
    return Promise.reject(new JobCancelledError());
  }

  return new Promise((resolve, reject) => {
    const executable = resolveCommand(command);
    const child = spawnCommand(executable, args, {
      cwd: options.cwd,
      env: { ...getProcessEnv(), ...options.env },
    });

    if (jobId) {
      trackJobProcess(jobId, child);
    }

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      options.onStdout?.(text);
    });

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      options.onStderr?.(text);
    });

    child.on('error', (err) => reject(err));

    child.on('close', (code) => {
      if (jobId && isJobCancelled(jobId)) {
        reject(new JobCancelledError());
        return;
      }
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });

    if (options.input) {
      child.stdin?.write(options.input);
      child.stdin?.end();
    }
  });
}

export function runCommandStreaming(
  command: string,
  args: string[],
  options: RunCommandOptions = {}
): Promise<number> {
  return runCommand(command, args, options).then((r) => r.exitCode);
}
