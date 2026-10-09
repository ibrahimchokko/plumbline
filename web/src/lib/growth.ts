/**
 * Referral links and the onboarding-copy experiment.
 *
 * Referrals: an inbound ?ref=CODE is remembered and sent once with the
 * sponsored-onboarding request so the referring verifier gets credit.
 * Rewards are reputational only (a visible count), never USDC.
 *
 * Experiment: each address is deterministically assigned one onboarding
 * copy variant. This is scaffolding — nothing is reported anywhere until a
 * backend events endpoint exists; the assignment is only shown locally.
 */
import { pickVariant } from '@plumbline/core';
import { store } from './storage.ts';

const REF_KEY = 'referral.code';
const CODE_RE = /^[A-Za-z0-9_-]{4,32}$/;

export function captureReferral(search = typeof location !== 'undefined' ? location.search : '') {
  const code = new URLSearchParams(search).get('ref');
  if (code && CODE_RE.test(code)) store.set(REF_KEY, code);
}

export function consumeReferral(): string | null {
  const code = store.get(REF_KEY);
  store.remove(REF_KEY);
  return code && CODE_RE.test(code) ? code : null;
}

export const referralLink = (code: string) => `${location.origin}/verify?ref=${encodeURIComponent(code)}`;

export const ONBOARDING_EXPERIMENT = {
  id: 'onboarding-copy-v2',
  variants: {
    control: null,
    short: { body: 'Add USDC to your account to start earning. Free — we cover every fee.', button: 'Enable USDC (free)' },
    detailed: {
      body: 'To receive payouts your account needs a USDC trustline. Plumbline sponsors the account reserve and the network fee, so this costs nothing and needs no XLM. You sign one transaction; your key never leaves your wallet.',
      button: 'Set up account (sponsored)',
    },
  },
} as const;

export type OnboardingVariant = keyof typeof ONBOARDING_EXPERIMENT.variants;

export function onboardingVariant(address: string): OnboardingVariant {
  const names = Object.keys(ONBOARDING_EXPERIMENT.variants) as OnboardingVariant[];
  const key = `ab.${ONBOARDING_EXPERIMENT.id}.${address}`;
  const saved = store.get(key) as OnboardingVariant | null;
  if (saved && names.includes(saved)) return saved;
  const v = pickVariant(ONBOARDING_EXPERIMENT.id, names, address);
  store.set(key, v);
  return v;
}
