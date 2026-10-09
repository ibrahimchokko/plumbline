/**
 * plumb sandbox "<question>" [--tier standard] [--json]
 * Zero setup: no key, no wallet, no chain. The fastest way to see a real response.
 */
import { waitForSettlement } from '@plumbline/core';
import { flagBool, flagString, type Parsed } from '../args.ts';
import { api, endProgress, ok, progress } from '../env.ts';
import { printJob } from './ask.ts';

export async function sandbox(p: Parsed) {
  const question = p.positional.join(' ').trim() || 'What is 6 × 7?';
  const { jobId } = await api.oracle.sandbox(question, flagString(p.flags, 'tier'));
  if (!flagBool(p.flags, 'json')) ok(`asked "${question}" (sandbox job ${jobId})`);
  const job = await waitForSettlement(api, jobId, { intervalMs: 700, timeoutMs: 60_000, onTick: (j) => progress(`  … ${j.status}`) });
  endProgress();
  if (flagBool(p.flags, 'json')) console.log(JSON.stringify(job, null, 2));
  else printJob(job);
}
