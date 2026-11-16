// Abaya portal service worker: shows push notifications and opens the portal when one is tapped.
// (No offline caching — the portal always loads fresh.)
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { body: e.data ? e.data.text() : '' } }
  const base = new URL('./portal/', self.registration.scope).href
  e.waitUntil(self.registration.showNotification(d.title || 'Abaya', {
    body: d.body || '',
    icon: new URL('./icons/icon-192.png', self.registration.scope).href,
    badge: new URL('./icons/icon-192.png', self.registration.scope).href,
    data: { url: d.url || base },
  }))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || new URL('./portal/', self.registration.scope).href
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const w of wins) {
      if (w.url.includes('/portal/')) { await w.focus(); try { await w.navigate(url) } catch { /* cross-origin */ } return }
    }
    await self.clients.openWindow(url)
  })())
})
