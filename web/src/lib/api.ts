import { createApi } from '@plumbline/core';
import { config } from './config.ts';
import { store } from './storage.ts';

export const ADMIN_TOKEN_KEY = 'control.token';
export const API_KEY_KEY = 'customer.apiKey';

type UnauthorizedListener = (scope: 'admin' | 'customer' | 'session') => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();
export const onUnauthorized = (fn: UnauthorizedListener) => {
  unauthorizedListeners.add(fn);
  return () => {
    unauthorizedListeners.delete(fn);
  };
};

/** The single API client every screen shares. */
export const api = createApi({
  baseUrl: config.backendUrl,
  adminToken: () => store.get(ADMIN_TOKEN_KEY),
  apiKey: () => store.get(API_KEY_KEY),
  onUnauthorized: (scope) => {
    if (scope === 'admin') store.remove(ADMIN_TOKEN_KEY);
    if (scope === 'customer') store.remove(API_KEY_KEY);
    unauthorizedListeners.forEach((fn) => fn(scope));
  },
});

export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));
