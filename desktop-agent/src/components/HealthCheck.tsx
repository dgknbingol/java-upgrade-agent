import type { HealthToolStatus } from '../types/job';

interface HealthCheckProps {
  tools: HealthToolStatus[];
  loading: boolean;
  error: string;
  targetJavaVersion: string;
  onRefresh: () => void;
}

export function HealthCheck({
  tools,
  loading,
  error,
  targetJavaVersion,
  onRefresh,
}: HealthCheckProps) {
  const targetLabel = targetJavaVersion.trim() || '21';

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Health Check</h2>
        <button type="button" className="btn btn-outline" onClick={onRefresh} disabled={loading}>
          Yenile
        </button>
      </div>
      <div className="panel-body">
        <p className="health-target-note muted">
          Migration hedefi: <strong>Java {targetLabel}</strong>
        </p>
        {error && <p className="error-msg">{error}</p>}
        {loading && tools.length === 0 ? (
          <p className="muted">Kontrol ediliyor…</p>
        ) : (
          <ul className="health-list">
            {tools.map((tool) => (
              <li key={tool.name} className={tool.available ? 'ok' : 'missing'}>
                <span className="health-name">{tool.name}</span>
                <span className="health-status">{tool.available ? '✓' : '✗'}</span>
                <span className="health-version">
                  {tool.requirement && (
                    <span className="health-requirement">{tool.requirement}</span>
                  )}
                  {tool.requirement && (tool.version || tool.installHint) ? ' · ' : null}
                  {tool.available
                    ? tool.version
                    : tool.version || tool.installHint}
                  {!tool.available && tool.version && tool.installHint ? (
                    <>
                      {' · '}
                      <span className="health-install-hint">{tool.installHint}</span>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
