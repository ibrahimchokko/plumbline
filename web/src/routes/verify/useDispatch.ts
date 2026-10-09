/**
 * The verifier's live dispatch channel (SSE: GET /app/events).
 *
 * Improvement over the original: a dropped connection used to flip the
 * verifier straight to "offline" and they silently stopped receiving paid
 * questions until they noticed. Now the channel reconnects by itself with
 * exponential backoff, re-proving the session if the token went stale, and
 * only goes offline when the verifier says so.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { backoffDelay, type DispatchedQuestion } from '@plumbline/core';
import { api } from '../../lib/api.ts';

export type DispatchState = 'offline' | 'connecting' | 'online' | 'reconnecting';

export function useDispatch(opts: {
  address: string | null;
  getToken: () => Promise<string>;
  invalidateToken: () => void;
  categories: string[];
  onQuestion: (q: DispatchedQuestion) => void;
  log: (msg: string, tone?: 'info' | 'success' | 'warn' | 'error') => void;
}) {
  const [state, setState] = useState<DispatchState>('offline');
  const [attempt, setAttempt] = useState(0);
  const wanted = useRef(false);
  const es = useRef<EventSource | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const failures = useRef(0);

  const teardown = () => {
    es.current?.close();
    es.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const open = useCallback(async () => {
    const o = optsRef.current;
    if (!wanted.current || !o.address) return;
    teardown();
    let token: string;
    try {
      token = await o.getToken();
    } catch (err) {
      o.log(`Could not sign in: ${err instanceof Error ? err.message : String(err)}`, 'error');
      wanted.current = false;
      setState('offline');
      return;
    }
    if (!wanted.current) return;
    const source = new EventSource(api.streams.dispatch(o.address, token, o.categories));
    es.current = source;

    source.addEventListener('connected', () => {
      failures.current = 0;
      setAttempt(0);
      setState('online');
      const topics = optsRef.current.categories;
      optsRef.current.log(`Online and listening${topics.length ? ` for ${topics.join(', ')}` : ' for every topic'}.`, 'success');
    });
    source.addEventListener('question', (evt) => {
      try {
        optsRef.current.onQuestion(JSON.parse((evt as MessageEvent<string>).data));
      } catch {
        optsRef.current.log('Received a malformed question event — ignored.', 'warn');
      }
    });
    source.onerror = () => {
      if (!wanted.current) return;
      source.close();
      failures.current += 1;
      // Two failures in a row: the token may have expired server-side.
      if (failures.current >= 2) optsRef.current.invalidateToken();
      const delay = backoffDelay(failures.current - 1, { baseMs: 1500, maxMs: 30_000 });
      setAttempt(failures.current);
      setState('reconnecting');
      optsRef.current.log(`Dispatch channel dropped — reconnecting in ${Math.round(delay / 1000)}s.`, 'warn');
      timer.current = setTimeout(open, delay);
    };
  }, []);

  const goOnline = useCallback(async () => {
    wanted.current = true;
    setState('connecting');
    await open();
  }, [open]);

  const goOffline = useCallback(() => {
    wanted.current = false;
    teardown();
    setState('offline');
    optsRef.current.log('Offline. You will not receive questions.');
  }, []);

  // Changing topics while online re-subscribes with the new filter.
  const topicKey = opts.categories.join(',');
  useEffect(() => {
    if (wanted.current) void open();
  }, [topicKey, open]);

  // Switching wallet drops the channel for the old address.
  useEffect(() => {
    if (wanted.current) goOffline();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.address]);

  useEffect(() => () => {
    wanted.current = false;
    teardown();
  }, []);

  return { state, attempt, goOnline, goOffline };
}
