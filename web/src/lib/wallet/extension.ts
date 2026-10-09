/**
 * Browser-extension wallets via Stellar Wallets Kit.
 *
 * The module list is explicit (not allowAllModules()) so we never silently
 * inherit a new adapter — and its dependency tree — on a kit upgrade.
 * The kit itself is imported lazily, so visitors who never click "Connect"
 * never download it. Ledger is opt-in (VITE_ENABLE_LEDGER) and loaded only
 * when enabled, because its USB/HID stack is large.
 */
import { config } from '../config.ts';
import type { Signer } from './types.ts';

type Kit = import('@creit.tech/stellar-wallets-kit').StellarWalletsKit;
let kitPromise: Promise<Kit> | null = null;

async function getKit(): Promise<Kit> {
  if (!kitPromise) {
    kitPromise = (async () => {
      const m = await import('@creit.tech/stellar-wallets-kit');
      const modules: import('@creit.tech/stellar-wallets-kit').ModuleInterface[] = [
        new m.FreighterModule(),
        new m.LobstrModule(),
        new m.xBullModule(),
        new m.HanaModule(),
        new m.AlbedoModule(),
        new m.HotWalletModule(),
      ];
      if (config.enableLedger) {
        const { ledgerModules } = await import('./ledger.ts');
        modules.push(...ledgerModules());
      }
      return new m.StellarWalletsKit({
        network: config.networkPassphrase as unknown as import('@creit.tech/stellar-wallets-kit').WalletNetwork,
        modules,
      });
    })();
  }
  return kitPromise;
}

function makeSigner(kit: Kit, id: string, label: string, address: string): Signer {
  return {
    kind: 'extension',
    id,
    label,
    address,
    async signTransaction(xdr) {
      kit.setWallet(id);
      const { signedTxXdr } = await kit.signTransaction(xdr, { address, networkPassphrase: config.networkPassphrase });
      return signedTxXdr;
    },
  };
}

/** Opens the wallet picker; resolves with a signer, or rejects if closed. */
export async function connectExtension(): Promise<Signer> {
  const kit = await getKit();
  return new Promise<Signer>((resolve, reject) => {
    let settled = false;
    kit
      .openModal({
        modalTitle: 'Connect a Stellar wallet',
        onWalletSelected: async (option) => {
          try {
            kit.setWallet(option.id);
            const { address } = await kit.getAddress();
            settled = true;
            resolve(makeSigner(kit, option.id, option.name, address));
          } catch (err) {
            settled = true;
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        },
        onClosed: (err) => {
          if (!settled) reject(err ?? new Error('Wallet selection was closed'));
        },
      })
      .catch(reject);
  });
}

/** Re-attach to a previously chosen extension without the modal (best effort). */
export async function reconnectExtension(id: string, label: string): Promise<Signer | null> {
  try {
    const kit = await getKit();
    kit.setWallet(id);
    const { address } = await kit.getAddress({ skipRequestAccess: true });
    return address ? makeSigner(kit, id, label, address) : null;
  } catch {
    return null;
  }
}
