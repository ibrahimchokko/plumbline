import { useCallback, useEffect, useRef, useState } from 'react';

/** Poll an async loader on an interval; pauses while the tab is hidden. */
export function usePolling<T>(load: (() => Promise<T>) | null, intervalMs: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;

  const refresh = useCallback(async () => {
    const fn = loadRef.current;
    if (!fn) return;
    setLoading(true);
    try {
      setData(await fn());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!load) return;
    refresh();
    if (!intervalMs) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, intervalMs);
    const onVis = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, !!load, ...deps]);

  return { data, error, loading, refresh, setData };
}

/** Run an async action with a busy flag; returns [run, busy]. */
export function useAction<A extends unknown[]>(fn: (...args: A) => Promise<unknown>): [(...args: A) => Promise<void>, boolean] {
  const [busy, setBusy] = useState(false);
  const ref = useRef(fn);
  ref.current = fn;
  const run = useCallback(async (...args: A) => {
    setBusy(true);
    try {
      await ref.current(...args);
    } finally {
      setBusy(false);
    }
  }, []);
  return [run, busy];
}

/** A ticking "now" for countdowns (ms resolution chosen by caller). */
export function useNow(active: boolean, everyMs = 250): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [active, everyMs]);
  return now;
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = title ? `${title} · Plumbline` : 'Plumbline';
    return () => {
      document.title = prev;
    };
  }, [title]);
}

export function downloadText(filename: string, mime: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fileStamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
