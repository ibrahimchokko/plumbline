/**
 * Public health page. The state comes only from a live check: when the
 * server can't be reached we say so and hide the numbers, rather than
 * leaving stale figures that look current. A slow-but-up server is reported
 * as degraded — slowness is a real signal.
 */
import { useCallback, useEffect, useState } from 'react';
import { checkCompatibility, type PublicStats } from '@plumbline/core';
import { Badge, Button, PageHead, Panel, Stat } from '../components/ui.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { config } from '../lib/config.ts';
import { useDocumentTitle } from '../lib/hooks.ts';
import { useI18n } from '../lib/i18n/index.tsx';

const SLOW_MS = 2000;
const POLL_MS = 30_000;

type State = { kind: 'checking' } | { kind: 'up' | 'degraded'; ms: number; stats: PublicStats; at: number } | { kind: 'down'; reason: string; at: number };

export default function Health() {
  const { t, fmtNumber, fmtTime } = useI18n();
  useDocumentTitle(t('nav.health'));
  const [state, setState] = useState<State>({ kind: 'checking' });
  const [history, setHistory] = useState<Array<{ at: number; ms: number | null }>>([]);
  const [version, setVersion] = useState<string>('');

  const check = useCallback(async () => {
    const started = performance.now();
    try {
      const stats = await api.stats();
      const ms = Math.round(performance.now() - started);
      setState({ kind: ms > SLOW_MS ? 'degraded' : 'up', ms, stats, at: Date.now() });
      setHistory((h) => [...h, { at: Date.now(), ms }].slice(-30));
    } catch (err) {
      setState({ kind: 'down', reason: errorMessage(err), at: Date.now() });
      setHistory((h) => [...h, { at: Date.now(), ms: null }].slice(-30));
    }
  }, []);

  useEffect(() => {
    check();
    api
      .health()
      .then((h) => setVersion(h.apiVersion ?? h.version ?? ''))
      .catch(() => undefined);
    const id = setInterval(() => document.visibilityState === 'visible' && check(), POLL_MS);
    return () => clearInterval(id);
  }, [check]);

  const tone = state.kind === 'up' ? 'good' : state.kind === 'degraded' ? 'warn' : state.kind === 'down' ? 'bad' : 'neutral';
  const label = state.kind === 'up' ? 'Operational' : state.kind === 'degraded' ? 'Degraded' : state.kind === 'down' ? 'Cannot reach the server' : 'Checking…';
  const maxMs = Math.max(SLOW_MS, ...history.map((h) => h.ms ?? 0));
  const compat = checkCompatibility(config.backendCompat, version);

  return (
    <div className="wrap page">
      <PageHead eyebrow="Public" title={t('nav.health')} sub={<span className="mono">{config.backendUrl}</span>}>
        <Button variant="ghost" onClick={check}>
          {t('common.refresh')}
        </Button>
      </PageHead>
      <div className="stack">
        <Panel>
          <div className="row between">
            <Badge tone={tone} live={state.kind === 'up'}>
              {label}
            </Badge>
            <span className="faint small">
              {state.kind === 'up' || state.kind === 'degraded' ? `Answered in ${state.ms} ms · checked ${fmtTime(state.at)}` : state.kind === 'down' ? `${state.reason} · checked ${fmtTime(state.at)}` : ''}
            </span>
          </div>
          {(state.kind === 'up' || state.kind === 'degraded') && (
            <div className="grid cols-3" style={{ marginTop: 20 }}>
              <Stat label="Questions answered" value={fmtNumber(state.stats.totalResolved)} />
              <Stat label="Questions refunded" value={fmtNumber(state.stats.totalRefunded)} />
              <Stat signal label="Verifiers online" value={fmtNumber(state.stats.onlineWorkers)} />
            </div>
          )}
        </Panel>
        <Panel title="Response time" eyebrow={`Last ${history.length} checks · this browser`}>
          <svg className="chart" viewBox="0 0 300 60" role="img" aria-label="Recent response times">
            <line className="grid-line" x1="0" x2="300" y1={60 - (SLOW_MS / maxMs) * 56} y2={60 - (SLOW_MS / maxMs) * 56} strokeDasharray="3 3" />
            {history.map((h, i) => {
              const w = 300 / 30;
              const hh = h.ms === null ? 56 : Math.max(2, (h.ms / maxMs) * 56);
              return <rect key={h.at} className={h.ms === null || h.ms > SLOW_MS ? 'bar flag' : 'bar'} x={i * w + 1} y={60 - hh} width={w - 2} height={hh}><title>{h.ms === null ? 'unreachable' : `${h.ms} ms`}</title></rect>;
            })}
          </svg>
          <p className="hint">Dashed line = {SLOW_MS} ms “degraded” threshold. Orange bars are slow or failed checks.</p>
        </Panel>
        <Panel title="Versions">
          <p className="small">
            This app: <span className="mono">v{config.appVersion}</span>, built for backend API <span className="mono">v{config.backendCompat}</span>. Server reports{' '}
            <span className="mono">{version ? `v${version}` : 'no version'}</span> —{' '}
            <Badge tone={compat === 'match' || compat === 'compatible' ? 'good' : compat === 'unknown' ? 'neutral' : 'warn'}>{compat}</Badge>
          </p>
          <p className="hint">Embed a live status badge anywhere: see “Embeds” in the README.</p>
        </Panel>
      </div>
    </div>
  );
}
