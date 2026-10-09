/**
 * The one wallet session for the whole app.
 *
 * In the original, every page (worker console, buyer dashboard, …) had its
 * own copy-pasted connect + ensureSession() code, so someone who both asks
 * and answers had to connect and sign twice in two tabs. Here:
 *
 *  - Connect once; every route shares the same signer and session token.
 *  - Several wallets can be connected at once and switched from the header
 *    (the original markup had an account switcher that was never wired up).
 *  - ensureSession() is de-duplicated: ten components asking for a token at
 *    the same moment produce ONE wallet signature prompt, not ten.
 *  - Tokens are kept per tab (sessionStorage) so a page reload doesn't cost
 *    another signature, and are refreshed a minute before they expire.
 *  - The last wallet is remembered and silently re-attached on reload.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './api.ts';
import { notify } from './notify.ts';
import { store } from './storage.ts';
import { connectExtension, reconnectExtension } from './wallet/extension.ts';
import { openLocalWallet } from './wallet/localWallet.ts';
import type { LocalSigner, Signer } from './wallet/types.ts';

interface TokenRecord {
  token: string;
  expiresAt: number;
}

interface RememberedWallet {
  kind: Signer['kind'];
  id: string;
  label: string;
  address: string;
}

const REMEMBER_KEY = 'wallets';
const ACTIVE_KEY = 'wallets.active';
const TOKEN_PREFIX = 'plumbline.session.';
const REFRESH_MARGIN_MS = 60_000;

function readToken(address: string): TokenRecord | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_PREFIX + address);
    const rec = raw ? (JSON.parse(raw) as TokenRecord) : null;
    return rec && rec.expiresAt - REFRESH_MARGIN_MS > Date.now() ? rec : null;
  } catch {
    return null;
  }
}
function writeToken(address: string, rec: TokenRecord | null) {
  try {
    if (rec) sessionStorage.setItem(TOKEN_PREFIX + address, JSON.stringify(rec));
    else sessionStorage.removeItem(TOKEN_PREFIX + address);
  } catch {
    /* ignore */
  }
}

export interface SessionValue {
  signer: Signer | null;
  address: string | null;
  wallets: Signer[];
  busy: boolean;
  restoring: boolean;
  connect(kind: 'extension' | 'local'): Promise<Signer | null>;
  disconnect(address?: string): void;
  switchTo(address: string): void;
  /** Proves control of the active address once and returns a bearer token. */
  ensureSession(): Promise<string>;
  /** Forget the cached token (e.g. after a 401). */
  invalidateSession(): void;
  hasSession: boolean;
  /** Sign an XDR with the active wallet. */
  sign(xdr: string): Promise<string>;
  local: LocalSigner | null;
  replaceLocal(next: LocalSigner): void;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<Signer[]>([]);
  const [activeAddress, setActiveAddress] = useState<string | null>(store.get(ACTIVE_KEY));
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [tokenTick, setTokenTick] = useState(0);
  const inflight = useRef(new Map<string, Promise<string>>());

  const signer = wallets.find((w) => w.address === activeAddress) ?? wallets[0] ?? null;
  const address = signer?.address ?? null;

  const remember = useCallback((list: Signer[]) => {
    store.setJson(
      REMEMBER_KEY,
      list.map<RememberedWallet>((w) => ({ kind: w.kind, id: w.id, label: w.label, address: w.address })),
    );
  }, []);

  const addWallet = useCallback(
    (w: Signer) => {
      setWallets((prev) => {
        const next = [...prev.filter((p) => p.address !== w.address), w];
        remember(next);
        return next;
      });
      setActiveAddress(w.address);
      store.set(ACTIVE_KEY, w.address);
    },
    [remember],
  );

  // Silently re-attach remembered wallets on load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const remembered = store.getJson<RememberedWallet[]>(REMEMBER_KEY, []);
      const restored: Signer[] = [];
      for (const r of remembered) {
        try {
          const s = r.kind === 'local' ? await openLocalWallet() : await reconnectExtension(r.id, r.label);
          if (s && !restored.some((x) => x.address === s.address)) restored.push(s);
        } catch {
          /* wallet no longer available — drop it */
        }
      }
      if (!cancelled) {
        setWallets(restored);
        setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback<SessionValue['connect']>(
    async (kind) => {
      if (busy) return null; // busy-guard: a double click can't race two activations
      setBusy(true);
      try {
        const w = kind === 'local' ? await openLocalWallet() : await connectExtension();
        addWallet(w);
        notify(
          kind === 'local'
            ? 'Built-in wallet ready. The key never leaves this browser.'
            : `Connected ${w.label} (${w.address.slice(0, 6)}…${w.address.slice(-4)}).`,
          { tone: 'success', scope: 'wallet' },
        );
        return w;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/closed/i.test(msg)) notify(`Could not connect: ${msg}`, { tone: 'error', scope: 'wallet' });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [addWallet, busy],
  );

  const disconnect = useCallback(
    (target?: string) => {
      const addr = target ?? address;
      if (!addr) return;
      writeToken(addr, null);
      setWallets((prev) => {
        const next = prev.filter((w) => w.address !== addr);
        remember(next);
        if (activeAddress === addr) {
          const fallback = next[0]?.address ?? null;
          setActiveAddress(fallback);
          if (fallback) store.set(ACTIVE_KEY, fallback);
          else store.remove(ACTIVE_KEY);
        }
        return next;
      });
    },
    [address, activeAddress, remember],
  );

  const switchTo = useCallback((addr: string) => {
    setActiveAddress(addr);
    store.set(ACTIVE_KEY, addr);
  }, []);

  const ensureSession = useCallback(async () => {
    if (!signer) throw new Error('Connect a wallet first.');
    const cached = readToken(signer.address);
    if (cached) return cached.token;
    const running = inflight.current.get(signer.address);
    if (running) return running;

    const s = signer;
    const p = (async () => {
      notify('Proving you control this address (one signature, no funds move)…', { scope: 'wallet' });
      const { xdr } = await api.workers.challenge(s.address);
      const signed = await s.signTransaction(xdr);
      const { token, expiresAt } = await api.workers.session(s.address, signed);
      writeToken(s.address, { token, expiresAt });
      setTokenTick((t) => t + 1);
      notify('Signed in. Answers and history are now tied to you alone.', { tone: 'success', scope: 'wallet' });
      return token;
    })().finally(() => inflight.current.delete(s.address));
    inflight.current.set(s.address, p);
    return p;
  }, [signer]);

  const invalidateSession = useCallback(() => {
    if (address) writeToken(address, null);
    setTokenTick((t) => t + 1);
  }, [address]);

  const sign = useCallback(
    async (xdr: string) => {
      if (!signer) throw new Error('Connect a wallet first.');
      return signer.signTransaction(xdr);
    },
    [signer],
  );

  const replaceLocal = useCallback(
    (next: LocalSigner) => {
      setWallets((prev) => {
        const list = [...prev.filter((w) => w.kind !== 'local'), next];
        remember(list);
        return list;
      });
      setActiveAddress(next.address);
      store.set(ACTIVE_KEY, next.address);
    },
    [remember],
  );

  const value = useMemo<SessionValue>(
    () => ({
      signer,
      address,
      wallets,
      busy,
      restoring,
      connect,
      disconnect,
      switchTo,
      ensureSession,
      invalidateSession,
      hasSession: !!(address && readToken(address)),
      sign,
      local: (wallets.find((w) => w.kind === 'local') as LocalSigner | undefined) ?? null,
      replaceLocal,
    }),
    // tokenTick deliberately re-computes hasSession after sign-in/out
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signer, address, wallets, busy, restoring, connect, disconnect, switchTo, ensureSession, invalidateSession, sign, replaceLocal, tokenTick],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used inside <SessionProvider>');
  return v;
}
