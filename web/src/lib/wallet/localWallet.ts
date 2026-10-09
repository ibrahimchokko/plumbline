import { config } from '../config.ts';
import type { LocalSigner, LocalWalletState } from './types.ts';

/** Key name the original Arbiter app used for its (plaintext) quick-start
 * secret. If found, it is moved into the hardened worker once and deleted. */
const LEGACY_PLAINTEXT_KEY = 'arbiter_local_wallet_secret';

type Rpc = <T>(op: string, args?: unknown) => Promise<T>;
let rpc: Rpc | null = null;

function getRpc(): Rpc {
  if (rpc) return rpc;
  const worker = new Worker(new URL('./signer.worker.ts', import.meta.url), { type: 'module' });
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let seq = 0;
  worker.onmessage = ({ data }: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    if (data.error) p.reject(new Error(data.error));
    else p.resolve(data.result);
  };
  worker.onerror = (e) => {
    pending.forEach((p) => p.reject(new Error(e.message || 'wallet worker crashed')));
    pending.clear();
  };
  rpc = <T,>(op: string, args?: unknown) =>
    new Promise<T>((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage({ id, op, args });
    });
  return rpc;
}

export function hasLegacyPlaintextWallet(): boolean {
  try {
    return !!localStorage.getItem(LEGACY_PLAINTEXT_KEY);
  } catch {
    return false;
  }
}

/** Open (creating on first use) this browser's local wallet. */
export async function openLocalWallet(): Promise<LocalSigner> {
  const call = getRpc();
  let legacySecret: string | null = null;
  try {
    legacySecret = localStorage.getItem(LEGACY_PLAINTEXT_KEY);
  } catch {
    /* ignore */
  }
  const info = await call<{ address: string; state: LocalWalletState }>('init', { legacySecret });
  if (legacySecret) {
    try {
      localStorage.removeItem(LEGACY_PLAINTEXT_KEY);
    } catch {
      /* ignore */
    }
  }

  const signer: LocalSigner = {
    kind: 'local',
    id: 'local',
    label: 'Built-in wallet',
    address: info.address,
    state: info.state,
    async signTransaction(xdr) {
      const { signedTxXdr } = await call<{ signedTxXdr: string }>('sign', { xdr, networkPassphrase: config.networkPassphrase });
      return signedTxXdr;
    },
    exportSecret: () => call<string | null>('exportSecret'),
    async lockExport() {
      const { state } = await call<{ state: LocalWalletState }>('lock');
      signer.state = state;
      return state;
    },
    forget: () => call<void>('forget'),
    async restore(secret) {
      const next = await call<{ address: string; state: LocalWalletState }>('restore', { secret });
      signer.address = next.address;
      signer.state = next.state;
      return next;
    },
  };
  return signer;
}
