/**
 * Every environment-dependent value in one place. Nothing else in the app
 * reads import.meta.env directly — so switching testnet -> mainnet is a
 * single variable, and the network passphrase used to sign can never drift
 * from the one used to build transactions (a real inconsistency in the
 * original app, which hard-coded TESTNET in one file and read an env var in
 * another).
 */

const env = import.meta.env;

export type NetworkName = 'testnet' | 'public';

const NETWORKS = {
  testnet: {
    passphrase: 'Test SDF Network ; September 2015',
    horizon: 'https://horizon-testnet.stellar.org',
    rpc: 'https://soroban-testnet.stellar.org',
  },
  public: {
    passphrase: 'Public Global Stellar Network ; September 2015',
    horizon: 'https://horizon.stellar.org',
    rpc: 'https://mainnet.sorobanrpc.com',
  },
} as const;

const network: NetworkName = env.VITE_NETWORK === 'public' ? 'public' : 'testnet';

export const config = {
  appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0',
  backendCompat: typeof __BACKEND_COMPAT__ === 'string' ? __BACKEND_COMPAT__ : '1.0.0',
  backendUrl: (env.VITE_BACKEND_URL || 'http://localhost:4000').replace(/\/+$/, ''),
  network,
  networkPassphrase: NETWORKS[network].passphrase,
  horizonUrl: env.VITE_HORIZON_URL || NETWORKS[network].horizon,
  sorobanRpcUrl: env.VITE_SOROBAN_RPC_URL || NETWORKS[network].rpc,
  usdc: {
    code: env.VITE_USDC_ASSET_CODE || 'USDC',
    issuer: env.VITE_USDC_ASSET_ISSUER || 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  },
  contractId: env.VITE_ORACLE_CONTRACT_ID || '',
  enableLedger: env.VITE_ENABLE_LEDGER === 'true',
  sentryDsn: env.VITE_SENTRY_DSN || '',
  unleash: { url: env.VITE_UNLEASH_URL || '', clientKey: env.VITE_UNLEASH_CLIENT_KEY || '' },
} as const;

export const brand = {
  name: 'Plumbline',
  tagline: 'Staked answers, settled on Stellar.',
  docsUrl: 'https://github.com/your-org/plumbline#readme',
} as const;
