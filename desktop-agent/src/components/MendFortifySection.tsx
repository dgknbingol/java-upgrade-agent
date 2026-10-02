import { useState } from 'react';

interface MendFortifySectionProps {
  includeMend: boolean;
  includeFortify: boolean;
  jiraBaseUrl: string;
  jiraToken: string;
  disabled?: boolean;
  onIncludeMendChange: (value: boolean) => void;
  onIncludeFortifyChange: (value: boolean) => void;
  onJiraBaseUrlChange: (value: string) => void;
  onJiraTokenChange: (value: string) => void;
  onSave: (input: { jiraBaseUrl: string; jiraToken: string }) => Promise<void>;
}

export function MendFortifySection({
  includeMend,
  includeFortify,
  jiraBaseUrl,
  jiraToken,
  disabled = false,
  onIncludeMendChange,
  onIncludeFortifyChange,
  onJiraBaseUrlChange,
  onJiraTokenChange,
  onSave,
}: MendFortifySectionProps) {
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  async function handleSave() {
    setSaving(true);
    setSaveMessage('');
    try {
      await onSave({
        jiraBaseUrl: jiraBaseUrl.trim(),
        jiraToken: jiraToken.trim(),
      });
      setSaveMessage('Jira ayarları kaydedildi.');
    } catch {
      setSaveMessage('Kaydetme başarısız.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Mend & Fortify</h2>
      </div>
      <div className="panel-body form-grid">
        <label className="field checkbox-field">
          <span className="checkbox-row">
            <input
              type="checkbox"
              checked={includeMend}
              disabled={disabled}
              onChange={(e) => onIncludeMendChange(e.target.checked)}
            />
            <span className="field-label">Mend (Source Composition Analysis)</span>
          </span>
          <span className="field-hint">
            İşaretlenirse Analyze / Fix sırasında Mend SCA bulguları Jira&apos;dan çekilir ve
            remediation kapsamına alınır.
          </span>
        </label>

        <label className="field checkbox-field">
          <span className="checkbox-row">
            <input
              type="checkbox"
              checked={includeFortify}
              disabled={disabled}
              onChange={(e) => onIncludeFortifyChange(e.target.checked)}
            />
            <span className="field-label">Fortify (Static Code Analysis)</span>
          </span>
          <span className="field-hint">
            İşaretlenirse Analyze / Fix sırasında Fortify SAST bulguları Jira&apos;dan çekilir ve
            remediation kapsamına alınır.
          </span>
        </label>

        <label className="field">
          <span className="field-label">Jira Base URL</span>
          <input
            type="text"
            value={jiraBaseUrl}
            disabled={disabled}
            placeholder="https://itjira.vodafone.local"
            onChange={(e) => {
              onJiraBaseUrlChange(e.target.value);
              setSaveMessage('');
            }}
          />
        </label>

        <label className="field">
          <span className="field-label">Jira Personal Token</span>
          <input
            type="password"
            value={jiraToken}
            disabled={disabled}
            placeholder="Jira PAT / kişisel token"
            autoComplete="off"
            onChange={(e) => {
              onJiraTokenChange(e.target.value);
              setSaveMessage('');
            }}
          />
          <span className="field-hint">
            Token yalnızca seçili checkbox&apos;lar için Jira API çağrılarında kullanılır. Kaydet
            ile kalıcı saklanır.
          </span>
        </label>

        <div className="pipeline-settings-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={disabled || saving}
            onClick={() => void handleSave()}
          >
            {saving ? 'Kaydediliyor…' : 'Jira Ayarlarını Kaydet'}
          </button>
          {saveMessage && <span className="field-hint pipeline-save-msg">{saveMessage}</span>}
        </div>
      </div>
    </section>
  );
}
