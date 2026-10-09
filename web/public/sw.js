/*
 * Plumbline service worker.
 *
 * 1. Web Push: show a notification for a dispatched question and mirror it
 *    into any open tab's notification inbox.
 * 2. Notification click: focus an open Plumbline tab on /verify (or open one).
 * 3. Offline shell: the app shell (navigation requests) is served from cache
 *    when the network is down, so the page loads and can explain it's offline
 *    instead of showing the browser's dinosaur. API calls are never cached.
 */
const SHELL_CACHE = 'plumbline-shell-v1';
const SHELL = ['/', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== SHELL_CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.mode !== 'navigate') return; // only the HTML shell; never API/data
  event.respondWith(
    (async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(SHELL_CACHE);
        cache.put('/', fresh.clone()).catch(() => undefined);
        return fresh;
      } catch {
        return (await caches.match('/')) || Response.error();
      }
    })(),
  );
});

self.addEventListener('push', (event) => {
  let payload = { title: 'Plumbline', body: 'A new question is waiting for you.' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    /* non-JSON payload: keep the default text */
  }
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: '/icon.svg',
        tag: payload.questionId ? `question-${payload.questionId}` : undefined,
        data: { questionId: payload.questionId },
      }),
      self.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then((clients) => clients.forEach((c) => c.postMessage({ type: 'plumbline:notify', message: `${payload.title}: ${payload.body}` }))),
    ]),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const tab = clients.find((c) => 'focus' in c);
      if (tab) {
        tab.navigate?.('/verify').catch(() => undefined);
        return tab.focus();
      }
      return self.clients.openWindow('/verify');
    }),
  );
});
