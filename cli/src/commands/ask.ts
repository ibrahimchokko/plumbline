/**
 * plumb ask "<question>" [--tier standard] [--category math] [--image ./pic.png] [--sponsored]
 *
 * The full paid flow against a real backend + contract:
 *   1. POST /oracle                -> 402 with a locked quote
 *   2. sign submit() and pay       -> directly (payer pays the fee) or
 *                                     --sponsored via /sponsor/pay (zero XLM)
 *   3. POST /oracle + proof        -> 202 jobId
 *   4. poll until settled          -> resolved / refunded
 */
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { waitForSettlement, type Job, type PaymentChallenge } from '@plumbline/core';
import { flagBool, flagString, type Parsed } from '../args.ts';
import { keypair, signSubmit, submitAndWait } from '../chain.ts';
import { api, c, endProgress, env, explorer, info, ok, progress, warn } from '../env.ts';

const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

export async function uploadImage(path: string): Promise<string> {
  const type = IMAGE_TYPES[extname(path).toLowerCase()];
  if (!type) throw new Error(`unsupported image type: ${path} (png, jpeg, webp, gif)`);
  const bytes = await readFile(path);
  if (bytes.byteLength > 2 * 1024 * 1024) throw new Error('images must be 2 MB or smaller');
  const { attachmentId } = await api.attachments.upload(new Blob([bytes], { type }), basename(path));
  return attachmentId;
}

export function printJob(job: Job, questionId?: string) {
  if (job.outcome === 'resolved') {
    ok(`${c.bold('ANSWERED')} — "${job.answer}" (confidence ${job.confidence ?? '—'}${job.reconciliationMethod ? `, via ${job.reconciliationMethod}` : ''})`);
    if (job.matchingWorkers?.length) info(`agreeing verifiers: ${job.matchingWorkers.join(', ')}`);
    if (job.payoutTx) info(`payout: ${explorer(job.payoutTx)}`);
  } else if (job.outcome === 'refunded') {
    ok(`${c.bold('REFUNDED')} — ${job.reason ?? 'no consensus'}`);
    if (job.refundTx) info(`refund: ${explorer(job.refundTx)}`);
  } else {
    warn(`The server could not settle on-chain (outcome=${job.outcome}): ${job.reason ?? 'unknown reason'}`);
    if (questionId) {
      info(`You are not stuck: after ${job.autoRefundAfterLedgers ?? env.timeoutLedgers} ledgers anyone can run`);
      info(`  ${c.cyan(`plumb refund ${questionId}`)}  to return the escrow to you — no admin needed.`);
    }
  }
}

export async function payAndAsk(opts: { question: string; tier?: string; category?: string; attachmentId?: string; sponsored: boolean }) {
  const payer = keypair(env.payerSecret, 'PAYER_SECRET', 'a funded testnet key pays for the question');
  info(`asker ${payer.publicKey()}`);

  const quote: PaymentChallenge = await api.oracle.quote({ question: opts.question, tier: opts.tier, category: opts.category, attachmentId: opts.attachmentId });
  const surge = quote.surgeMultiplier && quote.surgeMultiplier !== 1 ? c.yellow(` (surge ×${quote.surgeMultiplier} — verifiers are scarce right now)`) : '';
  ok(`price locked: ${c.bold(`${quote.amount} USDC`)} for question ${quote.questionId}${surge}`);

  let hash: string;
  if (opts.sponsored) {
    const signed = await signSubmit(payer, quote.questionId, quote.amountStroops);
    ({ hash } = await api.sponsor.pay({ xdr: signed, payerAddress: payer.publicKey(), questionId: quote.questionId }));
    ok(`escrow deposit fee-bumped by the server (you spent 0 XLM): ${explorer(hash)}`);
  } else {
    info('submitting the escrow deposit on-chain…');
    hash = await submitAndWait(await signSubmit(payer, quote.questionId, quote.amountStroops, '1000000'));
    ok(`escrow deposit landed: ${explorer(hash)}`);
  }

  const { jobId } = await api.oracle.fulfil({ question: opts.question, attachmentId: opts.attachmentId }, { paymentTx: hash, questionId: quote.questionId });
  ok(`payment verified — job ${jobId} dispatched to verifiers`);

  const job = await waitForSettlement(api, jobId, {
    timeoutMs: 5 * 60_000,
    onTick: (j) => progress(`  … ${j.status} (${j.totalAnswers ?? 0} answers so far)`),
  });
  endProgress();
  printJob(job, quote.questionId);
  return { quote, job };
}

export async function ask(p: Parsed) {
  const question = p.positional.join(' ').trim() || 'What is the capital of France?';
  const image = flagString(p.flags, 'image');
  console.log(`${c.bold('Asking')} "${question}"`);
  const attachmentId = image ? await uploadImage(image) : undefined;
  if (attachmentId) ok(`image attached (${attachmentId})`);
  await payAndAsk({ question, tier: flagString(p.flags, 'tier') ?? 'standard', category: flagString(p.flags, 'category'), attachmentId, sponsored: flagBool(p.flags, 'sponsored') });
}
