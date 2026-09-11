import { IconCopy, IconDownload, IconExternalLink } from '../Icons';

interface ArtifactToolbarProps {
  content: string;
  downloadFilename: string;
  windowTitle: string;
  disabled?: boolean;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildPreviewHtml(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; font-family: Consolas, 'Cascadia Code', 'Segoe UI', monospace; background: #111; color: #e8e8e8; }
    header { padding: 1rem 1.25rem; background: #e60000; color: #fff; font-family: 'Segoe UI', sans-serif; font-size: 1rem; font-weight: 600; }
    pre { margin: 0; padding: 1.25rem; white-space: pre-wrap; word-break: break-word; line-height: 1.5; font-size: 0.82rem; }
  </style>
</head>
<body>
  <header>${escapeHtml(title)}</header>
  <pre>${escapeHtml(content)}</pre>
</body>
</html>`;
}

export function ArtifactToolbar({
  content,
  downloadFilename,
  windowTitle,
  disabled = false,
}: ArtifactToolbarProps) {
  const isEmpty = disabled || !content.trim();

  async function handleCopy() {
    if (isEmpty) return;
    await navigator.clipboard.writeText(content);
  }

  function handleDownload() {
    if (isEmpty) return;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = downloadFilename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function handleOpenWindow() {
    if (isEmpty) return;

    const html = buildPreviewHtml(windowTitle, content);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const popup = window.open(url, '_blank');
    if (!popup) {
      URL.revokeObjectURL(url);
      window.alert(
        'Yeni pencere açılamadı. Tarayıcınız pop-up engelliyor olabilir; bu site için pop-up\'a izin verin.'
      );
      return;
    }

    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <div className="artifact-toolbar">
      <button type="button" className="artifact-tool-btn" onClick={handleCopy} disabled={isEmpty} title="Tümünü kopyala">
        <IconCopy size={14} />
        Kopyala
      </button>
      <button type="button" className="artifact-tool-btn" onClick={handleDownload} disabled={isEmpty} title="İndir">
        <IconDownload size={14} />
        İndir
      </button>
      <button
        type="button"
        className="artifact-tool-btn"
        onClick={handleOpenWindow}
        disabled={isEmpty}
        title="Yeni pencerede aç"
      >
        <IconExternalLink size={14} />
        Aç
      </button>
    </div>
  );
}
