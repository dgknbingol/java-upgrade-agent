import { parseGitDiff } from '../utils/diffParser';

interface DiffSummaryProps {
  diff: string;
}

function yesNo(value: boolean): string {
  return value ? 'güncellendi' : 'yok';
}

export function DiffSummary({ diff }: DiffSummaryProps) {
  const summary = parseGitDiff(diff);

  if (!summary) {
    return null;
  }

  const javaLabel = summary.primaryJavaChange
    ? `${summary.primaryJavaChange.from} → ${summary.primaryJavaChange.to}`
    : summary.javaVersionChanges.length > 0
      ? summary.javaVersionChanges.map((c) => `${c.from} → ${c.to}`).join(', ')
      : '—';

  return (
    <div className="diff-summary artifact-primary-scroll">
      <div className="diff-summary-top">
        <h3>Visual Summary</h3>
        <div className="diff-summary-stats">
          <span>
            <strong>Java Target:</strong> {javaLabel}
          </span>
          <span>
            <strong>Changed Files:</strong> {summary.totalChangedFiles}
          </span>
          <span>
            <strong>Maven:</strong> {yesNo(summary.mavenChanged)}
          </span>
          <span>
            <strong>CI:</strong> {yesNo(summary.ciChanged)}
          </span>
          <span>
            <strong>Devcontainer:</strong> {yesNo(summary.dockerChanged)}
          </span>
          <span>
            <strong>Docs:</strong> {yesNo(summary.docsChanged)}
          </span>
        </div>
      </div>

      <div className="diff-file-cards">
        {summary.files.map((file) => (
          <article key={file.path} className="diff-file-card">
            <div className="diff-file-card-header">
              <code className="diff-file-path">{file.path}</code>
              <span className={`diff-badge diff-badge-${file.category.replace(/[^a-z]+/gi, '-').toLowerCase()}`}>
                {file.category}
              </span>
            </div>

            {file.versionChanges.length > 0 && (
              <div className="diff-version-changes">
                {file.versionChanges.map((change) => (
                  <span key={`${file.path}-${change.from}-${change.to}`} className="diff-version-pill">
                    <span className="diff-remove-inline">{change.from}</span>
                    <span className="diff-arrow">→</span>
                    <span className="diff-add-inline">{change.to}</span>
                  </span>
                ))}
              </div>
            )}

            <div className="diff-line-preview">
              {file.changedLines.map((line, index) => (
                <div
                  key={`${file.path}-${index}`}
                  className={
                    line.type === 'remove'
                      ? 'diff-line diff-line-remove'
                      : line.type === 'add'
                        ? 'diff-line diff-line-add'
                        : 'diff-line'
                  }
                >
                  {line.type === 'remove' ? '−' : line.type === 'add' ? '+' : ' '}
                  {line.content}
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
