import { useEffect, useRef, useState } from 'react';
import { DiffSummary } from './DiffSummary';
import { OutputTabToolbar } from './OutputTabToolbar';
import { getOutputTabContent, type OutputTabId } from '../utils/outputContent';

interface OutputTabsProps {
  report: string;
  diff: string;
  logs: string[];
  mendFindings: string;
  fortifyFindings: string;
  status: string;
  upgradeBranch: string;
  onExpandChange?: (expanded: boolean) => void;
}

export function OutputTabs({
  report,
  diff,
  logs,
  mendFindings,
  fortifyFindings,
  status,
  upgradeBranch,
  onExpandChange,
}: OutputTabsProps) {
  const [tab, setTab] = useState<OutputTabId>('logs');
  const [expanded, setExpanded] = useState(false);
  const logScrollRef = useRef<HTMLPreElement>(null);
  const stickToBottomRef = useRef(true);

  const SCROLL_BOTTOM_THRESHOLD_PX = 48;

  function isNearBottom(el: HTMLElement): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_BOTTOM_THRESHOLD_PX;
  }

  function handleLogScroll() {
    const el = logScrollRef.current;
    if (!el) return;
    stickToBottomRef.current = isNearBottom(el);
  }

  function scrollLogsToBottom() {
    const el = logScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stickToBottomRef.current = true;
  }

  useEffect(() => {
    if (logs.length === 0) {
      stickToBottomRef.current = true;
    }
  }, [logs]);

  useEffect(() => {
    if (tab !== 'logs') return;
    if (!stickToBottomRef.current) return;
    scrollLogsToBottom();
  }, [logs, tab]);

  const tabs: { id: OutputTabId; label: string }[] = [
    { id: 'logs', label: 'Live Logs' },
    { id: 'mend', label: 'Mend' },
    { id: 'fortify', label: 'Fortify' },
    { id: 'report', label: 'Migration Report' },
    { id: 'summary', label: 'Visual Diff Summary' },
    { id: 'diff', label: 'Raw Diff' },
  ];

  const isJobRunning = [
    'cloning',
    'running-copilot',
    'building',
    'smoke-running',
    'pushing',
    'rolling-back',
  ].includes(status);

  const tabContent = getOutputTabContent(tab, {
    logs,
    report,
    diff,
    mendFindings,
    fortifyFindings,
  });

  function handleExpandToggle() {
    const next = !expanded;
    setExpanded(next);
    onExpandChange?.(next);
  }

  function renderTabBody() {
    switch (tab) {
      case 'logs':
        return (
          <pre
            ref={logScrollRef}
            className="log-scroll output-tab-scroll"
            onScroll={handleLogScroll}
          >
            {logs.length ? logs.join('\n') : 'Henüz log yok.'}
          </pre>
        );
      case 'mend':
        return mendFindings.trim() ? (
          <pre className="artifact-view output-tab-scroll">{mendFindings}</pre>
        ) : (
          <p className="output-empty">
            Mend bulgusu yok. Mend checkbox&apos;ını işaretleyip Analyze çalıştırın.
          </p>
        );
      case 'fortify':
        return fortifyFindings.trim() ? (
          <pre className="artifact-view output-tab-scroll">{fortifyFindings}</pre>
        ) : (
          <p className="output-empty">
            Fortify bulgusu yok. Fortify checkbox&apos;ını işaretleyip Analyze çalıştırın.
          </p>
        );
      case 'report':
        return report ? (
          <pre className="artifact-view output-tab-scroll">{report}</pre>
        ) : (
          <p className="output-empty">
            {isJobRunning
              ? 'Migration report henüz oluşmadı — Copilot çalışırken burada canlı görünecek.'
              : 'Migration report henüz yok.'}
          </p>
        );
      case 'summary':
        return (
          <DiffSummary diff={diff} liveWaiting={isJobRunning && !diff.trim()} />
        );
      case 'diff':
        return diff && !tabContent.isEmpty ? (
          <pre className="artifact-view output-tab-scroll">{diff}</pre>
        ) : (
          <p className="output-empty">
            {isJobRunning
              ? 'Henüz diff yok — dosya değişiklikleri geldikçe burada canlı görünecek.'
              : 'Henüz diff yok.'}
          </p>
        );
    }
  }

  return (
    <section className="panel output-panel">
      <div className="panel-header">
        <h2>Output</h2>
      </div>
      <div className="tab-bar">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab-btn${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="panel-body tab-content tab-content--pane">
        <div className="output-tab-pane">
          <OutputTabToolbar
            content={tabContent.content}
            defaultFilename={tabContent.defaultFilename}
            saveTitle={tabContent.saveTitle}
            disabled={tabContent.isEmpty}
            expanded={expanded}
            onExpandToggle={handleExpandToggle}
            meta={
              tab === 'logs' ? (
                <div className="meta-row">
                  <span>Status: {status}</span>
                  {upgradeBranch && <span>Branch: {upgradeBranch}</span>}
                </div>
              ) : undefined
            }
          />
          <div
            className={`output-tab-body${tab === 'logs' ? ' output-tab-body--logs' : ''}`}
          >
            {renderTabBody()}
          </div>
        </div>
      </div>
    </section>
  );
}
