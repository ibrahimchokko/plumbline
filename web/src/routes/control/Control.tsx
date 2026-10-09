/** Control room — the operator console (was "admin"). Bearer-token gated, read-mostly. */
import { useEffect, useState } from 'react';
import { AdminGate } from '../../components/AdminGate.tsx';
import { Button, PageHead } from '../../components/ui.tsx';
import { useDocumentTitle } from '../../lib/hooks.ts';
import { store } from '../../lib/storage.ts';
import { Askers, Kyc, Network, Overview, Payouts, Pools, Transactions, Treasury, Trust, Verifiers } from './views.tsx';

const VIEWS = {
  overview: ['Overview', Overview],
  transactions: ['Transactions', Transactions],
  verifiers: ['Verifiers', Verifiers],
  askers: ['Askers', Askers],
  pools: ['Pools', Pools],
  treasury: ['Fees & treasury', Treasury],
  trust: ['Trust', Trust],
  kyc: ['KYC', Kyc],
  payouts: ['Payouts', Payouts],
  network: ['Network', Network],
} as const;
type ViewId = keyof typeof VIEWS;

export default function Control() {
  useDocumentTitle('Control room');
  const initial = (location.hash.slice(1) as ViewId) in VIEWS ? (location.hash.slice(1) as ViewId) : 'overview';
  const [view, setView] = useState<ViewId>(initial);
  const [compact, setCompact] = useState(store.get('control.density') === 'compact');

  useEffect(() => {
    history.replaceState(null, '', `#${view}`);
  }, [view]);

  const [, Comp] = VIEWS[view];
  return (
    <div className="wrap page">
      <PageHead eyebrow="Operators" title="Control room" sub="Money in, money out, and who is answering. Read-only except pool whitelists.">
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={compact}
          onClick={() => {
            store.set('control.density', compact ? 'comfortable' : 'compact');
            setCompact(!compact);
          }}
        >
          {compact ? 'Comfortable rows' : 'Compact rows'}
        </Button>
      </PageHead>
      <AdminGate>
        {(signOut) => (
          <div className={`control-layout${compact ? ' compact' : ''}`}>
            <nav className="sidenav" aria-label="Control room sections">
              {(Object.keys(VIEWS) as ViewId[]).map((id) => (
                <button key={id} aria-current={view === id} onClick={() => setView(id)}>
                  {VIEWS[id][0]}
                </button>
              ))}
              <button onClick={signOut} style={{ color: 'var(--bad)' }}>
                Sign out
              </button>
            </nav>
            <div>
              <Comp key={view} />
            </div>
          </div>
        )}
      </AdminGate>
    </div>
  );
}
