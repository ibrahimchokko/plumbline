/**
 * plumb scenario <name>   — scripted storylines in ONE process.
 *   quorum          bring N verifiers online (--workers 3), ask one question, show the quorum result
 *   disagreement    two verifiers answer differently → watch the refund path
 *   timeout-refund  pay, never tell the server, force refund_timeout() as a third party
 */
import { flagNumber, type Parsed } from '../args.ts';
import { keypair } from '../chain.ts';
import { c, env, info, ok } from '../env.ts';
import { payAndAsk } from './ask.ts';
import { proveTimeoutRefund } from './proof.ts';
import { startVerifier } from './verifier.ts';

const SCENARIOS: Record<string, { about: string; run: (p: Parsed) => Promise<void> }> = {
  quorum: {
    about: 'N verifiers agree → the question resolves and they are credited',
    async run(p) {
      const n = flagNumber(p.flags, 'workers', 3);
      const stamp = Date.now();
      const vs = Array.from({ length: n }, (_, i) => startVerifier({ id: `scenario-${stamp}-${i + 1}`, answer: 'Paris', categories: [], quiet: false }));
      try {
        await Promise.all(vs.map((v) => v.live));
        ok(`${n} verifiers online`);
        const { job } = await payAndAsk({ question: 'What is the capital of France?', tier: 'standard', sponsored: false });
        if (job.outcome === 'resolved') ok(`resolved by ${job.matchingWorkers?.length ?? '?'}/${n} verifiers`);
      } finally {
        vs.forEach((v) => v.stop());
      }
    },
  },
  disagreement: {
    about: 'verifiers give different answers → no consensus → full refund',
    async run() {
      const stamp = Date.now();
      const vs = [startVerifier({ id: `split-${stamp}-a`, answer: 'Paris', categories: [] }), startVerifier({ id: `split-${stamp}-b`, answer: 'Lyon', categories: [] })];
      try {
        await Promise.all(vs.map((v) => v.live));
        await payAndAsk({ question: 'What is the capital of France?', tier: 'standard', sponsored: false });
      } finally {
        vs.forEach((v) => v.stop());
      }
    },
  },
  'timeout-refund': {
    about: 'pay for a question the server never hears about, then force refund_timeout()',
    async run() {
      const payer = keypair(env.payerSecret, 'PAYER_SECRET', 'the scenario pays for a real question');
      await proveTimeoutRefund(payer, { sponsored: false });
    },
  },
};

export async function scenario(p: Parsed) {
  const name = p.positional[0];
  if (!name || !SCENARIOS[name]) {
    if (name) console.error(c.red(`Unknown scenario "${name}".`));
    console.log('Usage: plumb scenario <name>\n\nScenarios:');
    for (const [k, v] of Object.entries(SCENARIOS)) console.log(`  ${c.bold(k.padEnd(16))} ${v.about}`);
    if (name) process.exitCode = 1;
    return;
  }
  info(`▶ ${name}: ${SCENARIOS[name].about}`);
  await SCENARIOS[name].run(p);
}
