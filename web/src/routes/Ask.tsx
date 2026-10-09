/**
 * Ask — the asker's hub (was "buyer dashboard"): ask new questions, and
 * watch every past one update live.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CSV_BOM, dailyTotals, filterQuestions, recordsToCsv, type PayerQuestion, type PayerSnapshot } from '@plumbline/core';
import { ActivityLog, Badge, Button, Empty, Meter, PageHead, Panel, QuestionStateBadge, SafeText, Stat } from '../components/ui.tsx';
import { WalletGate } from '../components/WalletGate.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { useFlag } from '../lib/flags.ts';
import { downloadText, fileStamp, useDocumentTitle, useNow } from '../lib/hooks.ts';
import { useI18n } from '../lib/i18n/index.tsx';
import { scoped, useActivity } from '../lib/notify.ts';
import { useSession } from '../lib/session.tsx';
import { openStatusChannel, type StatusChannel } from '../lib/statusChannel.ts';
import { store } from '../lib/storage.ts';
import { Composer } from './ask/Composer.tsx';

const log = scoped('ask');
const EXPORT_COLUMNS = ['questionId', 'question', 'tier', 'amount', 'status', 'outcome', 'confidence', 'answer', 'createdAt'] as const;

function useStars(address: string | null) {
  const key = `stars.${address}`;
  const [stars, setStars] = useState<Set<string>>(() => new Set(store.getJson<string[]>(key, [])));
  useEffect(() => setStars(new Set(store.getJson<string[]>(key, []))), [key]);
  const toggle = (id: string) => {
    const next = new Set(stars);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setStars(next);
    store.setJson(key, [...next]);
  };
  return { stars, toggle };
}

function CancelWindow({ q, onCancelled }: { q: PayerQuestion; onCancelled: () => void }) {
  const s = useSession();
  const now = useNow(true, 250);
  const [busy, setBusy] = useState(false);
  const total = useRef(Math.max(1, (q.cancelableUntil ?? 0) - Date.now()));
  const left = (q.cancelableUntil ?? 0) - now;
  if (left <= 0) return null;
  return (
    <div className="row" style={{ marginTop: 8 }}>
      <div style={{ flex: 1, minWidth: 120 }}>
        <Meter value={left / total.current} />
        <span className="hint">You can still cancel for {Math.ceil(left / 1000)}s</span>
      </div>
      <Button
        variant="danger"
        size="sm"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.payers.cancel(s.address!, q.questionId, await s.ensureSession());
            log(`Cancelled ${q.questionId}.`, 'success', { toast: true });
            onCancelled();
          } catch (err) {
            log(`Could not cancel ${q.questionId}: ${errorMessage(err)}`, 'error');
          } finally {
            setBusy(false);
          }
        }}
      >
        Cancel
      </Button>
    </div>
  );
}

function Feedback({ q }: { q: PayerQuestion }) {
  const s = useSession();
  const [rating, setRating] = useState<'up' | 'down' | null>(q.feedback ?? null);
  const [msg, setMsg] = useState('');
  const send = async (r: 'up' | 'down') => {
    const prev = rating;
    setRating(r);
    setMsg('Sending…');
    try {
      await api.payers.feedback(s.address!, q.questionId, await s.ensureSession(), r);
      setMsg('Thanks.');
    } catch (err) {
      setRating(prev);
      setMsg(errorMessage(err));
    }
  };
  return (
    <span className="row" role="group" aria-label="Rate this answer" style={{ gap: 4 }}>
      <button className="star" aria-pressed={rating === 'up'} aria-label="Good answer" onClick={() => send('up')}>
        👍
      </button>
      <button className="star" aria-pressed={rating === 'down'} aria-label="Bad answer" onClick={() => send('down')}>
        👎
      </button>
      <span className="hint" aria-live="polite">
        {msg}
      </span>
    </span>
  );
}

function History() {
  const { t, fmtUsdc, fmtNumber, fmtDateTime } = useI18n();
  const s = useSession();
  const [snap, setSnap] = useState<PayerSnapshot | null>(null);
  const [live, setLive] = useState(false);
  const [query, setQuery] = useState('');
  const [state, setState] = useState<'all' | 'in-progress' | 'resolved' | 'refunded'>('all');
  const [starredOnly, setStarredOnly] = useState(false);
  const { stars, toggle } = useStars(s.address);
  const channel = useRef<StatusChannel | null>(null);

  useEffect(() => {
    if (!s.address) return;
    channel.current?.close();
    setSnap(null);
    const ch = openStatusChannel({
      address: s.address,
      getToken: s.ensureSession,
      onSnapshot: (d) => {
        setSnap(d);
        log(`Loaded ${t('ask.questions', { n: d.questions.length })}.`);
      },
      onEvent: (q) => {
        setSnap((prev) => {
          if (!prev) return prev;
          const idx = prev.questions.findIndex((x) => x.questionId === q.questionId);
          const questions = [...prev.questions];
          if (idx >= 0) questions[idx] = { ...questions[idx], ...q };
          else questions.unshift({ status: 'pending', ...q } as PayerQuestion);
          return { ...prev, questions };
        });
        if (q.status === 'settled') {
          log(`${q.questionId}: ${q.outcome === 'resolved' ? 'answered' : 'refunded'}.`, q.outcome === 'resolved' ? 'success' : 'warn', { toast: true });
          void ch.resync(); // totals are server-computed
        }
      },
      onConnection: setLive,
    });
    channel.current = ch;
    ch.ready.catch((err) => log(`Could not load your questions: ${errorMessage(err)}`, 'error'));
    return () => ch.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.address]);

  const visible = useMemo(() => filterQuestions(snap?.questions ?? [], { query, state, starredOnly, starred: stars }), [snap, query, state, starredOnly, stars]);
  const days = useMemo(() => dailyTotals(snap?.questions ?? []), [snap]);
  const maxDay = Math.max(1, ...days.map((d) => d.amount));

  const exportAs = (fmt: 'csv' | 'json') => {
    const rows = visible as unknown as Record<string, unknown>[];
    if (fmt === 'json') downloadText(`plumbline-questions-${fileStamp()}.json`, 'application/json', JSON.stringify(rows, null, 2));
    else downloadText(`plumbline-questions-${fileStamp()}.csv`, 'text/csv;charset=utf-8', CSV_BOM + recordsToCsv([...EXPORT_COLUMNS], rows));
  };

  return (
    <div className="stack">
      <div className="grid cols-3">
        <Stat label={t('ask.spent')} value={snap ? fmtUsdc(snap.totalSpend) : '—'} />
        <Stat label={t('ask.tracked')} value={snap ? fmtNumber(snap.totalTracked) : '—'} />
        <Stat label={t('ask.success')} value={snap?.successRate == null ? '—' : fmtNumber(snap.successRate, { style: 'percent' })} />
      </div>

      {days.length > 0 && (
        <Panel title="Spend calendar" eyebrow="Last 12 weeks">
          <div className="heat" role="list" aria-label="Daily spend">
            {days.map((d) => (
              <div key={d.day} role="listitem" className="heat-cell" style={{ ['--v' as string]: Math.max(0.12, d.amount / maxDay) }} title={`${d.day}: ${d.amount.toFixed(2)} USDC`} aria-label={`${d.day}: ${d.amount.toFixed(2)} USDC`}>
                {d.day.slice(8)}
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel
        title={
          <span className="row">
            {t('ask.history')}
            <Badge tone={live ? 'good' : 'warn'} live={live}>
              {live ? t('ask.live') : t('ask.reconnecting')}
            </Badge>
          </span>
        }
        action={
          <div className="row">
            <Button variant="ghost" size="sm" onClick={() => void channel.current?.resync()}>
              {t('common.refresh')}
            </Button>
            <Button variant="ghost" size="sm" disabled={!visible.length} onClick={() => exportAs('csv')}>
              CSV
            </Button>
            <Button variant="ghost" size="sm" disabled={!visible.length} onClick={() => exportAs('json')}>
              JSON
            </Button>
          </div>
        }
      >
        <div className="row" style={{ marginBottom: 12 }}>
          <input className="input" style={{ flex: 1, minWidth: 200 }} type="search" placeholder={`${t('common.search')}: question, id or answer`} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('common.search')} />
          <div className="seg" role="group" aria-label="Filter by state">
            {(['all', 'in-progress', 'resolved', 'refunded'] as const).map((k) => (
              <button key={k} aria-pressed={state === k} onClick={() => setState(k)}>
                {k === 'all' ? 'All' : t(`status.${k}`)}
              </button>
            ))}
          </div>
          <label className="check small">
            <input type="checkbox" checked={starredOnly} onChange={(e) => setStarredOnly(e.target.checked)} /> ★ only
          </label>
        </div>
        {!snap ? (
          <p className="faint">{t('common.loading')}</p>
        ) : visible.length === 0 ? (
          <Empty>{snap.questions.length ? 'No questions match these filters.' : t('ask.none')}</Empty>
        ) : (
          <ul className="list">
            {visible.map((q) => (
              <li key={q.questionId} className="q-item">
                <button className="star" aria-pressed={stars.has(q.questionId)} aria-label={stars.has(q.questionId) ? 'Unstar' : 'Star'} onClick={() => toggle(q.questionId)}>
                  {stars.has(q.questionId) ? '★' : '☆'}
                </button>
                <div style={{ minWidth: 0 }}>
                  <div className="break">
                    <SafeText text={q.question || q.questionId} />
                  </div>
                  <div className="faint small">
                    {[q.tier, q.amount ? fmtUsdc(q.amount) : null, q.createdAt ? fmtDateTime(q.createdAt) : null, q.status === 'settled' && q.outcome === 'resolved' && q.confidence != null ? `confidence ${fmtNumber(q.confidence)}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  {q.status === 'settled' && q.outcome === 'resolved' && q.answer && (
                    <div className="q-answer row between">
                      <span className="break">
                        <strong>Answer: </strong>
                        {q.answer}
                      </span>
                      <Feedback q={q} />
                    </div>
                  )}
                  {q.status !== 'settled' && Number.isFinite(q.cancelableUntil) && (
                    <CancelWindow q={q} onCancelled={() => setSnap((p) => p && { ...p, questions: p.questions.map((x) => (x.questionId === q.questionId ? { ...x, status: 'cancelled', outcome: 'cancelled' } : x)) })} />
                  )}
                </div>
                <QuestionStateBadge q={q} />
              </li>
            ))}
          </ul>
        )}
        <p className="hint" style={{ marginTop: 8 }}>
          Stars are kept in this browser, per wallet.
        </p>
      </Panel>
    </div>
  );
}

export default function Ask() {
  const { t } = useI18n();
  useDocumentTitle(t('ask.title'));
  const composerOn = useFlag('askComposer');
  const activity = useActivity('ask');
  return (
    <div className="wrap page">
      <PageHead eyebrow="Askers" title={t('ask.title')} sub={t('ask.sub')} />
      <WalletGate why="Your wallet pays the escrow and receives any refund. Fees are sponsored — you need USDC, not XLM.">
        <div className="split">
          <div className="stack">
            {composerOn && <Composer onAsked={() => undefined} />}
            <History />
          </div>
          <div className="stack">
            <ActivityLog items={activity} />
          </div>
        </div>
      </WalletGate>
    </div>
  );
}
