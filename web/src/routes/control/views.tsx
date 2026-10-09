/**
 * Control-room views. Every table renders data that is caller-influenced
 * upstream (free-form verifier ids, self-reported KYC/payout fields), so it
 * is only ever rendered as text — never HTML — and CSV exports neutralise
 * spreadsheet formulas.
 *
 * Fixed vs. the original: Overview called an undefined `canView()` and the
 * Trust chart an undefined `SVG_NS`, so both crashed. Role restrictions are
 * now discovered honestly: a 403 on a section shows "restricted".
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CSV_BOM,
  distinctValues,
  filterTransactions,
  fromStroopsCompact,
  isApiError,
  looksLikeStellarAddress,
  percent,
  ratioHistogram,
  recordsToCsv,
  shortId,
  toCsv,
  type AdminTransaction,
  type TxFilter,
  type WorkerPool,
} from '@plumbline/core';
import { Badge, Button, Empty, Field, Histogram, Panel, Stat } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { config } from '../../lib/config.ts';
import { downloadText, fileStamp } from '../../lib/hooks.ts';

const LOW_USDC = 100;
const LOW_XLM = 50;
const PAGE = 100;

/** Load once per mount; distinguishes restricted (403) and not-deployed. */
function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data?: T; error?: string; restricted?: boolean; loading: boolean }>({ loading: true });
  const reload = () => {
    setState((s) => ({ ...s, loading: true }));
    fn()
      .then((data) => setState({ data, loading: false }))
      .catch((err) => setState({ loading: false, error: errorMessage(err), restricted: isApiError(err, 'forbidden') }));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, deps);
  return { ...state, reload };
}

function Loadable<T>({ s, children }: { s: { data?: T; error?: string; restricted?: boolean; loading: boolean }; children: (d: T) => ReactNode }) {
  if (s.restricted) return <Empty>Restricted — your token's role can't see this section.</Empty>;
  if (s.error) return <Empty>Could not load: {s.error}</Empty>;
  if (s.loading && s.data === undefined) return <p className="faint">Loading…</p>;
  return <>{s.data !== undefined && children(s.data)}</>;
}

const exportCsv = (name: string, header: string[], rows: unknown[][]) => downloadText(`plumbline-${name}-${fileStamp()}.csv`, 'text/csv;charset=utf-8', CSV_BOM + toCsv(header, rows));
const when = (v: string | number | undefined) => (v === undefined ? '—' : new Date(v).toLocaleString());

/* ---------------- overview ---------------- */
export function Overview() {
  const fees = useLoad(() => api.admin.fees());
  const treasury = useLoad(() => api.admin.treasury());
  const workers = useLoad(() => api.admin.workers());
  const payers = useLoad(() => api.admin.payers());
  const val = <T,>(s: { data?: T; restricted?: boolean; error?: string }, f: (d: T) => ReactNode) => (s.restricted ? 'restricted' : s.error ? '—' : s.data === undefined ? '…' : f(s.data));
  const usdcLow = treasury.data?.configured && Number(treasury.data.usdcBalance) < LOW_USDC;
  const xlmLow = treasury.data?.configured && Number(treasury.data.xlmBalance) < LOW_XLM;
  return (
    <div className="stack">
      <div className="grid cols-3">
        <Stat signal label="Fee revenue" value={val(fees, (f) => `${f.totalFeeRevenue} USDC`)} note={val(fees, (f) => `${f.resolvedCount} resolved questions`)} />
        <Stat label="Treasury USDC" value={val(treasury, (t) => (t.configured ? t.usdcBalance : 'not configured'))} note={usdcLow ? '⚠ below the low-balance threshold' : undefined} />
        <Stat label="Fee reserve XLM" value={val(treasury, (t) => (t.configured ? t.xlmBalance : 'not configured'))} note={xlmLow ? '⚠ below the low-balance threshold' : undefined} />
        <Stat label="Verifiers" value={val(workers, (w) => w.length)} note={val(workers, (w) => `${w.filter((x) => x.established).length} established`)} />
        <Stat label="Askers" value={val(payers, (p) => p.length)} />
        <Stat label="Owed to verifiers" value={val(workers, (w) => `${w.reduce((s, x) => s + Number(x.owed || 0), 0).toFixed(2)} USDC`)} note="Accrued, not yet withdrawn" />
      </div>
      {(usdcLow || xlmLow) && <p className="callout bad">Treasury is running low — top it up before sponsored transactions start failing.</p>}
    </div>
  );
}

/* ---------------- transactions ---------------- */
export function Transactions() {
  const [rows, setRows] = useState<AdminTransaction[]>([]);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [f, setF] = useState<TxFilter>({});

  const load = async (offset: number) => {
    setBusy(true);
    try {
      const page = await api.admin.transactions(PAGE, offset);
      setRows((prev) => (offset === 0 ? page : [...prev, ...page]));
      setMore(page.length === PAGE);
      setErr('');
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => void load(0), []);
  const visible = useMemo(() => filterTransactions(rows, f), [rows, f]);
  const statuses = useMemo(() => distinctValues(rows, 'status'), [rows]);
  const outcomes = useMemo(() => distinctValues(rows, 'outcome'), [rows]);

  return (
    <Panel
      title="Transactions"
      action={
        <Button variant="ghost" size="sm" disabled={!visible.length} onClick={() => downloadText(`plumbline-transactions-${fileStamp()}.csv`, 'text/csv;charset=utf-8', CSV_BOM + recordsToCsv(['questionId', 'payer', 'amountStroops', 'status', 'outcome', 'createdAt'], visible as never))}>
          Export CSV
        </Button>
      }
    >
      <div className="grid cols-4" style={{ marginBottom: 12 }}>
        <Field label="Search">
          <input className="input" type="search" placeholder="question id / asker" value={f.query ?? ''} onChange={(e) => setF({ ...f, query: e.target.value })} />
        </Field>
        <Field label="From">
          <input className="input" type="date" value={f.from ?? ''} onChange={(e) => setF({ ...f, from: e.target.value })} />
        </Field>
        <Field label="To">
          <input className="input" type="date" value={f.to ?? ''} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </Field>
        <Field label="Min / max USDC">
          <div className="input-row">
            <input className="input num" inputMode="decimal" placeholder="min" value={f.minUsdc ?? ''} onChange={(e) => setF({ ...f, minUsdc: e.target.value })} />
            <input className="input num" inputMode="decimal" placeholder="max" value={f.maxUsdc ?? ''} onChange={(e) => setF({ ...f, maxUsdc: e.target.value })} />
          </div>
        </Field>
        <Field label="Status">
          <select className="input" value={f.status ?? ''} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="">Any</option>
            {statuses.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Outcome">
          <select className="input" value={f.outcome ?? ''} onChange={(e) => setF({ ...f, outcome: e.target.value })}>
            <option value="">Any</option>
            {outcomes.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <div style={{ alignSelf: 'end' }}>
          <Button variant="ghost" size="sm" onClick={() => setF({})}>
            Clear filters
          </Button>
        </div>
      </div>
      <p className="hint">
        Filters apply to the {rows.length} rows loaded so far{more ? ' — load more to search further back' : ''}.
      </p>
      {err && <Empty>Could not load: {err}</Empty>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Question</th>
              <th>Asker</th>
              <th className="num">Amount</th>
              <th>Status</th>
              <th>Outcome</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="faint">
                  {busy ? 'Loading…' : 'No transactions match.'}
                </td>
              </tr>
            ) : (
              visible.map((t) => (
                <tr key={t.questionId}>
                  <td className="mono" title={t.questionId}>
                    {shortId(String(t.questionId))}
                  </td>
                  <td className="mono" title={t.payer}>
                    {shortId(t.payer)}
                  </td>
                  <td className="num">{t.amountStroops ? fromStroopsCompact(t.amountStroops) : '—'}</td>
                  <td>
                    <Badge tone={t.status === 'settled' ? 'good' : 'info'}>{t.status ?? '—'}</Badge>
                  </td>
                  <td>{t.outcome ?? '—'}</td>
                  <td className="faint small">{when(t.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {more && (
        <Button variant="ghost" busy={busy} onClick={() => load(rows.length)} style={{ marginTop: 12 }}>
          Load {PAGE} more
        </Button>
      )}
    </Panel>
  );
}

/* ---------------- verifiers / askers ---------------- */
export function Verifiers() {
  const s = useLoad(() => api.admin.workers());
  return (
    <Panel title="Verifiers" action={s.data && <Button variant="ghost" size="sm" onClick={() => exportCsv('verifiers', ['workerId', 'matchRatio', 'totalAnswers', 'established', 'stake', 'owed'], s.data!.map((w) => [w.workerId, w.matchRatio, w.totalAnswers, w.established, w.stake, w.owed]))}>Export CSV</Button>}>
      <Loadable s={s}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty>No verifiers yet.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Verifier</th>
                    <th className="num">Agreement</th>
                    <th className="num">Answers</th>
                    <th>Established</th>
                    <th className="num">Bond</th>
                    <th className="num">Owed</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((w) => (
                    <tr key={w.workerId}>
                      <td className="mono" title={w.workerId}>
                        {shortId(w.workerId)}
                      </td>
                      <td className="num">{percent(w.matchRatio)}</td>
                      <td className="num">{w.totalAnswers}</td>
                      <td>{w.established ? <Badge tone="good">yes</Badge> : <Badge>no</Badge>}</td>
                      <td className="num">{w.stake}</td>
                      <td className="num">{w.owed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loadable>
    </Panel>
  );
}

export function Askers() {
  const s = useLoad(() => api.admin.payers());
  return (
    <Panel title="Askers" action={s.data && <Button variant="ghost" size="sm" onClick={() => exportCsv('askers', ['payerAddress', 'totalSpend', 'totalTracked', 'settled', 'successRate'], s.data!.map((p) => [p.payerAddress, p.totalSpend, p.totalTracked, p.settled, p.successRate]))}>Export CSV</Button>}>
      <Loadable s={s}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty>No askers yet.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Asker</th>
                    <th className="num">Spent</th>
                    <th className="num">Questions</th>
                    <th className="num">Settled</th>
                    <th className="num">Answered rate</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.payerAddress}>
                      <td className="mono" title={p.payerAddress}>
                        {shortId(p.payerAddress)}
                      </td>
                      <td className="num">{p.totalSpend}</td>
                      <td className="num">{p.totalTracked}</td>
                      <td className="num">{p.settled}</td>
                      <td className="num">{percent(p.successRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loadable>
    </Panel>
  );
}

/* ---------------- pools ---------------- */
export function Pools() {
  const s = useLoad(() => api.admin.pools());
  const [pools, setPools] = useState<WorkerPool[]>([]);
  const [sel, setSel] = useState('');
  const [addr, setAddr] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (s.data) {
      setPools(s.data);
      setSel((cur) => cur || s.data![0]?.id || '');
    }
  }, [s.data]);
  const pool = pools.find((p) => p.id === sel);
  const update = (wl: string[]) => setPools((ps) => ps.map((p) => (p.id === sel ? { ...p, whitelist: wl } : p)));

  return (
    <Panel title="Private verifier pools" eyebrow="Whitelist-gated dispatch">
      <Loadable s={s}>
        {() =>
          pools.length === 0 ? (
            <Empty>No pools configured yet.</Empty>
          ) : (
            <div className="stack">
              <div className="row">
                <select className="input" style={{ maxWidth: 260 }} value={sel} onChange={(e) => setSel(e.target.value)} aria-label="Pool">
                  {pools.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name ?? p.id}
                    </option>
                  ))}
                </select>
                <form
                  className="input-row"
                  style={{ flex: 1 }}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const a = addr.trim();
                    if (!looksLikeStellarAddress(a)) return setMsg('Not a valid Stellar address.');
                    if (pool?.whitelist.includes(a)) return setMsg('Already in this pool.');
                    try {
                      update(await api.admin.addToPool(sel, a));
                      setAddr('');
                      setMsg('Added.');
                    } catch (err) {
                      setMsg(`Could not add: ${errorMessage(err)}`);
                    }
                  }}
                >
                  <input className="input mono" placeholder="G… verifier address" value={addr} onChange={(e) => setAddr(e.target.value)} aria-label="Verifier address" />
                  <Button type="submit">Add</Button>
                </form>
              </div>
              {msg && <p className="faint small">{msg}</p>}
              {(pool?.whitelist ?? []).length === 0 ? (
                <Empty>Nobody is whitelisted in this pool.</Empty>
              ) : (
                <ul className="list">
                  {pool!.whitelist.map((a) => (
                    <li key={a} className="row between">
                      <span className="mono break">{a}</span>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={async () => {
                          try {
                            update(await api.admin.removeFromPool(sel, a));
                            setMsg('Removed.');
                          } catch (err) {
                            setMsg(`Could not remove: ${errorMessage(err)}`);
                          }
                        }}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        }
      </Loadable>
    </Panel>
  );
}

/* ---------------- money ---------------- */
export function Treasury() {
  const s = useLoad(() => api.admin.treasury());
  const fees = useLoad(() => api.admin.fees());
  return (
    <div className="stack">
      <Panel title="Fees">
        <Loadable s={fees}>
          {(f) => (
            <div className="grid cols-2">
              <Stat signal label="Fee revenue" value={`${f.totalFeeRevenue} USDC`} />
              <Stat label="Resolved questions" value={f.resolvedCount} />
            </div>
          )}
        </Loadable>
      </Panel>
      <Panel title="Treasury" eyebrow="Read live from Horizon">
        <Loadable s={s}>
          {(t) =>
            !t.configured ? (
              <Empty>PLATFORM_ADDRESS is not configured on the server.</Empty>
            ) : (
              <div className="stack">
                <div className="grid cols-3">
                  <Stat label="Platform address" value={<span className="mono small" title={t.platformAddress}>{shortId(t.platformAddress)}</span>} />
                  <Stat signal={Number(t.usdcBalance) < LOW_USDC} label="USDC" value={t.usdcBalance} note={Number(t.usdcBalance) < LOW_USDC ? `⚠ under ${LOW_USDC}` : 'resolve() sends the platform fee here'} />
                  <Stat signal={Number(t.xlmBalance) < LOW_XLM} label="XLM (fee reserve)" value={t.xlmBalance} note={Number(t.xlmBalance) < LOW_XLM ? `⚠ under ${LOW_XLM}` : 'pays sponsored fee-bumps'} />
                </div>
                <hr />
                {t.fiatPool ? (
                  <div className="grid cols-2">
                    <Stat label="Fiat pool" value={<span className="mono small" title={t.fiatPool.address}>{shortId(t.fiatPool.address)}</span>} />
                    <Stat signal={Number(t.fiatPool.usdcBalance) < LOW_USDC} label="Fiat pool USDC" value={t.fiatPool.usdcBalance} note="Backs every API-key / card question" />
                  </div>
                ) : (
                  <p className="faint small">Fiat pool not configured (FIAT_POOL_ADDRESS unset) — the API-key on-ramp is disabled.</p>
                )}
              </div>
            )
          }
        </Loadable>
      </Panel>
    </div>
  );
}

function SelfReported({ title, load, header, row }: { title: string; load: () => Promise<Array<Record<string, unknown>>>; header: string[]; row: (r: Record<string, unknown>) => ReactNode[] }) {
  const s = useLoad(load);
  return (
    <Panel title={title} eyebrow="Self-reported by users — treat as unverified">
      <Loadable s={s}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty>Nothing reported yet.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    {header.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      {row(r).map((c, j) => (
                        <td key={j}>{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loadable>
    </Panel>
  );
}

export const Kyc = () => (
  <SelfReported
    title="KYC status"
    load={() => api.admin.kyc() as never}
    header={['Address', 'Status', 'Tier', 'Reported']}
    row={(c) => [<span className="mono" title={String(c.address)}>{shortId(String(c.address))}</span>, String(c.status ?? '—'), String(c.tier ?? '—'), <span className="faint small">{when(c.reportedAt as string)}</span>]}
  />
);

export const Payouts = () => (
  <SelfReported
    title="Bank payouts"
    load={() => api.admin.payouts() as never}
    header={['Address', 'Amount', 'Status', 'Reported']}
    row={(p) => [<span className="mono" title={String(p.address)}>{shortId(String(p.address))}</span>, `${p.amount ?? '—'} ${p.assetCode ?? ''}`, String(p.status ?? '—'), <span className="faint small">{when(p.reportedAt as string)}</span>]}
  />
);

/* ---------------- trust ---------------- */
export function Trust() {
  const s = useLoad(() => api.admin.workers());
  const [threshold, setThreshold] = useState(0.5);
  return (
    <Panel title="Trust & fraud signals" eyebrow="Established verifiers by agreement">
      <Loadable s={s}>
        {(ws) => {
          const est = ws.filter((w) => w.established && w.matchRatio !== null);
          const flagged = est.filter((w) => (w.matchRatio ?? 1) < threshold).sort((a, b) => (a.matchRatio ?? 0) - (b.matchRatio ?? 0));
          return (
            <div className="stack">
              <Histogram buckets={ratioHistogram(est.map((w) => w.matchRatio!))} flagBelow={threshold} label="Distribution of verifier agreement ratios" />
              <Field label={`Flag below ${Math.round(threshold * 100)}% agreement`}>
                <input type="range" min={0.1} max={0.9} step={0.1} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
              </Field>
              {flagged.length === 0 ? (
                <Empty>No established verifier is below the threshold.</Empty>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Verifier</th>
                        <th className="num">Agreement</th>
                        <th className="num">Answers</th>
                        <th className="num">Bond at risk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flagged.map((w) => (
                        <tr key={w.workerId}>
                          <td className="mono" title={w.workerId}>
                            {shortId(w.workerId)}
                          </td>
                          <td className="num">{percent(w.matchRatio)}</td>
                          <td className="num">{w.totalAnswers}</td>
                          <td className="num">{w.stake}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        }}
      </Loadable>
    </Panel>
  );
}

export function Network() {
  return (
    <Panel title="Network & build" eyebrow="Static config this app was built with">
      <dl className="grid cols-2 small">
        {[
          ['Backend', config.backendUrl],
          ['Network', `${config.network} (${config.networkPassphrase})`],
          ['Horizon', config.horizonUrl],
          ['Soroban RPC', config.sorobanRpcUrl],
          ['Escrow contract', config.contractId || 'not set'],
          ['USDC', `${config.usdc.code} · ${config.usdc.issuer}`],
          ['App version', config.appVersion],
          ['Built for backend API', config.backendCompat],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="label">{k}</dt>
            <dd className="mono break" style={{ margin: 0 }}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
      <p className="hint">Change these with VITE_* variables and rebuild.</p>
    </Panel>
  );
}
