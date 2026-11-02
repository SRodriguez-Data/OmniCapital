// Service worker de OmniCapital: muestra los avisos del asesor que envía el agente diario (Web Push) y, al tocarlos,
// abre la app en la pantalla que corresponde. No guarda nada en caché.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', evento => evento.waitUntil(self.clients.claim()));

self.addEventListener('push', evento => {
  let datos = {};
  try { datos = evento.data ? evento.data.json() : {}; } catch { datos = { cuerpo: evento.data ? evento.data.text() : '' }; }
  const titulo = datos.titulo || 'Tu asesor';
  evento.waitUntil(self.registration.showNotification(titulo, {
    body: datos.cuerpo || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: datos.etiqueta || 'asesor',
    renotify: true,
    data: { url: datos.url || '/?vista=asesor' },
  }));
});

self.addEventListener('notificationclick', evento => {
  evento.notification.close();
  const url = new URL(evento.notification.data?.url || '/?vista=asesor', self.location.origin).href;
  evento.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const v of ventanas) {
      if (new URL(v.url).origin === self.location.origin && 'focus' in v) {
        await v.navigate(url).catch(() => {});
        return v.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
