/**
 * Plumbline status badge — dependency-free.
 *
 *   <div data-plumbline-status data-api-base="https://your-backend"></div>
 *   <script type="module" src="https://<host>/embed/status-badge.js"></script>
 *
 * Polls GET /stats and reports only reachability + verifiers online.
 * "Operational" means /stats answered AND at least one verifier is online.
 * Unreachable shows "status unavailable" — never a fake "operational".
 */

const COLORS = { ok: '#1f7a4d', degraded: '#a86400', unknown: '#7d786d' } as const;
const scriptBase = (document.currentScript as HTMLScriptElement | null)?.dataset.apiBase ?? null;

function mount(host: HTMLElement) {
  if (host.dataset.plumblineMounted) return;
  host.dataset.plumblineMounted = '1';
  const base = (host.dataset.apiBase ?? scriptBase ?? location.origin).replace(/\/+$/, '');
  const every = Number(host.dataset.interval ?? 60_000);
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');

  const render = (state: keyof typeof COLORS, text: string) => {
    const badge = document.createElement('span');
    badge.style.cssText = 'display:inline-flex;align-items:center;gap:6px;font:500 12px ui-monospace,monospace;padding:4px 10px;border:1px solid #d6cfc0;border-radius:999px';
    const dot = document.createElement('span');
    dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${COLORS[state]}`;
    badge.append(dot, document.createTextNode(`Plumbline: ${text}`));
    host.replaceChildren(badge);
  };

  const check = async () => {
    try {
      const res = await fetch(`${base}/stats`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const { onlineWorkers } = (await res.json()) as { onlineWorkers?: unknown };
      if (typeof onlineWorkers !== 'number') throw new Error('bad payload');
      if (onlineWorkers > 0) render('ok', `operational · ${onlineWorkers} online`);
      else render('degraded', 'no verifiers online');
    } catch {
      render('unknown', 'status unavailable');
    }
  };
  render('unknown', 'checking…');
  void check();
  setInterval(check, every);
}

const init = () => document.querySelectorAll<HTMLElement>('[data-plumbline-status],#arbiter-status').forEach(mount);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

export {};
