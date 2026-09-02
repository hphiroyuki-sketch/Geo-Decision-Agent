/*
 * Service worker for the PWA baseline the requirements set (5.1 / NFR-015).
 *
 * Deliberately narrow. The one thing this app must never do is serve a stale
 * analysis: a cached number that looks current is worse than no number at all,
 * and section 14 treats the customer's siting data as confidential. So:
 *
 *   - /api/* is never cached, never intercepted. It always goes to the network.
 *   - Only the built shell (HTML, JS, CSS, icons) is cached, so the app opens
 *     on a weak signal and shows its own "offline" state instead of the
 *     browser's error page.
 *   - Signing out posts CLEAR_CACHES, which drops everything this origin
 *     stored on the device (NFR-015: サインアウト時の端末データ消去).
 */
const VERSION = "gda-shell-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "CLEAR_CACHES") {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // map tiles etc. stay untouched
  if (url.pathname.startsWith("/api/")) return; // never cache project data

  // Navigations: network first so a deploy is picked up, cached shell as the
  // fallback when the network is gone.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put("/index.html", copy));
          return res;
        })
        .catch(() => caches.match("/index.html").then((r) => r || Response.error())),
    );
    return;
  }

  // Hashed build assets: cache first, they never change under the same name.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && (url.pathname.startsWith("/assets/") || SHELL.includes(url.pathname))) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
