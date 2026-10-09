import 'dotenv/config';
import { createApi } from '@plumbline/core';

const NET = {
  testnet: { passphrase: 'Test SDF Network ; September 2015', rpc: 'https://soroban-testnet.stellar.org', horizon: 'https://horizon-testnet.stellar.org' },
  public: { passphrase: 'Public Global Stellar Network ; September 2015', rpc: 'https://mainnet.sorobanrpc.com', horizon: 'https://horizon.stellar.org' },
} as const;

const e = process.env;
const network = e.NETWORK === 'public' || /Public Global/.test(e.NETWORK_PASSPHRASE ?? '') ? 'public' : 'testnet';

/** Every environment variable the CLI reads, in one place. Old Arbiter
 * demo-agent names (DEMO_PAYER_SECRET etc.) keep working. */
export const env = {
  backendUrl: (e.BACKEND_URL || 'http://localhost:4000').replace(/\/+$/, ''),
  network: network as 'testnet' | 'public',
  networkPassphrase: e.NETWORK_PASSPHRASE || NET[network].passphrase,
  sorobanRpcUrl: e.SOROBAN_RPC_URL || NET[network].rpc,
  horizonUrl: e.HORIZON_URL || NET[network].horizon,
  contractId: e.ORACLE_CONTRACT_ID || '',
  usdcCode: e.USDC_ASSET_CODE || 'USDC',
  usdcIssuer: e.USDC_ASSET_ISSUER || 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  timeoutLedgers: Number(e.TIMEOUT_LEDGERS || 100),
  payerSecret: e.PAYER_SECRET || e.DEMO_PAYER_SECRET || '',
  workerSecret: e.WORKER_SECRET || '',
  fundingSecret: e.FUNDING_PAYER_SECRET || '',
  rateLimitWindowMs: Number(e.RATE_LIMIT_WINDOW_MS || 60_000),
  rateLimitMax: Number(e.RATE_LIMIT_MAX || 5),
};

export const api = createApi({ baseUrl: env.backendUrl, timeoutMs: 30_000 });

export function need(value: string, name: string, why: string): string {
  if (!value) throw new Error(`${name} is not set — ${why}. Put it in cli/.env (see cli/.env.example).`);
  return value;
}

/* ---------- pretty output ---------- */
const tty = process.stdout.isTTY && !e.NO_COLOR;
const paint = (code: number) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = { dim: paint(2), bold: paint(1), green: paint(32), yellow: paint(33), red: paint(31), orange: paint(38), cyan: paint(36) };
export const ok = (msg: string) => console.log(`${c.green('✓')} ${msg}`);
export const info = (msg: string) => console.log(`${c.dim('•')} ${msg}`);
export const warn = (msg: string) => console.log(`${c.yellow('!')} ${msg}`);
export const step = (n: number, total: number, msg: string) => console.log(`\n${c.bold(`[${n}/${total}]`)} ${msg}`);
export const progress = (msg: string) => tty && process.stdout.write(`\r${c.dim(msg)}\x1b[K`);
export const endProgress = () => tty && process.stdout.write('\r\x1b[K');
export const explorer = (hash: string) => `https://stellar.expert/explorer/${env.network}/tx/${hash}`;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
