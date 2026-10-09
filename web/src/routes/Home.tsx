/**
 * Overview / landing. Every live number here comes from the real backend —
 * the try-it box calls the zero-payment sandbox, the ticker reads /stats,
 * the surge chart streams /pricing/surge/stream. Anything unreachable hides
 * itself rather than showing placeholder or simulated figures.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { suggestTier, waitForSettlement, type Job, type TierInfo } from '@plumbline/core';
import { Badge, Button, CopyButton } from '../components/ui.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { brand, config } from '../lib/config.ts';
import { useDocumentTitle, usePolling } from '../lib/hooks.ts';
import { useI18n } from '../lib/i18n/index.tsx';

const BASE_TIERS: TierInfo[] = [
  { id: 'instant', label: 'Instant', price: 0.05, quorumSize: 1, timeoutSeconds: 30 },
  { id: 'standard', label: 'Standard', price: 0.25, quorumSize: 2, timeoutSeconds: 20 },
  { id: 'express', label: 'Express', price: 0.4, quorumSize: 2, timeoutSeconds: 12 },
  { id: 'priority', label: 'Priority', price: 0.6, quorumSize: 3, timeoutSeconds: 8 },
];
const CONFIDENCE: Record<string, string> = {
  instant: 'One verifier — fastest, least redundant',
  standard: 'Two verifiers must agree',
  express: 'Two must agree, on a tighter clock',
  priority: 'Three-way consensus — highest confidence',
};

function TryIt({ tiers }: { tiers: TierInfo[] }) {
  const [q, setQ] = useState('');
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'wait'; n: number } | { kind: 'done'; job: Job } | { kind: 'err'; msg: string }>({ kind: 'idle' });
  const tier = manual || suggestTier(q);
  const meta = tiers.find((x) => x.id === tier);

  return (
    <form
      className="try-card"
      aria-label="Try a question right now"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!q.trim()) return;
        setBusy(true);
        setState({ kind: 'wait', n: 0 });
        try {
          const { jobId } = await api.oracle.sandbox(q.trim(), tier);
          const job = await waitForSettlement(api, jobId, { intervalMs: 400, timeoutMs: 30_000, onTick: (j) => setState({ kind: 'wait', n: j.totalAnswers ?? 0 }) });
          setState({ kind: 'done', job });
        } catch (err) {
          setState({ kind: 'err', msg: errorMessage(err) });
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="eyebrow">Sandbox — no wallet, no payment, no signup</div>
      <label className="sr-only" htmlFor="try-q">
        Your question
      </label>
      <div className="input-row">
        <input id="try-q" className="input" maxLength={200} autoComplete="off" placeholder="Does Soroban allow re-entrant contract calls?" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" variant="signal" busy={busy}>
          Ask
        </Button>
      </div>
      <div className="row between small" style={{ marginTop: 8 }}>
        <span className="faint">
          {manual ? 'Chosen' : 'Auto'}: {meta?.label ?? tier}
          {meta ? ` · ${meta.price} USDC · ${meta.quorumSize ?? '?'} verifiers · ≤${meta.timeoutSeconds ?? '?'}s` : ''}
        </span>
        <select className="input" style={{ width: 'auto', minHeight: 30, paddingBlock: 2 }} value={manual} onChange={(e) => setManual(e.target.value)} aria-label="Tier">
          <option value="">Auto tier</option>
          {tiers.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label ?? x.id}
            </option>
          ))}
        </select>
      </div>
      <div className="answer-box" role="status" aria-live="polite">
        {state.kind === 'idle' && <p className="faint">The answer lands here.</p>}
        {state.kind === 'wait' && (
          <p>
            <Badge tone="info" live>
              verifiers working
            </Badge>{' '}
            <span className="faint small">{state.n} answer(s) in</span>
          </p>
        )}
        {state.kind === 'done' &&
          (state.job.outcome === 'resolved' ? (
            <>
              <Badge tone="good">answered</Badge>
              <div className="answer" style={{ marginTop: 6 }}>
                {state.job.answer}
              </div>
            </>
          ) : (
            <>
              <Badge tone="warn">refunded</Badge>
              <p className="small" style={{ marginTop: 6 }}>
                {state.job.reason ?? 'No consensus — on a paid question you would get every cent back.'}
              </p>
            </>
          ))}
        {state.kind === 'err' && (
          <p className="small">
            <Badge tone="bad">unreachable</Badge> {state.msg}
          </p>
        )}
      </div>
    </form>
  );
}

function Ticker() {
  const { fmtNumber } = useI18n();
  const { data } = usePolling(() => api.stats(), 10_000);
  if (!data) return null;
  return (
    <p className="ticker">
      <span className="badge good live" style={{ padding: '2px 6px' }}>
        live
      </span>
      <strong className="num">{fmtNumber(data.totalResolved)}</strong> paid questions settled · <strong className="num">{fmtNumber(data.onlineWorkers)}</strong> verifiers online
    </p>
  );
}

type Sample = { t: number; m: number } | { t: number; gap: true };
const WINDOW_MS = 10 * 60_000;

function SurgeChart() {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [status, setStatus] = useState<'connecting' | 'live' | 'reconnecting' | 'off'>('connecting');
  const [, force] = useState(0);
  const retry = useRef(1000);

  useEffect(() => {
    if (!('EventSource' in window)) return setStatus('off');
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    const connect = () => {
      es = new EventSource(api.streams.surge());
      es.onopen = () => {
        retry.current = 1000;
        setStatus('live');
      };
      es.onmessage = (evt) => {
        try {
          const d = JSON.parse(evt.data) as { surgeMultiplier: number; at?: number };
          if (!Number.isFinite(d.surgeMultiplier)) return;
          const t = d.at ?? Date.now();
          setSamples((prev) => [...prev.filter((s) => s.t >= Date.now() - WINDOW_MS), { t, m: d.surgeMultiplier }]);
        } catch {
          /* ignore */
        }
      };
      es.onerror = () => {
        es?.close();
        if (!alive) return;
        setStatus('reconnecting');
        // A gap is drawn as a gap — history is never filled in.
        setSamples((prev) => (prev.length && !('gap' in prev[prev.length - 1]) ? [...prev, { t: Date.now(), gap: true }] : prev));
        timer = setTimeout(connect, retry.current);
        retry.current = Math.min(retry.current * 2, 30_000);
      };
    };
    connect();
    const tick = setInterval(() => force((x) => x + 1), 5000);
    return () => {
      alive = false;
      es?.close();
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, []);

  const pts = samples.filter((s): s is { t: number; m: number } => !('gap' in s));
  if (!pts.length) return null;
  const W = 600;
  const H = 120;
  const end = Date.now();
  const start = end - WINDOW_MS;
  const maxM = Math.max(2, ...pts.map((p) => p.m));
  const x = (t: number) => ((t - start) / WINDOW_MS) * W;
  const y = (m: number) => H - 6 - ((m - 1) / (maxM - 1)) * (H - 12);
  let d = '';
  let pen = false;
  samples.forEach((s, i) => {
    if ('gap' in s) return void (pen = false);
    if (!pen) {
      d += `M${x(s.t)},${y(s.m)}`;
      pen = true;
    } else {
      const prev = samples[i - 1] as { m: number };
      d += `L${x(s.t)},${y(prev.m)}L${x(s.t)},${y(s.m)}`;
    }
    if (i === samples.length - 1) d += `L${x(end)},${y(s.m)}`;
  });
  const now = pts[pts.length - 1].m;

  return (
    <div className="panel" style={{ marginTop: 24 }}>
      <div className="row between">
        <span>
          Surge multiplier now: <strong className="num">{now.toFixed(2)}×</strong>
        </span>
        <Badge tone={status === 'live' ? 'good' : 'warn'} live={status === 'live'}>
          {status}
        </Badge>
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Surge multiplier over the last 10 minutes">
        <line className="grid-line" x1="0" x2={W} y1={y(1)} y2={y(1)} strokeDasharray="4 4" />
        <path className="line" d={d} />
      </svg>
      <p className="hint">Streamed from the server's smoothed verifier-supply signal. Prices are locked at quote time, so this never moves a price you've already been given.</p>
    </div>
  );
}

function Pricing({ tiers }: { tiers: TierInfo[] }) {
  const [sel, setSel] = useState(1);
  const [live, setLive] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    api
      .prices()
      .then((d) => {
        const p = (d && 'prices' in d ? d.prices : d) as Record<string, number>;
        if (p && typeof p === 'object') setLive(p);
      })
      .catch(() => undefined);
  }, []);
  const tier = tiers[Math.min(sel, tiers.length - 1)];
  const livePrice = live && typeof live[tier.id] === 'number' ? live[tier.id] : null;
  return (
    <div className="grid cols-2">
      <div className="panel">
        <div className="eyebrow">Compare tiers</div>
        <input type="range" min={0} max={tiers.length - 1} value={sel} onChange={(e) => setSel(Number(e.target.value))} aria-label="Pricing tier" style={{ width: '100%', accentColor: 'var(--signal)' }} />
        <h3 style={{ marginTop: 12 }}>{tier.label ?? tier.id}</h3>
        <p className="num" style={{ fontSize: 30, margin: 0 }}>
          {(livePrice ?? tier.price).toFixed(2)} <span className="small faint">USDC / question</span>
        </p>
        <p className="faint small">{livePrice !== null ? 'Live price including current surge.' : 'Base price — live pricing unavailable right now.'}</p>
        <p className="small">
          Quorum of {tier.quorumSize ?? '?'} · answer window {tier.timeoutSeconds ?? '?'}s
          <br />
          {CONFIDENCE[tier.id] ?? ''}
        </p>
      </div>
      <div className="table-wrap panel flush">
        <table className="table">
          <thead>
            <tr>
              <th>Tier</th>
              <th className="num">From</th>
              <th className="num">Quorum</th>
              <th className="num">Window</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((x, i) => (
              <tr key={x.id} onClick={() => setSel(i)} style={{ cursor: 'pointer', background: i === sel ? 'var(--signal-soft)' : undefined }}>
                <td>{x.label ?? x.id}</td>
                <td className="num">{x.price.toFixed(2)}</td>
                <td className="num">{x.quorumSize ?? '—'}</td>
                <td className="num">{x.timeoutSeconds ? `${x.timeoutSeconds}s` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const FAQ: Array<[string, string]> = [
  ['Why people instead of just asking an AI?', 'A model that answers wrong loses nothing. Plumbline verifiers put up a USDC bond, and an answer that loses the quorum vote costs them part of it. Money on the line, settled in public, is the difference between a guess and a checked answer.'],
  ['What happens if the verifiers disagree?', 'Nobody gets paid and you get a full refund — automatically, on-chain. There is no partial state where your money is stuck.'],
  ['What if the Plumbline server disappears?', 'Your payment sits in a Soroban escrow contract, not in our bank account. After a timeout anyone — you included — can call refund_timeout() on the contract directly and the funds go back to you. No permission needed.'],
  ['Do I need XLM or a crypto wallet?', 'No XLM: every transaction is fee-sponsored. A wallet is optional too — use the built-in browser wallet, or skip wallets entirely with an API key paid by card.'],
  ['How do verifiers get paid?', 'Each matching answer is credited to the verifier on-chain. They withdraw whenever they like, in one transaction, to their own address, another address, or a bank via a Stellar anchor.'],
  ['What is Stellar / Soroban?', 'Stellar is a payments blockchain with fast, very cheap transactions and a native USDC. Soroban is its smart-contract platform; Plumbline\'s escrow runs on it.'],
];

export default function Home() {
  useDocumentTitle('');
  const { data: liveTiers } = usePolling(() => api.tiers(), 0);
  const tiers = useMemo(() => (liveTiers && liveTiers.length ? liveTiers : BASE_TIERS), [liveTiers]);
  const embed = `<div data-plumbline-ask data-api-base="${config.backendUrl}"></div>\n<script type="module" src="${location.origin}/embed/ask-widget.js"></script>`;

  return (
    <>
      <section className="hero">
        <span className="plumb" aria-hidden="true" />
        <div className="wrap hero-grid">
          <div>
            <div className="eyebrow">Human verification oracle · Stellar / Soroban</div>
            <h1>
              Is it true? <em>Put money</em> on the answer.
            </h1>
            <p className="hero-sub">
              {brand.name} sends your question to a quorum of people with a bond at stake. If they agree, they're paid. If they don't, you're refunded — all on-chain, all automatic.
            </p>
            <div className="row">
              <Link className="btn signal" to="/ask">
                Ask a question
              </Link>
              <Link className="btn ghost" to="/verify">
                Earn as a verifier
              </Link>
            </div>
            <ul className="trust">
              <li>
                <strong>$0.05</strong>
                <span>starting price</span>
              </li>
              <li>
                <strong>0 XLM</strong>
                <span>needed to start</span>
              </li>
              <li>
                <strong>100%</strong>
                <span>refund if no consensus</span>
              </li>
            </ul>
            <Ticker />
          </div>
          <TryIt tiers={tiers} />
        </div>
      </section>

      <section className="section" id="how">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">How it works</div>
            <h2>Four steps, one contract, no stuck money.</h2>
          </div>
          <ol className="steps">
            <li>
              <h3>Ask</h3>
              <p className="muted">Send the claim you need checked: an audit finding, how a contract behaves, something an AI told you.</p>
            </li>
            <li>
              <h3>Lock the price</h3>
              <p className="muted">You get a quote locked to your question. Pay it in USDC into escrow (fees sponsored) or from API-key credit.</p>
            </li>
            <li>
              <h3>Verifiers race</h3>
              <p className="muted">Online verifiers in that topic get it in real time and answer independently before the clock runs out.</p>
            </li>
            <li>
              <h3>Settle</h3>
              <p className="muted">Matching answers form the consensus and are paid. No consensus means a full refund. Either way it's a public transaction.</p>
            </li>
          </ol>
        </div>
      </section>

      <section className="section" id="compare">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">Why it's different</div>
            <h2>Accountability you can check yourself.</h2>
          </div>
          <div className="table-wrap panel flush">
            <table className="table compare">
              <caption className="sr-only">Plumbline compared with an AI chatbot and unpaid crowdsourcing</caption>
              <thead>
                <tr>
                  <th />
                  <th className="ours">{brand.name}</th>
                  <th>AI chatbot</th>
                  <th>Unpaid crowd</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Who answers', 'A quorum of people, reconciled into one answer', 'One model, one pass', 'Whoever shows up'],
                  ['Cost of being wrong', 'Verifier loses part of their bond', 'Nothing', 'Nothing'],
                  ['Where your money is', 'Soroban escrow, verifiable by anyone', 'Not applicable', 'Usually off-chain'],
                  ['No agreement?', 'Full on-chain refund', "You get an answer anyway", 'Undefined'],
                  ['Best for', 'Facts that are expensive to get wrong', 'Drafts, brainstorming', 'Opinions'],
                ].map(([k, a, b, c]) => (
                  <tr key={k}>
                    <th scope="row">{k}</th>
                    <td className="ours">{a}</td>
                    <td>{b}</td>
                    <td>{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="section" id="pricing">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">Pricing</div>
            <h2>Pay per question. Faster or surer costs more.</h2>
          </div>
          <Pricing tiers={tiers} />
          <SurgeChart />
        </div>
      </section>

      <section className="band">
        <div className="wrap row between">
          <div style={{ maxWidth: 640 }}>
            <h2 style={{ color: 'inherit' }}>Know things? Get paid in USDC for being right.</h2>
            <p style={{ opacity: 0.75 }}>Pick your topics, go online, answer. Matching answers build a public track record and are credited to you on-chain.</p>
          </div>
          <Link className="btn" to="/verify">
            Start verifying
          </Link>
        </div>
      </section>

      <section className="section" id="developers">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">Developers</div>
            <h2>One endpoint, a CLI, and a drop-in widget.</h2>
          </div>
          <div className="grid cols-2">
            <div className="panel">
              <h3>Embed the ask box anywhere</h3>
              <pre className="code-block">{embed}</pre>
              <CopyButton text={embed} />
            </div>
            <div className="panel">
              <h3>Or from a terminal</h3>
              <pre className="code-block">{`npm run plumb -- sandbox "Is 7919 prime?"\nnpm run plumb -- ask "Capital of Australia?" --tier standard\nnpm run plumb -- verifier --answer 42`}</pre>
              <p className="faint small">
                Full API reference, HTTP flow and contract methods are in the <a href={brand.docsUrl}>docs</a>. Building an app instead? <Link to="/account">Get an API key</Link>.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="faq">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">FAQ</div>
            <h2>Questions about questions.</h2>
          </div>
          <div>
            {FAQ.map(([q, a]) => (
              <details key={q} className="faq">
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
