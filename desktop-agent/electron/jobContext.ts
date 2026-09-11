let currentJobId: string | null = null;

export function setCurrentJobId(jobId: string | null): void {
  currentJobId = jobId;
}

export function getCurrentJobId(): string | null {
  return currentJobId;
}

export async function withJobContext<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
  setCurrentJobId(jobId);
  try {
    return await fn();
  } finally {
    setCurrentJobId(null);
  }
}
