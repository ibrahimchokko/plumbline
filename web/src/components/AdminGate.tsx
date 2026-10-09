import { useEffect, useState, type ReactNode } from 'react';
import { ADMIN_TOKEN_KEY, onUnauthorized } from '../lib/api.ts';
import { store } from '../lib/storage.ts';
import { Button, Panel } from './ui.tsx';

/**
 * Bearer-token gate for operator screens. The token lives in this browser
 * until "Sign out"; a 401 from any admin call clears it and returns here.
 */
export function AdminGate({ children }: { children: (signOut: () => void) => ReactNode }) {
  const [token, setToken] = useState(store.get(ADMIN_TOKEN_KEY));
  const [input, setInput] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(
    () =>
      onUnauthorized((scope) => {
        if (scope === 'admin') {
          setToken(null);
          setMsg('That token was rejected — try again.');
        }
      }),
    [],
  );

  const signOut = () => {
    store.remove(ADMIN_TOKEN_KEY);
    setToken(null);
  };

  if (token) return <>{children(signOut)}</>;
  return (
    <Panel title="Operator sign-in" eyebrow="Restricted">
      <form
        className="input-row"
        onSubmit={(e) => {
          e.preventDefault();
          const v = input.trim();
          if (!v) return;
          store.set(ADMIN_TOKEN_KEY, v);
          setInput('');
          setMsg('');
          setToken(v);
        }}
      >
        <input id="control-token" data-sensitive className="input mono" type="password" autoComplete="off" placeholder="Admin bearer token" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Admin bearer token" />
        <Button type="submit">Sign in</Button>
      </form>
      {msg && <p className="callout bad small" style={{ marginTop: 12 }}>{msg}</p>}
    </Panel>
  );
}
