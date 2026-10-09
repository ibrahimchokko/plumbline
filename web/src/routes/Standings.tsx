/**
 * Standings — public, no wallet needed. Established verifiers ranked by how
 * often they agreed with the quorum, plus an anonymised settlement feed.
 * Everything rendered here is caller-influenced, so it is only ever text
 * (React escapes it); identifying fields in the feed are dropped even if a
 * backend regression leaks them.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { percent, shortId, type SettlementEvent } from '@plumbline/core';
import { Badge, Button, Empty, PageHead, Panel } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useDocumentTitle, usePolling } from '../lib/hooks.ts';
import { useI18n } from '../lib/i18n/index.tsx';

type SortKey = 'ratio' | 'answers' | 'stake';

export function useSettlementFeed(max = 25) {
  const [events, setEvents] = useState<Array<SettlementEvent & { at: number }>>([]);
  useEffect(() => {
    let es: EventSource;
    try {
      es = new EventSource(api.streams.activity());
    } catch {
      return;
    }
    es.addEventListener('settlement', (msg) => {
      try {
        const e = JSON.parse((msg as MessageEvent<string>).data) as SettlementEvent & { workerId?: unknown; payer?: unknown };
        if (e.workerId || e.payer) return;
        setEvents((prev) => [{ ...e, at: Date.now() }, ...prev].slice(0, max));
      } catch {
        /* ignore malformed */
      }
    });
    return () => es.close();
  }, [max]);
  return events;
}

export default function Standings() {
  const { t, fmtUsdc, fmtTime } = useI18n();
  useDocumentTitle(t('nav.standings'));
  const { data, error, loading, refresh } = usePolling(() => api.leaderboard(), 60_000);
  const feed = useSettlementFeed();
  const [sort, setSort] = useState<SortKey>('ratio');
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const list = (data ?? []).map((r, i) => ({ ...r, rank: i + 1 }));
    const filtered = q ? list.filter((r) => r.workerId.toLowerCase().includes(q.toLowerCase())) : list;
    const by: Record<SortKey, (a: (typeof list)[0], b: (typeof list)[0]) => number> = {
      ratio: (a, b) => a.rank - b.rank,
      answers: (a, b) => b.totalAnswers - a.totalAnswers,
      stake: (a, b) => Number(b.stake) - Number(a.stake),
    };
    return [...filtered].sort(by[sort]);
  }, [data, sort, q]);

  return (
    <div className="wrap page">
      <PageHead eyebrow="Public" title={t('nav.standings')} sub="Only established verifiers are ranked. Agreement with the quorum is the score; the bond shows how much they put behind it.">
        <Button variant="ghost" onClick={refresh} busy={loading}>
          {t('common.refresh')}
        </Button>
      </PageHead>
      <div className="split">
        <Panel className="flush">
          <div className="row between" style={{ padding: 16 }}>
            <input className="input" style={{ maxWidth: 280 }} type="search" placeholder="Find an address" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a verifier" />
            <div className="seg" role="group" aria-label="Sort by">
              {(['ratio', 'answers', 'stake'] as const).map((k) => (
                <button key={k} aria-pressed={sort === k} onClick={() => setSort(k)}>
                  {k === 'ratio' ? 'Agreement' : k === 'answers' ? 'Answers' : 'Bond'}
                </button>
              ))}
            </div>
          </div>
          {error ? (
            <div style={{ padding: 16 }}>
              <Empty>Could not load standings: {error.message}</Empty>
            </div>
          ) : !data ? (
            <p className="faint" style={{ padding: 16 }}>
              {t('common.loading')}
            </p>
          ) : rows.length === 0 ? (
            <div style={{ padding: 16 }}>
              <Empty>No established verifiers yet.</Empty>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Verifier</th>
                    <th className="num">Agreement</th>
                    <th className="num">Answers</th>
                    <th className="num">Bond</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.workerId}>
                      <td className="mono">{r.rank}</td>
                      <td title={r.workerId}>
                        <Link className="mono" to={`/v/${encodeURIComponent(r.workerId)}`}>
                          {shortId(r.workerId)}
                        </Link>
                      </td>
                      <td className="num">
                        {percent(r.matchRatio)} <span className="faint small">({r.matched}/{r.totalAnswers})</span>
                      </td>
                      <td className="num">{r.totalAnswers}</td>
                      <td className="num">{fmtUsdc(r.stake)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title="Recent settlements" eyebrow="Live · anonymised">
          {feed.length === 0 ? (
            <p className="faint small">Waiting for the next settlement…</p>
          ) : (
            <ul className="list">
              {feed.map((e, i) => (
                <li key={`${e.at}-${i}`} className="row between">
                  <span className="row">
                    <Badge tone={e.outcome === 'resolved' ? 'good' : 'warn'}>{e.outcome}</Badge>
                    <span className="small">
                      {e.category} · {e.tier}
                    </span>
                  </span>
                  <span className="mono small">
                    {fmtUsdc(e.amount)} <span className="faint">{fmtTime(e.at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
