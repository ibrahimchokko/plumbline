/**
 * Everything to do with keeping the built-in wallet safe:
 *   - one-time backup (reveal / copy) then "lock" the key for good,
 *   - optional device unlock (passkey / fingerprint) before revealing,
 *   - social recovery: split the key into k-of-n shares to hand out,
 *   - restore a wallet from a secret key or from recovery shares.
 * Splitting and combining happen entirely in this browser.
 */
import { useState } from 'react';
import { combineShares, splitSecret } from '@plumbline/core';
import { errorMessage } from '../lib/api.ts';
import { useFlag } from '../lib/flags.ts';
import { useI18n } from '../lib/i18n/index.tsx';
import { notify } from '../lib/notify.ts';
import { useSession } from '../lib/session.tsx';
import { store } from '../lib/storage.ts';
import { Button, CopyButton, Field, Modal, Panel } from './ui.tsx';

const CRED_KEY = 'local.passkey';
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function enrollPasskey(): Promise<boolean> {
  if (!window.PublicKeyCredential) return false;
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: rand(32),
      rp: { name: 'Plumbline' },
      user: { id: rand(16), name: 'built-in-wallet', displayName: 'Plumbline built-in wallet' },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) return false;
  store.set(CRED_KEY, b64(cred.rawId));
  return true;
}

/** A local presence check (not a cryptographic key guard — the worker is). */
async function verifyPasskey(): Promise<boolean> {
  const id = store.get(CRED_KEY);
  if (!id || !window.PublicKeyCredential) return true; // not enrolled -> no gate
  try {
    await navigator.credentials.get({ publicKey: { challenge: rand(32), allowCredentials: [{ type: 'public-key', id: unb64(id) }], userVerification: 'required', timeout: 60_000 } });
    return true;
  } catch {
    return false;
  }
}

export function BackupPanel() {
  const { t } = useI18n();
  const { local } = useSession();
  const [secret, setSecret] = useState<string | null>(null);
  const [locking, setLocking] = useState(false);
  const [hidden, setHidden] = useState(false);
  const socialRecovery = useFlag('socialRecovery');
  const [sharesOpen, setSharesOpen] = useState(false);

  if (!local || local.state !== 'pending-backup' || hidden) return null;

  const reveal = async () => {
    if (secret) return setSecret(null);
    if (!(await verifyPasskey())) return notify('Device check failed — secret not shown.', { tone: 'warn', scope: 'wallet' });
    setSecret(await local.exportSecret());
  };

  return (
    <Panel className="callout" title={t('backup.title')}>
      <p>{t('backup.body')}</p>
      <div className="input-row" style={{ marginBottom: 12 }}>
        <input id="backup-secret" data-sensitive className="input mono" readOnly type={secret ? 'text' : 'password'} value={secret ?? '••••••••••••••••••••••••••••••••••••••••••••••••••••••••'} aria-label="Built-in wallet secret key" />
        <Button variant="ghost" onClick={reveal} aria-pressed={!!secret}>
          {secret ? t('backup.hide') : t('backup.reveal')}
        </Button>
        {secret && <CopyButton text={secret} label={t('backup.copy')} size="md" />}
      </div>
      <div className="row">
        <Button
          busy={locking}
          onClick={async () => {
            setLocking(true);
            try {
              await local.lockExport();
              setSecret(null);
              setHidden(true);
              notify('Backup confirmed. The key is now locked in this browser and can never be exported again.', { tone: 'success', scope: 'wallet' });
            } finally {
              setLocking(false);
            }
          }}
        >
          {t('backup.done')}
        </Button>
        {socialRecovery && (
          <Button variant="ghost" onClick={() => setSharesOpen(true)}>
            Split into recovery shares
          </Button>
        )}
        {window.PublicKeyCredential && !store.get(CRED_KEY) && (
          <Button
            variant="ghost"
            onClick={async () => {
              try {
                if (await enrollPasskey()) notify('Device unlock enabled for revealing the key.', { tone: 'success', scope: 'wallet' });
              } catch (e) {
                notify(`Could not enable device unlock: ${errorMessage(e)}`, { tone: 'warn', scope: 'wallet' });
              }
            }}
          >
            Require fingerprint / passkey to reveal
          </Button>
        )}
      </div>
      {sharesOpen && <SplitDialog onClose={() => setSharesOpen(false)} />}
    </Panel>
  );
}

function SplitDialog({ onClose }: { onClose: () => void }) {
  const { local } = useSession();
  const [k, setK] = useState(2);
  const [n, setN] = useState(3);
  const [shares, setShares] = useState<string[]>([]);
  const [err, setErr] = useState('');

  const split = async () => {
    setErr('');
    try {
      if (!(await verifyPasskey())) throw new Error('device check failed');
      const secret = await local?.exportSecret();
      if (!secret) throw new Error('the key is already locked and can no longer be split');
      setShares(splitSecret(secret, k, n));
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  return (
    <Modal title="Social recovery shares" onClose={onClose}>
      <p className="muted small">
        Your key is split here, in this browser. Give each share to a different person or place (a friend, a second device, a password manager). Any{' '}
        <strong>{k}</strong> of the <strong>{n}</strong> shares rebuild the wallet — fewer reveal nothing about it.
      </p>
      <div className="grid cols-2" style={{ marginBottom: 12 }}>
        <Field label="Shares needed (threshold)">
          <input className="input" type="number" min={2} max={n} value={k} onChange={(e) => setK(Math.max(2, Math.min(n, Number(e.target.value))))} />
        </Field>
        <Field label="Total shares">
          <input className="input" type="number" min={k} max={10} value={n} onChange={(e) => setN(Math.max(k, Math.min(10, Number(e.target.value))))} />
        </Field>
      </div>
      <div className="row">
        <Button onClick={split}>Create shares</Button>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      {err && <p className="callout bad small" style={{ marginTop: 12 }}>{err}</p>}
      {shares.length > 0 && (
        <div className="share-list" style={{ marginTop: 16 }}>
          {shares.map((s, i) => (
            <div key={s}>
              <div className="row between small">
                <strong>Share {i + 1}</strong>
                <CopyButton text={s} />
              </div>
              <code data-sensitive>{s}</code>
            </div>
          ))}
          <p className="hint">Each share has a built-in checksum, so a typo is caught when you restore.</p>
        </div>
      )}
    </Modal>
  );
}

/** Restore the built-in wallet from a secret key or recovery shares. */
export function RestoreWallet() {
  const s = useSession();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'secret' | 'shares'>('shares');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const restore = async () => {
    setErr('');
    setBusy(true);
    try {
      const secret = mode === 'secret' ? text.trim() : combineShares(text.split(/\s+/).filter(Boolean));
      const local = s.local ?? (await (await import('../lib/wallet/localWallet.ts')).openLocalWallet());
      if (local.state !== 'pending-backup' && !confirm('This replaces the built-in wallet currently in this browser. Its funds stay on-chain but you will need its own backup to use it again. Continue?')) return;
      await local.restore(secret);
      s.replaceLocal(local);
      notify(`Wallet restored: ${local.address.slice(0, 6)}…${local.address.slice(-6)}`, { tone: 'success', scope: 'wallet' });
      setOpen(false);
      setText('');
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Restore a built-in wallet
      </Button>
      {open && (
        <Modal title="Restore a built-in wallet" onClose={() => setOpen(false)}>
          <div className="seg" role="tablist" style={{ marginBottom: 12 }}>
            <button role="tab" aria-selected={mode === 'shares'} onClick={() => setMode('shares')}>
              From recovery shares
            </button>
            <button role="tab" aria-selected={mode === 'secret'} onClick={() => setMode('secret')}>
              From secret key
            </button>
          </div>
          <Field label={mode === 'shares' ? 'Paste the shares, one per line' : 'Secret key (starts with S)'}>
            <textarea className="input mono" data-sensitive value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} autoComplete="off" />
          </Field>
          {err && <p className="callout bad small">{err}</p>}
          <div className="row" style={{ marginTop: 12 }}>
            <Button busy={busy} onClick={restore} disabled={!text.trim()}>
              Restore
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
