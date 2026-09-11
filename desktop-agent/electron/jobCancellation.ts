import { spawn, type ChildProcess } from 'child_process';

export class JobCancelledError extends Error {
  constructor() {
    super('İşlem kullanıcı tarafından durduruldu.');
    this.name = 'JobCancelledError';
  }
}

const cancelledJobs = new Set<string>();
const jobProcesses = new Map<string, Set<ChildProcess>>();

export function clearJobCancellation(jobId: string): void {
  cancelledJobs.delete(jobId);
  jobProcesses.delete(jobId);
}

export function isJobCancelled(jobId: string): boolean {
  return cancelledJobs.has(jobId);
}

export function assertJobNotCancelled(jobId: string): void {
  if (isJobCancelled(jobId)) {
    throw new JobCancelledError();
  }
}

export function trackJobProcess(jobId: string, child: ChildProcess): void {
  if (!jobProcesses.has(jobId)) {
    jobProcesses.set(jobId, new Set());
  }
  const bucket = jobProcesses.get(jobId)!;
  bucket.add(child);

  const cleanup = () => bucket.delete(child);
  child.once('close', cleanup);
  child.once('error', cleanup);
}

export function terminateProcessTree(child: ChildProcess): void {
  if (!child.pid) return;

  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        shell: true,
        windowsHide: true,
        stdio: 'ignore',
      });
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    // best effort
  }
}

export function cancelJob(jobId: string): void {
  cancelledJobs.add(jobId);
  const processes = jobProcesses.get(jobId);
  if (!processes) return;

  for (const child of processes) {
    terminateProcessTree(child);
  }
}
