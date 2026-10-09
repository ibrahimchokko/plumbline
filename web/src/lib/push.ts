/** Web Push helpers for verifiers who want a ping for longer-window questions. */
import { api } from './api.ts';

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function urlBase64ToUint8Array(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
}

/** Does this browser already hold a subscription? (no permission prompt) */
export async function existingSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

export async function enablePush(address: string, token: string, categories: string[]): Promise<void> {
  if (!pushSupported()) throw new Error('this browser does not support push notifications');
  const publicKey = await api.vapidKey();
  if (!publicKey) throw new Error('this server has not configured push notifications');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('notification permission was not granted');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
  await api.workers.pushSubscribe(address, { subscription: sub.toJSON(), categories, token });
}

export async function disablePush(): Promise<void> {
  const sub = await existingSubscription();
  await sub?.unsubscribe();
}
