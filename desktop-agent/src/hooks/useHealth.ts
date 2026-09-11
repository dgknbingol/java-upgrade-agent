import { useCallback, useEffect, useState } from 'react';
import type { HealthToolStatus } from '../types/job';

export function useHealth(targetJavaVersion: string) {
  const [tools, setTools] = useState<HealthToolStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const version = targetJavaVersion.trim() || '21';
      const result = await window.electronAPI.checkHealth(version);
      setTools(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Health check başarısız');
      setTools([]);
    } finally {
      setLoading(false);
    }
  }, [targetJavaVersion]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const allReady = tools.length > 0 && tools.every((t) => t.available);

  return { tools, loading, error, allReady, refresh };
}
