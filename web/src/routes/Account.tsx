/**
 * API account — the wallet-free on-ramp. Pay by card, get an API key, call
 * the oracle over plain HTTP. Holds: balance + top-up, webhook on
 * settlement, a test console, and copy-paste code snippets.
 *
 * Assumed backend contract (inherited from the original app, which made the
 * same assumptions): X-Api-Key header, /billing/account, /billing/checkout,
 * /billing/account/webhook. Missing endpoints degrade to a clear message.
 */
import { useEffect, useState } from 'react';
import { fromStroopsCompact, waitForSettlement, type CustomerAccount, type Job } from '@plumbline/core';
import { Button, CopyButton, Field, PageHead, Panel, Stat } from '../components/ui.tsx';
import { api, API_KEY_KEY, errorMessage, onUnauthorized } from '../lib/api.ts';
import { config } from '../lib/config.ts';
import { useDocumentTitle } from '../lib/hooks.ts';
import { useI18n } from '../lib/i18n/index.tsx';
import { store } from '../lib/storage.ts';

function GetKey() {
  const [email, setEmail] = useState('');
  const [amount, setAmount] = useState('10');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  return (
    <Panel title="New here? Get an API key" eyebrow="No wallet, no XLM, no faucet">
      <p className="muted">Pay by card, receive a key, and call the oracle over HTTP. Your key is shown once at the end of checkout — store it in a secrets manager.</p>
      <form
        className="grid cols-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMsg('');
          try {
            const { url } = await api.customer.checkout({ email, amount: Number(amount) });
            if (!url) throw new Error('checkout returned no redirect');
            location.href = url;
          } catch (err) {
            setMsg(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Email">
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="First top-up (USDC)">
          <input className="input num" type="number" min={1} step={1} required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <div style={{ alignSelf: 'end' }}>
          <Button type="submit" busy={busy}>
            Continue to checkout
          </Button>
        </div>
      </form>
      {msg && <p className="callout bad small">{msg}</p>}
    </Panel>
  );
}

function Snippets() {
  const curl = `curl -X POST ${config.backendUrl}/oracle \\
  -H "X-Api-Key: $PLUMBLINE_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"question":"Does Soroban allow re-entrant calls?","tier":"standard"}'
# -> 202 {"jobId":"…"}  then poll:
curl ${config.backendUrl}/oracle/<jobId>`;
  const js = `const res = await fetch('${config.backendUrl}/oracle', {
  method: 'POST',
  headers: { 'X-Api-Key': process.env.PLUMBLINE_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ question: 'Is 2^61-1 prime?', tier: 'standard' }),
});
const { jobId } = await res.json();`;
  const [tab, setTab] = useState<'curl' | 'js'>('curl');
  const code = tab === 'curl' ? curl : js;
  return (
    <Panel
      title="Call it from code"
      action={
        <div className="row">
          <div className="seg" role="tablist">
            <button role="tab" aria-selected={tab === 'curl'} onClick={() => setTab('curl')}>
              curl
            </button>
            <button role="tab" aria-selected={tab === 'js'} onClick={() => setTab('js')}>
              JavaScript
            </button>
          </div>
          <CopyButton text={code} />
        </div>
      }
    >
      <pre className="code-block">{code}</pre>
    </Panel>
  );
}

function Console() {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [msg, setMsg] = useState('');
  return (
    <Panel title="Test console" eyebrow="Billed from your credit">
      <form
        className="input-row"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setJob(null);
          setMsg('');
          try {
            const { jobId } = await api.oracle.askWithApiKey({ question: q.trim() });
            setMsg(`Job ${jobId} dispatched…`);
            setJob(await waitForSettlement(api, jobId, { onTick: (j) => setMsg(`Job ${jobId}: ${j.status} (${j.totalAnswers ?? 0} answers)`) }));
            setMsg('');
          } catch (err) {
            setMsg(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <input className="input" placeholder="Ask something…" value={q} onChange={(e) => setQ(e.target.value)} required />
        <Button type="submit" busy={busy}>
          Ask
        </Button>
      </form>
      {msg && <p className="faint small" style={{ marginTop: 8 }}>{msg}</p>}
      {job && <p className={`callout ${job.outcome === 'resolved' ? 'good' : 'bad'}`} style={{ marginTop: 12 }}>{job.outcome === 'resolved' ? job.answer : `Refunded — ${job.reason ?? 'no consensus'}`}</p>}
    </Panel>
  );
}

function Signed({ account, onLogout, reload }: { account: CustomerAccount; onLogout: () => void; reload: () => void }) {
  const { fmtUsdc } = useI18n();
  const [hook, setHook] = useState('');
  const [hookMsg, setHookMsg] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    api.customer
      .webhook()
      .then(({ url }) => {
        setHook(url ?? '');
        setHookMsg(url ? `Registered: ${url}` : 'No webhook registered.');
      })
      .catch((err) => setHookMsg(errorMessage(err)));
  }, []);

  return (
    <div className="stack">
      <Panel
        title="Account"
        action={
          <div className="row">
            <Button variant="ghost" size="sm" onClick={reload}>
              Refresh
            </Button>
            <Button variant="danger" size="sm" onClick={onLogout}>
              Sign out
            </Button>
          </div>
        }
      >
        <div className="grid cols-3">
          <Stat signal label="Credit" value={fmtUsdc(account.creditBalance)} note={`${account.creditBalanceStroops} stroops (${fromStroopsCompact(account.creditBalanceStroops)} exact)`} />
          <Stat label="Account id" value={<span className="mono small">{account.accountId}</span>} />
          <div style={{ alignSelf: 'end' }}>
            <Button
              busy={busy === 'topup'}
              onClick={async () => {
                setBusy('topup');
                try {
                  const { url } = await api.customer.checkout();
                  location.href = url;
                } catch (err) {
                  setHookMsg(`Top-up: ${errorMessage(err)}`);
                } finally {
                  setBusy('');
                }
              }}
            >
              Top up
            </Button>
          </div>
        </div>
      </Panel>
      <Panel title="Settlement webhook" eyebrow="We POST to you when a question settles">
        <div className="input-row">
          <input className="input mono" placeholder="https://example.com/hooks/plumbline" value={hook} onChange={(e) => setHook(e.target.value)} type="url" />
          <Button
            busy={busy === 'save'}
            onClick={async () => {
              try {
                const u = new URL(hook);
                if (u.protocol !== 'https:') throw new Error('webhooks must use https://');
              } catch (err) {
                return setHookMsg(err instanceof TypeError ? 'Enter a valid https:// URL.' : errorMessage(err));
              }
              setBusy('save');
              try {
                await api.customer.saveWebhook(hook);
                setHookMsg(`Saved — we'll call ${hook} on settlement.`);
              } catch (err) {
                setHookMsg(errorMessage(err));
              } finally {
                setBusy('');
              }
            }}
          >
            Save
          </Button>
          <Button
            variant="danger"
            busy={busy === 'del'}
            onClick={async () => {
              setBusy('del');
              try {
                await api.customer.deleteWebhook();
                setHook('');
                setHookMsg('Webhook removed.');
              } catch (err) {
                setHookMsg(errorMessage(err));
              } finally {
                setBusy('');
              }
            }}
          >
            Remove
          </Button>
        </div>
        {hookMsg && <p className="faint small" style={{ marginTop: 8 }}>{hookMsg}</p>}
      </Panel>
      <Console />
    </div>
  );
}

export default function Account() {
  useDocumentTitle('API account');
  const [key, setKey] = useState('');
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!store.get(API_KEY_KEY)) return;
    setBusy(true);
    try {
      setAccount(await api.customer.account());
      setMsg('');
    } catch (err) {
      setMsg(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
    return onUnauthorized((scope) => {
      if (scope === 'customer') {
        setAccount(null);
        setMsg('That API key was rejected — try again.');
      }
    });
  }, []);

  return (
    <div className="wrap page">
      <PageHead eyebrow="Developers" title="API account" sub="For apps and agents that want verified answers without touching a wallet." />
      <div className="split">
        <div className="stack">
          {account ? (
            <Signed
              account={account}
              reload={load}
              onLogout={() => {
                store.remove(API_KEY_KEY);
                setAccount(null);
              }}
            />
          ) : (
            <>
              <Panel title="Sign in with your API key">
                <form
                  className="input-row"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    store.set(API_KEY_KEY, key.trim());
                    setKey('');
                    await load();
                  }}
                >
                  <input id="customer-key" data-sensitive className="input mono" type="password" autoComplete="off" placeholder="pk_live_…" value={key} onChange={(e) => setKey(e.target.value)} required aria-label="API key" />
                  <Button type="submit" busy={busy}>
                    Sign in
                  </Button>
                </form>
                <p className="hint" style={{ marginTop: 8 }}>
                  Kept in this browser only; sign out to remove it.
                </p>
                {msg && <p className="callout bad small">{msg}</p>}
              </Panel>
              <GetKey />
            </>
          )}
        </div>
        <Snippets />
      </div>
    </div>
  );
}
