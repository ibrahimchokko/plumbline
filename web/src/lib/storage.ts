/**
 * localStorage that never throws. Private browsing, blocked cookies and
 * full quotas all make raw localStorage calls throw; every caller in the
 * original app had to remember its own try/catch (several didn't).
 */

const PREFIX = 'plumbline.';

export const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(PREFIX + key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(PREFIX + key, value);
    } catch {
      /* storage unavailable — the in-memory state still works for this tab */
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      /* ignore */
    }
  },
  getJson<T>(key: string, fallback: T): T {
    const raw = store.get(key);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },
  setJson(key: string, value: unknown): void {
    store.set(key, JSON.stringify(value));
  },
};
