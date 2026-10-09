import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { questionState, type PayerQuestion } from '@plumbline/core';
import { useI18n } from '../lib/i18n/index.tsx';
import type { MessageKey } from '../lib/i18n/en.ts';
import { copyText } from '../lib/hooks.ts';
import type { Notice } from '../lib/notify.ts';

type BtnVariant = 'primary' | 'signal' | 'ghost' | 'danger';

export function Button({
  variant = 'primary',
  size,
  busy,
  block,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm'; busy?: boolean; block?: boolean }) {
  const cls = ['btn', variant !== 'primary' ? variant : '', size ?? '', block ? 'block' : '', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} disabled={busy || rest.disabled} aria-busy={busy || undefined} {...rest}>
      {busy && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Panel({ title, action, children, className = '', id, eyebrow }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; id?: string; eyebrow?: string }) {
  return (
    <section className={`panel ${className}`} id={id} aria-label={typeof title === 'string' ? title : undefined}>
      {(title || action) && (
        <div className="panel-head">
          <div>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            {title && <h2>{title}</h2>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHead({ eyebrow, title, sub, children }: { eyebrow?: string; title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </header>
  );
}

export function Stat({ label, value, note, signal }: { label: string; value: ReactNode; note?: ReactNode; signal?: boolean }) {
  return (
    <div className={`stat${signal ? ' signal' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'signal' | 'neutral';
export function Badge({ tone = 'neutral', live, children }: { tone?: Tone; live?: boolean; children: ReactNode }) {
  return <span className={`badge ${tone === 'neutral' ? '' : tone}${live ? ' live' : ''}`}>{children}</span>;
}

export function QuestionStateBadge({ q }: { q: Pick<PayerQuestion, 'status' | 'outcome'> }) {
  const { t } = useI18n();
  const state = questionState(q);
  if (state === 'in-progress') {
    const key: MessageKey = q.status === 'awaiting_workers' ? 'status.awaiting_workers' : q.status === 'reconciling' ? 'status.reconciling' : 'status.in-progress';
    return (
      <Badge tone="info" live>
        {t(key)}
      </Badge>
    );
  }
  return <Badge tone={state === 'resolved' ? 'good' : state === 'cancelled' ? 'neutral' : 'warn'}>{t(`status.${state}`)}</Badge>;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="hint">{hint}</small>}
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Meter({ value, tone }: { value: number; tone?: 'signal' | 'urgent' }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <div className={`meter ${tone ?? ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct / 10) * 10}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

export function CopyButton({ text, label, size = 'sm' }: { text: string; label?: string; size?: 'sm' | 'md' }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="ghost"
      size={size === 'sm' ? 'sm' : undefined}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        }
      }}
    >
      {done ? t('common.copied') : (label ?? t('common.copy'))}
    </Button>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button, [href], input, select, textarea')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function ActivityLog({ items, title }: { items: Notice[]; title?: string }) {
  const { t, fmtTime } = useI18n();
  return (
    <Panel title={title ?? t('common.activity')}>
      {items.length === 0 ? (
        <p className="faint small">{t('common.nothing')}</p>
      ) : (
        <ul className="log" role="log" aria-live="polite">
          {items.slice(0, 40).map((n) => (
            <li key={n.id} className={`tone-${n.tone}`}>
              <time>{fmtTime(n.at)}</time>
              <span className="break">
                {n.message}
                {n.href && (
                  <>
                    {' '}
                    <a href={n.href} target="_blank" rel="noreferrer">
                      view ↗
                    </a>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * Renders untrusted question text with ```fenced code``` support. Only text
 * nodes and our own token spans are ever created — raw HTML in the input is
 * shown as text, never interpreted. (React escapes by default; this just
 * adds the code-block layer the original app had.)
 */
const FENCE = /```([a-z0-9+-]*)\n?([\s\S]*?)```/gi;
const TOKEN = /(\b(?:fn|pub|let|mut|struct|impl|contract|return|const|async|await|function|class|if|else|true|false|null)\b|\b(?:resolve|refund|transfer|mint)\b|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\/\/[^\n]*)/g;

function Code({ code, lang }: { code: string; lang: string }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  let i = 0;
  for (const m of code.matchAll(TOKEN)) {
    parts.push(code.slice(cursor, m.index));
    const tok = m[0];
    const cls = tok.startsWith('//') ? 'tok-com' : tok.startsWith('"') || tok.startsWith("'") ? 'tok-str' : 'tok-kw';
    parts.push(
      <span key={i++} className={cls}>
        {tok}
      </span>,
    );
    cursor = (m.index ?? 0) + tok.length;
  }
  parts.push(code.slice(cursor));
  return (
    <pre className="code-block">
      <code data-language={lang || undefined}>{parts}</code>
    </pre>
  );
}

export function SafeText({ text }: { text: string | undefined | null }) {
  const value = String(text ?? '');
  const out: ReactNode[] = [];
  let cursor = 0;
  let i = 0;
  for (const m of value.matchAll(FENCE)) {
    out.push(value.slice(cursor, m.index));
    out.push(<Code key={i++} code={m[2]} lang={m[1].toLowerCase()} />);
    cursor = (m.index ?? 0) + m[0].length;
  }
  out.push(value.slice(cursor));
  return <>{out}</>;
}

/** Inline-SVG histogram (colours come from CSS variables, so it follows the theme). */
export function Histogram({ buckets, flagBelow = 0.5, label }: { buckets: number[]; flagBelow?: number; label: string }) {
  const W = 420;
  const H = 150;
  const pad = { t: 10, b: 22, l: 26 };
  const plotH = H - pad.t - pad.b;
  const bw = (W - pad.l) / buckets.length;
  const max = Math.max(1, ...buckets);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <line className="grid-line" x1={pad.l} x2={W} y1={pad.t + plotH} y2={pad.t + plotH} />
      <line className="grid-line" x1={pad.l} x2={W} y1={pad.t} y2={pad.t} strokeDasharray="3 3" />
      <text x={pad.l - 6} y={pad.t + 4} textAnchor="end">
        {max}
      </text>
      {buckets.map((count, i) => {
        const h = (count / max) * plotH;
        const x = pad.l + i * bw + 2;
        return (
          <g key={i}>
            <rect className={(i + 1) / buckets.length <= flagBelow ? 'bar flag' : 'bar'} x={x} y={pad.t + plotH - h} width={bw - 4} height={h}>
              <title>{`${i * 10}–${(i + 1) * 10}%: ${count}`}</title>
            </rect>
            {i % 2 === 0 && (
              <text x={x + (bw - 4) / 2} y={H - 6} textAnchor="middle">
                {i * 10}%
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
