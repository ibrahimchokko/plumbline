import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { checkCompatibility, shortId } from '@plumbline/core';
import { api } from '../lib/api.ts';
import { brand, config } from '../lib/config.ts';
import { LOCALES, useI18n, type Locale } from '../lib/i18n/index.tsx';
import { clearInbox, dismissToast, markAllRead, removeNotice, useInbox, useToasts } from '../lib/notify.ts';
import { useSession } from '../lib/session.tsx';
import { store } from '../lib/storage.ts';
import { CHANGELOG } from '../changelog.ts';
import { Button, Modal } from './ui.tsx';

export function LogoMark() {
  return (
    <svg className="logo-mark" viewBox="0 0 24 24" aria-hidden="true">
      <line x1="12" y1="1" x2="12" y2="13" stroke="currentColor" strokeWidth="2" />
      <path d="M12 12 L17 17 L12 23 L7 17 Z" fill="var(--signal)" />
    </svg>
  );
}

function useOutside(ref: React.RefObject<HTMLElement>, onOut: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onOut();
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onOut();
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, [ref, onOut, active]);
}

function ThemeToggle() {
  const { t } = useI18n();
  const [theme, setTheme] = useState<string | null>(document.documentElement.dataset.theme ?? null);
  const next = () => {
    const isDark = theme === 'dark' || (theme === null && matchMedia('(prefers-color-scheme: dark)').matches);
    const value = isDark ? 'light' : 'dark';
    document.documentElement.dataset.theme = value;
    store.set('theme', value);
    try {
      localStorage.setItem('plumbline.theme', value);
    } catch {
      /* ignore */
    }
    setTheme(value);
  };
  return (
    <Button variant="ghost" className="icon" onClick={next} aria-label={t('theme.toggle')} title={t('theme.toggle')}>
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
      </svg>
    </Button>
  );
}

function Bell() {
  const { t, fmtTime } = useI18n();
  const items = useInbox();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false), open);
  const unread = items.filter((i) => !i.read).length;
  return (
    <div className="pop-anchor" ref={ref}>
      <Button
        variant="ghost"
        className="icon"
        aria-label={`${t('common.notifications')}${unread ? ` (${unread})` : ''}`}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open) markAllRead();
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 17V11a6 6 0 1 1 12 0v6l2 2H4z M10 21h4" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
        {unread > 0 && <span className="dot-count">{unread > 99 ? '99+' : unread}</span>}
      </Button>
      {open && (
        <div className="popover" role="dialog" aria-label={t('common.notifications')}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <strong>{t('common.notifications')}</strong>
            <Button variant="ghost" size="sm" onClick={clearInbox}>
              {t('common.clear')}
            </Button>
          </div>
          {items.length === 0 ? (
            <p className="faint small">{t('common.nothing')}</p>
          ) : (
            <ul className="list inbox">
              {items.map((n) => (
                <li key={n.id} className={n.read ? '' : 'unread'}>
                  <div className="break">
                    <time>{fmtTime(n.at)}</time>
                    {n.message}
                  </div>
                  <button className="star" aria-label="Dismiss" onClick={() => removeNotice(n.id)}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function WalletMenu() {
  const { t } = useI18n();
  const s = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false), open);

  if (!s.signer) {
    return (
      <div className="pop-anchor" ref={ref}>
        <Button variant="signal" busy={s.busy || s.restoring} onClick={() => setOpen(!open)} aria-expanded={open}>
          {t('wallet.connect')}
        </Button>
        {open && (
          <div className="popover stack tight">
            <Button
              block
              onClick={() => {
                setOpen(false);
                void s.connect('extension');
              }}
            >
              Freighter, xBull, Lobstr…
            </Button>
            <Button
              block
              variant="ghost"
              onClick={() => {
                setOpen(false);
                void s.connect('local');
              }}
            >
              {t('wallet.quick')}
            </Button>
            <p className="hint" style={{ margin: 0 }}>
              {t('wallet.quickNote')}
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="pop-anchor" ref={ref}>
      <Button variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open} title={s.signer.address}>
        <span className="badge good" style={{ padding: '2px 6px' }}>
          {s.signer.kind === 'local' ? 'local' : s.signer.label}
        </span>
        <span className="mono">{shortId(s.signer.address, 4, 4)}</span>
      </Button>
      {open && (
        <div className="popover stack tight">
          <div className="eyebrow">{t('wallet.active')}</div>
          {s.wallets.map((w) => (
            <div key={w.address} className="row between">
              <button className="btn ghost sm" aria-pressed={w.address === s.address} onClick={() => s.switchTo(w.address)} style={{ flex: 1, justifyContent: 'flex-start' }}>
                {w.address === s.address ? '● ' : '○ '}
                <span className="mono">{shortId(w.address, 5, 5)}</span>
                <span className="faint">{w.kind === 'local' ? 'built-in' : w.label}</span>
              </button>
              <Button variant="danger" size="sm" onClick={() => s.disconnect(w.address)} aria-label={`${t('wallet.disconnect')} ${w.address}`}>
                ×
              </Button>
            </div>
          ))}
          <hr style={{ margin: '6px 0' }} />
          <Button size="sm" variant="ghost" onClick={() => void s.connect('extension')}>
            + {t('wallet.add')}
          </Button>
          {!s.local && (
            <Button size="sm" variant="ghost" onClick={() => void s.connect('local')}>
              + {t('wallet.quick')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

const NAV = [
  ['/', 'nav.home'],
  ['/verify', 'nav.verify'],
  ['/ask', 'nav.ask'],
  ['/standings', 'nav.standings'],
  ['/account', 'nav.account'],
  ['/health', 'nav.health'],
  ['/control', 'nav.control'],
] as const;

function VersionBanner() {
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  useEffect(() => {
    api
      .health()
      .then((h) => {
        const reported = h.apiVersion ?? h.version;
        const c = checkCompatibility(config.backendCompat, reported);
        if (c === 'incompatible')
          setMsg({ bad: true, text: `This app was built for backend API v${config.backendCompat}, but the server reports v${reported}. Some features may fail.` });
        else if (c === 'older-minor')
          setMsg({ bad: false, text: `The server (v${reported}) is older than this app expects (v${config.backendCompat}); a few newer features may be unavailable.` });
      })
      .catch(() => {
        /* unreachable backend is surfaced by the screens themselves */
      });
  }, []);
  if (!msg) return null;
  return (
    <div className={`banner${msg.bad ? ' bad' : ''}`} role="status">
      {msg.text}{' '}
      <button className="btn ghost sm" onClick={() => setMsg(null)}>
        Dismiss
      </button>
    </div>
  );
}

function Toasts() {
  const toasts = useToasts();
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {toasts.map((n) => (
        <div key={n.id} className={`toast ${n.tone}`} role={n.tone === 'error' ? 'alert' : 'status'}>
          <span className="break">{n.message}</span>
          <button aria-label="Dismiss" onClick={() => dismissToast(n.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function WhatsNew() {
  const latest = CHANGELOG[0];
  const [show, setShow] = useState(() => !!latest && !!store.get('seenVersion') && store.get('seenVersion') !== latest.version);
  useEffect(() => {
    // First-ever visit: don't nag; just record the current version.
    if (latest && !store.get('seenVersion')) store.set('seenVersion', latest.version);
  }, [latest]);
  if (!show || !latest) return null;
  const close = () => {
    store.set('seenVersion', latest.version);
    setShow(false);
  };
  return (
    <Modal title={`What's new in ${latest.version}`} onClose={close}>
      <p className="faint small">{latest.date}</p>
      <ul>
        {latest.items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
      <Button onClick={close}>Got it</Button>
    </Modal>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { t, locale, setLocale } = useI18n();
  const [navOpen, setNavOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setNavOpen(false), [loc.pathname]);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        {t('app.skip')}
      </a>
      <VersionBanner />
      <header className="topbar">
        <div className="wrap topbar-inner">
          <NavLink to="/" className="logo" aria-label={`${brand.name} home`}>
            <LogoMark />
            {brand.name}
          </NavLink>
          <Button variant="ghost" className="icon nav-toggle" aria-expanded={navOpen} aria-controls="primary-nav" aria-label={t('nav.menu')} onClick={() => setNavOpen(!navOpen)}>
            ☰
          </Button>
          <nav id="primary-nav" className={`nav${navOpen ? ' open' : ''}`} aria-label="Primary">
            {NAV.map(([to, key]) => (
              <NavLink key={to} to={to} end={to === '/'}>
                {t(key)}
              </NavLink>
            ))}
          </nav>
          <div className="topbar-tools">
            <label>
              <span className="sr-only">{t('lang.label')}</span>
              <select className="input" style={{ minHeight: 38, width: 'auto', paddingBlock: 4 }} value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
                {Object.entries(LOCALES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
            <ThemeToggle />
            <Bell />
            <WalletMenu />
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <footer className="footer">
        <div className="wrap row between">
          <span>
            {brand.name} v{config.appVersion} · {config.network === 'public' ? 'Stellar mainnet' : 'Stellar testnet'} · Apache-2.0
          </span>
          <span className="row">
            <NavLink to="/live">{t('nav.live')}</NavLink>
            <NavLink to="/health">{t('nav.health')}</NavLink>
            <a href={brand.docsUrl}>Docs</a>
          </span>
        </div>
      </footer>
      <Toasts />
      <WhatsNew />
    </div>
  );
}
