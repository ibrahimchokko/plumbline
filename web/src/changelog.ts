/** Hand-written per release, newest first. Bumping the top `version` shows
 * a one-time "what's new" dialog to returning visitors. */
export const CHANGELOG = [
  {
    version: '1.0.0',
    date: '2026-10-09',
    items: [
      'One app, one wallet connection: verify, ask, standings and your account all share a single session.',
      'Ask questions straight from the browser — get a locked price, pay with zero XLM, watch it settle live.',
      'Staking actually stakes now, and withdrawals can be partial or sent to another address.',
      'Split your built-in wallet key into recovery shares, or restore it from a backup.',
      'Practice mode, answer drafts, live topic demand and automatic reconnects for verifiers.',
    ],
  },
] as const;
