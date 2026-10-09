/// <reference lib="webworker" />
/**
 * Isolated signer for the built-in "quick start" wallet.
 *
 * The private key never lives on the page. It lives here, in a dedicated
 * Web Worker, persisted in IndexedDB in one of two states:
 *
 *  pending-backup  The secret is stored AES-GCM-encrypted under a
 *                  non-extractable WebCrypto key so the user can still
 *                  reveal / copy / split it for backup. A copied disk image
 *                  or synced profile is useless without that key.
 *
 *  locked          After the user confirms their backup, the seed is
 *                  imported as a NON-EXTRACTABLE Ed25519 WebCrypto key and
 *                  the encrypted copy is deleted. From then on no script on
 *                  this origin — not even an XSS payload — can read the key;
 *                  at most it can ask for signatures while the page is open,
 *                  the same power an extension wallet's page bridge has.
 *
 *  locked-fallback Browsers without WebCrypto Ed25519 keep the encrypted
 *                  secret but still refuse every further export.
 *
 * The page talks to this worker only through the tiny RPC at the bottom.
 */
import { Keypair, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';

declare const self: DedicatedWorkerGlobalScope;

const DB = 'plumbline-wallet';
const STORE = 'keys';
const LEGACY_DB = 'arbiter-wallet'; // migrate wallets created by the original app
// PKCS#8 header for a raw 32-byte Ed25519 seed.
const PKCS8_PREFIX = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);

type State = 'pending-backup' | 'locked' | 'locked-fallback';
interface Rec {
  address: string;
  state: State;
  wrapKey?: CryptoKey;
  iv?: Uint8Array;
  ct?: ArrayBuffer;
  signKey?: CryptoKey;
}

let rec: Rec | null = null;
let keypair: Keypair | null = null;

function idb<T>(db: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(db, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => {
        open.result.close();
        resolve((req as IDBRequest | undefined)?.result as T);
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}
const load = (db = DB) => idb<Rec | undefined>(db, 'readonly', (s) => s.get('wallet'));
const save = (v: Rec) => idb<void>(DB, 'readwrite', (s) => s.put(v, 'wallet'));
const wipe = () => idb<void>(DB, 'readwrite', (s) => s.delete('wallet'));

async function ed25519Supported(): Promise<boolean> {
  try {
    await crypto.subtle.generateKey({ name: 'Ed25519' } as Algorithm, false, ['sign']);
    return true;
  } catch {
    return false;
  }
}

async function encrypt(secret: string) {
  const wrapKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, new TextEncoder().encode(secret));
  return { wrapKey, iv, ct };
}

async function decrypt(r: Rec): Promise<string> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: r.iv! }, r.wrapKey!, r.ct!);
  return new TextDecoder().decode(pt);
}

async function create(secret?: string): Promise<Rec> {
  const kp = secret ? Keypair.fromSecret(secret) : Keypair.random();
  const r: Rec = { address: kp.publicKey(), state: 'pending-backup', ...(await encrypt(kp.secret())) };
  await save(r);
  keypair = kp;
  return r;
}

async function init({ legacySecret }: { legacySecret?: string | null }) {
  rec = (await load()) ?? null;
  if (!rec) {
    let migrated: Rec | undefined;
    try {
      migrated = await load(LEGACY_DB);
    } catch {
      /* no legacy db */
    }
    if (migrated) {
      rec = migrated;
      await save(rec);
    } else {
      rec = await create(legacySecret ?? undefined);
    }
  }
  if (rec.state !== 'locked' && !keypair) keypair = Keypair.fromSecret(await decrypt(rec));
  return { address: rec.address, state: rec.state };
}

async function lock() {
  if (!rec || rec.state !== 'pending-backup') return { state: rec?.state ?? null };
  if (!(await ed25519Supported())) {
    rec = { ...rec, state: 'locked-fallback' };
  } else {
    const seed = StrKey.decodeEd25519SecretSeed(keypair!.secret());
    const pkcs8 = new Uint8Array(PKCS8_PREFIX.length + seed.length);
    pkcs8.set(PKCS8_PREFIX);
    pkcs8.set(seed, PKCS8_PREFIX.length);
    const signKey = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' } as Algorithm, false, ['sign']);
    pkcs8.fill(0);
    rec = { address: rec.address, state: 'locked', signKey };
    keypair = null;
  }
  await save(rec);
  return { state: rec.state };
}

async function sign({ xdr, networkPassphrase }: { xdr: string; networkPassphrase: string }) {
  if (!rec) throw new Error('wallet not initialised');
  const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
  if (rec.state === 'locked' && rec.signKey) {
    const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' } as Algorithm, rec.signKey, tx.hash()));
    let bin = '';
    sig.forEach((b) => (bin += String.fromCharCode(b)));
    tx.addSignature(rec.address, btoa(bin));
  } else {
    if (!keypair) keypair = Keypair.fromSecret(await decrypt(rec));
    tx.sign(keypair);
  }
  return { signedTxXdr: tx.toXDR() };
}

async function restore({ secret }: { secret: string }) {
  if (!StrKey.isValidEd25519SecretSeed(secret.trim())) throw new Error('That is not a valid Stellar secret key (it should start with S).');
  await wipe();
  keypair = null;
  rec = await create(secret.trim());
  return { address: rec.address, state: rec.state };
}

const handlers: Record<string, (args: never) => unknown> = {
  init,
  lock,
  sign,
  restore,
  exportSecret: () => (rec?.state === 'pending-backup' && keypair ? keypair.secret() : null),
  forget: async () => {
    rec = null;
    keypair = null;
    await wipe();
  },
};

self.onmessage = async ({ data: { id, op, args } }: MessageEvent<{ id: number; op: string; args: unknown }>) => {
  try {
    const handler = handlers[op];
    if (!handler) throw new Error(`unknown op ${op}`);
    self.postMessage({ id, result: await handler((args ?? {}) as never) });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
