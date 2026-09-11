import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  API_BASE,
  analyzeRepository,
  fetchDiff,
  fetchPrerequisites,
  fetchReport,
  PrerequisiteStatus,
  pushBranch,
  runBuild,
  SourceMode,
  startJob,
  subscribeToJobEvents,
} from './api';
import {
  IconArrowRight,
  IconClipboard,
  IconCode,
  IconFileText,
  IconGitBranch,
  IconGitDiff,
  IconGlobe,
  IconPlay,
  IconSearch,
  IconSun,
  IconTerminal,
  IconUpload,
  IconWrench,
} from './Icons';
import { ArtifactToolbar } from './components/ArtifactToolbar';
import { DiffSummary } from './components/DiffSummary';
import { PathPickerField } from './components/PathPickerField';
import { APP_VERSION_LABEL } from './version';

function formatTargetDisplay(version: string): string {
  const trimmed = version.trim();
  if (trimmed.startsWith('1.')) {
    return `Java ${trimmed}`;
  }
  return `Java ${trimmed}`;
}

function App() {
  const [sourceMode, setSourceMode] = useState<SourceMode>('remote');
  const [repoUrl, setRepoUrl] = useState('');
  const [localRepoPath, setLocalRepoPath] = useState('');
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [sourceBranch, setSourceBranch] = useState('main');
  const [targetJavaVersion, setTargetJavaVersion] = useState('21');
  const [jobId, setJobId] = useState<string | null>(null);
  const [upgradeBranch, setUpgradeBranch] = useState('');
  const [status, setStatus] = useState('idle');
  const [logs, setLogs] = useState<string[]>([]);
  const [report, setReport] = useState('');
  const [diff, setDiff] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [prerequisites, setPrerequisites] = useState<PrerequisiteStatus[]>([]);
  const [prereqLoading, setPrereqLoading] = useState(true);
  const [prereqError, setPrereqError] = useState('');
  const [analyzed, setAnalyzed] = useState(false);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [analyzeError, setAnalyzeError] = useState('');
  const [displayVersion, setDisplayVersion] = useState('');
  const [sourceJavaVersion, setSourceJavaVersion] = useState('');
  const [detectedFrom, setDetectedFrom] = useState('');
  const logsContainerRef = useRef<HTMLDivElement>(null);

  const missingTools = prerequisites.filter((t) => !t.available);
  const toolsReady = !prereqLoading && prereqError === '' && missingTools.length === 0;

  function loadPrerequisites() {
    setPrereqLoading(true);
    setPrereqError('');
    fetchPrerequisites()
      .then((data) => setPrerequisites(data.tools))
      .catch(() => {
        setPrerequisites([]);
        setPrereqError(
          `Lokal agent'a bağlanılamadı (${API_BASE}). Bilgisayarınızda backend'i başlatın: cd backend && npm run dev. UI OpenShift'te olsa bile clone, Copilot ve push sizin makinenizde çalışır.`
        );
      })
      .finally(() => setPrereqLoading(false));
  }

  useEffect(() => {
    loadPrerequisites();
  }, []);

  useEffect(() => {
    setAnalyzed(false);
    setAnalyzeError('');
    setDisplayVersion('');
    setSourceJavaVersion('');
    setDetectedFrom('');
  }, [sourceMode, repoUrl, localRepoPath, sourceBranch]);

  useEffect(() => {
    const container = logsContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (!jobId) return;

    const source = subscribeToJobEvents(
      jobId,
      (line) => setLogs((prev) => [...prev, line]),
      (newStatus) => {
        setStatus(newStatus);
        if (newStatus === 'completed' || newStatus === 'failed') {
          void refreshArtifacts(jobId);
        }
      },
      (branch) => setUpgradeBranch(branch)
    );

    return () => source.close();
  }, [jobId]);

  async function refreshArtifacts(id: string) {
    const [reportContent, diffContent] = await Promise.all([
      fetchReport(id),
      fetchDiff(id),
    ]);
    if (reportContent) setReport(reportContent);
    setDiff(
      diffContent.trim()
        ? diffContent
        : 'Kaynak branch ile karşılaştırıldığında dosya değişikliği yok.'
    );
  }

  async function handleAnalyze() {
    if (!sourceBranch.trim()) {
      setAnalyzeError('Kaynak branch gerekli.');
      return;
    }

    if (sourceMode === 'remote' && !repoUrl.trim()) {
      setAnalyzeError('Git URL gerekli.');
      return;
    }

    if (sourceMode === 'local' && !localRepoPath.trim()) {
      setAnalyzeError('Yerel proje klasörü gerekli.');
      return;
    }

    setAnalyzeError('');
    setAnalyzeLoading(true);

    try {
      const result = await analyzeRepository({
        sourceMode,
        repoUrl: repoUrl.trim(),
        localRepoPath: localRepoPath.trim(),
        sourceBranch: sourceBranch.trim(),
      });
      setDisplayVersion(result.displayVersion);
      setSourceJavaVersion(result.currentJavaVersion);
      setDetectedFrom(result.detectedFrom);
      setAnalyzed(true);
    } catch (err) {
      setAnalyzed(false);
      setAnalyzeError(err instanceof Error ? err.message : 'Analiz başarısız oldu');
    } finally {
      setAnalyzeLoading(false);
    }
  }

  async function handleStart(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    setLogs([]);
    setReport('');
    setDiff('');
    setStatus('pending');

    try {
      const result = await startJob({
        sourceMode,
        repoUrl: repoUrl.trim(),
        localRepoPath: localRepoPath.trim(),
        workspaceRoot: workspaceRoot.trim(),
        sourceBranch,
        targetJavaVersion,
        sourceJavaVersion,
      });
      setJobId(result.jobId);
      setUpgradeBranch(result.upgradeBranch);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bilinmeyen hata');
    } finally {
      setLoading(false);
    }
  }

  async function handleBuild() {
    if (!jobId) return;
    setError('');
    try {
      await runBuild(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Build başlatılamadı');
    }
  }

  async function handlePush() {
    if (!jobId) return;
    setError('');
    try {
      await pushBranch(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Push başlatılamadı');
    }
  }

  const statusLabel: Record<string, string> = {
    idle: 'Bekleniyor',
    pending: 'Başlatılıyor',
    cloning: 'Klonlanıyor',
    'checking-out': 'Checkout',
    'creating-branch': 'Branch oluşturuluyor',
    'running-copilot': 'Copilot çalışıyor',
    building: 'Maven build',
    'building-only': 'Maven build',
    pushing: 'Push ediliyor',
    completed: 'Tamamlandı',
    failed: 'Başarısız',
  };

  const statusHint =
    status === 'idle'
      ? 'İşlem bekleniyor...'
      : jobId
        ? `Job ID: ${jobId}${upgradeBranch ? ` · Branch: ${upgradeBranch}` : ''}`
        : 'İşlem başlatılıyor...';

  const startLabel = loading
    ? 'Başlatılıyor...'
    : prereqLoading
      ? 'Araçlar kontrol ediliyor...'
      : !analyzed
        ? 'Önce Analiz Et'
        : 'Yükseltmeyi Başlat';

  const analyzeLabel = analyzeLoading ? 'Analiz ediliyor...' : 'Analiz Et';

  const reportEmpty =
    !report.trim() || report.includes('MIGRATION_REPORT.md henüz oluşturulmadı');
  const diffEmpty =
    !diff.trim() || diff.startsWith('Henüz diff') || diff.startsWith('Kaynak branch');

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="site-header-inner">
          <div className="brand">
            <div className="logo-box">
              <img src="/vodafone-logo.png" alt="Vodafone" className="brand-logo" />
            </div>
            <div className="brand-text">
              <div className="brand-title-row">
                <h1>Paytion Java Upgrade Agent</h1>
                <span className="version-badge">{APP_VERSION_LABEL}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="page-body">
        <main className="main-content">
          {(prereqError || missingTools.length > 0) && (
            <section className="panel panel-alert">
              <div className="panel-header">
                <h2>{prereqError ? 'Backend Bağlantısı' : 'Eksik Araçlar'}</h2>
              </div>
              <div className="panel-body">
                {prereqError ? (
                  <p>{prereqError}</p>
                ) : (
                  <ul className="prereq-list">
                    {missingTools.map((tool) => (
                      <li key={tool.name}>
                        <strong>{tool.name}</strong> — {tool.installHint}
                      </li>
                    ))}
                  </ul>
                )}
                <button type="button" className="btn btn-outline" onClick={loadPrerequisites}>
                  Tekrar Kontrol Et
                </button>
              </div>
            </section>
          )}

          <div className="workspace">
            <div className="workspace-left">
              <section className="panel">
                <div className="panel-header">
                  <IconSun size={17} />
                  <h2>Yükseltme Ayarları</h2>
                </div>
                <div className="panel-body">
                  <form onSubmit={handleStart}>
                    <label className="field">
                      <span className="field-label">Kaynak Tipi</span>
                      <div className="source-mode-row">
                        <button
                          type="button"
                          className={`source-mode-btn${sourceMode === 'remote' ? ' active' : ''}`}
                          onClick={() => setSourceMode('remote')}
                        >
                          Uzak Repo
                        </button>
                        <button
                          type="button"
                          className={`source-mode-btn${sourceMode === 'local' ? ' active' : ''}`}
                          onClick={() => setSourceMode('local')}
                        >
                          Yerel Klasör
                        </button>
                      </div>
                    </label>

                    {sourceMode === 'remote' ? (
                      <label className="field">
                        <span className="field-label">Git Repository URL</span>
                        <div className="field-input-wrap">
                          <span className="field-icon">
                            <IconGlobe size={16} />
                          </span>
                          <input
                            type="url"
                            value={repoUrl}
                            onChange={(e) => setRepoUrl(e.target.value)}
                            placeholder="https://github.com/org/repo.git"
                            required={sourceMode === 'remote'}
                          />
                        </div>
                      </label>
                    ) : (
                      <PathPickerField
                        label="Yerel Proje Klasörü"
                        value={localRepoPath}
                        onChange={setLocalRepoPath}
                        placeholder="C:\Projects\spring-petclinic"
                        pickerTitle="Git projesi klasörünü seçin"
                        required={sourceMode === 'local'}
                      />
                    )}

                    <label className="field">
                      <span className="field-label">Kaynak Branch</span>
                      <div className="field-input-wrap">
                        <span className="field-icon">
                          <IconGitBranch size={16} />
                        </span>
                        <input
                          type="text"
                          value={sourceBranch}
                          onChange={(e) => setSourceBranch(e.target.value)}
                          required
                        />
                      </div>
                    </label>

                    <PathPickerField
                      label="Yerel Workspace Klasörü"
                      value={workspaceRoot}
                      onChange={setWorkspaceRoot}
                      placeholder="Boş = backend/workspaces/{jobId}"
                      pickerTitle="Upgrade workspace klasörünü seçin"
                      hint="Upgrade işinin klonlanacağı yerel klasör. Boş bırakılırsa varsayılan kullanılır."
                    />

                    <button
                      type="button"
                      className="btn btn-analyze"
                      onClick={handleAnalyze}
                      disabled={
                        analyzeLoading ||
                        !sourceBranch.trim() ||
                        (sourceMode === 'remote' && !repoUrl.trim()) ||
                        (sourceMode === 'local' && !localRepoPath.trim())
                      }
                    >
                      <IconSearch size={16} />
                      {analyzeLabel}
                    </button>

                    {analyzeError && <p className="error-msg">{analyzeError}</p>}

                    {analyzed && (
                      <>
                        <div className="version-compare">
                          <div className="version-compare-side">
                            <span className="version-compare-label">GÜNCEL VERSİYON</span>
                            <span className="version-compare-value version-current">
                              {displayVersion}
                            </span>
                          </div>
                          <div className="version-compare-arrow">
                            <IconArrowRight size={18} />
                          </div>
                          <div className="version-compare-side">
                            <span className="version-compare-label">HEDEF VERSİYON</span>
                            <span className="version-compare-value version-target">
                              {formatTargetDisplay(targetJavaVersion)}
                            </span>
                          </div>
                        </div>
                        {detectedFrom && (
                          <p className="analyze-meta">Tespit: {detectedFrom}</p>
                        )}
                      </>
                    )}

                    <label className="field">
                      <span className="field-label">Hedef Java Sürümü</span>
                      <div className="field-input-wrap">
                        <span className="field-icon">
                          <IconCode size={16} />
                        </span>
                        <input
                          type="text"
                          value={targetJavaVersion}
                          onChange={(e) => setTargetJavaVersion(e.target.value)}
                        />
                      </div>
                    </label>

                    <button
                      type="submit"
                      className="btn btn-primary btn-full"
                      disabled={loading || prereqLoading || !toolsReady || !analyzed}
                    >
                      <IconPlay size={16} />
                      {startLabel}
                    </button>

                    <div className="btn-row">
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={handleBuild}
                        disabled={!jobId}
                        title="Mevcut workspace'te mvn clean install tekrar çalıştırır; hata olursa Copilot düzeltmeyi dener"
                      >
                        <IconWrench size={16} />
                        Run Build
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={handlePush}
                        disabled={!jobId}
                      >
                        <IconUpload size={16} />
                        Push Branch
                      </button>
                    </div>
                    <p className="btn-hint">
                      Run Build: yükseltme bittikten sonra Maven build&apos;i yeniden çalıştırır.
                      Hata olursa Copilot otomatik düzeltmeyi dener.
                    </p>
                  </form>
                  {error && <p className="error-msg">{error}</p>}
                </div>
              </section>

              <section className="panel panel-plain">
                <div className="panel-body status-panel-body">
                  <div className="status-title-row">
                    <div className="status-title">
                      <IconClipboard size={17} />
                      <h2>Job Durumu</h2>
                    </div>
                    <span className={`status-badge status-${status}`}>
                      {statusLabel[status] ?? status}
                    </span>
                  </div>
                  <div className="status-hint">{statusHint}</div>
                </div>
              </section>
            </div>

            <div className="workspace-right">
              <section className="panel panel-logs">
                <div className="panel-header panel-header-light">
                  <div className="panel-title-row">
                    <IconTerminal size={17} className="icon-red" />
                    <h2>Canlı Loglar</h2>
                  </div>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => setLogs([])}
                    disabled={logs.length === 0}
                  >
                    Temizle
                  </button>
                </div>
                <div className="panel-body panel-body-flush terminal-wrap">
                  <div ref={logsContainerRef} className="terminal">
                    {logs.length === 0
                      ? 'Yükseltme başlatıldığında loglar burada görünecek...'
                      : logs.join('\n')}
                  </div>
                </div>
              </section>

              <div className="artifacts-row">
                <section className="panel panel-artifact">
                  <div className="panel-header">
                    <IconFileText size={17} />
                    <h2>Migration Report</h2>
                  </div>
                  <div className="panel-body panel-body-flush artifact-panel-body">
                    <ArtifactToolbar
                      content={report}
                      downloadFilename="MIGRATION_REPORT.md"
                      windowTitle="Migration Report"
                      disabled={reportEmpty}
                    />
                    <div className="code-box light artifact-content-box artifact-primary-scroll">
                      {report || 'MIGRATION_REPORT.md henüz oluşturulmadı.'}
                    </div>
                  </div>
                </section>

                <section className="panel panel-artifact">
                  <div className="panel-header">
                    <IconGitDiff size={17} />
                    <h2>Git Diff</h2>
                  </div>
                  <div className="panel-body panel-body-flush artifact-panel-body">
                    <ArtifactToolbar
                      content={diff}
                      downloadFilename="git-diff.patch"
                      windowTitle="Git Diff"
                      disabled={diffEmpty}
                    />
                    {!diffEmpty && <DiffSummary diff={diff} />}
                    <details className="raw-diff-details">
                      <summary>Raw Diff</summary>
                      <div className="code-box dark artifact-content-box">
                        {diff || 'Henüz diff yok.'}
                      </div>
                    </details>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </main>

        <footer className="site-footer">
          Vodafone Turkey — Paytion Java Upgrade Agent — 2024
        </footer>
      </div>
    </div>
  );
}

export default App;
