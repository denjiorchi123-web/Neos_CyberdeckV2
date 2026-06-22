// CyberDeck Service Worker — offline resilience
// Caches the app shell for instant reloads and queues failed POST requests.
// Background Sync replays queued sends when the network comes back.

// Bump this whenever attachment/UI behavior changes so kiosk browsers do not
// keep serving an old JavaScript bundle with obsolete file-type filters.
const CACHE_VER   = "cyberdeck-v3-any-file";
const SHELL_PATHS = ["/", "/favicon.ico"];

// ── Install: pre-cache app shell ──────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VER).then(cache => cache.addAll(SHELL_PATHS))
  );
  self.skipWaiting();
});

// ── Activate: clean up old caches ────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VER).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: network-first for API/socket, cache-first for static assets ───────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept Socket.IO or API socket routes — they must hit the network
  if (url.pathname.startsWith("/api/socket") || url.pathname.startsWith("/socket.io")) {
    return;
  }

  // For navigation requests: try network, fall back to cached index
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match("/").then(r => r ?? new Response("Offline", { status: 503 }))
      )
    );
    return;
  }

  // For static assets (_next/, public files): cache-first
  if (
    url.pathname.startsWith("/_next/static") ||
    url.pathname.startsWith("/uploads") ||
    url.pathname.match(/\.(js|css|woff2?|ico|png|svg)$/)
  ) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VER).then(c => c.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Everything else: network-first
  event.respondWith(fetch(event.request));
});

// ── Background Sync: drain offline message queue ─────────────────────────────
self.addEventListener("sync", (event) => {
  if (event.tag === "cyberdeck-outbox") {
    // Signal all open clients to drain the IndexedDB outbox queue.
    // The actual drain happens in the app via useOfflineQueue hook.
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true }).then(clients =>
        Promise.all(clients.map(c => c.postMessage({ type: "DRAIN_OUTBOX" })))
      )
    );
  }
});
