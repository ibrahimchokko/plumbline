/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_NETWORK?: 'testnet' | 'public';
  readonly VITE_HORIZON_URL?: string;
  readonly VITE_SOROBAN_RPC_URL?: string;
  readonly VITE_USDC_ASSET_CODE?: string;
  readonly VITE_USDC_ASSET_ISSUER?: string;
  readonly VITE_ORACLE_CONTRACT_ID?: string;
  readonly VITE_ENABLE_LEDGER?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_UNLEASH_URL?: string;
  readonly VITE_UNLEASH_CLIENT_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
declare const __APP_VERSION__: string;
declare const __BACKEND_COMPAT__: string;
