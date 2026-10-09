/**
 * Verify & earn — the verifier's desk (was "worker console").
 *
 *  connect -> (back up built-in key) -> one-time sponsored onboarding
 *          -> pick topics -> go online -> answer -> earnings accrue on-chain
 */
import { useCallback, useEffect, useState } from 'react';
import type { CategoryDemand, DispatchedQuestion } from '@plumbline/core';
import { explorerTxUrl } from '@plumbline/core';
import { BackupPanel, RestoreWallet } from '../components/LocalWalletCare.tsx';
import { ActivityLog, Badge, Button, Meter, PageHead, Panel } from '../components/ui.tsx';
import { WalletGate } from '../components/WalletGate.tsx';
import { api, errorMessage, isApiErrorKind } from '../lib/apiHelpers.ts';
import { config } from '../lib/config.ts';
import { useFlag } from '../lib/flags.ts';
import { consumeReferral, ONBOARDING_EXPERIMENT, onboardingVariant } from '../lib/growth.ts';
import { useDocumentTitle, usePolling } from '../lib/hooks.ts';
import { useI18n } from '../lib/i18n/index.tsx';
import type { MessageKey } from '../lib/i18n/en.ts';
import { scoped, useActivity } from '../lib/notify.ts';
import { useSession } from '../lib/session.tsx';
import { accountReadiness } from '../lib/soroban.ts';
import { store } from '../lib/storage.ts';
import { Earnings } from './verify/Earnings.tsx';
import { LedgerBook } from './verify/LedgerBook.tsx';
import { NotificationSettings } from './verify/Notifications.tsx';
import { QuestionCard, type ActiveQuestion } from './verify/QuestionCard.tsx';
import { useDispatch } from './verify/useDispatch.ts';

const TOPICS = ['math', 'coding', 'history', 'general'] as const;
const log = scoped('verify');

const PRACTICE: Array<{ question: string; expected: string; category: string }> = [
  { question: 'What is 12 × 12?', expected: '144', category: 'math' },
  { question: 'In which year did the Stellar network launch?', expected: '2014', category: 'history' },
  { question: 'What does this Rust return?\n```rust\nfn f() -> u8 { 2 + 2 }\n```', expected: '4', category: 'coding' },
  { question: 'What is the capital of Nigeria?', expected: 'Abuja', category: 'general' },
];

function Onboarding({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const s = useSession();
  const [busy, setBusy] = useState(false);
  const variant = onboardingVariant(s.address!);
  const copy = ONBOARDING_EXPERIMENT.variants[variant];

  const run = async () => {
    setBusy(true);
    try {
      log('Building the sponsored setup transaction…');
      const { xdr } = await api.sponsor.onboardBuild(s.address!, consumeReferral());
      log('Please sign in your wallet…');
      const signed = await s.sign(xdr);
      const { hash } = await api.sponsor.onboardSubmit(signed);
      log('Account ready — USDC trustline opened, and you spent zero XLM.', 'success', { href: explorerTxUrl(hash, config.network), toast: true });
      onDone();
    } catch (err) {
      log(`Setup failed: ${errorMessage(err)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel eyebrow="Step 2" title={t('onboard.title')}>
      <p>{copy?.body ?? t('onboard.body')}</p>
      <Button variant="signal" busy={busy} onClick={run}>
        {copy?.button ?? t('onboard.button')}
      </Button>
      <p className="hint" style={{ marginTop: 8 }} data-ab-variant={variant}>
        Experiment “{ONBOARDING_EXPERIMENT.id}”: variant {variant} (local only, nothing is reported).
      </p>
    </Panel>
  );
}

function TopicPicker({ value, onChange, demand }: { value: string[]; onChange: (v: string[]) => void; demand: CategoryDemand | null }) {
  const { t } = useI18n();
  const counts = demand ? Object.values(demand).filter(Number.isFinite) : [];
  const max = counts.length ? Math.max(...counts, 1) : 1;
  return (
    <fieldset>
      <legend className="label">
        {t('verify.topics')} <span className="faint">— {t('verify.topicsHint')}</span>
      </legend>
      <div className="topics">
        {TOPICS.map((topic) => {
          const n = demand && Number.isFinite(demand[topic]) ? demand[topic] : null;
          // Fewer verifiers online = more demand for you.
          const scarcity = n === null ? 0 : 1 - n / max;
          const level = scarcity >= 0.66 ? 'high' : scarcity >= 0.33 ? 'medium' : 'low';
          return (
            <label key={topic} className="topic">
              <span className="check">
                <input type="checkbox" checked={value.includes(topic)} onChange={(e) => onChange(e.target.checked ? [...value, topic] : value.filter((v) => v !== topic))} />
                {t(`topic.${topic}` as MessageKey)}
              </span>
              {n !== null && (
                <span className="topic-demand" data-level={level} title={t('demand.workers', { n })}>
                  <Meter value={scarcity} tone={level === 'high' ? 'signal' : undefined} />
                  {t(`demand.${level}` as MessageKey)}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export default function Verify() {
  const { t } = useI18n();
  useDocumentTitle(t('verify.title'));
  const s = useSession();
  const activity = useActivity('verify');
  const practiceEnabled = useFlag('practiceMode');
  const [ready, setReady] = useState<'checking' | 'needs-onboarding' | 'ready'>('checking');
  const [topics, setTopics] = useState<string[]>(() => store.getJson<string[]>('verify.topics', []));
  const [question, setQuestion] = useState<ActiveQuestion | null>(null);
  const [practice, setPractice] = useState(false);

  useEffect(() => store.setJson('verify.topics', topics), [topics]);

  // Demand heatmap: GET /categories/demand every 30s; hidden if unreachable.
  const { data: demand } = usePolling(() => api.categoryDemand(), 30_000);

  // Is the account set up to receive USDC?
  useEffect(() => {
    if (!s.address) return;
    setReady('checking');
    accountReadiness(s.address)
      .then((r) => setReady(r.hasUsdcTrustline ? 'ready' : 'needs-onboarding'))
      .catch((err) => {
        log(`Could not check your account (${errorMessage(err)}) — assuming setup is needed.`, 'warn');
        setReady('needs-onboarding');
      });
  }, [s.address]);

  const onQuestion = useCallback((q: DispatchedQuestion) => {
    const now = Date.now();
    setQuestion({ ...q, receivedAt: now, deadlineAt: now + q.expiresInMs });
    log(`New question: “${q.question.slice(0, 80)}${q.question.length > 80 ? '…' : ''}”`, 'info', { toast: true });
    if (document.visibilityState === 'hidden' && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('Plumbline — new question', { body: q.question.slice(0, 120), tag: `q-${q.questionId}` });
    }
  }, []);

  const dispatch = useDispatch({
    address: ready === 'ready' ? s.address : null,
    getToken: s.ensureSession,
    invalidateToken: s.invalidateSession,
    categories: topics,
    onQuestion,
    log,
  });

  const submitAnswer = async (answer: string): Promise<'ok' | 'retry' | 'closed'> => {
    const q = question!;
    if (q.practice) {
      const right = answer.trim().toLowerCase() === q.practice.expected.toLowerCase();
      log(right ? `Practice: “${answer}” would match the quorum.` : `Practice: the quorum would likely say “${q.practice.expected}”.`, right ? 'success' : 'warn', { toast: true });
      return 'ok';
    }
    // Retry transient network failures until the question's window closes.
    for (let attempt = 0; ; attempt++) {
      try {
        const token = await s.ensureSession();
        await api.workers.answer({ questionId: q.questionId, workerId: s.address!, answer, token });
        log(`Answer sent: “${answer}”.`, 'success');
        return 'ok';
      } catch (err) {
        if (isApiErrorKind(err, 'conflict')) {
          log('Too late — this question already closed, expired or was answered.', 'warn', { toast: true });
          return 'closed';
        }
        if (isApiErrorKind(err, 'unauthorized')) {
          s.invalidateSession();
          if (attempt === 0) continue; // re-sign once, then retry
        }
        const retryable = isApiErrorKind(err, 'network') || isApiErrorKind(err, 'timeout');
        if (retryable && Date.now() + 1500 < q.deadlineAt) {
          log('Network hiccup — retrying your answer…', 'warn');
          await new Promise((r) => setTimeout(r, 1200));
          continue;
        }
        log(`Answer not sent: ${errorMessage(err)}`, 'error');
        return 'retry';
      }
    }
  };

  const startPractice = () => {
    const p = PRACTICE[Math.floor(Math.random() * PRACTICE.length)];
    const now = Date.now();
    setQuestion({ questionId: `practice-${now}`, question: p.question, category: p.category, expiresInMs: 30_000, receivedAt: now, deadlineAt: now + 30_000, practice: { expected: p.expected } });
  };

  const statusText =
    dispatch.state === 'online'
      ? t('verify.online', { topics: topics.length ? topics.join(', ') : t('verify.allTopics') })
      : dispatch.state === 'reconnecting'
        ? t('verify.reconnecting', { n: dispatch.attempt })
        : dispatch.state === 'connecting'
          ? t('common.loading')
          : t('verify.offline');

  return (
    <div className="wrap page">
      <PageHead eyebrow="Verifiers" title={t('verify.title')} sub={t('verify.sub')}>
        <RestoreWallet />
      </PageHead>
      <WalletGate why="Your wallet address is your verifier identity. Earnings accrue to it on-chain.">
        <div className="stack">
          <BackupPanel />
          {ready === 'checking' && (
            <Panel>
              <p className="faint">Checking your account on Stellar…</p>
            </Panel>
          )}
          {ready === 'needs-onboarding' && <Onboarding onDone={() => setReady('ready')} />}
          {ready === 'ready' && (
            <div className="split">
              <div className="stack">
                {question && <QuestionCard key={question.questionId} q={question} onSubmit={submitAnswer} onDismiss={() => setQuestion(null)} />}
                <Panel
                  title={
                    <span className="row">
                      Dispatch
                      <Badge tone={dispatch.state === 'online' ? 'good' : dispatch.state === 'reconnecting' ? 'warn' : 'neutral'} live={dispatch.state === 'online'}>
                        {statusText}
                      </Badge>
                    </span>
                  }
                  action={
                    dispatch.state === 'offline' ? (
                      <Button variant="signal" onClick={() => void dispatch.goOnline()}>
                        {t('verify.goOnline')}
                      </Button>
                    ) : (
                      <Button variant="ghost" onClick={dispatch.goOffline}>
                        {t('verify.goOffline')}
                      </Button>
                    )
                  }
                >
                  <div className="stack">
                    <TopicPicker value={topics} onChange={setTopics} demand={demand} />
                    {practiceEnabled && (
                      <div className="row between callout info">
                        <div>
                          <strong>Practice mode</strong>
                          <p className="small" style={{ margin: 0 }}>
                            Try the answer flow on a sample question. Nothing touches the chain, your bond or your reputation.
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-pressed={practice}
                          onClick={() => {
                            setPractice(true);
                            startPractice();
                          }}
                        >
                          Try a sample question
                        </Button>
                      </div>
                    )}
                    <NotificationSettings categories={topics} log={log} />
                  </div>
                </Panel>
                <Earnings log={log} />
              </div>
              <div className="stack">
                <ActivityLog items={activity} />
                <LedgerBook />
              </div>
            </div>
          )}
        </div>
      </WalletGate>
    </div>
  );
}
