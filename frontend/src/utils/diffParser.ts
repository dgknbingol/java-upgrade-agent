export type FileCategory =
  | 'Maven'
  | 'Gradle'
  | 'CI/CD'
  | 'Documentation'
  | 'Runtime / Devcontainer'
  | 'Source / Config';

export interface VersionChange {
  from: string;
  to: string;
  context?: string;
}

export interface DiffLine {
  type: 'remove' | 'add' | 'context';
  content: string;
}

export interface ParsedFileDiff {
  path: string;
  category: FileCategory;
  versionChanges: VersionChange[];
  changedLines: DiffLine[];
}

export interface DiffSummaryData {
  files: ParsedFileDiff[];
  totalChangedFiles: number;
  javaVersionChanges: VersionChange[];
  mavenChanged: boolean;
  ciChanged: boolean;
  dockerChanged: boolean;
  docsChanged: boolean;
  primaryJavaChange: VersionChange | null;
}

function classifyFile(path: string): FileCategory {
  const normalized = path.replace(/\\/g, '/');

  if (normalized.endsWith('pom.xml')) return 'Maven';
  if (normalized.endsWith('build.gradle') || normalized.endsWith('build.gradle.kts')) {
    return 'Gradle';
  }
  if (normalized.includes('.github/workflows/') && /\.ya?ml$/i.test(normalized)) {
    return 'CI/CD';
  }
  if (/README\.md$/i.test(normalized)) return 'Documentation';
  if (/Dockerfile$/i.test(normalized) || normalized.includes('.devcontainer/')) {
    return 'Runtime / Devcontainer';
  }
  return 'Source / Config';
}

function uniqueVersionChanges(changes: VersionChange[]): VersionChange[] {
  const seen = new Set<string>();
  const result: VersionChange[] = [];

  for (const change of changes) {
    const key = `${change.from}->${change.to}:${change.context ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(change);
  }

  return result;
}

function extractVersionTokens(line: string): string[] {
  const tokens: string[] = [];
  const patterns = [
    /JavaLanguageVersion\.of\((\d+)\)/,
    /java:\s*\[\s*'(\d+)'\s*\]/,
    /VARIANT=(\d+-[a-z]+|\d+)/i,
    /JAVA_VERSION=([\d.]+-[a-z]+|\d+(?:\.\d+)*)/i,
    /<java\.version>(\d+)<\/java\.version>/,
    /Java\s+(\d+)\s+or/i,
    /'(\d{1,2}(?:\.\d+)*(?:-[a-z0-9]+)?)'/g,
    /(\d{1,2}(?:\.\d+)*(?:-[a-z0-9]+)?)/g,
  ];

  for (const pattern of patterns) {
    if (pattern.global) {
      for (const match of line.matchAll(pattern)) {
        if (match[1]) tokens.push(match[1]);
      }
    } else {
      const match = line.match(pattern);
      if (match?.[1]) tokens.push(match[1]);
    }
  }

  return [...new Set(tokens)];
}

function pairVersionChanges(removed: string, added: string): VersionChange[] {
  const oldTokens = extractVersionTokens(removed);
  const newTokens = extractVersionTokens(added);

  if (oldTokens.length === 0 || newTokens.length === 0) {
    return [];
  }

  const changes: VersionChange[] = [];
  const pairCount = Math.min(oldTokens.length, newTokens.length);

  for (let i = 0; i < pairCount; i++) {
    if (oldTokens[i] !== newTokens[i]) {
      changes.push({
        from: oldTokens[i],
        to: newTokens[i],
        context: removed.trim().slice(0, 80),
      });
    }
  }

  return changes;
}

function parseFileSection(section: string): ParsedFileDiff | null {
  const headerMatch = section.match(/^diff --git a\/(.+?) b\/(.+)$/m);
  if (!headerMatch) return null;

  const path = headerMatch[2].trim();
  const changedLines: DiffLine[] = [];
  const versionChanges: VersionChange[] = [];

  const lines = section.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('@@')) {
      continue;
    }

    if (line.startsWith('-')) {
      const content = line.slice(1);
      changedLines.push({ type: 'remove', content });

      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const next = lines[j];
        if (!next.startsWith('+')) continue;
        versionChanges.push(...pairVersionChanges(content, next.slice(1)));
        break;
      }
      continue;
    }

    if (line.startsWith('+')) {
      changedLines.push({ type: 'add', content: line.slice(1) });
    }
  }

  return {
    path,
    category: classifyFile(path),
    versionChanges: uniqueVersionChanges(versionChanges),
    changedLines: changedLines.slice(0, 12),
  };
}

function pickPrimaryJavaChange(changes: VersionChange[]): VersionChange | null {
  const simple = changes.find((c) => /^\d{1,2}$/.test(c.from) && /^\d{1,2}$/.test(c.to));
  if (simple) return simple;

  const major = changes.find((c) => c.from.split('.')[0] !== c.to.split('.')[0]);
  if (major) return major;

  return changes[0] ?? null;
}

export function parseGitDiff(diff: string): DiffSummaryData | null {
  const trimmed = diff.trim();
  if (!trimmed || trimmed.startsWith('Henüz diff') || trimmed.startsWith('Kaynak branch')) {
    return null;
  }

  const sections = trimmed.split(/^diff --git /m).filter(Boolean);
  const files = sections
    .map((section) => parseFileSection(`diff --git ${section}`))
    .filter((file): file is ParsedFileDiff => file !== null);

  if (files.length === 0) return null;

  const javaVersionChanges = uniqueVersionChanges(
    files.flatMap((file) => file.versionChanges)
  );

  return {
    files,
    totalChangedFiles: files.length,
    javaVersionChanges,
    mavenChanged: files.some((f) => f.category === 'Maven'),
    ciChanged: files.some((f) => f.category === 'CI/CD'),
    dockerChanged: files.some((f) => f.category === 'Runtime / Devcontainer'),
    docsChanged: files.some((f) => f.category === 'Documentation'),
    primaryJavaChange: pickPrimaryJavaChange(javaVersionChanges),
  };
}
