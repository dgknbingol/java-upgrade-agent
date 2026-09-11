import { JobCancelledError } from './jobCancellation';

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) {
    return `${totalSec}s`;
  }

  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) {
    return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
  }

  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
}

function outcomeMark(err: unknown): string {
  if (err instanceof JobCancelledError) {
    return '⊗';
  }
  return '✗';
}

/** Çalıştırır; bittiğinde veya hata/iptalde loga `[süre] label: …` yazar. */
export async function timedStep<T>(
  log: (line: string) => void,
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    log(`[süre] ${label}: ${formatDuration(Date.now() - start)} ✓`);
    return result;
  } catch (err) {
    log(`[süre] ${label}: ${formatDuration(Date.now() - start)} ${outcomeMark(err)}`);
    throw err;
  }
}

export function logElapsed(log: (line: string) => void, label: string, startMs: number): void {
  log(`[süre] ${label}: ${formatDuration(Date.now() - startMs)} ✓`);
}
