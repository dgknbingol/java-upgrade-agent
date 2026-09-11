import { useState } from 'react';
import type { PipelineSettingsInput, StartupRunMode } from '../types/electron';

interface PipelineSettingsSectionProps {
  settings: PipelineSettingsInput;
  disabled?: boolean;
  onChange: (settings: PipelineSettingsInput) => void;
  onSave: (settings: PipelineSettingsInput) => Promise<void>;
}

export function PipelineSettingsSection({
  settings,
  disabled = false,
  onChange,
  onSave,
}: PipelineSettingsSectionProps) {
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  function updateNumberField<K extends keyof PipelineSettingsInput>(
    key: K,
    raw: string,
    min: number,
    max: number
  ) {
    const parsed = Number.parseInt(raw, 10);
    const value = Number.isFinite(parsed)
      ? Math.min(max, Math.max(min, parsed))
      : settings[key];
    onChange({ ...settings, [key]: value });
    setSaveMessage('');
  }

  async function handleSave() {
    setSaving(true);
    setSaveMessage('');
    try {
      await onSave(settings);
      setSaveMessage('Ayarlar kaydedildi.');
    } catch {
      setSaveMessage('Kaydetme başarısız.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Pipeline Ayarları</h2>
      </div>
      <div className="panel-body form-grid">
        <label className="field">
          <span className="field-label">Migration turları</span>
          <input
            type="number"
            min={1}
            max={10}
            value={settings.maxMigrationRounds}
            disabled={disabled}
            onChange={(e) => updateNumberField('maxMigrationRounds', e.target.value, 1, 10)}
          />
          <span className="field-hint">Copilot migration döngüsü üst sınırı (1–10).</span>
        </label>

        <label className="field">
          <span className="field-label">Build fix denemesi</span>
          <input
            type="number"
            min={1}
            max={10}
            value={settings.maxBuildFixAttempts}
            disabled={disabled}
            onChange={(e) => updateNumberField('maxBuildFixAttempts', e.target.value, 1, 10)}
          />
          <span className="field-hint">Maven build başarısız olunca Copilot ile tekrar deneme.</span>
        </label>

        <label className="field">
          <span className="field-label">Maven log tail (karakter)</span>
          <input
            type="number"
            min={1000}
            max={30000}
            step={500}
            value={settings.mavenBuildLogTailChars}
            disabled={disabled}
            onChange={(e) => updateNumberField('mavenBuildLogTailChars', e.target.value, 1000, 30000)}
          />
          <span className="field-hint">Copilot&apos;a gönderilen build logunun son N karakteri.</span>
        </label>

        <p className="field-hint pipeline-subsection-title">Run App ayarları</p>

        <label className="field checkbox-field">
          <span className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.smokeRunEnabled}
              disabled={disabled}
              onChange={(e) => {
                onChange({ ...settings, smokeRunEnabled: e.target.checked });
                setSaveMessage('');
              }}
            />
            <span className="field-label">Run App etkin</span>
          </span>
          <span className="field-hint">
            <strong>Run App</strong> butonu ile Spring Boot uygulamasını başlatır. Hata olursa loglar
            Copilot&apos;a iletilir. Boot değilse otomatik atlanır.
          </span>
        </label>

        <label className="field">
          <span className="field-label">Run modu</span>
          <select
            value={settings.startupRunMode}
            disabled={disabled || !settings.smokeRunEnabled}
            onChange={(e) => {
              onChange({ ...settings, startupRunMode: e.target.value as StartupRunMode });
              setSaveMessage('');
            }}
          >
            <option value="auto">auto — önce java -jar, yoksa mvn spring-boot:run</option>
            <option value="jar">jar — java -jar target/*.jar</option>
            <option value="maven">maven — mvn spring-boot:run</option>
          </select>
        </label>

        <label className="field">
          <span className="field-label">Startup timeout (saniye)</span>
          <input
            type="number"
            min={30}
            max={600}
            value={settings.smokeRunTimeoutSeconds}
            disabled={disabled || !settings.smokeRunEnabled}
            onChange={(e) => updateNumberField('smokeRunTimeoutSeconds', e.target.value, 30, 600)}
          />
        </label>

        <label className="field">
          <span className="field-label">Spring profile</span>
          <input
            type="text"
            value={settings.smokeRunProfile}
            disabled={disabled || !settings.smokeRunEnabled}
            placeholder="boş = varsayılan profile"
            onChange={(e) => {
              onChange({ ...settings, smokeRunProfile: e.target.value });
              setSaveMessage('');
            }}
          />
          <span className="field-hint">Örn. <code>test</code> veya <code>local</code>.</span>
        </label>

        <label className="field">
          <span className="field-label">Başarı sonrası izleme (saniye)</span>
          <input
            type="number"
            min={0}
            max={120}
            value={settings.startupPostSuccessSeconds}
            disabled={disabled || !settings.smokeRunEnabled}
            onChange={(e) =>
              updateNumberField('startupPostSuccessSeconds', e.target.value, 0, 120)
            }
          />
          <span className="field-hint">
            Uygulama ayağa kalktıktan sonra geç gelen hataları yakalamak için ek bekleme. 0 =
            hemen kapat.
          </span>
        </label>

        <label className="field">
          <span className="field-label">Startup fix denemesi</span>
          <input
            type="number"
            min={1}
            max={5}
            value={settings.maxSmokeFixAttempts}
            disabled={disabled || !settings.smokeRunEnabled}
            onChange={(e) => updateNumberField('maxSmokeFixAttempts', e.target.value, 1, 5)}
          />
          <span className="field-hint">Startup patlarsa Copilot runtime fix + yeniden run.</span>
        </label>

        <div className="pipeline-settings-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={disabled || saving}
            onClick={() => void handleSave()}
          >
            {saving ? 'Kaydediliyor…' : 'Ayarları Kaydet'}
          </button>
          {saveMessage && <span className="field-hint pipeline-save-msg">{saveMessage}</span>}
        </div>
      </div>
    </section>
  );
}
