import { PathPickerField } from './PathPickerField';

interface WorkspaceSectionProps {
  workspaceRoot: string;
  onWorkspaceRootChange: (value: string) => void;
  remoteMode?: boolean;
}

export function WorkspaceSection({
  workspaceRoot,
  onWorkspaceRootChange,
  remoteMode = false,
}: WorkspaceSectionProps) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{remoteMode ? 'Uzak Repo Klon Klasörü' : 'Workspace'}</h2>
      </div>
      <div className="panel-body form-grid">
        <PathPickerField
          label={remoteMode ? 'Çalışma / Klon Klasörü' : 'Yerel Workspace Klasörü'}
          value={workspaceRoot}
          onChange={onWorkspaceRootChange}
          placeholder={remoteMode ? 'C:\\Projects\\my-app' : 'Boş = varsayılan (AppData/workspaces)'}
          pickerTitle={remoteMode ? 'Git projesinin klonlanacağı klasörü seçin' : 'Klonlanacak workspace üst klasörünü seçin'}
          hint={
            remoteMode
              ? 'Uzak repo bu klasöre klonlanır (veya mevcut .git varsa güncellenir). Boş bırakılırsa geçici workspace kullanılır.'
              : 'Repo bu klasör altında {jobId} alt dizinine klonlanır. Boş bırakılırsa uygulama varsayılanını kullanır.'
          }
        />
      </div>
    </section>
  );
}
