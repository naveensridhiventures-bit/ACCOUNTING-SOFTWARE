import { DependencyList, useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, get } from './api';

/** Fetch on mount and whenever deps change; keeps previous data visible while reloading. */
export function useApi<T = any>(path: string | null, query?: Record<string, any>, deps: DependencyList = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<ApiError | null>(null);
  const seq = useRef(0);
  const key = JSON.stringify(query ?? {});

  const load = useCallback(async () => {
    if (!path) return;
    const id = ++seq.current;
    setLoading(true);
    try {
      const r = await get<T>(path, query);
      if (id === seq.current) { setData(r); setError(null); }
    } catch (e) {
      if (id === seq.current) setError(e as ApiError);
    } finally {
      if (id === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load, ...deps]);
  return { data, loading, error, reload: load, setData };
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function useTitle(title: string) {
  useEffect(() => { document.title = `${title} - Ledgerly`; }, [title]);
}
