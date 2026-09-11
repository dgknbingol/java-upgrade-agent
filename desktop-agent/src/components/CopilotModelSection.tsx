import { useCallback, useEffect, useState } from 'react';

export interface CopilotModelOptions {
  models: string[];
  selectedModel: string;
  cliPersistedModel: string | null;
}

interface CopilotModelSectionProps {
  model: string;
  disabled?: boolean;
  onModelChange: (model: string) => void;
  onSave: (model: string) => Promise<string>;
}

export function CopilotModelSection({
  model,
  disabled = false,
  onModelChange,
  onSave,
}: CopilotModelSectionProps) {
  const [options, setOptions] = useState<CopilotModelOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');

  const loadModels = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await window.electronAPI.listCopilotModels();
      setOptions(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Model listesi alınamadı');
      setOptions(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  async function handleSave() {
    setSaving(true);
    setSaveMessage('');
    setError('');
    try {
      const saved = await onSave(model);
      onModelChange(saved);
      setSaveMessage('Model kaydedildi.');
      await loadModels();
    } catch {
      setSaveMessage('Kaydetme başarısız.');
    } finally {
      setSaving(false);
    }
  }

  const models = options?.models ?? (model ? [model] : ['auto']);
  const cliDefault = options?.cliPersistedModel;

  return (
    <details className="panel collapsible-panel">
      <summary className="collapsible-panel__summary">
        <h2 className="collapsible-panel__title">Copilot Model</h2>
        <span className="collapsible-panel__badge">{model || 'auto'}</span>
      </summary>
      <div className="collapsible-panel__body form-grid">
        {loading ? (
          <p className="muted">Modeller yükleniyor…</p>
        ) : (
          <>
            {error && <p className="error-msg">{error}</p>}

            <label className="field">
              <span className="field-label">Migration modeli</span>
              <select
                value={model}
                disabled={disabled}
                onChange={(e) => {
                  onModelChange(e.target.value);
                  setSaveMessage('');
                }}
              >
                {models.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry === 'auto' ? 'auto (Copilot seçsin)' : entry}
                  </option>
                ))}
              </select>
              <span className="field-hint">
                Tüm Copilot migration ve build-fix çağrılarında{' '}
                <code>--model {model || 'auto'}</code> kullanılır. Hesabınızda olmayan
                modeller hata verir — <strong>auto</strong> önerilir (yoksa otomatik auto
                ile yeniden denenir).
              </span>
            </label>

            {cliDefault && cliDefault !== model && (
              <p className="field-hint">
                Copilot CLI varsayılanı (config): <strong>{cliDefault}</strong> — bu uygulama
                seçiminizi kullanır.
              </p>
            )}

            <div className="pipeline-settings-actions">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={disabled || saving}
                onClick={() => void handleSave()}
              >
                {saving ? 'Kaydediliyor…' : 'Modeli Kaydet'}
              </button>
              <button
                type="button"
                className="btn btn-outline"
                disabled={loading}
                onClick={() => void loadModels()}
              >
                Listeyi Yenile
              </button>
              {saveMessage && <span className="field-hint pipeline-save-msg">{saveMessage}</span>}
            </div>
          </>
        )}
      </div>
    </details>
  );
}
