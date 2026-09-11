import { useState, type ReactNode } from 'react';

interface OutputTabToolbarProps {
  content: string;
  defaultFilename: string;
  saveTitle: string;
  disabled?: boolean;
  expanded: boolean;
  onExpandToggle: () => void;
  meta?: ReactNode;
}

export function OutputTabToolbar({
  content,
  defaultFilename,
  saveTitle,
  disabled = false,
  expanded,
  onExpandToggle,
  meta,
}: OutputTabToolbarProps) {
  const [busy, setBusy] = useState<'copy' | 'save' | null>(null);
  const [feedback, setFeedback] = useState('');
  const isEmpty = disabled || !content.trim();

  async function handleCopy() {
    if (isEmpty) return;
    setBusy('copy');
    setFeedback('');
    try {
      await navigator.clipboard.writeText(content);
      setFeedback('Kopyalandı');
      window.setTimeout(() => setFeedback(''), 2000);
    } catch {
      setFeedback('Kopyalama başarısız');
    } finally {
      setBusy(null);
    }
  }

  async function handleDownload() {
    if (isEmpty) return;
    setBusy('save');
    setFeedback('');
    try {
      const result = await window.electronAPI.saveTextFile({
        content,
        defaultFilename,
        title: saveTitle,
      });
      if (result.saved && result.path) {
        setFeedback('Kaydedildi');
        window.setTimeout(() => setFeedback(''), 2500);
      }
    } catch {
      setFeedback('Kaydetme başarısız');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="output-tab-toolbar">
      <div className="output-tab-toolbar-left">
        {meta}
        {feedback && <span className="output-tab-feedback">{feedback}</span>}
      </div>
      <div className="output-tab-toolbar-actions">
        <button
          type="button"
          className="btn btn-log-action"
          onClick={handleCopy}
          disabled={isEmpty || busy !== null}
          title="Panoya kopyala"
        >
          {busy === 'copy' ? 'Kopyalanıyor…' : 'Kopyala'}
        </button>
        <button
          type="button"
          className="btn btn-log-action"
          onClick={handleDownload}
          disabled={isEmpty || busy !== null}
          title="Dosya konumu seçerek kaydet"
        >
          {busy === 'save' ? 'Kaydediliyor…' : 'İndir'}
        </button>
        <button
          type="button"
          className="btn btn-log-action"
          onClick={onExpandToggle}
          title={expanded ? 'Tam ekrandan çık' : 'Output tam ekran'}
        >
          {expanded ? 'Küçült' : 'Tam ekran'}
        </button>
      </div>
    </div>
  );
}
