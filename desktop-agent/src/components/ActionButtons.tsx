interface ActionButtonsProps {
  loading: boolean;
  canAnalyze: boolean;
  canStart: boolean;
  canStop: boolean;
  canBuild: boolean;
  canRunApp: boolean;
  canPush: boolean;
  canRollback: boolean;
  onAnalyze: () => void;
  onStart: () => void;
  onStop: () => void;
  onRunBuild: () => void;
  onRunApp: () => void;
  onPush: () => void;
  onRollback: () => void;
}

export function ActionButtons({
  loading,
  canAnalyze,
  canStart,
  canStop,
  canBuild,
  canRunApp,
  canPush,
  canRollback,
  onAnalyze,
  onStart,
  onStop,
  onRunBuild,
  onRunApp,
  onPush,
  onRollback,
}: ActionButtonsProps) {
  return (
    <div className="action-row">
      <button type="button" className="btn btn-secondary" onClick={onAnalyze} disabled={loading || !canAnalyze}>
        Analyze
      </button>
      <button type="button" className="btn btn-primary" onClick={onStart} disabled={loading || !canStart}>
        Start Upgrade
      </button>
      <button type="button" className="btn btn-danger" onClick={onStop} disabled={!canStop}>
        Durdur
      </button>
      <button type="button" className="btn btn-secondary" onClick={onRunBuild} disabled={loading || !canBuild}>
        Fix/Run Build
      </button>
      <button type="button" className="btn btn-secondary" onClick={onRunApp} disabled={loading || !canRunApp}>
        Run App
      </button>
      <button type="button" className="btn btn-outline" onClick={onPush} disabled={loading || !canPush}>
        Push Branch
      </button>
      <button type="button" className="btn btn-danger" onClick={onRollback} disabled={loading || !canRollback}>
        Rollback
      </button>
    </div>
  );
}
