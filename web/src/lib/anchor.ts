/**
 * Cash-out to a bank through a Stellar anchor: SEP-10 web auth, then the
 * SEP-24 interactive withdrawal.
 *
 * This must run in the browser: the anchor only issues its token to the
 * account holder who signs the SEP-10 challenge, so the backend has no
 * authority to do it for the user.
 *
 * Flow: authenticate -> open the anchor's hosted KYC/bank form -> poll the
 * anchor until it says "send me the funds" -> (with explicit confirmation)
 * relay a withdraw_to() carrying the anchor's memo through the sponsored
 * fee-bump, or fall back to showing exact manual instructions.
 */
import type { AnchorConfig } from '@plumbline/core';
import { config } from './config.ts';

const POLL_MS = 3000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;
const READY = ['pending_user_transfer_start', 'completed', 'error', 'refunded', 'expired'];

export interface AnchorTx {
  id: string;
  status: string;
  amount_in?: string;
  amount_in_asset?: string;
  withdraw_anchor_account?: string;
  withdraw_memo?: string;
  withdraw_memo_type?: string;
  more_info_url?: string;
}

export async function sep10(anchor: AnchorConfig, address: string, sign: (xdr: string) => Promise<string>): Promise<string> {
  const u = new URL(anchor.webAuthEndpoint);
  u.searchParams.set('account', address);
  const challenge = await fetch(u);
  if (!challenge.ok) throw new Error(`the anchor refused the sign-in challenge (HTTP ${challenge.status})`);
  const { transaction } = (await challenge.json()) as { transaction: string };
  const signed = await sign(transaction);
  const verify = await fetch(anchor.webAuthEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction: signed }),
  });
  if (!verify.ok) throw new Error(`the anchor rejected the signed challenge (HTTP ${verify.status})`);
  return ((await verify.json()) as { token: string }).token;
}

export async function startWithdraw(anchor: AnchorConfig, jwt: string, address: string): Promise<{ url: string; id: string }> {
  const res = await fetch(`${anchor.transferServerSep24}/transactions/withdraw/interactive`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ asset_code: config.usdc.code, account: address }),
  });
  if (!res.ok) throw new Error(`the anchor rejected the withdrawal request (HTTP ${res.status})`);
  return res.json();
}

export async function waitForAnchor(anchor: AnchorConfig, jwt: string, id: string, onUpdate: (t: AnchorTx) => void, signal?: AbortSignal): Promise<AnchorTx> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let last = '';
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('cancelled');
    const u = new URL(`${anchor.transferServerSep24}/transaction`);
    u.searchParams.set('id', id);
    const res = await fetch(u, { headers: { Authorization: `Bearer ${jwt}` } });
    if (res.ok) {
      const { transaction } = (await res.json()) as { transaction: AnchorTx };
      if (transaction.status !== last) {
        last = transaction.status;
        onUpdate(transaction);
      }
      if (READY.includes(transaction.status)) return transaction;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error('timed out waiting for the anchor — you can resume from the anchor’s own site');
}

/** True only when the anchor gave us everything needed to pay it safely. */
export function canAutoRelay(t: AnchorTx): boolean {
  return !!t.withdraw_anchor_account && !!t.amount_in && Number(t.amount_in) > 0 && /^G[A-Z2-7]{55}$/.test(t.withdraw_anchor_account);
}
