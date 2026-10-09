import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  SequenceTracker,
  SlidingWindowLimiter,
  checkCompatibility,
  combineShares,
  createApi,
  csvCell,
  dailyTotals,
  filterQuestions,
  filterTransactions,
  fromStroops,
  fromStroopsCompact,
  parseSseFrame,
  percentBucket,
  pickVariant,
  questionState,
  ratioHistogram,
  readSse,
  scrubValue,
  shortId,
  splitSecret,
  suggestTier,
  toCsv,
  toStroops,
} from '../src/index.ts';

describe('money', () => {
  it('converts exactly in both directions', () => {
    expect(toStroops('1.5')).toBe(15_000_000n);
    expect(toStroops('0.0000001')).toBe(1n);
    expect(toStroops(' 42 ')).toBe(420_000_000n);
    expect(fromStroops(15_000_000n)).toBe('1.5000000');
    expect(fromStroopsCompact('15000000')).toBe('1.5');
    expect(fromStroopsCompact(0n)).toBe('0');
  });
  it('rejects anything ambiguous', () => {
    for (const bad of ['-1', '1e3', '1.12345678', 'abc', '', '1.']) expect(() => toStroops(bad)).toThrow();
  });
});

describe('shamir recovery', () => {
  const secret = 'SBXXSECRETKEYEXAMPLE0000000000000000000000000000000000000';
  it('any k of n shares rebuild the secret', () => {
    const shares = splitSecret(secret, 3, 5);
    expect(shares).toHaveLength(5);
    expect(combineShares([shares[0], shares[2], shares[4]])).toBe(secret);
    expect(combineShares([shares[4], shares[1], shares[3]])).toBe(secret);
  });
  it('rejects too few or duplicated shares', () => {
    const shares = splitSecret(secret, 3, 5);
    expect(() => combineShares([shares[0], shares[1]])).toThrow(/need 3/);
    expect(() => combineShares([shares[0], shares[0], shares[1]])).toThrow(/need 3/);
  });
  it('catches a typo via checksum', () => {
    const [s] = splitSecret(secret, 2, 3);
    const tampered = s.replace(/-([0-9a-f])/, (_m, c) => `-${c === 'a' ? 'b' : 'a'}`);
    expect(() => combineShares([tampered, splitSecret(secret, 2, 3)[1]])).toThrow();
  });
  it('still reads legacy dotted shares', () => {
    // 2-of-2 legacy shares hand-built for the one-byte secret "A" (0x41):
    // f(x) = 0x41 ^ c*x with c = 1  ->  f(1)=0x40, f(2)=0x43
    expect(combineShares(['2.2.1.40', '2.2.2.43'])).toBe('A');
  });
});

describe('csv', () => {
  it('neutralises formulas and quotes properly', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(null)).toBe('');
    expect(toCsv(['a', 'b'], [[1, '+2']])).toBe("a,b\r\n1,'+2\r\n");
  });
});

describe('scrub', () => {
  it('redacts keys, tokens and sensitive fields', () => {
    const out = scrubValue({
      msg: 'failed for GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW with Bearer abc.def',
      secret: 'S123',
      nested: { apiKey: 'k' },
    });
    expect(out.msg).not.toContain('GABCDEF');
    expect(out.msg).not.toContain('abc.def');
    expect(out.secret).toBe('[redacted]');
    expect(out.nested.apiKey).toBe('[redacted]');
  });
});

describe('version compatibility', () => {
  it('follows semver rather than exact string equality', () => {
    expect(checkCompatibility('1.2.0', '1.2.0')).toBe('match');
    expect(checkCompatibility('1.2.0', '1.3.4')).toBe('compatible');
    expect(checkCompatibility('1.2.0', '1.1.9')).toBe('older-minor');
    expect(checkCompatibility('1.2.0', '2.0.0')).toBe('incompatible');
    expect(checkCompatibility('1.2.0', undefined)).toBe('unknown');
  });
});

describe('filters', () => {
  const qs = [
    { questionId: 'q1', question: 'Capital of France?', status: 'settled', outcome: 'resolved', answer: 'Paris', amount: '0.25', createdAt: '2026-01-01T10:00:00Z' },
    { questionId: 'q2', question: 'Is 7 prime?', status: 'awaiting_workers', amount: '0.05', createdAt: '2026-01-01T12:00:00Z' },
    { questionId: 'q3', question: 'Soroban reentrancy?', status: 'settled', outcome: 'refunded', amount: '1', createdAt: '2026-01-03T00:00:00Z' },
  ];
  it('derives state', () => {
    expect(qs.map(questionState)).toEqual(['resolved', 'in-progress', 'refunded']);
  });
  it('searches question, id and answer; filters by state and stars', () => {
    expect(filterQuestions(qs, { query: 'paris' }).map((q) => q.questionId)).toEqual(['q1']);
    expect(filterQuestions(qs, { state: 'refunded' }).map((q) => q.questionId)).toEqual(['q3']);
    expect(filterQuestions(qs, { starredOnly: true, starred: new Set(['q2']) }).map((q) => q.questionId)).toEqual(['q2']);
  });
  it('totals spend per day', () => {
    expect(dailyTotals(qs)).toEqual([
      { day: '2026-01-01', amount: 0.3 },
      { day: '2026-01-03', amount: 1 },
    ]);
  });
  it('filters admin transactions by amount and status', () => {
    const tx = [
      { questionId: 'a', amountStroops: '2500000', status: 'settled' },
      { questionId: 'b', amountStroops: '50000000', status: 'pending' },
    ];
    expect(filterTransactions(tx, { minUsdc: '1' }).map((t) => t.questionId)).toEqual(['b']);
    expect(filterTransactions(tx, { status: 'settled' }).map((t) => t.questionId)).toEqual(['a']);
    expect(filterTransactions(tx, { minUsdc: 'garbage' })).toHaveLength(2);
  });
  it('builds a ratio histogram', () => {
    expect(ratioHistogram([0, 0.05, 0.55, 1])).toEqual([2, 0, 0, 0, 0, 1, 0, 0, 0, 1]);
  });
});

describe('format + hashing', () => {
  it('shortens ids safely', () => {
    expect(shortId(undefined)).toBe('—');
    expect(shortId('GABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBe('GABCDE…UVWXYZ');
  });
  it('suggests tiers', () => {
    expect(suggestTier('urgent: is the bridge paused?')).toBe('express');
    expect(suggestTier('x'.repeat(200))).toBe('priority');
    expect(suggestTier('2+2?')).toBe('standard');
  });
  it('buckets deterministically', () => {
    expect(percentBucket('flag', 'user')).toBe(percentBucket('flag', 'user'));
    expect(pickVariant('exp', ['a', 'b', 'c'], 'G1')).toBe(pickVariant('exp', ['a', 'b', 'c'], 'G1'));
  });
});

describe('sequence tracker', () => {
  it('applies in order, drops duplicates, flags gaps', () => {
    const t = new SequenceTracker();
    t.reset(5);
    expect(t.offer(5)).toBe('duplicate');
    expect(t.offer(6)).toBe('apply');
    expect(t.offer(8)).toBe('gap');
    expect(t.position).toBe(6);
    t.reset(3); // a stale snapshot must not move us backwards
    expect(t.position).toBe(6);
  });
});

describe('rate limiter', () => {
  it('limits per key within a window', () => {
    let now = 0;
    const l = new SlidingWindowLimiter(2, 1000, () => now);
    expect(l.check('u').allowed).toBe(true);
    expect(l.check('u').allowed).toBe(true);
    expect(l.check('u')).toEqual({ allowed: false, retryInMs: 1000 });
    expect(l.check('other').allowed).toBe(true);
    now = 1001;
    expect(l.check('u').allowed).toBe(true);
  });
});

describe('sse parser', () => {
  it('parses fields and skips keep-alives', () => {
    expect(parseSseFrame(': ping')).toBeNull();
    expect(parseSseFrame('event: question\nid: 7\ndata: {"a":1}')).toEqual({ event: 'question', id: '7', data: '{"a":1}' });
  });
  it('reads a chunked stream', async () => {
    const enc = new TextEncoder();
    const chunks = ['event: connected\ndata: ok\n', '\nevent: question\ndata: 1\r\n\r\n'];
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        chunks.forEach((s) => c.enqueue(enc.encode(s)));
        c.close();
      },
    });
    const frames = [];
    for await (const f of readSse(body)) frames.push(f.event);
    expect(frames).toEqual(['connected', 'question']);
  });
});

describe('api client', () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('surfaces server error messages with a typed kind', async () => {
    const api = createApi({ baseUrl: 'http://x/', fetch: async () => json(409, { error: 'already answered' }) });
    await expect(api.workers.answer({ questionId: 'q', workerId: 'w', answer: 'a' })).rejects.toMatchObject({
      kind: 'conflict',
      message: 'already answered',
    });
  });

  it('maps missing optional endpoints to not-deployed', async () => {
    const api = createApi({ baseUrl: 'http://x', fetch: async () => json(404, {}) });
    const err = (await api.workers.setDigest("G", "t", "daily").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe('not-deployed');
  });

  it('attaches admin bearer and reports 401', async () => {
    const seen: Record<string, string>[] = [];
    const onUnauthorized = vi.fn();
    const api = createApi({
      baseUrl: 'http://x',
      adminToken: () => 'tok',
      onUnauthorized,
      fetch: async (_u, init) => {
        seen.push(init?.headers as Record<string, string>);
        return json(401, {});
      },
    });
    await expect(api.admin.fees()).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(seen[0].Authorization).toBe('Bearer tok');
    expect(onUnauthorized).toHaveBeenCalledWith('admin');
  });

  it('expects a 402 for a quote', async () => {
    const api = createApi({ baseUrl: 'http://x', fetch: async () => json(402, { questionId: '9', amount: '0.25', amountStroops: '2500000' }) });
    await expect(api.oracle.quote({ question: 'q' })).resolves.toMatchObject({ questionId: '9' });
  });

  it('retries a GET once after a network failure', async () => {
    let calls = 0;
    const api = createApi({
      baseUrl: 'http://x',
      fetch: async () => {
        calls++;
        if (calls === 1) throw new TypeError('fetch failed');
        return json(200, { totalResolved: 1, totalRefunded: 0, onlineWorkers: 2 });
      },
    });
    await expect(api.stats()).resolves.toMatchObject({ onlineWorkers: 2 });
    expect(calls).toBe(2);
  });

  it('builds stream urls with query params', () => {
    const api = createApi({ baseUrl: 'http://x' });
    expect(api.streams.dispatch('G1', 'tok', ['math', 'coding'])).toBe('http://x/app/events?worker=G1&token=tok&categories=math%2Ccoding');
  });
});
