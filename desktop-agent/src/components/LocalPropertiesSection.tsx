import { FilePickerField } from './FilePickerField';

interface LocalPropertiesSectionProps {
  useLocalPropertiesOverride: boolean;
  localPropertiesFilePath: string;
  disabled?: boolean;
  onUseLocalPropertiesOverrideChange: (value: boolean) => void;
  onLocalPropertiesFilePathChange: (value: string) => void;
}

export function LocalPropertiesSection({
  useLocalPropertiesOverride,
  localPropertiesFilePath,
  disabled = false,
  onUseLocalPropertiesOverrideChange,
  onLocalPropertiesFilePathChange,
}: LocalPropertiesSectionProps) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Local Properties</h2>
      </div>
      <div className="panel-body form-grid">
        <label className="field checkbox-field">
          <span className="checkbox-row">
            <input
              type="checkbox"
              checked={useLocalPropertiesOverride}
              disabled={disabled}
              onChange={(e) => onUseLocalPropertiesOverrideChange(e.target.checked)}
            />
            <span className="field-label">Harici local properties kullan</span>
          </span>
          <span className="field-hint">
            İşaretlenirse seçtiğiniz dosyanın içeriği, her Maven build öncesinde projedeki{' '}
            <code>application-local.properties</code> dosyasına yazılır. İşaretlenmezse veya dosya
            seçilmezse projedeki mevcut local properties ile derlenir.
          </span>
        </label>

        {useLocalPropertiesOverride && (
          <FilePickerField
            label="Properties dosyası"
            value={localPropertiesFilePath}
            disabled={disabled}
            onChange={onLocalPropertiesFilePathChange}
            placeholder="C:\\config\\my-app-local.properties"
            pickerTitle="application-local.properties kaynağını seçin"
            hint="Dosya yolu elle girilebilir veya Gözat ile seçilebilir. Çok modüllü projelerde tüm src/main/resources/application-local.properties dosyaları güncellenir."
          />
        )}
      </div>
    </section>
  );
}
