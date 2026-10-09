/**
 * Live status updates for the asker's questions — ONE server stream per
 * browser per address, shared by every open tab:
 *
 *   backend ──SSE──▶ leader tab ──BroadcastChannel──▶ every tab
 *
 * The leader is elected with the Web Locks API; if that tab closes, another
 * takes over automatically. Every subscriber starts from a snapshot, events
 * carry a contiguous sequence number, and any gap triggers a snapshot
 * resync instead of silently skipping a status (see SequenceTracker).
 * Coming back to a hidden tab or regaining network also resyncs.
 */
import { SequenceTracker, backoffDelay, type PayerQuestion, type PayerSnapshot } from '@plumbline/core';
import { api } from './api.ts';

export interface StatusChannel {
  ready: Promise<void>;
  resync(): Promise<void>;
  close(): void;
}

export function openStatusChannel(opts: {
  address: string;
  getToken: () => Promise<string>;
  onSnapshot: (s: PayerSnapshot) => void;
  onEvent: (q: Partial<PayerQuestion> & { questionId: string }) => void;
  onConnection: (live: boolean) => void;
}): StatusChannel {
  const name = `plumbline-status:${opts.address}`;
  const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(name) : null;
  const seq = new SequenceTracker();
  let source: EventSource | null = null;
  let closed = false;
  let attempt = 0;
  let releaseLock: (() => void) | null = null;
  let resyncing: Promise<void> | null = null;

  const resync = () => {
    if (resyncing) return resyncing;
    resyncing = (async () => {
      try {
        const token = await opts.getToken();
        const snap = await api.payers.snapshot(opts.address, token);
        if (Number.isFinite(snap.cursor)) seq.reset(Number(snap.cursor));
        opts.onSnapshot(snap);
      } finally {
        resyncing = null;
      }
    })();
    return resyncing;
  };

  function deliver(n: number, payload: Partial<PayerQuestion> & { questionId: string }) {
    const d = seq.offer(n);
    if (d === 'apply') opts.onEvent(payload);
    else if (d === 'gap') void resync();
  }

  bc?.addEventListener('message', ({ data }) => {
    if (data?.type === 'status') deliver(data.seq, data.payload);
    else if (data?.type === 'connection') opts.onConnection(!!data.live);
  });

  function announce(live: boolean) {
    opts.onConnection(live);
    bc?.postMessage({ type: 'connection', live });
  }

  async function openStream() {
    if (closed) return;
    let token: string;
    try {
      token = await opts.getToken();
    } catch {
      return;
    }
    source = new EventSource(api.streams.payerStatus(opts.address, token, seq.position));
    source.onopen = () => {
      attempt = 0;
      announce(true);
    };
    source.addEventListener('status', (e) => {
      const ev = e as MessageEvent<string>;
      try {
        const n = Number(ev.lastEventId);
        const payload = JSON.parse(ev.data);
        bc?.postMessage({ type: 'status', seq: n, payload });
        deliver(n, payload);
      } catch {
        /* malformed event — ignore */
      }
    });
    source.onerror = () => {
      announce(false);
      // CONNECTING = browser is auto-retrying with Last-Event-ID.
      // CLOSED (e.g. 401 after token expiry) = reopen ourselves with a fresh token.
      if (source?.readyState === EventSource.CLOSED && !closed) {
        source = null;
        setTimeout(openStream, backoffDelay(attempt++));
      }
    };
  }

  function lead() {
    if (!navigator.locks) return void openStream();
    navigator.locks.request(name, () => {
      if (closed) return;
      void openStream();
      return new Promise<void>((resolve) => (releaseLock = resolve));
    });
  }

  const onVisible = () => document.visibilityState === 'visible' && void resync();
  const onOnline = () => void resync();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);

  const ready = resync().then(lead);

  return {
    ready,
    resync,
    close() {
      closed = true;
      source?.close();
      releaseLock?.();
      bc?.close();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    },
  };
}
