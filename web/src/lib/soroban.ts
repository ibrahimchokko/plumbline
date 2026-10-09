/**
 * Builds the unsigned Soroban contract-call transactions the user signs.
 *
 * Every call here is later relayed through a /sponsor/* fee-bump endpoint,
 * so the nominal fee in the inner transaction is never actually paid by the
 * user — which is how a wallet holding zero XLM can still stake, withdraw
 * and pay for questions.
 *
 * Contract methods used (Arbiter escrow contract ABI):
 *   submit(payer: Address, question_id: u64, amount: i128)
 *   stake(worker: Address, amount: i128)
 *   withdraw(worker: Address, amount: i128)
 *   withdraw_to(worker: Address, beneficiary: Address, amount: i128)
 */
import { config } from './config.ts';

type Sdk = typeof import('@stellar/stellar-sdk');
let sdkPromise: Promise<Sdk> | null = null;
const sdk = () => (sdkPromise ??= import('@stellar/stellar-sdk'));

export interface MemoSpec {
  type?: 'text' | 'id' | 'hash' | 'return' | string;
  value: string;
}

function assertContract() {
  if (!config.contractId) {
    throw new Error('No escrow contract is configured (set VITE_ORACLE_CONTRACT_ID).');
  }
}

let server: import('@stellar/stellar-sdk').rpc.Server | null = null;
async function rpcServer() {
  const { rpc } = await sdk();
  server ??= new rpc.Server(config.sorobanRpcUrl, { allowHttp: config.sorobanRpcUrl.startsWith('http://') });
  return server;
}

async function buildCall(source: string, method: string, args: (s: Sdk) => import('@stellar/stellar-sdk').xdr.ScVal[], memo?: MemoSpec | null) {
  assertContract();
  const s = await sdk();
  const srv = await rpcServer();
  const account = await srv.getAccount(source);
  const builder = new s.TransactionBuilder(account, { fee: '100', networkPassphrase: config.networkPassphrase }).addOperation(
    new s.Contract(config.contractId).call(method, ...args(s)),
  );
  if (memo?.value) {
    const m =
      memo.type === 'id'
        ? s.Memo.id(String(memo.value))
        : memo.type === 'hash'
          ? s.Memo.hash(memo.value)
          : memo.type === 'return'
            ? s.Memo.return(memo.value)
            : s.Memo.text(String(memo.value));
    builder.addMemo(m);
  }
  const prepared = await srv.prepareTransaction(builder.setTimeout(120).build());
  return prepared.toXDR();
}

const addr = (s: Sdk, a: string) => new s.Address(a).toScVal();
const i128 = (s: Sdk, v: bigint | string) => s.nativeToScVal(BigInt(v), { type: 'i128' });
const u64 = (s: Sdk, v: bigint | string) => s.nativeToScVal(BigInt(v), { type: 'u64' });

export const buildStakeXdr = (worker: string, amountStroops: bigint) => buildCall(worker, 'stake', (s) => [addr(s, worker), i128(s, amountStroops)]);

export const buildWithdrawXdr = (worker: string, amountStroops: bigint | string) =>
  buildCall(worker, 'withdraw', (s) => [addr(s, worker), i128(s, amountStroops)]);

export const buildWithdrawToXdr = (worker: string, beneficiary: string, amountStroops: bigint | string, memo?: MemoSpec | null) =>
  buildCall(worker, 'withdraw_to', (s) => [addr(s, worker), addr(s, beneficiary), i128(s, amountStroops)], memo);

export const buildSubmitPaymentXdr = (payer: string, questionId: string, amountStroops: string) =>
  buildCall(payer, 'submit', (s) => [addr(s, payer), u64(s, questionId), i128(s, amountStroops)]);

/** Full checksum validation of a G… address (not just a regex). */
export async function isValidAccountId(address: string): Promise<boolean> {
  const { StrKey } = await sdk();
  return StrKey.isValidEd25519PublicKey(address.trim());
}

export interface AccountReadiness {
  exists: boolean;
  hasUsdcTrustline: boolean;
  usdcBalance: string | null;
  xlmBalance: string | null;
}

/** One Horizon read that tells us whether onboarding is needed. */
export async function accountReadiness(address: string): Promise<AccountReadiness> {
  const res = await fetch(`${config.horizonUrl}/accounts/${address}`);
  if (res.status === 404) return { exists: false, hasUsdcTrustline: false, usdcBalance: null, xlmBalance: null };
  if (!res.ok) throw new Error(`Horizon returned HTTP ${res.status}`);
  const account = (await res.json()) as { balances?: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string; balance: string }> };
  const balances = account.balances ?? [];
  const usdc = balances.find((b) => b.asset_code === config.usdc.code && b.asset_issuer === config.usdc.issuer);
  const xlm = balances.find((b) => b.asset_type === 'native');
  return { exists: true, hasUsdcTrustline: !!usdc, usdcBalance: usdc?.balance ?? null, xlmBalance: xlm?.balance ?? null };
}
