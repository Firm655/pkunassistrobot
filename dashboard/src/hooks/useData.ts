import { useCallback, useEffect, useRef, useState } from 'react';
import { useTableVersion, type RealtimeTable } from '@/contexts/RealtimeContext';

/**
 * Minimal async data hook. Refetches when `deps` change or when any listed realtime table changes.
 * Keeps the previous data while refetching so realtime refreshes don't flash spinners.
 */
export function useData<T>(fetcher: () => Promise<T>, deps: unknown[], tables: readonly RealtimeTable[] = []) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const version = useTableVersion(tables);
  const [manual, setManual] = useState(0);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      fetchRef.current()
        .then((d) => { if (!cancelled) { setData(d); setError(null); } })
        .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, version === '' ? 0 : 150); // small debounce to coalesce bursts of realtime events
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version, manual]);

  const reload = useCallback(() => setManual((n) => n + 1), []);
  return { data, error, loading: loading && data === undefined, refreshing: loading, reload };
}
