/**
 * One notification system for the whole app.
 *
 * The original had three overlapping mechanisms (a per-page activity log
 * <ul>, a per-page header bell with its own localStorage key, and ad-hoc
 * status <p> tags). Here every event goes through `notify()`, which feeds:
 *   - a transient toast (for things the user should see now),
 *   - the persistent bell/inbox (last 60 events, survives reloads),
 *   - the per-screen activity log (via `useActivity`).
 */

import { useSyncExternalStore } from 'react';
import { store } from './storage.ts';

export type Tone = 'info' | 'success' | 'warn' | 'error';

export interface Notice {
  id: string;
  at: number;
  message: string;
  tone: Tone;
  scope: string;
  read: boolean;
  /** optional link (e.g. explorer tx) */
  href?: string;
}

const MAX = 60;
const KEY = 'inbox';

let items: Notice[] = store.getJson<Notice[]>(KEY, []);
let toasts: Notice[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function persist() {
  store.setJson(KEY, items);
}

export function notify(message: string, opts: { tone?: Tone; scope?: string; toast?: boolean; href?: string } = {}) {
  const n: Notice = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    message,
    tone: opts.tone ?? 'info',
    scope: opts.scope ?? 'app',
    read: false,
    href: opts.href,
  };
  items = [n, ...items].slice(0, MAX);
  persist();
  if (opts.toast ?? n.tone !== 'info') {
    toasts = [...toasts, n].slice(-4);
    setTimeout(() => dismissToast(n.id), n.tone === 'error' ? 8000 : 4500);
  }
  emit();
  return n;
}

export function dismissToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function markAllRead() {
  if (!items.some((i) => !i.read)) return;
  items = items.map((i) => ({ ...i, read: true }));
  persist();
  emit();
}

export function removeNotice(id: string) {
  items = items.filter((i) => i.id !== id);
  persist();
  emit();
}

export function clearInbox() {
  items = [];
  persist();
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useInbox = () => useSyncExternalStore(subscribe, () => items);
export const useToasts = () => useSyncExternalStore(subscribe, () => toasts);

/** Activity for one screen (scope), newest first. */
export function useActivity(scope: string): Notice[] {
  const all = useInbox();
  return all.filter((n) => n.scope === scope);
}

/** Bound helper: `const log = scoped('verify'); log('…')`. */
export function scoped(scope: string) {
  const fn = (message: string, tone: Tone = 'info', extra: { toast?: boolean; href?: string } = {}) => notify(message, { tone, scope, ...extra });
  return fn;
}

// Push payloads relayed from the service worker land in the inbox too.
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (evt: MessageEvent) => {
    if (evt.data?.type === 'plumbline:notify') notify(String(evt.data.message), { scope: 'push', toast: true });
  });
}
