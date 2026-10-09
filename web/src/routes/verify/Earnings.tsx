/**
 * Earnings & bond.
 *
 * Matching answers are CREDITED on-chain (an accrued "owed" balance), not
 * paid out one question at a time; withdrawing sweeps it in one transaction
 * whenever the verifier chooses. Staking is an optional credibility bond —
 * answers that lose a quorum vote forfeit a small slice of it.
 *
 * Fixed vs. the original: the Stake button there ran leftover wallet-connect
 * code and never staked anything. Withdrawals were all-or-nothing; they can
 * now be partial, and sent to another address with a full checksum check.
 */
import { useState } from 'react';
import { fromStroopsCompact, percent, toStroops, explorerTxUrl } from '@plumbline/core';
import { Button, Field, Panel, Stat } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { canAutoRelay, sep10, startWithdraw, waitForAnchor } from '../../lib/anchor.ts';
import { config } from '../../lib/config.ts';
import { referralLink } from '../../lib/growth.ts';
import { copyText, usePolling } from '../../lib/hooks.ts';
import { useI18n } from '../../lib/i18n/index.tsx';
import { useSession } from '../../lib/session.tsx';
import { buildStakeXdr, buildWithdrawToXdr, buildWithdrawXdr, isValidAccountId } from '../../lib/soroban.ts';

type Log = (m: string, tone?: 'info' | 'success' | 'warn' | 'error', extra?: { href?: string; toast?: boolean }) => void;

export function Earnings({ log }: { log: Log }) {
  const { t, fmtUsdc } = useI18n();
  const s = useSession();
  const address = s.address!;
  const { data, refresh } = usePolling(
    async () => {
      const [owed, stake, rep] = await Promise.allSettled([api.workers.owed(address), api.workers.stake(address), api.workers.reputation(address)]);
      return {
        owed: owed.status === 'fulfilled' ? owed.value : null,
        stake: stake.status === 'fulfilled' ? stake.value : null,
        rep: rep.status === 'fulfilled' ? rep.value : null,
      };
    },
    20_000,
    [address],
  );

  const [beneficiary, setBeneficiary] = useState('');
  const [withdrawAmt, setWithdrawAmt] = useState('');
  const [stakeAmt, setStakeAmt] = useState('');
  const [busy, setBusy] = useState<'' | 'withdraw' | 'stake' | 'bank'>('');
  const [bankStatus, setBankStatus] = useState('');

  const owedStroops = BigInt(data?.owed?.owedStroops ?? '0');
  const rep = data?.rep;
  const total = rep?.totalAnswers ?? rep?.total ?? 0;

  async function relayWithdraw(amountStroops: bigint, to: string | null, memo?: { type?: string; value: string } | null) {
    const xdr = to ? await buildWithdrawToXdr(address, to, amountStroops, memo) : await buildWithdrawXdr(address, amountStroops);
    const signed = await s.sign(xdr);
    const token = await s.ensureSession().catch(() => undefined);
    return api.sponsor.withdraw({ xdr: signed, workerAddress: address, amountStroops: amountStroops.toString(), ...(to ? { beneficiaryAddress: to } : {}), ...(token ? { token } : {}) });
  }

  const withdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('withdraw');
    try {
      const to = beneficiary.trim() || null;
      if (to && !(await isValidAccountId(to))) throw new Error('that payout address is not a valid Stellar account (G…)');
      const fresh = await api.workers.owed(address);
      const available = BigInt(fresh.owedStroops);
      if (available <= 0n) throw new Error('nothing has accrued yet');
      const amount = withdrawAmt.trim() ? toStroops(withdrawAmt) : available;
      if (amount > available) throw new Error(`you can withdraw at most ${fromStroopsCompact(available)} USDC`);
      log(`Building a withdrawal of ${fromStroopsCompact(amount)} USDC…`);
      const { hash } = await relayWithdraw(amount, to);
      log(`Withdrew ${fromStroopsCompact(amount)} USDC${to ? ` to ${to.slice(0, 6)}…` : ''}.`, 'success', { href: explorerTxUrl(hash, config.network), toast: true });
      setWithdrawAmt('');
      await refresh();
    } catch (err) {
      log(`Withdrawal failed: ${errorMessage(err)}`, 'error');
    } finally {
      setBusy('');
    }
  };

  const stake = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('stake');
    try {
      const amount = toStroops(stakeAmt);
      if (amount <= 0n) throw new Error('enter an amount above zero');
      log(`Building a bond of ${fromStroopsCompact(amount)} USDC…`);
      const xdr = await buildStakeXdr(address, amount);
      const signed = await s.sign(xdr);
      const token = await s.ensureSession().catch(() => undefined);
      const { hash } = await api.sponsor.stake({ xdr: signed, workerAddress: address, amountStroops: amount.toString(), ...(token ? { token } : {}) });
      log(`Bond increased by ${fromStroopsCompact(amount)} USDC.`, 'success', { href: explorerTxUrl(hash, config.network), toast: true });
      setStakeAmt('');
      await refresh();
    } catch (err) {
      log(`Staking failed: ${errorMessage(err)}`, 'error');
    } finally {
      setBusy('');
    }
  };

  const cashOut = async () => {
    setBusy('bank');
    setBankStatus('');
    try {
      const anchor = await api.anchor.config();
      if (!anchor) throw new Error('this server has no bank partner (anchor) configured');
      setBankStatus('Signing in with the bank partner (one signature)…');
      const jwt = await sep10(anchor, address, s.sign);
      setBankStatus('Opening the partner’s withdrawal form in a new window…');
      const { url, id } = await startWithdraw(anchor, jwt, address);
      window.open(url, 'plumbline-anchor', 'width=480,height=720');
      setBankStatus('Finish the form in the new window. Waiting for the partner…');
      const tx = await waitForAnchor(anchor, jwt, id, (x) => setBankStatus(`Partner status: ${x.status.replace(/_/g, ' ')}`));
      const token = await s.ensureSession().catch(() => '');
      void api.anchor.report({ address, token, kind: 'withdrawal', status: tx.status, amount: tx.amount_in ?? null, assetCode: tx.amount_in_asset ?? null, anchorTransactionId: tx.id });

      if (tx.status === 'pending_user_transfer_start') {
        let prefix = '';
        if (canAutoRelay(tx) && confirm(`Send ${tx.amount_in} ${config.usdc.code} to the bank partner now to complete this cash-out?`)) {
          try {
            await relayWithdraw(toStroops(tx.amount_in!), tx.withdraw_anchor_account!, tx.withdraw_memo ? { type: tx.withdraw_memo_type || 'text', value: tx.withdraw_memo } : null);
            setBankStatus('Payment sent. The partner will confirm and pay out to your bank.');
            log('Cash-out payment sent to the bank partner.', 'success', { toast: true });
            await refresh();
            return;
          } catch (err) {
            prefix = `Automatic transfer failed (${errorMessage(err)}). `;
          }
        }
        setBankStatus(
            `${prefix}Send ${tx.amount_in} ${config.usdc.code} to ${tx.withdraw_anchor_account}${tx.withdraw_memo ? ` with memo "${tx.withdraw_memo}"` : ''} to complete this withdrawal.`,
        );
      } else {
        setBankStatus(tx.status === 'completed' ? 'Cash-out completed by the partner.' : `Partner reported: ${tx.status}`);
      }
    } catch (err) {
      setBankStatus(`Bank cash-out failed: ${errorMessage(err)}`);
    } finally {
      setBusy('');
    }
  };

  return (
    <Panel title={t('earn.title')} action={<Button variant="ghost" size="sm" onClick={refresh}>{t('common.refresh')}</Button>}>
      <div className="grid cols-3" style={{ marginBottom: 20 }}>
        <Stat signal label={t('earn.accrued')} value={fmtUsdc(data?.owed?.owed ?? 0)} />
        <Stat label={t('earn.bond')} value={fmtUsdc(data?.stake?.stake ?? 0)} />
        <Stat
          label={t('earn.trackRecord')}
          value={total ? percent(rep?.matchRatio ?? null, 0) : '—'}
          note={total ? t('earn.matched', { matched: rep?.matched ?? 0, total, pct: percent(rep?.matchRatio ?? null, 0) }) : t('earn.noAnswers')}
        />
      </div>

      <div className="grid cols-2">
        <form className="stack tight" onSubmit={withdraw}>
          <h3>{t('earn.withdraw')}</h3>
          <Field label="Amount (blank = everything)" hint={owedStroops > 0n ? `Available: ${fromStroopsCompact(owedStroops)} USDC` : 'Nothing to withdraw yet.'}>
            <input className="input num" inputMode="decimal" placeholder={fromStroopsCompact(owedStroops)} value={withdrawAmt} onChange={(e) => setWithdrawAmt(e.target.value)} />
          </Field>
          <Field label={t('earn.payTo')} hint="e.g. an exchange deposit address or a cold wallet. Leave blank for your own address.">
            <input id="withdraw-to" data-sensitive className="input mono" placeholder="G…" value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} spellCheck={false} />
          </Field>
          <div className="row">
            <Button type="submit" busy={busy === 'withdraw'} disabled={owedStroops <= 0n}>
              {t('earn.withdraw')}
            </Button>
            <Button variant="ghost" busy={busy === 'bank'} onClick={cashOut}>
              {t('earn.withdrawBank')}
            </Button>
          </div>
          {bankStatus && (
            <p className="callout info small break" role="status">
              {bankStatus}
            </p>
          )}
        </form>

        <form className="stack tight" onSubmit={stake}>
          <h3>{t('earn.stake')}</h3>
          <Field label="Amount in USDC" hint="Optional. A bond signals you stand behind your answers; answers that lose a quorum vote forfeit a small slice. Verifiers who never stake are never slashed.">
            <input className="input num" inputMode="decimal" placeholder="5.00" value={stakeAmt} onChange={(e) => setStakeAmt(e.target.value)} required />
          </Field>
          <div>
            <Button type="submit" busy={busy === 'stake'} disabled={!stakeAmt.trim()}>
              {t('earn.stake')}
            </Button>
          </div>
        </form>
      </div>
      <hr />
      <Referral log={log} />
    </Panel>
  );
}

function Referral({ log }: { log: Log }) {
  const s = useSession();
  const [link, setLink] = useState('');
  const [stats, setStats] = useState('');
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try {
      const token = await s.ensureSession();
      const { code } = await api.workers.createReferral(s.address!, token);
      const url = referralLink(code);
      setLink(url);
      if (await copyText(url)) log('Referral link copied to your clipboard.', 'success', { toast: true });
      const st = await api.workers.referralStats(s.address!, token).catch(() => null);
      if (st) setStats(`${st.referred} referred · ${st.established} reached established status`);
    } catch (err) {
      log(`Could not create a referral link: ${errorMessage(err)}`, 'warn');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="row between">
      <div>
        <h3 style={{ marginBottom: 4 }}>Invite other verifiers</h3>
        <p className="faint small" style={{ margin: 0 }}>
          {stats || 'Credit is reputational (a public count), never a USDC reward.'}
        </p>
      </div>
      {link ? <input className="input mono" readOnly value={link} style={{ maxWidth: 360 }} onFocus={(e) => e.target.select()} /> : <Button variant="ghost" busy={busy} onClick={make}>Get referral link</Button>}
    </div>
  );
}
