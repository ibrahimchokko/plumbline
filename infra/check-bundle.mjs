#!/usr/bin/env node
// Fails CI if the code a first-time visitor downloads (the entry script plus
// everything index.html preloads) grows past the budget. Wallet adapters and
// the Stellar SDK must stay lazy.
import { readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const BUDGET_GZIP_KB = 120;
const dist = 'web/dist';
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const files = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
let total = 0;
for (const f of files) {
  const gz = gzipSync(readFileSync(join(dist, f))).length;
  total += gz;
  console.log(`${(gz / 1024).toFixed(1).padStart(7)} KB gz  ${f}  (${(statSync(join(dist, f)).size / 1024).toFixed(0)} KB raw)`);
}
console.log(`${(total / 1024).toFixed(1).padStart(7)} KB gz  TOTAL initial JS (budget ${BUDGET_GZIP_KB} KB)`);
if (/stellar-sdk|wallets/.test(files.join(' '))) {
  console.error('✗ the Stellar SDK or wallet adapters are being loaded on first paint — keep them behind dynamic import()');
  process.exit(1);
}
if (total / 1024 > BUDGET_GZIP_KB) {
  console.error('✗ initial JS is over budget');
  process.exit(1);
}
console.log('✓ within budget');
