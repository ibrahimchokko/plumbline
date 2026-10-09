import { Keypair } from '@stellar/stellar-sdk';
import { SlidingWindowLimiter, checkCompatibility, waitForSettlement } from '@plumbline/core';
import { flagString, type Parsed } from '../args.ts';
import { latestLedger, signRefundTimeout, submitAndWait } from '../chain.ts';
import { api, c, env, explorer, info, need, ok, warn } from '../env.ts';

/** plumb status — is the backend up, which version, how many verifiers. */
export async function status() {
  const started = Date.now();
  const stats = await api.stats();
  const ms = Date.now() - started;
  const health = await api.health().catch(() => null);
  const reported = health?.apiVersion ?? health?.version;
  ok(`${env.backendUrl} answered in ${ms} ms${ms > 2000 ? c.yellow(' (slow)') : ''}`);
  info(`answered ${stats.totalResolved} · refunded ${stats.totalRefunded} · verifiers online ${stats.onlineWorkers}`);
  info(`backend API ${reported ? `v${reported}` : 'version not reported'} — ${checkCompatibility('1.0.0', reported)} with this CLI`);
  info(`network ${env.network} · contract ${env.contractId || c.yellow('not set')}`);
}

/**
 * plumb refund <questionId>
 * Calls the contract's permissionless refund_timeout(). Requires NO
 * signature from the asker or the platform — the caller only pays the
 * network fee. This is the escape hatch that guarantees escrow can be
 * delayed but never stranded.
 */
export async function refund(p: Parsed) {
  const questionId = need(p.positional[0] ?? '', 'questionId', 'usage: plumb refund <questionId>');
  const caller = Keypair.fromSecret(need(env.payerSecret || env.workerSecret, 'PAYER_SECRET', 'any funded key can pay the fee'));
  info(`ledger now ${await latestLedger()} — calling refund_timeout(${questionId}) as ${caller.publicKey()}`);
  const hash = await submitAndWait(await signRefundTimeout(caller, questionId));
  ok(`refund_timeout() succeeded with no admin or asker signature: ${explorer(hash)}`);
}

/**
 * plumb bot "<question>" [--user U123]
 * Sandbox-only chat-bot backend (Slack/Discord): rate-limited per chat user
 * so one person can't drain a shared sandbox quota. No payer secret is used
 * — real payments from a bot need a custody model nobody has chosen yet.
 * (The original sandbox-ask.js used CommonJS `require` inside an ES-module
 * package and crashed on start; this is the working replacement.)
 */
const limiter = new SlidingWindowLimiter(env.rateLimitMax, env.rateLimitWindowMs);

export async function handleBotMessage(userId: string, question: string): Promise<string> {
  const gate = limiter.check(userId);
  if (!gate.allowed) return `Rate limit reached — try again in ${Math.ceil(gate.retryInMs / 1000)}s.`;
  try {
    const { jobId } = await api.oracle.sandbox(question);
    const job = await waitForSettlement(api, jobId, { intervalMs: 700, timeoutMs: 45_000 });
    return job.outcome === 'resolved' ? String(job.answer) : `No consensus (${job.reason ?? 'refunded'}).`;
  } catch (err) {
    return `Sorry, I couldn't reach the oracle: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function bot(p: Parsed) {
  const question = p.positional.join(' ').trim();
  if (!question) throw new Error('usage: plumb bot [--user USER_ID] "<question>"');
  console.log(await handleBotMessage(flagString(p.flags, 'user') ?? 'anonymous', question));
}

export function warnIfMainnet() {
  if (env.network === 'public') warn(c.bold('You are on Stellar MAINNET — real money moves.'));
}
