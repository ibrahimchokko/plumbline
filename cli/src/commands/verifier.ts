/**
 * plumb verifier [--answer 42] [--categories math,coding] [--id my-bot]
 *                [--stake 1.5] [--auto-withdraw 30s]
 *
 * A headless verifier that stays online unattended: it reconnects with
 * backoff after any drop (re-proving its session first), answers each
 * dispatched question with a fixed reply, and can stake and periodically
 * sweep its accrued earnings in one withdraw() — the "streaming settlement"
 * model: one network fee for however many answers were credited.
 *
 * With WORKER_SECRET set, the verifier id is a real signable address
 * (needed for staking/withdrawing). Without it, a plain test id is used.
 */
import { Agent } from 'undici';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { backoffDelay, fromStroopsCompact, readSse, toStroops } from '@plumbline/core';
import { flagString, parseDuration, type Parsed } from '../args.ts';
import { signStake, signWithdraw } from '../chain.ts';
import { api, c, env, explorer, sleep } from '../env.ts';

export interface VerifierHandle {
  id: string;
  stop(): void;
  /** resolves once the dispatch channel says "connected" the first time */
  live: Promise<void>;
}

/**
 * Start one verifier loop. Used by `plumb verifier` and by in-process
 * scenarios. The SSE stream gets its OWN connection pool (undici Agent):
 * a long-lived streaming GET can otherwise starve later POSTs to the same
 * origin from the same process — a real bug reproduced against a hosted
 * proxy in the original project.
 */
export function startVerifier(opts: { keypair?: Keypair | null; id?: string; answer: string; categories: string[]; quiet?: boolean }): VerifierHandle {
  const kp = opts.keypair ?? null;
  const id = kp ? kp.publicKey() : (opts.id ?? `cli-verifier-${Date.now()}`);
  const tag = c.cyan(`[${id.length > 16 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id}]`);
  const say = (m: string) => !opts.quiet && console.log(`${tag} ${m}`);
  const agent = new Agent();
  const ctrl = new AbortController();
  let token: string | null = null;
  let stopped = false;
  let markLive: () => void = () => undefined;
  const live = new Promise<void>((r) => (markLive = r));

  async function session(): Promise<string | null> {
    if (!kp) return null; // plain test id: no auth required (or possible)
    if (token) return token;
    const { xdr } = await api.workers.challenge(id);
    const tx = TransactionBuilder.fromXDR(xdr, env.networkPassphrase);
    tx.sign(kp);
    token = (await api.workers.session(id, tx.toXDR())).token;
    say('session established (proved control of this address)');
    return token;
  }

  async function answer(raw: string) {
    const { questionId, question } = JSON.parse(raw) as { questionId: string; question: string };
    say(`question ${questionId}: "${question}" → answering "${opts.answer}"`);
    try {
      await api.workers.answer({ questionId, workerId: id, answer: opts.answer, token });
      say(c.green(`answer accepted for ${questionId}`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      say(/409|closed|already/i.test(msg) ? c.yellow(`${questionId} closed before we answered`) : c.red(`answer failed: ${msg}`));
    }
  }

  (async () => {
    let attempt = 0;
    while (!stopped) {
      try {
        const t = await session();
        const res = await fetch(api.streams.dispatch(id, t, opts.categories), { dispatcher: agent, signal: ctrl.signal } as RequestInit);
        if (!res.ok || !res.body) throw new Error(`dispatch connect failed: HTTP ${res.status}`);
        for await (const frame of readSse(res.body)) {
          if (frame.event === 'connected') {
            attempt = 0;
            say(c.green(`online${opts.categories.length ? ` for ${opts.categories.join(', ')}` : ' for every topic'}`));
            markLive();
          } else if (frame.event === 'question') {
            void answer(frame.data);
          }
        }
        say('dispatch channel closed by the server');
      } catch (err) {
        if (stopped) break;
        say(c.yellow(`disconnected: ${err instanceof Error ? err.message : String(err)}`));
        token = null; // may be stale after a server restart
      }
      if (stopped) break;
      const delay = backoffDelay(attempt++, { baseMs: 2000, maxMs: 30_000 });
      say(`reconnecting in ${Math.round(delay / 1000)}s…`);
      await sleep(delay);
    }
  })();

  return {
    id,
    live,
    stop() {
      stopped = true;
      ctrl.abort();
      agent.close().catch(() => undefined);
      say('stopped');
    },
  };
}

export async function verifier(p: Parsed) {
  const kp = env.workerSecret ? Keypair.fromSecret(env.workerSecret) : null;
  const categories = (flagString(p.flags, 'categories') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const stake = flagString(p.flags, 'stake');
  const sweep = flagString(p.flags, 'auto-withdraw');

  if ((stake || sweep) && !kp) throw new Error('--stake / --auto-withdraw need WORKER_SECRET (on-chain calls need a signable address)');

  if (stake && kp) {
    const amount = toStroops(stake);
    console.log(`staking ${fromStroopsCompact(amount)} USDC as a bond…`);
    const xdr = await signStake(kp, amount);
    const { hash } = await api.sponsor.stake({ xdr, workerAddress: kp.publicKey(), amountStroops: amount.toString() });
    console.log(c.green(`✓ staked: ${explorer(hash)}`));
  }

  const v = startVerifier({ keypair: kp, id: flagString(p.flags, 'id'), answer: flagString(p.flags, 'answer') ?? '42', categories });

  if (sweep && kp) {
    const every = parseDuration(sweep, 30_000);
    (async () => {
      for (;;) {
        await sleep(every);
        try {
          const { owedStroops, owed } = await api.workers.owed(kp.publicKey());
          if (BigInt(owedStroops) <= 0n) continue;
          console.log(`${owed} USDC accrued — sweeping…`);
          const xdr = await signWithdraw(kp, owedStroops);
          const { hash } = await api.sponsor.withdraw({ xdr, workerAddress: kp.publicKey(), amountStroops: owedStroops });
          console.log(c.green(`✓ withdrew ${owed} USDC: ${explorer(hash)}`));
        } catch (err) {
          console.log(c.yellow(`auto-withdraw check failed: ${err instanceof Error ? err.message : String(err)}`));
        }
      }
    })();
  }

  const stop = () => {
    v.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await new Promise(() => undefined); // run until interrupted
}
