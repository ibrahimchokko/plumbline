/**
 * Opt-in error reporting. A complete no-op unless VITE_SENTRY_DSN is set,
 * and the SDK is loaded lazily so it never weighs down the default bundle.
 * Every event and breadcrumb is scrubbed of keys, tokens, addresses and
 * recovery shares before it leaves the browser. Respects Do Not Track and
 * Global Privacy Control.
 */
import { scrubString, scrubValue } from '@plumbline/core';
import { config } from './config.ts';

const SENSITIVE_SELECTORS = ['[data-sensitive]', '#backup-secret', '#control-token', '#customer-key'];


export function initTelemetry(): void {
  if (!config.sentryDsn) return;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  if (nav.doNotTrack === '1' || nav.globalPrivacyControl === true) return;

  // Dynamic import: emitted as its own chunk, downloaded only when a DSN is set.
  import('@sentry/browser')
    .then((Sentry) => {
      Sentry.init({
        dsn: config.sentryDsn,
        release: `plumbline-web@${config.appVersion}`,
        environment: import.meta.env.MODE,
        sendDefaultPii: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        beforeSend(event: any) {
          if (event.request) {
            delete event.request.headers;
            delete event.request.cookies;
            delete event.request.data;
            if (event.request.url) event.request.url = scrubString(event.request.url.split('#')[0]);
          }
          delete event.user;
          return scrubValue(event);
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        beforeBreadcrumb(crumb: any) {
          const target = String(crumb?.data?.target ?? crumb?.message ?? '');
          if (crumb?.category === 'ui.input') return null;
          if (SENSITIVE_SELECTORS.some((s) => target.includes(s.replace(/[[\]#]/g, '')))) return null;
          return scrubValue(crumb);
        },
      });
    })
    .catch(() => {
      /* reporting must never break the app */
    });
}
