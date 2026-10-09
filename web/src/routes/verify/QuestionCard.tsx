import { useEffect, useRef, useState } from 'react';
import type { DispatchedQuestion } from '@plumbline/core';
import { Badge, Button, Meter, SafeText } from '../../components/ui.tsx';
import { config } from '../../lib/config.ts';
import { useNow } from '../../lib/hooks.ts';
import { useI18n } from '../../lib/i18n/index.tsx';
import { store } from '../../lib/storage.ts';

export const MAX_ANSWER = 400;

export interface ActiveQuestion extends DispatchedQuestion {
  receivedAt: number;
  deadlineAt: number;
  practice?: { expected: string };
}

/** Only render images served by our own backend — never arbitrary hosts. */
function trustedAttachment(url?: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, config.backendUrl);
    return u.origin === new URL(config.backendUrl).origin ? u.href : null;
  } catch {
    return null;
  }
}

export function QuestionCard({ q, onSubmit, onDismiss }: { q: ActiveQuestion; onSubmit: (answer: string) => Promise<'ok' | 'retry' | 'closed'>; onDismiss: () => void }) {
  const { t } = useI18n();
  const [answer, setAnswer] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const now = useNow(!done, 200);
  const total = Math.max(1, q.deadlineAt - q.receivedAt);
  const left = Math.max(0, q.deadlineAt - now);
  const expired = left <= 0;
  const lastDraft = store.get('verify.lastDraft');

  // Move focus to the new question so keyboard and screen-reader users land on it.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    headingRef.current?.focus();
    return () => prev?.focus?.();
  }, [q.questionId]);

  // Keep a draft so a reload or accidental dismiss doesn't lose typing.
  useEffect(() => {
    if (answer) store.set('verify.lastDraft', answer);
  }, [answer]);

  const img = trustedAttachment(q.attachmentUrl);
  const ratio = left / total;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = answer.trim();
    if (!text || expired || done) return;
    setSending(true);
    try {
      const r = await onSubmit(text);
      if (r !== 'retry') {
        setDone(true);
        store.remove('verify.lastDraft');
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="question" aria-labelledby="q-heading">
      <div className="row between">
        <h2 id="q-heading" ref={headingRef} tabIndex={-1} style={{ margin: 0 }}>
          {t('question.incoming')}
        </h2>
        <div className="row">
          {q.practice && <Badge tone="info">practice</Badge>}
          {q.category && <Badge>{q.category}</Badge>}
          {q.tier && <Badge tone="signal">{q.tier}</Badge>}
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <Meter value={ratio} tone={ratio < 0.25 ? 'urgent' : 'signal'} />
        <div className="row between small faint" style={{ marginTop: 4 }}>
          <span aria-live="off">{expired ? t('question.expired') : t('question.secondsLeft', { n: Math.ceil(left / 1000) })}</span>
          <span className="mono">#{q.questionId}</span>
        </div>
      </div>
      <div className="question-text">
        <SafeText text={q.question} />
      </div>
      {img && <img src={img} alt="Image attached to this question" loading="lazy" />}
      <form onSubmit={submit} className="stack tight" style={{ marginTop: 12 }}>
        <label className="sr-only" htmlFor="answer-input">
          {t('question.placeholder')}
        </label>
        <div className="input-row">
          <input
            id="answer-input"
            className="input"
            autoComplete="off"
            maxLength={MAX_ANSWER}
            placeholder={t('question.placeholder')}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            disabled={expired || done}
          />
          <Button type="submit" variant="signal" busy={sending} disabled={!answer.trim() || expired || done}>
            {t('question.submit')}
          </Button>
        </div>
        <div className="row between small faint">
          <span>
            {answer.length} / {MAX_ANSWER}
          </span>
          {!answer && lastDraft && !done && (
            <button type="button" className="btn ghost sm" onClick={() => setAnswer(lastDraft)}>
              Restore last draft
            </button>
          )}
          {(done || expired) && (
            <button type="button" className="btn ghost sm" onClick={onDismiss}>
              Clear
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
