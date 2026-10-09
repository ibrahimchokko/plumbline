/**
 * Ledger hardware-wallet adapter (opt-in: VITE_ENABLE_LEDGER=true).
 *
 * When the flag is off, vite.config.ts aliases this file to ledger.stub.ts,
 * so the USB/HID dependency tree is never even resolved — let alone
 * shipped. Ledger signs whole Soroban transaction envelopes, which is
 * exactly what every Plumbline flow asks it to sign.
 */
import { LedgerModule } from '@creit.tech/stellar-wallets-kit/modules/ledger.module';
import type { ModuleInterface } from '@creit.tech/stellar-wallets-kit';

export const ledgerModules = (): ModuleInterface[] => [new LedgerModule()];
