/**
 * Runtime feature flags — toggled without a rebuild.
 *
 * Source: an Unleash frontend API if configured, otherwise /flags.json:
 *   { "flag": true | false | { "enabled": true, "rollout": 25 } }
 * `rollout` is a 0–100 percentage evaluated against a stable per-browser
 * id, so a given person stays consistently in or out. Any failure falls
 * back to DEFAULTS — i.e. the app's normal behaviour.
 */
import { useEffect, useState } from 'react';
import { percentBucket } from '@plumbline/core';
import { config } from './config.ts';
import { store } from './storage.ts';

export const DEFAULTS = {
  pushNotifications: true,
  askComposer: true,
  practiceMode: true,
  socialRecovery: true,
} as const;
export type FlagName = keyof typeof DEFAULTS;
type Flags = Record<FlagName, boolean>;

function stableId(): string {
  let id = store.get('flags.uid');
  if (!id) {
    id = globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2);
    store.set('flags.uid', id);
  }
  return id;
}

async function fetchJson(url: string | URL, headers?: Record<string, string>) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

let loaded: Promise<Flags> | null = null;

export function loadFlags(): Promise<Flags> {
  if (loaded) return loaded;
  const uid = stableId();
  loaded = (async () => {
    if (config.unleash.url && config.unleash.clientKey) {
      const u = new URL(config.unleash.url);
      u.searchParams.set('appName', 'plumbline-web');
      u.searchParams.set('userId', uid);
      const body = (await fetchJson(u, { Authorization: config.unleash.clientKey })) as { toggles?: Array<{ name: string; enabled?: boolean }> };
      const out = Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, false])) as Flags;
      for (const t of body.toggles ?? []) if (t.name in out) out[t.name as FlagName] = t.enabled !== false;
      return out;
    }
    const raw = (await fetchJson('/flags.json')) as Record<string, boolean | { enabled?: boolean; rollout?: number }>;
    const out: Flags = { ...DEFAULTS };
    for (const [name, v] of Object.entries(raw ?? {})) {
      if (!(name in out)) continue;
      if (typeof v === 'boolean') out[name as FlagName] = v;
      else if (v && typeof v === 'object') {
        const rollout = Number.isFinite(v.rollout) ? Number(v.rollout) : 100;
        out[name as FlagName] = v.enabled !== false && percentBucket(name, uid) < rollout;
      }
    }
    return out;
  })().catch(() => ({ ...DEFAULTS }));
  return loaded;
}

/** `const on = useFlag('practiceMode')` — true until proven false (fail open). */
export function useFlag(name: FlagName): boolean {
  const [on, setOn] = useState<boolean>(DEFAULTS[name]);
  useEffect(() => {
    let alive = true;
    loadFlags().then((f) => alive && setOn(f[name]));
    return () => {
      alive = false;
    };
  }, [name]);
  return on;
}
