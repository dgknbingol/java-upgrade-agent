interface BranchSectionProps {
  useNewBranch: boolean;
  workBranchName: string;
  targetJavaVersion: string;
  defaultBranchPattern: string;
  onUseNewBranchChange: (value: boolean) => void;
  onWorkBranchNameChange: (value: string) => void;
}

export function BranchSection({
  useNewBranch,
  workBranchName,
  targetJavaVersion,
  defaultBranchPattern,
  onUseNewBranchChange,
  onWorkBranchNameChange,
}: BranchSectionProps) {
  const defaultPreview = defaultBranchPattern.replace('{version}', targetJavaVersion || '21');

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Branch</h2>
      </div>
      <div className="panel-body form-grid">
        <label className="field checkbox-field">
          <span className="checkbox-row">
            <input
              type="checkbox"
              checked={useNewBranch}
              onChange={(e) => onUseNewBranchChange(e.target.checked)}
            />
            <span className="field-label">Yeni branch üzerinde çalış</span>
          </span>
          <span className="field-hint">
            İşaretlenmezse doğrudan kaynak branch üzerinde çalışılır (ör. önceki upgrade
            denemesi branch&apos;ini seçip build tekrarlanabilir).
          </span>
        </label>

        {useNewBranch && (
          <label className="field">
            <span className="field-label">Yeni Branch Adı</span>
            <input
              type="text"
              value={workBranchName}
              onChange={(e) => onWorkBranchNameChange(e.target.value)}
              placeholder={defaultPreview}
            />
            <span className="field-hint">
              Boş bırakılırsa varsayılan: <code>{defaultPreview}</code>. Branch zaten varsa
              açılır; yoksa kaynak branch&apos;ten oluşturulur.
            </span>
          </label>
        )}

      </div>
    </section>
  );
}
