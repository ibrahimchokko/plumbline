export type WalletKind = 'extension' | 'local';

/**
 * The only thing the rest of the app knows about a wallet. Browser
 * extensions (via Stellar Wallets Kit) and the built-in local wallet both
 * satisfy it, so no screen needs to care which one is active.
 */
export interface Signer {
  kind: WalletKind;
  /** e.g. "freighter", "xbull", "local" */
  id: string;
  label: string;
  address: string;
  signTransaction(xdr: string): Promise<string>;
}

export type LocalWalletState = 'pending-backup' | 'locked' | 'locked-fallback';

export interface LocalSigner extends Signer {
  kind: 'local';
  state: LocalWalletState;
  /** Raw secret for the one-time backup. Null once export has been locked. */
  exportSecret(): Promise<string | null>;
  /** User confirmed their backup — make the key permanently non-exportable. */
  lockExport(): Promise<LocalWalletState>;
  /** Wipe the key from this browser (irreversible without a backup). */
  forget(): Promise<void>;
  /** Replace this browser's wallet with one restored from a secret. */
  restore(secret: string): Promise<{ address: string; state: LocalWalletState }>;
}

export const isLocalSigner = (s: Signer | null | undefined): s is LocalSigner => s?.kind === 'local';
