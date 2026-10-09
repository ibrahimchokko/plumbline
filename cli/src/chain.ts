/**
 * Soroban helpers for the CLI: build, sign and (optionally) submit calls to
 * the escrow contract. Mirrors the web app's soroban.ts but signs with a
 * local Keypair, because a terminal has no wallet extension.
 */
import { Address, Contract, Keypair, TransactionBuilder, nativeToScVal, rpc, type xdr } from '@stellar/stellar-sdk';
import { env, need } from './env.ts';

let server: rpc.Server | null = null;
export const soroban = () => (server ??= new rpc.Server(env.sorobanRpcUrl, { allowHttp: env.sorobanRpcUrl.startsWith('http://') }));

export const addr = (a: string) => new Address(a).toScVal();
export const i128 = (v: bigint | string) => nativeToScVal(BigInt(v), { type: 'i128' });
export const u64 = (v: bigint | string) => nativeToScVal(BigInt(v), { type: 'u64' });

/** Simulate + assemble a contract call and sign it with `signer`. */
export async function signedCall(signer: Keypair, method: string, args: xdr.ScVal[], fee = '100'): Promise<string> {
  need(env.contractId, 'ORACLE_CONTRACT_ID', 'the CLI needs to know which escrow contract to call');
  const account = await soroban().getAccount(signer.publicKey());
  const tx = new TransactionBuilder(account, { fee, networkPassphrase: env.networkPassphrase })
    .addOperation(new Contract(env.contractId).call(method, ...args))
    .setTimeout(120)
    .build();
  const prepared = await soroban().prepareTransaction(tx);
  prepared.sign(signer);
  return prepared.toXDR();
}

/** Submit a signed XDR ourselves (the signer pays the network fee) and wait. */
export async function submitAndWait(signedXdr: string): Promise<string> {
  const tx = TransactionBuilder.fromXDR(signedXdr, env.networkPassphrase);
  const sent = await soroban().sendTransaction(tx);
  if (sent.status === 'ERROR') throw new Error(`transaction rejected: ${JSON.stringify(sent.errorResult ?? sent)}`);
  const final = await soroban().pollTransaction(sent.hash, { attempts: 30 });
  if (final.status !== 'SUCCESS') throw new Error(`transaction ${sent.hash} ended as ${final.status}`);
  return sent.hash;
}

/** submit(payer, question_id, amount) — the escrow deposit for a question. */
export const signSubmit = (payer: Keypair, questionId: string, amountStroops: string, fee?: string) =>
  signedCall(payer, 'submit', [addr(payer.publicKey()), u64(questionId), i128(amountStroops)], fee);
export const signStake = (worker: Keypair, amountStroops: bigint | string) => signedCall(worker, 'stake', [addr(worker.publicKey()), i128(amountStroops)]);
export const signWithdraw = (worker: Keypair, amountStroops: bigint | string) => signedCall(worker, 'withdraw', [addr(worker.publicKey()), i128(amountStroops)]);
/** refund_timeout(question_id) needs NO auth from payer or admin — the caller only pays the fee. */
export const signRefundTimeout = (caller: Keypair, questionId: string) => signedCall(caller, 'refund_timeout', [u64(questionId)], '1000000');

export async function latestLedger(): Promise<number> {
  return (await soroban().getLatestLedger()).sequence;
}

export async function nativeBalance(address: string): Promise<string> {
  const res = await fetch(`${env.horizonUrl}/accounts/${address}`);
  if (res.status === 404) return '0';
  const acct = (await res.json()) as { balances: Array<{ asset_type: string; balance: string }> };
  return acct.balances.find((b) => b.asset_type === 'native')?.balance ?? '0';
}

export const keypair = (secret: string, name: string, why: string) => Keypair.fromSecret(need(secret, name, why));
