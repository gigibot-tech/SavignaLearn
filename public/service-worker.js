/* eslint-disable no-restricted-globals */

// Minimal notification “worker” for web.
// The app (client JS) sends SHOW_NOTIFICATION messages to this worker.
// We do NOT implement web-push; this is for local notifications while the tab is alive.

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'SHOW_NOTIFICATION') return;

  const title = String(data.title ?? '');
  const body = String(data.body ?? '');
  const payload = data.data ?? {};
  const tag = data.tag ? String(data.tag) : undefined;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data: payload,
      tag,
      renotify: false,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const payload = event.notification.data ?? {};
  const url = payload && typeof payload.url === 'string' ? payload.url : null;

  if (!url) return;

  const targetUrl = new URL(url, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // Focus an existing tab if we can.
      for (const client of allClients) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) {
            client.navigate(targetUrl);
          }
          return;
        }
      }

      await self.clients.openWindow(targetUrl);
    })()
  );
});

