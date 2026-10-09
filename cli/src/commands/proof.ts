/**
 * plumb sponsored-proof [--timeout-refund]
 *
 * Proves on real testnet that a brand-new key which has NEVER held a stroop
 * of XLM can: get an account created, open a USDC trustline, pay for a
 * question, and get settled — entirely fee-sponsored. Ends by asserting
 * the account still holds exactly 0 XLM.
 *
 * --timeout-refund additionally proves the contract's fail-safe: pay for a
 * question the server is never told about, wait out TIMEOUT_LEDGERS, and
 * have a third party force refund_timeout() with no asker/admin signature.
 */
import { Asset, BASE_FEE, Horizon, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { waitForSettlement } from '@plumbline/core';
import { flagBool, type Parsed } from '../args.ts';
import { keypair, latestLedger, nativeBalance, signRefundTimeout, signSubmit, submitAndWait } from '../chain.ts';
import { api, c, endProgress, env, explorer, info, need, ok, progress, sleep, step } from '../env.ts';
import { printJob } from './ask.ts';

const TOTAL = 6;

async function onboard(fresh: Keypair) {
  step(1, TOTAL, 'Sponsoring account creation + USDC trustline for a zero-XLM key');
  info(`fresh address ${fresh.publicKey()}`);
  const { xdr } = await api.sponsor.onboardBuild(fresh.publicKey());
  const tx = TransactionBuilder.fromXDR(xdr, env.networkPassphrase);
  tx.sign(fresh);
  const { hash } = await api.sponsor.onboardSubmit(tx.toXDR());
  ok(`onboarded: ${explorer(hash)}`);
}

async function fund(fresh: string, amount: string) {
  step(2, TOTAL, `Seeding ${amount} test USDC (the funder pays their own fee)`);
  const funder = keypair(env.fundingSecret, 'FUNDING_PAYER_SECRET', 'a funded USDC holder seeds the fresh account');
  const horizon = new Horizon.Server(env.horizonUrl, { allowHttp: env.horizonUrl.startsWith('http://') });
  const acct = await horizon.loadAccount(funder.publicKey());
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: env.networkPassphrase })
    .addOperation(Operation.payment({ destination: fresh, asset: new Asset(env.usdcCode, env.usdcIssuer), amount }))
    .setTimeout(60)
    .build();
  tx.sign(funder);
  ok(`funded: ${explorer((await horizon.submitTransaction(tx)).hash)}`);
}

async function sponsoredQuestion(fresh: Keypair, question: string) {
  const quote = await api.oracle.quote({ question, tier: 'express' });
  const signed = await signSubmit(fresh, quote.questionId, quote.amountStroops);
  const { hash } = await api.sponsor.pay({ xdr: signed, payerAddress: fresh.publicKey(), questionId: quote.questionId });
  return { quote, hash };
}

export async function sponsoredProof(p: Parsed) {
  need(env.contractId, 'ORACLE_CONTRACT_ID', 'the proof talks to the real escrow contract');
  const fresh = Keypair.random();
  info(`starting XLM balance: ${await nativeBalance(fresh.publicKey())} (account does not exist yet)`);

  await onboard(fresh);
  await fund(fresh.publicKey(), '5');

  step(3, TOTAL, 'Asking a question, paid via sponsored fee-bump');
  const { quote, hash } = await sponsoredQuestion(fresh, 'Zero-XLM proof: which asset does Plumbline settle in?');
  ok(`payment fee-bumped and landed: ${explorer(hash)}`);

  step(4, TOTAL, `Notifying the server and waiting for settlement of ${quote.questionId}`);
  const { jobId } = await api.oracle.fulfil({ question: 'unused' }, { paymentTx: hash, questionId: quote.questionId });
  const job = await waitForSettlement(api, jobId, { onTick: (j) => progress(`  … ${j.status}`) });
  endProgress();
  printJob(job, quote.questionId);

  step(5, TOTAL, 'Re-checking the fresh account’s XLM balance');
  const after = await nativeBalance(fresh.publicKey());
  if (Number(after) !== 0) throw new Error(`EXPECTED ZERO XLM but found ${after} — sponsorship leaked a fee onto the asker`);
  ok(c.bold('PROVEN: account created, trustline opened, question paid and settled — with 0 XLM ever held.'));

  if (!flagBool(p.flags, 'timeout-refund')) {
    step(6, TOTAL, `Skipping the refund_timeout() proof (add ${c.cyan('--timeout-refund')} to run it, ~${Math.round((env.timeoutLedgers * 5) / 60)} min)`);
    return;
  }
  await proveTimeoutRefund(fresh);
}

export async function proveTimeoutRefund(payer: Keypair, opts: { sponsored?: boolean } = { sponsored: true }) {
  step(6, TOTAL, `Proving the permissionless refund_timeout() escape hatch (~${env.timeoutLedgers * 5}s of ledgers)`);
  const quote = await api.oracle.quote({ question: 'This question is deliberately never fulfilled.', tier: 'express' });
  let hash: string;
  if (opts.sponsored) ({ hash } = await api.sponsor.pay({ xdr: await signSubmit(payer, quote.questionId, quote.amountStroops), payerAddress: payer.publicKey(), questionId: quote.questionId }));
  else hash = await submitAndWait(await signSubmit(payer, quote.questionId, quote.amountStroops, '1000000'));
  ok(`paid — server deliberately NOT notified: ${explorer(hash)}`);

  const deadline = (await latestLedger()) + env.timeoutLedgers;
  let now = 0;
  do {
    await sleep(10_000);
    now = await latestLedger();
    progress(`  ledger ${now}/${deadline}`);
  } while (now < deadline);
  endProgress();

  const caller = keypair(env.payerSecret || env.fundingSecret, 'PAYER_SECRET', 'an unrelated funded key pays the refund fee');
  info(`deadline reached — calling refund_timeout() as unrelated third party ${caller.publicKey()}`);
  const refundHash = await submitAndWait(await signRefundTimeout(caller, quote.questionId));
  ok(`refund_timeout() succeeded with no admin or asker signature: ${explorer(refundHash)}`);
}
