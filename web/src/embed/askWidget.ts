/**
 * Plumbline "ask" widget — dependency-free, embeddable on any site.
 *
 *   <div data-plumbline-ask data-api-base="https://your-backend"></div>
 *   <script type="module" src="https://<host>/embed/ask-widget.js"></script>
 *
 * Sandbox only: POST /oracle/sandbox then poll GET /oracle/:jobId. No
 * payment, no chain, no signup. Rendered inside a Shadow DOM so the host
 * page's CSS can't break it (and ours can't leak out). All server text is
 * set with textContent, never innerHTML. `data-arbiter-widget` containers
 * from the original project are picked up too.
 */

const CSS = `
:host{all:initial}
.w{font:14px/1.45 system-ui,sans-serif;border:1px solid #1b1a17;border-radius:8px;padding:14px;max-width:440px;background:#fbf9f4;color:#1b1a17;box-shadow:4px 4px 0 #1b1a17}
.n{font:500 10px/1.2 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;opacity:.6;margin:0 0 8px}
form{display:flex;gap:6px}
input{flex:1;min-width:0;padding:8px 10px;border:1px solid #d6cfc0;border-radius:4px;font:inherit;background:#fff;color:inherit}
button{padding:8px 14px;border:0;border-radius:4px;background:#e8590c;color:#fff;font:600 14px system-ui,sans-serif;cursor:pointer}
button:disabled{opacity:.5;cursor:default}
.r{margin-top:10px;min-height:1.4em}
.s{font:500 10px ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase}
.ok .s{color:#1f7a4d}.bad .s{color:#b42318}
.a{font:500 17px/1.35 Georgia,serif;margin-top:4px}
@media (prefers-color-scheme:dark){.w{background:#1c1b17;color:#ece6d9;border-color:#ece6d9;box-shadow:4px 4px 0 #ece6d9}input{background:#141310;border-color:#34312a}}
`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const scriptBase = (document.currentScript as HTMLScriptElement | null)?.dataset.apiBase ?? null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props);
}

function mount(host: HTMLElement) {
  if (host.dataset.plumblineMounted) return;
  host.dataset.plumblineMounted = '1';
  const base = (host.dataset.apiBase ?? scriptBase ?? location.origin).replace(/\/+$/, '');
  const root = host.attachShadow({ mode: 'open' });
  const style = el('style', { textContent: CSS });
  const box = el('div', { className: 'w' });
  const note = el('p', { className: 'n', textContent: 'Ask Plumbline · sandbox — free, no wallet' });
  const form = el('form');
  const input = el('input', { type: 'text', placeholder: 'Ask a question…', required: true, maxLength: 500 });
  input.setAttribute('aria-label', 'Question');
  const btn = el('button', { type: 'submit', textContent: 'Ask' });
  const out = el('div', { className: 'r' });
  out.setAttribute('aria-live', 'polite');
  form.append(input, btn);
  box.append(note, form, out);
  root.append(style, box);

  const show = (cls: string, status: string, answer?: string) => {
    out.className = `r ${cls}`;
    out.replaceChildren(el('div', { className: 's', textContent: status }));
    if (answer) out.append(el('div', { className: 'a', textContent: answer }));
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    btn.disabled = true;
    show('', 'Asking…');
    try {
      const res = await fetch(`${base}/oracle/sandbox`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q }) });
      if (!res.ok) throw new Error(`server returned ${res.status}`);
      const { jobId } = (await res.json()) as { jobId: string };
      for (let i = 0; i < 60; i++) {
        await sleep(i < 10 ? 300 : 1000);
        const job = (await (await fetch(`${base}/oracle/${encodeURIComponent(jobId)}`)).json()) as { status: string; outcome?: string; answer?: unknown; reason?: unknown };
        if (job.status !== 'settled') continue;
        if (job.outcome === 'resolved') show('ok', 'Answered', String(job.answer));
        else show('bad', 'Refunded', job.reason ? String(job.reason) : 'No consensus reached.');
        return;
      }
      show('bad', 'Still working', 'No answer yet — try again in a moment.');
    } catch (err) {
      show('bad', 'Could not reach the server', err instanceof Error ? err.message : String(err));
    } finally {
      btn.disabled = false;
    }
  });
}

function init() {
  document.querySelectorAll<HTMLElement>('[data-plumbline-ask],[data-arbiter-widget]').forEach(mount);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

(window as unknown as { PlumblineAsk: { mount: typeof mount } }).PlumblineAsk = { mount };

export {};
