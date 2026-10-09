/**
 * Live wire — a running feed of dispatch → answer → settlement for demos.
 * It diffs consecutive polls of /admin/transactions and /admin/workers, so
 * per-verifier answers are inferred from answer-count increments rather
 * than tied to a specific question. Events are only as fresh as the poll.
 */
import { useEffect, useRef, useState } from 'react';
import { shortId } from '@plumbline/core';
import { AdminGate } from '../components/AdminGate.tsx';
import { Badge, Button, PageHead, Panel } from '../components/ui.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { useDocumentTitle } from '../lib/hooks.ts';
import { useI18n } from '../lib/i18n/index.tsx';

type Ev = { id: number; at: number; kind: 'dispatch' | 'answer' | 'settle' | 'info'; label: string; text: string };
const POLL_MS = 2000;
const MAX = 200;

function Feed({ signOut }: { signOut: () => void }) {
  const { fmtTime } = useI18n();
  const [events, setEvents] = useState<Ev[]>([]);
  const [status, setStatus] = useState('Connecting…');
  const [paused, setPaused] = useState(false);
  const seenTx = useRef(new Map<string, string | undefined>());
  const seenW = useRef(new Map<string, number>());
  const primed = useRef(false);
  const seq = useRef(0);

  useEffect(() => {
    if (paused) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const push = (kind: Ev['kind'], label: string, text: string) =>
      setEvents((prev) => [{ id: ++seq.current, at: Date.now(), kind, label, text }, ...prev].slice(0, MAX));

    const poll = async () => {
      try {
        const [txs, workers] = await Promise.all([api.admin.transactions(100, 0), api.admin.workers()]);
        for (const t of [...txs].reverse()) {
          const prev = seenTx.current.get(t.questionId);
          const had = seenTx.current.has(t.questionId);
          seenTx.current.set(t.questionId, t.status);
          if (!primed.current) continue;
          if (!had) push('dispatch', 'Dispatched', `question ${shortId(t.questionId)} from ${shortId(t.payer)}`);
          if (t.status === 'settled' && prev !== 'settled') push('settle', 'Settled', `question ${shortId(t.questionId)} → ${t.outcome ?? 'settled'}`);
        }
        for (const w of workers) {
          const prev = seenW.current.get(w.workerId);
          seenW.current.set(w.workerId, w.totalAnswers);
          if (!primed.current) continue;
          if (prev === undefined) push('answer', 'New verifier', shortId(w.workerId));
          else if (w.totalAnswers > prev) push('answer', 'Answered', `${shortId(w.workerId)} (+${w.totalAnswers - prev}, ${w.totalAnswers} total)`);
        }
        if (!primed.current) {
          primed.current = true;
          push('info', 'Connected', `${txs.length} existing transactions, ${workers.length} verifiers — watching for new activity`);
        }
        if (alive) setStatus(`Live · ${workers.length} verifiers · polled ${new Date().toLocaleTimeString()}`);
      } catch (err) {
        if (alive) setStatus(`Can't reach the server: ${errorMessage(err)}`);
      }
      if (alive) timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [paused]);

  const tone = { dispatch: 'info', answer: 'signal', settle: 'good', info: 'neutral' } as const;
  return (
    <Panel
      title={<span className="row">Feed <Badge tone={paused ? 'neutral' : 'good'} live={!paused}>{paused ? 'paused' : 'live'}</Badge></span>}
      action={
        <div className="row">
          <Button variant="ghost" size="sm" onClick={() => setPaused(!paused)}>
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEvents([])}>
            Clear
          </Button>
          <Button variant="danger" size="sm" onClick={signOut}>
            Sign out
          </Button>
        </div>
      }
    >
      <p className="faint small">{status}</p>
      <ul className="list feed">
        {events.map((e) => (
          <li key={e.id}>
            <time className="faint">{fmtTime(e.at)}</time>
            <span>
              <Badge tone={tone[e.kind]}>{e.label}</Badge>
            </span>
            <span className="break">{e.text}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export default function LiveWire() {
  useDocumentTitle('Live wire');
  return (
    <div className="wrap page">
      <PageHead eyebrow="Operators · demos" title="Live wire" sub="Watch questions get dispatched, answered and settled as it happens. Run the CLI in another terminal and keep this on screen." />
      <AdminGate>{(signOut) => <Feed signOut={signOut} />}</AdminGate>
    </div>
  );
}
