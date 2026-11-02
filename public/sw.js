// Service worker of the installed app: the page itself comes from the network when online (so updates
// arrive right away) and from the cache when offline; libraries and fonts from versioned CDN URLs are
// cached on first use. Data (Supabase) is never cached here - the app keeps its own copy.
const VERSION = '__VERSION__';
const SHELL = 'hausakte-shell-' + VERSION;
const LIBS = 'hausakte-libs-v1';
const SHELL_FILES = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];
// libraries the page needs, stored at install so the app also starts offline after the very first visit
const LIB_URLS = __LIBS__;
const CDN = /^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;

async function storeLibs() {
  const c = await caches.open(LIBS);
  await Promise.all(
    LIB_URLS.map(async (u) => {
      if (await c.match(u)) return;
      try {
        const res = await fetch(u, { mode: 'cors', credentials: 'omit' });
        if (res.ok) await c.put(u, res);
      } catch (err) {}
    }),
  );
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    Promise.all([caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)), storeLibs()]).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('hausakte-shell-') && k !== SHELL) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

async function pageFromNetwork(req) {
  const c = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok) c.put('/', res.clone());
    return res;
  } catch (err) {
    return (await c.match('/')) || (await caches.match('/')) || Response.error();
  }
}

async function cacheFirst(cacheName, req) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') c.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate' && url.origin === self.location.origin) return e.respondWith(pageFromNetwork(req));
  if (CDN.test(req.url)) return e.respondWith(cacheFirst(LIBS, req));
  if (url.origin === self.location.origin && /^\/(icons\/|manifest\.webmanifest$)/.test(url.pathname)) return e.respondWith(cacheFirst(SHELL, req));
  // everything else (Supabase API, signed file URLs) goes straight to the network
});
