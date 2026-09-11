import { useState } from 'react';

interface FilePickerFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  pickerTitle: string;
  disabled?: boolean;
}

export function FilePickerField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  pickerTitle,
  disabled = false,
}: FilePickerFieldProps) {
  const [picking, setPicking] = useState(false);
  const [pickerError, setPickerError] = useState('');

  async function handleBrowse() {
    setPickerError('');
    setPicking(true);

    try {
      const result = await window.electronAPI.pickFile({
        title: pickerTitle,
        filters: [
          { name: 'Properties', extensions: ['properties'] },
          { name: 'Tüm dosyalar', extensions: ['*'] },
        ],
      });
      if (result.path) {
        onChange(result.path);
      }
    } catch (err) {
      setPickerError(err instanceof Error ? err.message : 'Dosya seçilemedi');
    } finally {
      setPicking(false);
    }
  }

  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <div className="path-picker-row">
        <input
          type="text"
          className="path-picker-input"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="btn btn-secondary btn-browse"
          onClick={handleBrowse}
          disabled={disabled || picking}
        >
          {picking ? 'Açılıyor…' : 'Gözat…'}
        </button>
      </div>
      {hint && <span className="field-hint">{hint}</span>}
      {pickerError && <p className="error-msg path-picker-error">{pickerError}</p>}
    </label>
  );
}
