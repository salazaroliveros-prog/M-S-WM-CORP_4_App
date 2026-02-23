/// <reference lib="webworker" />

import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare let self: ServiceWorkerGlobalScope;

cleanupOutdatedCaches();

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - injected by VitePWA at build time
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('push', (event) => {
  try {
    const payload = event.data?.json?.() ?? null;
    const title = String(payload?.title ?? 'Notificación');
    const body = String(payload?.body ?? '');
    const data = payload?.data ?? {};

    event.waitUntil(
      self.registration.showNotification(title, {
        body,
        data,
      })
    );
  } catch {
    // If payload isn't JSON, show a generic notification.
    event.waitUntil(self.registration.showNotification('Notificación', { body: '' }));
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = allClients.length > 0 ? allClients[0] : null;
      if (existing) {
        await existing.focus();
        return;
      }
      await self.clients.openWindow('./');
    })()
  );
});
