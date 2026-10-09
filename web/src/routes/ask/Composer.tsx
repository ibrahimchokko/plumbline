/**
 * Ask a question from the browser — NEW (the original "buyer dashboard"
 * could only *read* history; asking required the CLI).
 *
 *   1. POST /oracle             -> 402 with a price locked to a questionId
 *   2. sign submit() escrow call -> /sponsor/pay fee-bumps it (zero XLM)
 *   3. POST /oracle + proof      -> 202 jobId
 *   4. poll /oracle/:jobId       -> resolved (answer) or refunded
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { explorerTxUrl, suggestTier, waitForSettlement, type Job, type PaymentChallenge, type TierInfo } from '@plumbline/core';
import { Badge, Button, Field, Panel, SafeText } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { config } from '../../lib/config.ts';
import { useI18n } from '../../lib/i18n/index.tsx';
import { scoped } from '../../lib/notify.ts';
import { useSession } from '../../lib/session.tsx';
import { accountReadiness, buildSubmitPaymentXdr } from '../../lib/soroban.ts';

const log = scoped('ask');
const MAX_IMAGE = 2 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const FALLBACK_TIERS: TierInfo[] = [
  { id: 'instant', label: 'Instant', price: 0.05, quorumSize: 1, timeoutSeconds: 30 },
  { id: 'standard', label: 'Standard', price: 0.25, quorumSize: 2, timeoutSeconds: 20 },
  { id: 'express', label: 'Express', price: 0.4, quorumSize: 2, timeoutSeconds: 12 },
  { id: 'priority', label: 'Priority', price: 0.6, quorumSize: 3, timeoutSeconds: 8 },
];

type Phase = { kind: 'idle' } | { kind: 'quoted'; quote: PaymentChallenge } | { kind: 'paying' } | { kind: 'waiting'; jobId: string; answers: number } | { kind: 'done'; job: Job };

export function Composer({ onAsked }: { onAsked: () => void }) {
  const { t, fmtUsdc } = useI18n();
  const s = useSession();
  const [question, setQuestion] = useState('');
  const [tiers, setTiers] = useState<TierInfo[]>(FALLBACK_TIERS);
  const [tier, setTier] = useState<string>('');
  const [category, setCategory] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    api
      .tiers()
      .then((list) => list.length && setTiers(list))
      .catch(() => {
        /* keep documented fallback tiers */
      });
    return () => abort.current?.abort();
  }, []);

  const effectiveTier = tier || suggestTier(question);
  const tierInfo = useMemo(() => tiers.find((x) => x.id === effectiveTier) ?? tiers[0], [tiers, effectiveTier]);

  const reset = () => {
    setPhase({ kind: 'idle' });
    setErr('');
  };

  const getQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      let attachmentId: string | undefined;
      if (image) {
        if (!IMAGE_TYPES.includes(image.type)) throw new Error('images must be PNG, JPEG, WebP or GIF');
        if (image.size > MAX_IMAGE) throw new Error('images must be 2 MB or smaller');
        attachmentId = (await api.attachments.upload(image, image.name)).attachmentId;
      }
      const quote = await api.oracle.quote({ question: question.trim(), tier: effectiveTier, category: category || undefined, attachmentId });
      setPhase({ kind: 'quoted', quote });
      log(`Price locked: ${quote.amount} USDC${quote.surgeMultiplier && quote.surgeMultiplier !== 1 ? ` (surge ×${quote.surgeMultiplier})` : ''}.`);
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    if (phase.kind !== 'quoted') return;
    const { quote } = phase;
    setErr('');
    setBusy(true);
    try {
      const acct = await accountReadiness(s.address!);
      if (!acct.hasUsdcTrustline) throw new Error('this wallet has no USDC trustline yet — set it up on the Verify & earn page (free) and fund it with USDC');
      if (acct.usdcBalance !== null && Number(acct.usdcBalance) < Number(quote.amount)) {
        throw new Error(`this wallet holds ${acct.usdcBalance} USDC but the question costs ${quote.amount} USDC`);
      }
      setPhase({ kind: 'paying' });
      const xdr = await buildSubmitPaymentXdr(s.address!, quote.questionId, quote.amountStroops);
      const signed = await s.sign(xdr);
      const { hash } = await api.sponsor.pay({ xdr: signed, payerAddress: s.address!, questionId: quote.questionId });
      log(`Payment escrowed (${quote.amount} USDC, zero XLM spent).`, 'success', { href: explorerTxUrl(hash, config.network) });
      const { jobId } = await api.oracle.fulfil({ question: question.trim() }, { paymentTx: hash, questionId: quote.questionId });
      onAsked();
      setPhase({ kind: 'waiting', jobId, answers: 0 });
      abort.current = new AbortController();
      const job = await waitForSettlement(api, jobId, {
        signal: abort.current.signal,
        timeoutMs: 5 * 60_000,
        onTick: (j) => setPhase({ kind: 'waiting', jobId, answers: j.totalAnswers ?? 0 }),
      });
      setPhase({ kind: 'done', job });
      if (job.outcome === 'resolved') log(`Answered: “${job.answer}”.`, 'success', { toast: true, href: job.payoutTx ? explorerTxUrl(job.payoutTx, config.network) : undefined });
      else log(`Refunded: ${job.reason ?? 'no consensus'}.`, 'warn', { toast: true });
      setQuestion('');
      setImage(null);
    } catch (e2) {
      setErr(errorMessage(e2));
      setPhase((p) => (p.kind === 'paying' ? { kind: 'quoted', quote } : p));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel eyebrow="New" title={t('ask.title')}>
      <form className="stack" onSubmit={getQuote}>
        <Field label="Question" hint={`${question.length}/1000 · use \`\`\`fences\`\`\` for code`}>
          <textarea className="input" maxLength={1000} placeholder={t('ask.placeholder')} value={question} onChange={(e) => (setQuestion(e.target.value), phase.kind === 'quoted' && reset())} required disabled={phase.kind === 'paying' || phase.kind === 'waiting'} />
        </Field>
        <div className="grid cols-3">
          <Field label="Tier" hint={tierInfo ? `${tierInfo.quorumSize ?? '?'} verifiers · ≤${tierInfo.timeoutSeconds ?? '?'}s · from ${tierInfo.price} USDC` : undefined}>
            <select className="input" value={tier} onChange={(e) => (setTier(e.target.value), reset())}>
              <option value="">Auto ({effectiveTier})</option>
              {tiers.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label ?? x.id} — {x.price} USDC
                </option>
              ))}
            </select>
          </Field>
          <Field label="Topic">
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Any</option>
              <option value="math">Math</option>
              <option value="coding">Coding</option>
              <option value="history">History</option>
              <option value="general">General knowledge</option>
            </select>
          </Field>
          <Field label="Image (optional)" hint="PNG, JPEG, WebP or GIF up to 2 MB">
            <input className="input" type="file" accept={IMAGE_TYPES.join(',')} onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
          </Field>
        </div>

        {phase.kind === 'idle' && (
          <div>
            <Button type="submit" busy={busy} disabled={!question.trim()}>
              {t('ask.quote')}
            </Button>
          </div>
        )}
      </form>

      {phase.kind === 'quoted' && (
        <div className="callout info row between" style={{ marginTop: 16 }}>
          <div>
            <div className="eyebrow">Locked price</div>
            <strong className="num" style={{ fontSize: 22 }}>
              {fmtUsdc(phase.quote.amount)}
            </strong>{' '}
            {phase.quote.surgeMultiplier && phase.quote.surgeMultiplier !== 1 && <Badge tone="warn">surge ×{phase.quote.surgeMultiplier}</Badge>}
            <p className="small" style={{ margin: '4px 0 0' }}>
              Held in the escrow contract. Paid to the verifiers who agree — or refunded in full if they don't.
            </p>
          </div>
          <div className="row">
            <Button variant="ghost" onClick={reset}>
              {t('common.cancel')}
            </Button>
            <Button variant="signal" busy={busy} onClick={pay}>
              {t('ask.pay', { amount: fmtUsdc(phase.quote.amount) })}
            </Button>
          </div>
        </div>
      )}
      {phase.kind === 'paying' && <p className="callout info" style={{ marginTop: 16 }}>Waiting for your signature and the escrow deposit…</p>}
      {phase.kind === 'waiting' && (
        <div className="callout info" style={{ marginTop: 16 }}>
          <Badge tone="info" live>
            awaiting verifiers
          </Badge>{' '}
          <span className="small">
            Job <span className="mono">{phase.jobId}</span> · {phase.answers} answer(s) so far
          </span>
        </div>
      )}
      {phase.kind === 'done' && (
        <div className={`callout ${phase.job.outcome === 'resolved' ? 'good' : 'bad'}`} style={{ marginTop: 16 }}>
          {phase.job.outcome === 'resolved' ? (
            <>
              <div className="eyebrow">Answer · confidence {phase.job.confidence ?? '—'}</div>
              <div className="answer">
                <SafeText text={phase.job.answer} />
              </div>
            </>
          ) : (
            <p>Refunded — {phase.job.reason ?? 'the verifiers did not reach consensus'}.</p>
          )}
          <Button variant="ghost" size="sm" onClick={reset}>
            Ask another
          </Button>
        </div>
      )}
      {err && (
        <p className="callout bad small" role="alert" style={{ marginTop: 16 }}>
          {err}
        </p>
      )}
    </Panel>
  );
}
