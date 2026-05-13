/**
 * Self-destructing Service Worker.
 *
 * The previous build registered a Workbox PWA service worker that, combined
 * with Hostinger LiteSpeed's default 7-day Cache-Control on JS files, kept
 * pinning visitors to stale code (broken tab toggles, etc.). The PWA is
 * gone now (vite.config.ts no longer registers vite-plugin-pwa), but every
 * visitor who already loaded the site once has a Workbox SW installed and
 * still controlling their pages.
 *
 * Browsers automatically check `/sw.js` for an update on every navigation.
 * Because the *byte content* of this file differs from the prior Workbox
 * SW, the browser treats it as a new version, installs it, activates it
 * (skipWaiting + clients.claim), runs the body below, and the old PWA is
 * gone. The browser then unregisters this SW so future page loads are
 * pure network fetches with zero caching. Each visitor pays this cost
 * exactly once.
 *
 * Safe to leave deployed forever: visitors with no SW installed simply
 * never request `/sw.js`, so this file just sits there.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      // 1. Take control of all open pages immediately.
      await self.clients.claim();

      // 2. Delete every cache the prior SW (or any SW) ever populated.
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map((k) => caches.delete(k)));

      // 3. Unregister this SW. After this, the page is no longer
      //    controlled by any service worker.
      await self.registration.unregister();

      // 4. Reload every controlled tab so it picks up the network-only
      //    version of index.html and fresh asset URLs.
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        // navigate() works on Same-Origin clients and is the cleanest
        // way to force a hard reload from the SW.
        if ('navigate' in client) {
          await client.navigate(client.url);
        }
      }
    } catch (err) {
      // Non-fatal: if anything goes sideways the worst case is the user
      // sees the page they already had. No console.error to avoid noise.
      void err;
    }
  })());
});

// Pass-through fetch handler. We don't intercept anything — the browser
// goes straight to the network for every request. This keeps us out of
// the page's way during the brief window between activation and the
// post-activate reload, and matches what the page sees once the SW is
// fully unregistered.
self.addEventListener('fetch', () => {
  /* no-op: let the network handle every request */
});
