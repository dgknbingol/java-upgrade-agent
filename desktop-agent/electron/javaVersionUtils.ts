export function normalizeJavaVersion(version: string): string {
  const trimmed = version.trim();
  if (trimmed === '1.8') return '8';
  if (trimmed === '1.7') return '7';
  if (trimmed.startsWith('1.')) return trimmed.slice(2);
  return trimmed;
}

export function parseJavaMajor(version: string): number | null {
  const normalized = normalizeJavaVersion(version);
  const major = Number.parseInt(normalized.split('.')[0] ?? '', 10);
  return Number.isFinite(major) ? major : null;
}

/** `java -version` çıktısından major sürüm (ör. 21, 17, 8). */
export function parseJavaMajorFromVersionOutput(output: string): number | null {
  const match = output.match(/version\s+"([^"]+)"/i);
  if (!match?.[1]) return null;
  return parseJavaMajor(match[1]);
}

export function javaMajorMeetsTarget(installedMajor: number, targetMajor: number): boolean {
  return installedMajor >= targetMajor;
}

export function getJavaInstallHint(targetJavaVersion: string): string {
  const major = parseJavaMajor(targetJavaVersion) ?? 21;
  return `winget install EclipseAdoptium.Temurin.${major}.JDK`;
}

export function javaVersionsDiffer(source: string, target: string): boolean {
  return normalizeJavaVersion(source) !== normalizeJavaVersion(target);
}
