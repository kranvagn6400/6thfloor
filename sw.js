/* ============================================================
   sw.js — Service Worker for the Clinical Pharmacy Ward app
   ============================================================
   Strategy:
   - App shell (HTML, JS, CSS): network-first, revalidating with the
     server every time (cache: "no-cache"), so a deploy is picked up
     on the next load. When the network fails, serve the cached copy
     so the app keeps working offline in the ward.
   - Images and fonts: cache-first (rarely change).
   - CDN libraries (supabase-js, jsPDF, html2pdf, xlsx) and Google
     Fonts: network-first with cache fallback.
   - Supabase API calls are never cached.
   ============================================================ */

const CACHE_VERSION = 'pharma-ward-v385';
const PRECACHE_URLS = [
  './',
  './index.html',
  './css/styles.css',
  './css/theme.css',
  './js/medications.js',
  './js/ward.js',
  './js/storage.js',
  './js/supabase-config.js',
  './js/supabase-client.js',
  './js/supabase-sync.js',
  './js/auth.js',
  './js/clinical.js',
  './js/ddinter.js',
  './js/ddinter-data.js',
  './js/boarders.js',
  './js/ui.js',
  './js/chart-image.js',
  './js/chart-bridge.js',
  './js/pills-form.js',
  './js/print-sheets.js',
  './js/patient-search.js',
  './js/patient-history.js',
  './js/monthly-report.js',
  './js/bed-drag.js',
  './js/archive-sync.js',
  './js/med-availability.js',
  './js/patient-merge.js',
  './js/specialists.js',
  './js/specialists-admin.js',
  './js/chart-merge.js',
  './js/chart-sync.js',
  './js/occasions.js',
  './js/palettes.js',
  './js/ornaments.js',
  './js/neon.js',
  './js/greetings.js',
  './js/presence.js',
  './css/ornaments.css',
  './img/header-art.webp',
  './css/palettes.css',
  './css/occasions.css',
  './js/handover.js',
  './js/private-form.js',
  './js/patient-forms.js',
  './img/forms/albumin.jpg',
  './img/forms/meronem.jpg',
  './js/duty-roster.js',
  './fonts/Cairo-Regular.ttf',
  './fonts/Cairo-Bold.ttf',
  './js/chart-names.js',
  './js/chart-send-log.js',
  './js/tarbeet.js',
  './js/pills-page.js',
  './js/tv-alerts.js',
  './js/daily-quotes.js',
  './js/app.js',
  './manifest.json',
  './img/login-icon.png',
  './img/icon-192.png',
  './img/icon-512.png',
  './img/icon-192-maskable.png',
  './img/icon-512-maskable.png',
  './img/favicon-32.png',
  './img/apple-touch-icon-180.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.0/dist/umd/supabase.min.js',
  'https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
];

// ---------- Install: pre-cache the shell ----------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // Tolerant: one failed URL (e.g. CDN hiccup) must not block install.
      Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] precache miss:', url, err.message);
          })
        )
      )
    )
  );
  self.skipWaiting();
});

// ---------- Activate: clear old caches ----------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function putInCache(req, res) {
  if (res && res.ok) {
    const copy = res.clone();
    caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
  }
  return res;
}

// Cached copy, ignoring the ?v= query so a versioned request still
// finds the shell file that was precached without it.
function fromCache(req) {
  return caches.match(req).then((r) => r || caches.match(req, { ignoreSearch: true }));
}

// ---------- Fetch ----------
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isCDN = url.origin === 'https://cdn.jsdelivr.net';
  const isGoogleFonts = url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com';

  // Supabase API and anything else foreign: straight to the network.
  if (!isSameOrigin && !isCDN && !isGoogleFonts) return;

  // Navigations: network-first, fall back to the cached shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((res) => putInCache(req, res))
        .catch(() => fromCache(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // Images + fonts: cache-first.
  if (req.destination === 'image' || req.destination === 'font') {
    event.respondWith(
      fromCache(req).then((cached) => cached || fetch(req).then((res) => putInCache(req, res)))
    );
    return;
  }

  // JS, CSS, CDN libraries: network-first (revalidated), cache fallback.
  event.respondWith(
    fetch(req, isSameOrigin ? { cache: 'no-cache' } : undefined)
      .then((res) => putInCache(req, res))
      .catch(() => fromCache(req))
  );
});
