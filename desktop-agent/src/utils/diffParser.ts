export interface DiffFileChange {
  path: string;
  additions: number;
  deletions: number;
  isNew: boolean;
  isDeleted: boolean;
}

export interface DiffSummary {
  files: DiffFileChange[];
  totalAdditions: number;
  totalDeletions: number;
}

export function parseDiffSummary(diff: string): DiffSummary {
  const files: DiffFileChange[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;

  const chunks = diff.split(/^diff --git /m).filter(Boolean);

  for (const chunk of chunks) {
    const header = chunk.split('\n')[0] ?? '';
    const pathMatch = header.match(/a\/(.+?) b\/(.+)/);
    const filePath = pathMatch?.[2] ?? pathMatch?.[1] ?? 'unknown';

    const isNew = chunk.includes('new file mode');
    const isDeleted = chunk.includes('deleted file mode');

    let additions = 0;
    let deletions = 0;

    for (const line of chunk.split('\n')) {
      if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ')) continue;
      if (line.startsWith('+')) additions++;
      if (line.startsWith('-')) deletions++;
    }

    totalAdditions += additions;
    totalDeletions += deletions;

    files.push({ path: filePath, additions, deletions, isNew, isDeleted });
  }

  return { files, totalAdditions, totalDeletions };
}

export function formatDiffSummaryText(diff: string): string {
  if (
    !diff.trim() ||
    diff.startsWith('Kaynak branch') ||
    diff.startsWith('Henüz')
  ) {
    return '';
  }

  const summary = parseDiffSummary(diff);
  const lines = [
    `Dosya sayısı: ${summary.files.length}`,
    `Toplam: +${summary.totalAdditions} / -${summary.totalDeletions}`,
    '',
    ...summary.files.map((file) => {
      const tags = [
        file.isNew ? 'new' : '',
        file.isDeleted ? 'deleted' : '',
      ]
        .filter(Boolean)
        .join(', ');
      const tagSuffix = tags ? ` [${tags}]` : '';
      return `${file.path} (+${file.additions} -${file.deletions})${tagSuffix}`;
    }),
  ];

  return lines.join('\n');
}
