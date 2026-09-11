import { parseDiffSummary } from '../utils/diffParser';

interface DiffSummaryProps {
  diff: string;
  liveWaiting?: boolean;
}

export function DiffSummary({ diff, liveWaiting = false }: DiffSummaryProps) {
  if (!diff.trim() || diff.startsWith('Kaynak branch') || diff.startsWith('Henüz')) {
    return (
      <p className="output-empty">
        {liveWaiting
          ? 'Diff henüz yok — Copilot değişiklik yaptıkça görsel özet burada canlı görünecek.'
          : 'Görsel özet için diff yok.'}
      </p>
    );
  }

  const summary = parseDiffSummary(diff);

  return (
    <div className="diff-summary">
      <div className="diff-stats">
        <span>{summary.files.length} dosya</span>
        <span className="add">+{summary.totalAdditions}</span>
        <span className="del">-{summary.totalDeletions}</span>
      </div>
      <ul className="diff-file-list">
        {summary.files.map((file) => (
          <li key={file.path}>
            <code>{file.path}</code>
            <span>
              {file.isNew && <em className="tag">new</em>}
              {file.isDeleted && <em className="tag">deleted</em>}
              <span className="add">+{file.additions}</span>
              <span className="del">-{file.deletions}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
