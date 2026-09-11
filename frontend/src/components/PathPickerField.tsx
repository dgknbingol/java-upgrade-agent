import { useState } from 'react';
import { pickFolder } from '../api';
import { IconFolder } from '../Icons';

interface PathPickerFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  pickerTitle: string;
  required?: boolean;
}

export function PathPickerField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  pickerTitle,
  required,
}: PathPickerFieldProps) {
  const [picking, setPicking] = useState(false);
  const [pickerError, setPickerError] = useState('');

  async function handleBrowse() {
    setPickerError('');
    setPicking(true);

    try {
      const result = await pickFolder(pickerTitle);
      if (result.path) {
        onChange(result.path);
      }
    } catch (err) {
      setPickerError(err instanceof Error ? err.message : 'Klasör seçilemedi');
    } finally {
      setPicking(false);
    }
  }

  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <div className="path-picker-row">
        <div className="field-input-wrap path-picker-input">
          <span className="field-icon">
            <IconFolder size={16} />
          </span>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            required={required}
          />
        </div>
        <button
          type="button"
          className="btn btn-browse"
          onClick={handleBrowse}
          disabled={picking}
        >
          {picking ? 'Açılıyor…' : 'Gözat…'}
        </button>
      </div>
      {hint && <span className="field-hint">{hint}</span>}
      {pickerError && <p className="error-msg path-picker-error">{pickerError}</p>}
    </label>
  );
}
