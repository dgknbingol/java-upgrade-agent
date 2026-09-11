import { PathPickerField } from './PathPickerField';
import { JAVA_LTS_VERSIONS } from '../constants/javaVersions';
import type { SourceMode } from '../types/job';

interface RepositoryFormProps {
  sourceMode: SourceMode;
  repoUrl: string;
  localRepoPath: string;
  sourceBranch: string;
  targetJavaVersion: string;
  onSourceModeChange: (mode: SourceMode) => void;
  onRepoUrlChange: (v: string) => void;
  onLocalRepoPathChange: (v: string) => void;
  onSourceBranchChange: (v: string) => void;
  onTargetJavaVersionChange: (v: string) => void;
  skipTests: boolean;
  onSkipTestsChange: (value: boolean) => void;
  analyzedVersion?: string;
  analyzedMaven?: string;
  analyzedSpringBoot?: string;
}

export function RepositoryForm({
  sourceMode,
  repoUrl,
  localRepoPath,
  sourceBranch,
  targetJavaVersion,
  onSourceModeChange,
  onRepoUrlChange,
  onLocalRepoPathChange,
  onSourceBranchChange,
  onTargetJavaVersionChange,
  skipTests,
  onSkipTestsChange,
  analyzedVersion,
  analyzedMaven,
  analyzedSpringBoot,
}: RepositoryFormProps) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Repository</h2>
      </div>
      <div className="panel-body form-grid">
        <label className="field checkbox-field">
          <span className="checkbox-row">
            <input
              type="checkbox"
              checked={skipTests}
              onChange={(e) => onSkipTestsChange(e.target.checked)}
            />
            <span className="field-label">Skip Test</span>
          </span>
          <span className="field-hint">
            İşaretlenirse <strong>Fix/Run Build</strong> sırasında Maven testleri atlanır (
            <code>-DskipTests</code>). Start Upgrade migration build&apos;lerini etkilemez.
          </span>
        </label>

        <label className="field">
          <span className="field-label">Kaynak Türü</span>
          <div className="source-mode-row">
            <button
              type="button"
              className={`source-mode-btn${sourceMode === 'remote' ? ' active' : ''}`}
              onClick={() => onSourceModeChange('remote')}
            >
              Uzak Repo
            </button>
            <button
              type="button"
              className={`source-mode-btn${sourceMode === 'local' ? ' active' : ''}`}
              onClick={() => onSourceModeChange('local')}
            >
              Yerel Klasör
            </button>
          </div>
        </label>

        {sourceMode === 'remote' ? (
          <label className="field">
            <span className="field-label">Git Repository URL</span>
            <input
              type="url"
              value={repoUrl}
              onChange={(e) => onRepoUrlChange(e.target.value)}
              placeholder="https://bitbucket.org/org/repo.git"
            />
          </label>
        ) : (
          <PathPickerField
            label="Yerel Proje Klasörü"
            value={localRepoPath}
            onChange={onLocalRepoPathChange}
            placeholder="C:\Projects\my-app"
            pickerTitle="Git projesi klasörünü seçin"
            hint="Diskteki mevcut bir Git repository klasörü (.git içermeli)."
          />
        )}

        <label className="field">
          <span className="field-label">Source Branch</span>
          <input
            type="text"
            value={sourceBranch}
            onChange={(e) => onSourceBranchChange(e.target.value)}
            placeholder="main"
          />
        </label>

        <label className="field">
          <span className="field-label">Target Java Version (LTS)</span>
          <select
            value={targetJavaVersion}
            onChange={(e) => onTargetJavaVersionChange(e.target.value)}
          >
            {JAVA_LTS_VERSIONS.map((version) => (
              <option key={version} value={version}>
                Java {version}
              </option>
            ))}
          </select>
        </label>

        {analyzedVersion && (
          <div className="analysis-summary">
            <div>
              <span className="summary-label">Detected Java</span>
              <strong>{analyzedVersion}</strong>
            </div>
            {analyzedMaven && (
              <div>
                <span className="summary-label">Maven</span>
                <span>{analyzedMaven}</span>
              </div>
            )}
            {analyzedSpringBoot && (
              <div>
                <span className="summary-label">Spring Boot</span>
                <span>{analyzedSpringBoot}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
