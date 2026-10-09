/**
 * Shamir secret sharing over GF(256) — used for client-side social recovery
 * of the browser "quick start" wallet. Everything runs locally: no share
 * and never the secret itself is ever sent to a server.
 *
 * Share format (v1):   pl1-<k>-<n>-<x>-<hex payload>-<8 hex checksum>
 *   k = threshold, n = total shares, x = this share's index (1..n)
 *   checksum = FNV-1a over everything before it, so a mistyped or truncated
 *   share is rejected with a clear error instead of silently producing a
 *   wrong key.
 *
 * Legacy shares in the older `k.n.x.hex` dotted form are still accepted by
 * combineShares() so previously-distributed recovery kits keep working.
 */

import { fnv1a32 } from './hash.ts';

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    // multiply by the generator 0x03 modulo the AES polynomial 0x11b
    x ^= (x << 1) ^ (x & 0x80 ? 0x11b : 0);
    x &= 0xff;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
const div = (a: number, b: number) => {
  if (b === 0) throw new ShamirError('division by zero');
  return a === 0 ? 0 : EXP[(LOG[a] - LOG[b] + 255) % 255];
};

export class ShamirError extends Error {
  override name = 'ShamirError';
  constructor(message: string) {
    super(`Recovery share error: ${message}`);
  }
}

function secureRandom(length: number): Uint8Array {
  const c = globalThis.crypto;
  if (!c?.getRandomValues) {
    // Deliberately no Math.random() fallback: predictable coefficients would
    // let a single share leak the secret.
    throw new ShamirError('a secure random number generator is not available in this environment');
  }
  return c.getRandomValues(new Uint8Array(length));
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new ShamirError('share payload is not valid hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const checksum = (body: string) => fnv1a32(body).toString(16).padStart(8, '0');

export interface ParsedShare {
  k: number;
  n: number;
  x: number;
  payload: Uint8Array;
}

/** Split `secret` into `n` shares, any `k` of which rebuild it. */
export function splitSecret(secret: string, k: number, n: number): string[] {
  if (!secret) throw new ShamirError('secret must be a non-empty string');
  if (!Number.isInteger(k) || !Number.isInteger(n) || k < 2 || n < k || n > 255) {
    throw new ShamirError('need 2 <= threshold <= shares <= 255');
  }
  const bytes = new TextEncoder().encode(secret);
  const shares = Array.from({ length: n }, () => new Uint8Array(bytes.length));

  for (let i = 0; i < bytes.length; i++) {
    const coeffs = new Uint8Array(k);
    coeffs[0] = bytes[i];
    coeffs.set(secureRandom(k - 1), 1);
    for (let s = 0; s < n; s++) {
      const x = s + 1;
      let y = 0;
      for (let c = k - 1; c >= 0; c--) y = mul(y, x) ^ coeffs[c]; // Horner
      shares[s][i] = y;
    }
  }

  return shares.map((payload, s) => {
    const body = `pl1-${k}-${n}-${s + 1}-${toHex(payload)}`;
    return `${body}-${checksum(body)}`;
  });
}

export function parseShare(raw: string): ParsedShare {
  const text = String(raw).trim();
  let k: number, n: number, x: number, hex: string;

  if (text.startsWith('pl1-')) {
    const parts = text.split('-');
    if (parts.length !== 6) throw new ShamirError('malformed share');
    const body = parts.slice(0, 5).join('-');
    if (checksum(body) !== parts[5].toLowerCase()) {
      throw new ShamirError('checksum mismatch — this share was mistyped or truncated');
    }
    [k, n, x] = parts.slice(1, 4).map((p) => parseInt(p, 10));
    hex = parts[4];
  } else {
    // legacy dotted format
    const parts = text.split('.');
    if (parts.length !== 4) throw new ShamirError('malformed share');
    [k, n, x] = parts.slice(0, 3).map((p) => parseInt(p, 10));
    hex = parts[3];
  }

  if (![k, n, x].every(Number.isInteger) || x < 1 || x > n || k < 2 || k > n) {
    throw new ShamirError('malformed share header');
  }
  return { k, n, x, payload: fromHex(hex) };
}

/** Rebuild the secret from at least `k` shares (Lagrange interpolation at 0). */
export function combineShares(rawShares: string[]): string {
  if (!Array.isArray(rawShares) || rawShares.length === 0) throw new ShamirError('no shares provided');
  const parsed = rawShares.filter((s) => String(s).trim()).map(parseShare);
  if (parsed.length === 0) throw new ShamirError('no shares provided');

  const { k, payload } = parsed[0];
  const len = payload.length;
  for (const s of parsed) {
    if (s.k !== k || s.payload.length !== len) throw new ShamirError('shares come from different splits');
  }
  const unique = [...new Map(parsed.map((s) => [s.x, s])).values()];
  if (unique.length < k) throw new ShamirError(`need ${k} different shares, got ${unique.length}`);

  const used = unique.slice(0, k);
  const out = new Uint8Array(len);
  for (let b = 0; b < len; b++) {
    let acc = 0;
    for (let i = 0; i < used.length; i++) {
      let num = 1;
      let den = 1;
      for (let j = 0; j < used.length; j++) {
        if (i === j) continue;
        num = mul(num, used[j].x);
        den = mul(den, used[i].x ^ used[j].x);
      }
      acc ^= mul(used[i].payload[b], div(num, den));
    }
    out[b] = acc;
  }
  return new TextDecoder().decode(out);
}
