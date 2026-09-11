export function normalizeJavaVersion(version: string): string {
  const trimmed = version.trim();
  if (trimmed === '1.8') return '8';
  if (trimmed === '1.7') return '7';
  if (trimmed.startsWith('1.')) return trimmed.slice(2);
  return trimmed;
}

export function javaVersionsDiffer(source: string, target: string): boolean {
  return normalizeJavaVersion(source) !== normalizeJavaVersion(target);
}
