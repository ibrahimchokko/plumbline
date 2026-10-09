#!/usr/bin/env node
/**
 * Plumbline mock backend — a dependency-free, in-memory stand-in for the
 * real backend, for local UI work, demos and tests. NOT for production:
 * it does not touch the chain and accepts any "signed" session challenge.
 *
 *   node infra/mock-backend.mjs            # http://localhost:4000
 *   PORT=4100 ADMIN_TOKEN=dev node infra/mock-backend.mjs
 *
 * Implements the public, verifier, asker, sandbox and admin read endpoints
 * with realistic shapes, including SSE streams (/app/events, /activity,
 * /pricing/surge/stream, /payers/:a/questions/stream). Sandbox questions
 * are dispatched to any verifier connected over /app/events (e.g. the
 * `plumb verifier` CLI or the web Verify page); with nobody online they
 * auto-answer after a moment so the landing try-it box always works.
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || 4000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'dev-admin-token';
const API_VERSION = '1.0.0';

const TIERS = [
  { id: 'instant', label: 'Instant', price: 0.05, quorumSize: 1, timeoutSeconds: 30 },
  { id: 'standard', label: 'Standard', price: 0.25, quorumSize: 2, timeoutSeconds: 20 },
  { id: 'express', label: 'Express', price: 0.4, quorumSize: 2, timeoutSeconds: 12 },
  { id: 'priority', label: 'Priority', price: 0.6, quorumSize: 3, timeoutSeconds: 8 },
];
const CANNED = [
  [/capital of france/i, 'Paris'],
  [/capital of nigeria/i, 'Abuja'],
  [/6\s*[x×*]\s*7/i, '42'],
  [/prime/i, 'Yes'],
  [/reentr|re-entr/i, 'No — Soroban rejects re-entrant contract calls by default.'],
  [/stellar.*launch|launch.*stellar/i, '2014'],
];

const state = {
  jobs: new Map(), // jobId -> job
  verifiers: new Map(), // workerId -> { res, categories }
  reputation: new Map(), // workerId -> { matched, total }
  stake: new Map(),
  owed: new Map(),
  sessions: new Map(), // token -> { address, expiresAt }
  payers: new Map(), // address -> { questions: [], seq }
  payerStreams: new Map(), // address -> Set<res>
  activity: new Set(),
  surge: new Set(),
  surgeNow: 1,
  resolved: 0,
  refunded: 0,
  tx: [],
};

// Seed a few established verifiers so Standings/Control aren't empty.
for (const [id, m, t, st] of [
  ['GDEMOVERIFIERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 46, 50, '25'],
  ['GDEMOVERIFIERBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', 31, 40, '10'],
  ['GDEMOVERIFIERCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC', 18, 36, '5'],
]) {
  state.reputation.set(id, { matched: m, total: t });
  state.stake.set(id, st);
  state.owed.set(id, '1.25');
}

/* ---------------- helpers ---------------- */
const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS' });
  res.end(body === undefined ? '' : JSON.stringify(body));
};
const sse = (res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
  res.write(': connected\n\n');
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  res.on('close', () => clearInterval(ping));
};
const emit = (res, event, data, id) => res.write(`${id !== undefined ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const body = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
const stroops = (usdc) => String(Math.round(Number(usdc) * 1e7));
const isAdmin = (req) => req.headers.authorization === `Bearer ${ADMIN_TOKEN}`;
const sessionFor = (token) => {
  const s = state.sessions.get(token);
  return s && s.expiresAt > Date.now() ? s.address : null;
};
const ratio = (r) => (r && r.total ? r.matched / r.total : null);

function payerPush(address, q) {
  const p = state.payers.get(address);
  if (!p) return;
  p.seq += 1;
  const idx = p.questions.findIndex((x) => x.questionId === q.questionId);
  if (idx >= 0) p.questions[idx] = { ...p.questions[idx], ...q };
  else p.questions.unshift(q);
  for (const res of state.payerStreams.get(address) ?? []) emit(res, 'status', q, p.seq);
}

function settle(job, outcome, answer, reason, matching = []) {
  Object.assign(job, { status: 'settled', outcome, answer, reason, confidence: outcome === 'resolved' ? 0.9 : undefined, matchingWorkers: matching, reconciliationMethod: 'exact-match', payoutTx: outcome === 'resolved' ? randomUUID().replace(/-/g, '') : undefined, refundTx: outcome === 'refunded' ? randomUUID().replace(/-/g, '') : undefined });
  if (outcome === 'resolved') state.resolved++;
  else state.refunded++;
  for (const w of job.answers.keys()) {
    const r = state.reputation.get(w) ?? { matched: 0, total: 0 };
    r.total += 1;
    if (matching.includes(w)) {
      r.matched += 1;
      state.owed.set(w, (Number(state.owed.get(w) ?? 0) + job.price / Math.max(1, matching.length)).toFixed(7));
    }
    state.reputation.set(w, r);
  }
  for (const res of state.activity) emit(res, 'settlement', { category: job.category ?? 'general', tier: job.tier, outcome, amount: String(job.price) });
  const tx = state.tx.find((t) => t.questionId === job.questionId);
  if (tx) Object.assign(tx, { status: 'settled', outcome });
  if (job.payer) payerPush(job.payer, { questionId: job.questionId, status: 'settled', outcome, answer, confidence: job.confidence });
}

function dispatch(job) {
  const tier = TIERS.find((t) => t.id === job.tier) ?? TIERS[1];
  const targets = [...state.verifiers.entries()].filter(([, v]) => !v.categories.length || !job.category || v.categories.includes(job.category));
  job.status = 'awaiting_workers';
  if (job.payer) payerPush(job.payer, { questionId: job.questionId, status: 'awaiting_workers' });
  if (!targets.length) {
    // Nobody online: simulate a quick, plausible answer so demos always work.
    setTimeout(() => {
      const hit = CANNED.find(([re]) => re.test(job.question));
      if (hit) settle(job, 'resolved', hit[1], undefined, []);
      else settle(job, 'refunded', undefined, 'no verifiers online (mock)');
    }, 1200);
    return;
  }
  for (const [, v] of targets) emit(v.res, 'question', { questionId: job.questionId, question: job.question, expiresInMs: tier.timeoutSeconds * 1000, category: job.category, tier: job.tier });
  job.timer = setTimeout(() => reconcile(job, true), tier.timeoutSeconds * 1000);
}

function reconcile(job, final) {
  if (job.status === 'settled') return;
  const tier = TIERS.find((t) => t.id === job.tier) ?? TIERS[1];
  const tally = new Map();
  for (const [w, a] of job.answers) {
    const k = a.trim().toLowerCase();
    tally.set(k, [...(tally.get(k) ?? []), w]);
  }
  const [best, who] = [...tally.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
  if (who && who.length >= tier.quorumSize) {
    clearTimeout(job.timer);
    settle(job, 'resolved', job.answers.get(who[0]), undefined, who);
  } else if (final) settle(job, 'refunded', undefined, !job.answers.size ? 'no answers before the deadline' : job.answers.size < tier.quorumSize ? `only ${job.answers.size} of ${tier.quorumSize} required verifiers answered` : 'verifiers did not agree');
  else if (job.answers.size) job.status = 'reconciling';
}

function newJob({ question, tier = 'standard', category, payer, questionId }) {
  const t = TIERS.find((x) => x.id === tier) ?? TIERS[1];
  const job = { jobId: randomUUID(), questionId: questionId ?? String(Date.now()), question, tier: t.id, category, price: +(t.price * state.surgeNow).toFixed(2), status: 'pending', answers: new Map(), payer };
  state.jobs.set(job.jobId, job);
  return job;
}
const publicJob = (j) => ({ jobId: j.jobId, status: j.status, outcome: j.outcome, answer: j.answer, confidence: j.confidence, reason: j.reason, matchingWorkers: j.matchingWorkers, reconciliationMethod: j.reconciliationMethod, payoutTx: j.payoutTx, refundTx: j.refundTx, totalAnswers: j.answers.size, autoRefundAfterLedgers: 100 });

// Surge wanders gently so the landing chart has something to draw.
setInterval(() => {
  const online = state.verifiers.size;
  state.surgeNow = +Math.max(1, Math.min(3, (online ? 1.4 - online * 0.1 : 1.6) + (Math.random() - 0.5) * 0.3)).toFixed(2);
  for (const res of state.surge) res.write(`data: ${JSON.stringify({ surgeMultiplier: state.surgeNow, at: Date.now() })}\n\n`);
}, 4000);

/* ---------------- routes ---------------- */
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const m = (re) => re.exec(path);
  if (req.method === 'OPTIONS') return send(res, 204);
  let g;

  // public
  if (path === '/health') return send(res, 200, { ok: true, apiVersion: API_VERSION, mock: true });
  if (path === '/stats') return send(res, 200, { totalResolved: state.resolved, totalRefunded: state.refunded, onlineWorkers: state.verifiers.size });
  if (path === '/oracle/tiers') return send(res, 200, { tiers: TIERS });
  if (path === '/price') return send(res, 200, { prices: Object.fromEntries(TIERS.map((t) => [t.id, +(t.price * state.surgeNow).toFixed(2)])) });
  if (path === '/categories/demand') {
    const demand = { math: 0, coding: 0, history: 0, general: 0 };
    for (const v of state.verifiers.values()) for (const c of v.categories.length ? v.categories : Object.keys(demand)) demand[c] = (demand[c] ?? 0) + 1;
    return send(res, 200, { demand });
  }
  if (path === '/leaderboard') {
    const leaderboard = [...state.reputation.entries()]
      .filter(([, r]) => r.total >= 10)
      .map(([workerId, r]) => ({ workerId, matched: r.matched, totalAnswers: r.total, matchRatio: ratio(r), stake: state.stake.get(workerId) ?? '0' }))
      .sort((a, b) => b.matchRatio - a.matchRatio);
    return send(res, 200, { leaderboard });
  }
  if (path === '/activity') {
    sse(res);
    state.activity.add(res);
    return res.on('close', () => state.activity.delete(res));
  }
  if (path === '/pricing/surge/stream') {
    sse(res);
    state.surge.add(res);
    res.write(`data: ${JSON.stringify({ surgeMultiplier: state.surgeNow, at: Date.now() })}\n\n`);
    return res.on('close', () => state.surge.delete(res));
  }

  // oracle
  if (path === '/oracle/sandbox' && req.method === 'POST') {
    const b = await body(req);
    if (!b.question) return send(res, 400, { error: 'question is required' });
    const job = newJob({ question: String(b.question).slice(0, 1000), tier: b.tier });
    dispatch(job);
    return send(res, 202, { jobId: job.jobId, statusUrl: `/oracle/${job.jobId}` });
  }
  if ((g = m(/^\/oracle\/([\w-]+)$/)) && req.method === 'GET') {
    const job = state.jobs.get(g[1]);
    return job ? send(res, 200, publicJob(job)) : send(res, 404, { error: 'unknown job' });
  }
  if (path === '/oracle' && req.method === 'POST') {
    const b = await body(req);
    const qid = req.headers['x-question-id'];
    if (!req.headers['x-payment-tx'] && !req.headers['x-api-key']) {
      const t = TIERS.find((x) => x.id === b.tier) ?? TIERS[1];
      const amount = (t.price * state.surgeNow).toFixed(2);
      const questionId = String(Date.now());
      state.pendingQuotes ??= new Map();
      state.pendingQuotes.set(questionId, { ...b, amount });
      return send(res, 402, { questionId, amount, amountStroops: stroops(amount), surgeMultiplier: state.surgeNow, tier: t.id });
    }
    const quote = state.pendingQuotes?.get(String(qid)) ?? b;
    const job = newJob({ question: quote.question ?? b.question ?? '(question)', tier: quote.tier, category: quote.category, questionId: qid ? String(qid) : undefined, payer: quote.payer });
    state.tx.unshift({ questionId: job.questionId, payer: quote.payer, amountStroops: stroops(job.price), status: 'pending', createdAt: Date.now() });
    dispatch(job);
    return send(res, 202, { jobId: job.jobId, statusUrl: `/oracle/${job.jobId}` });
  }
  if (path === '/attachments' && req.method === 'POST') {
    req.resume();
    return send(res, 200, { attachmentId: randomUUID(), url: `/attachments/${randomUUID()}` });
  }

  // sessions (mock: any signed XDR is accepted)
  if ((g = m(/^\/workers\/([^/]+)\/session\/challenge$/)) && req.method === 'POST') {
    // A harmless, never-submitted transaction for the wallet to sign.
    try {
      const { Account, Operation, TransactionBuilder, Networks } = await import('@stellar/stellar-sdk');
      const tx = new TransactionBuilder(new Account(g[1], '0'), { fee: '100', networkPassphrase: Networks.TESTNET })
        .addOperation(Operation.manageData({ name: 'plumbline auth', value: randomUUID().slice(0, 32) }))
        .setTimeout(300)
        .build();
      return send(res, 200, { xdr: tx.toXDR() });
    } catch (err) {
      return send(res, 400, { error: `cannot build a challenge for ${g[1]}: ${err.message}` });
    }
  }
  if ((g = m(/^\/workers\/([^/]+)\/session$/)) && req.method === 'POST') {
    await body(req); // mock: the signature is not verified
    const token = randomUUID();
    const expiresAt = Date.now() + 30 * 60_000;
    state.sessions.set(token, { address: g[1], expiresAt });
    return send(res, 200, { token, expiresAt });
  }
  // Horizon-style account lookup, so the web app can run fully offline
  // (point VITE_HORIZON_URL at this server).
  if ((g = m(/^\/accounts\/(G[A-Z2-7]{55})$/))) {
    return send(res, 200, { id: g[1], balances: [{ asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', balance: '100.0000000' }, { asset_type: 'native', balance: '0.0000000' }] });
  }
  // asker history + live stream
  if ((g = m(/^\/payers\/([^/]+)\/questions$/))) {
    if (sessionFor(url.searchParams.get('token')) !== g[1]) return send(res, 401, { error: 'session required' });
    const p = state.payers.get(g[1]) ?? { questions: [], seq: 0 };
    state.payers.set(g[1], p);
    const settled = p.questions.filter((q) => q.status === 'settled');
    return send(res, 200, { questions: p.questions, totalSpend: p.questions.reduce((s, q) => s + Number(q.amount ?? 0), 0).toFixed(2), totalTracked: p.questions.length, successRate: settled.length ? settled.filter((q) => q.outcome === 'resolved').length / settled.length : null, cursor: p.seq });
  }
  if ((g = m(/^\/payers\/([^/]+)\/questions\/stream$/))) {
    if (sessionFor(url.searchParams.get('token')) !== g[1]) return send(res, 401, { error: 'session required' });
    sse(res);
    const set = state.payerStreams.get(g[1]) ?? new Set();
    set.add(res);
    state.payerStreams.set(g[1], set);
    return res.on('close', () => set.delete(res));
  }
  if ((g = m(/^\/workers\/([^/]+)\/(owed|stake|reputation)$/))) {
    const [, id, what] = g;
    if (what === 'owed') {
      const owed = state.owed.get(id) ?? '0';
      return send(res, 200, { owed, owedStroops: stroops(owed) });
    }
    if (what === 'stake') return send(res, 200, { stake: state.stake.get(id) ?? '0' });
    const r = state.reputation.get(id) ?? { matched: 0, total: 0 };
    return send(res, 200, { matched: r.matched, total: r.total, totalAnswers: r.total, matchRatio: ratio(r) });
  }

  // verifier dispatch
  if (path === '/app/events') {
    const worker = url.searchParams.get('worker');
    if (!worker) return send(res, 400, { error: 'worker is required' });
    if (/^G[A-Z2-7]{55}$/.test(worker) && !sessionFor(url.searchParams.get('token'))) return send(res, 401, { error: 'a session is required for a real address' });
    const categories = (url.searchParams.get('categories') ?? '').split(',').filter(Boolean);
    sse(res);
    state.verifiers.set(worker, { res, categories });
    emit(res, 'connected', { worker });
    return res.on('close', () => state.verifiers.get(worker)?.res === res && state.verifiers.delete(worker));
  }
  if (path === '/app/answer' && req.method === 'POST') {
    const b = await body(req);
    const job = [...state.jobs.values()].find((j) => j.questionId === b.questionId);
    if (!job || job.status === 'settled' || job.answers.has(b.workerId)) return send(res, 409, { error: 'question closed, expired or already answered' });
    job.answers.set(b.workerId, String(b.answer).slice(0, 400));
    reconcile(job, false);
    return send(res, 200, { ok: true });
  }

  // admin
  if (path.startsWith('/admin/')) {
    if (!isAdmin(req)) return send(res, 401, { error: 'bad admin token' });
    if (path === '/admin/transactions') {
      const limit = Number(url.searchParams.get('limit') ?? 100);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return send(res, 200, { transactions: state.tx.slice(offset, offset + limit) });
    }
    if (path === '/admin/workers')
      return send(res, 200, { workers: [...state.reputation.entries()].map(([workerId, r]) => ({ workerId, matchRatio: ratio(r), totalAnswers: r.total, established: r.total >= 10, stake: state.stake.get(workerId) ?? '0', owed: state.owed.get(workerId) ?? '0' })) });
    if (path === '/admin/payers') return send(res, 200, { payers: [] });
    if (path === '/admin/fees') return send(res, 200, { resolvedCount: state.resolved, totalFeeRevenue: (state.resolved * 0.02).toFixed(2) });
    if (path === '/admin/treasury') return send(res, 200, { configured: true, platformAddress: 'GDEMOPLATFORMXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', usdcBalance: '512.4000000', xlmBalance: '38.1000000', fiatPool: null });
    if (path === '/admin/kyc') return send(res, 200, { customers: [] });
    if (path === '/admin/payouts') return send(res, 200, { payouts: [] });
    if (path === '/admin/worker-pools') return send(res, 200, { pools: [{ id: 'audit', name: 'Audit specialists', whitelist: ['GDEMOVERIFIERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'] }] });
  }

  if (path === '/anchor/config') return send(res, 503, { error: 'no anchor configured (mock)' });
  return send(res, 404, { error: `no mock route for ${req.method} ${path}` });
});

server.listen(PORT, () => {
  console.log(`Plumbline mock backend on http://localhost:${PORT}  (admin token: ${ADMIN_TOKEN})`);
  console.log('Not a real backend: no chain, no payments. For UI work, demos and tests only.');
});
