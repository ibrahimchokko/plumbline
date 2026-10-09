/** Display helpers shared by every surface. All are null-safe. */

const G_ADDRESS = /^G[A-Z2-7]{55}$/;

/** Shape check for a Stellar account id (G…). Use StrKey for a full checksum check. */
export const looksLikeStellarAddress = (value: string | null | undefined): boolean => !!value && G_ADDRESS.test(value);

export function shortId(id: string | null | undefined, head = 6, tail = 6): string {
  if (!id) return '—';
  const s = String(id);
  return s.length <= head + tail + 3 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function percent(ratio: number | null | undefined, digits = 1): string {
  return ratio === null || ratio === undefined || !Number.isFinite(ratio) ? '—' : `${(ratio * 100).toFixed(digits)}%`;
}

export function explorerTxUrl(hash: string, network: 'testnet' | 'public' = 'testnet'): string {
  return `https://stellar.expert/explorer/${network}/tx/${hash}`;
}

export function explorerAccountUrl(address: string, network: 'testnet' | 'public' = 'testnet'): string {
  return `https://stellar.expert/explorer/${network}/account/${address}`;
}

/** Simple, documented heuristic used to pre-select a tier as the asker types. */
export function suggestTier(question: string): 'standard' | 'express' | 'priority' {
  const q = (question ?? '').trim();
  if (/\b(urgent|asap|now|immediately|right away|quick(ly)?|breaking|live)\b/i.test(q)) return 'express';
  if (q.length > 140) return 'priority';
  return 'standard';
}
