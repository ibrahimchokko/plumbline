#!/usr/bin/env node
/**
 * Browser smoke test: every route renders without a page error, the landing
 * sandbox answers, and a built-in-wallet verifier can go online, receive a
 * dispatched question and have its answer settle. Expects the mock backend
 * on :4000 and `vite preview` on :4173 (the web build must use
 * VITE_HORIZON_URL=http://localhost:4000 so account checks hit the mock).
 *   node infra/smoke.mjs [--shots ./out]
 */
import { chromium } from 'playwright';

const APP = process.env.APP_URL || 'http://localhost:4173';
const API = process.env.API_URL || 'http://localhost:4000';
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;

async function waitFor(url) {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} never came up`);
}
await waitFor(`${API}/health`);
await waitFor(APP);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
const snap = async (name) => shots && page.screenshot({ path: `${shots}/${name}.png` });

for (const r of ['/', '/verify', '/ask', '/standings', '/health', '/account', '/control', '/live', '/nope']) {
  await page.goto(APP + r, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await snap(r === '/' ? 'home' : r.slice(1));
  console.log(`✓ ${r}`);
}

await page.goto(APP + '/', { waitUntil: 'load' });
await page.fill('#try-q', 'What is the capital of France?');
await page.click('form.try-card button[type=submit]');
await page.waitForSelector('.answer-box .answer', { timeout: 15000 });
console.log(`✓ sandbox answered: ${await page.textContent('.answer-box .answer')}`);

await page.goto(APP + '/verify', { waitUntil: 'load' });
await page.click('text=Use built-in wallet');
await page.click('button:has-text("Go online")', { timeout: 15000 });
await page.waitForSelector('.badge:has-text("Online")', { timeout: 15000 });
const { jobId } = await (await fetch(`${API}/oracle/sandbox`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'Capital of Nigeria?', tier: 'instant' }) })).json();
await page.waitForSelector('.question', { timeout: 10000 });
await page.fill('#answer-input', 'Abuja');
await page.click('button:has-text("Submit answer")');
await page.waitForTimeout(1500);
const job = await (await fetch(`${API}/oracle/${jobId}`)).json();
await snap('verify-answered');
if (job.outcome !== 'resolved' || job.answer !== 'Abuja') throw new Error(`expected the browser verifier's answer to settle, got ${JSON.stringify(job)}`);
console.log('✓ verifier flow: online → question → answer → settled');

await browser.close();
if (errors.length) {
  console.error(`✗ page errors:\n${errors.join('\n')}`);
  process.exit(1);
}
console.log('✓ smoke test passed');
