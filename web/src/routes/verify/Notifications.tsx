import { useEffect, useState } from 'react';
import { Button, Field } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { useFlag } from '../../lib/flags.ts';
import { disablePush, enablePush, existingSubscription, pushSupported } from '../../lib/push.ts';
import { useSession } from '../../lib/session.tsx';

type Log = (m: string, tone?: 'info' | 'success' | 'warn' | 'error') => void;

/**
 * Push supplements the open tab for longer-window questions (~20s+); a
 * notification round-trip is too slow for the fastest tier. The state is
 * read from the browser on load, so a reload no longer shows "Off" while a
 * subscription is actually active (a bug in the original).
 */
export function NotificationSettings({ categories, log }: { categories: string[]; log: Log }) {
  const s = useSession();
  const enabled = useFlag('pushNotifications');
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [digest, setDigest] = useState<'instant' | 'daily' | 'weekly'>('instant');
  const [digestMsg, setDigestMsg] = useState('');

  useEffect(() => {
    existingSubscription().then((sub) => setOn(!!sub));
  }, []);

  if (!enabled) return null;

  return (
    <div className="grid cols-2">
      <div className="stack tight">
        <span className="label">Push notifications</span>
        <p className="faint small" style={{ margin: 0 }}>
          {!pushSupported() ? 'This browser does not support push.' : on ? 'On — you may be pinged for longer-window questions.' : 'Off — you only get questions while this tab is open.'}
        </p>
        <div>
          <Button
            variant="ghost"
            size="sm"
            busy={busy}
            disabled={!pushSupported()}
            onClick={async () => {
              setBusy(true);
              try {
                if (on) {
                  await disablePush();
                  setOn(false);
                  log('Push notifications turned off for this browser.');
                } else {
                  const token = await s.ensureSession();
                  await enablePush(s.address!, token, categories);
                  setOn(true);
                  log('Push notifications enabled.', 'success');
                }
              } catch (err) {
                log(`Push: ${errorMessage(err)}`, 'warn');
              } finally {
                setBusy(false);
              }
            }}
          >
            {on ? 'Turn off' : 'Enable'}
          </Button>
        </div>
      </div>
      <Field label="Digest (needs server support)" hint={digestMsg || 'Instant pushes, or a daily/weekly summary of questions you missed.'}>
        <select
          className="input"
          value={digest}
          onChange={async (e) => {
            const v = e.target.value as typeof digest;
            setDigest(v);
            try {
              const token = await s.ensureSession();
              await api.workers.setDigest(s.address!, token, v);
              setDigestMsg(`Saved: ${v}.`);
            } catch (err) {
              setDigestMsg(errorMessage(err));
            }
          }}
        >
          <option value="instant">Instant</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
      </Field>
    </div>
  );
}
