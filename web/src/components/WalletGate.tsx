import type { ReactNode } from 'react';
import { useI18n } from '../lib/i18n/index.tsx';
import { useSession } from '../lib/session.tsx';
import { Button, Panel } from './ui.tsx';

/** Renders children only when a wallet is connected; otherwise a friendly connect card. */
export function WalletGate({ children, why }: { children: ReactNode; why?: string }) {
  const { t } = useI18n();
  const s = useSession();
  if (s.restoring) return <Panel><p className="faint">{t('common.loading')}</p></Panel>;
  if (s.signer) return <>{children}</>;
  return (
    <Panel className="ink" eyebrow="Step 1" title={t('wallet.needed')}>
      {why && <p className="muted">{why}</p>}
      <div className="row" style={{ marginTop: 16 }}>
        <Button variant="signal" busy={s.busy} onClick={() => void s.connect('extension')}>
          {t('wallet.connect')}
        </Button>
        <Button variant="ghost" style={{ color: 'inherit', borderColor: 'currentColor' }} busy={s.busy} onClick={() => void s.connect('local')}>
          {t('wallet.quick')}
        </Button>
      </div>
      <p className="muted small" style={{ marginTop: 12, marginBottom: 0 }}>
        {t('wallet.quickNote')}
      </p>
    </Panel>
  );
}
