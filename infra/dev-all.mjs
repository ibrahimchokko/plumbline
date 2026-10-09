#!/usr/bin/env node
// `npm run dev:all` — mock backend + web dev server together, one Ctrl-C stops both.
import { spawn } from 'node:child_process';

const procs = [
  spawn(process.execPath, ['infra/mock-backend.mjs'], { stdio: 'inherit' }),
  // Point the app's Horizon account checks at the mock too, so it works fully offline.
  spawn('npm', ['run', 'dev', '-w', 'web'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, VITE_HORIZON_URL: process.env.VITE_HORIZON_URL || 'http://localhost:4000' },
  }),
];
const stop = () => {
  procs.forEach((p) => p.kill('SIGTERM'));
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => code && stop()));
