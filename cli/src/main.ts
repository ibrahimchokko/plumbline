/**
 * plumb — the Plumbline command line.
 *
 * Replaces the original seven separate demo scripts (ask.js, sandbox-ask.js,
 * worker-sim.js, sponsored-demo.js, sandbox-demo.js, run-scenario.js, the
 * bot) with one tool, one help screen and one set of env variables.
 */
import { isApiError } from '@plumbline/core';
import { parseArgs } from './args.ts';
import { ask } from './commands/ask.ts';
import { bot, refund, status, warnIfMainnet } from './commands/misc.ts';
import { sponsoredProof } from './commands/proof.ts';
import { sandbox } from './commands/sandbox.ts';
import { scenario } from './commands/scenario.ts';
import { verifier } from './commands/verifier.ts';
import { c, env } from './env.ts';

const HELP = `${c.bold('plumb')} — Plumbline from your terminal          backend: ${env.backendUrl} (${env.network})

${c.bold('Try it (no setup)')}
  plumb sandbox "<question>" [--tier standard] [--json]   free sandbox question, no wallet, no chain
  plumb status                                            server health, version, verifiers online

${c.bold('Ask (needs PAYER_SECRET + ORACLE_CONTRACT_ID)')}
  plumb ask "<question>" [--tier T] [--category C] [--image ./file.png] [--sponsored]
                                                          402 quote → escrow deposit → poll to settlement
  plumb refund <questionId>                               permissionless refund_timeout() after the window

${c.bold('Verify')}
  plumb verifier [--answer 42] [--categories math,coding] [--id NAME]
                 [--stake 1.5] [--auto-withdraw 30s]     headless verifier that reconnects by itself

${c.bold('Proofs & demos')}
  plumb sponsored-proof [--timeout-refund]                prove the zero-XLM journey on testnet
  plumb scenario <quorum|disagreement|timeout-refund>     scripted storylines in one process
  plumb bot "<question>" [--user U123]                    rate-limited sandbox replies for chat bots

Configuration lives in cli/.env — see cli/.env.example.`;

const COMMANDS: Record<string, (p: ReturnType<typeof parseArgs>) => Promise<void>> = {
  ask,
  sandbox,
  status: () => status(),
  verifier,
  worker: verifier, // old name
  refund,
  bot,
  'sponsored-proof': sponsoredProof,
  scenario,
};

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.command || parsed.command === 'help' || parsed.flags.help || parsed.flags.h) {
    console.log(HELP);
    return;
  }
  const run = COMMANDS[parsed.command];
  if (!run) {
    console.error(c.red(`Unknown command "${parsed.command}".\n`));
    console.log(HELP);
    process.exitCode = 1;
    return;
  }
  warnIfMainnet();
  await run(parsed);
}

main().catch((err) => {
  const detail = isApiError(err) && err.status ? ` (HTTP ${err.status})` : '';
  console.error(`\n${c.red('✗')} ${err instanceof Error ? err.message : String(err)}${detail}`);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
