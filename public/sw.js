// Service Worker: Pure Client-Side Offline Caching for Study Boards Public
// Architecture:
//  - Shell Assets: Network-first falling back to cache (instant zero-bump deploys)
//  - External CDN Assets (MathJax & Google Fonts): Cache-first with background revalidation
//  - ZERO Firebase, ZERO Cloudflare, ZERO proprietary question bank crawling

const SHELL_CACHE = 'studyboards-shell-v1';
const EXT_CACHE = 'studyboards-ext-v1';
const KEEP_CACHES = [SHELL_CACHE, EXT_CACHE];

const SHELL_ASSETS = [
    './',
    'index.html',
    'style.css',
    'manifest.webmanifest',
    'js/app.js',
    'js/db.js',
    'js/set-manager.js',
    'js/import-parser.js',
    'js/import-ui.js',
    'js/mastery.js',
    'js/profile.js',
    'js/anim.js',
    'js/confetti.js',
    'samples/sample_circuits_set.json',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-maskable-192.png',
    'icons/icon-maskable-512.png'
];

const MATHJAX_BASE = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/';
const MATHJAX_FONT_DIR = MATHJAX_BASE + 'output/chtml/fonts/woff-v2/';
const MATHJAX_FILES = [
    MATHJAX_BASE + 'tex-mml-chtml.js',
    ...['Main-Regular', 'Main-Bold', 'Main-Italic', 'Math-Italic', 'Math-BoldItalic', 'Size1-Regular', 'Size2-Regular', 'AMS-Regular']
        .map(name => `${MATHJAX_FONT_DIR}MathJax_${name}.woff`)
];

const GOOGLE_FONTS_CSS = 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap';
const EXT_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

function isCacheable(response) {
    return response && (response.ok || response.type === 'opaque');
}

async function putInCache(cacheName, request, response) {
    try {
        const cache = await caches.open(cacheName);
        await cache.put(request, response);
    } catch (e) {
        // Suppress quota or opaque response edge cases
    }
}

// Pre-cache core shell on installation
self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const shellCache = await caches.open(SHELL_CACHE);
        await Promise.allSettled(
            SHELL_ASSETS.map(async (path) => {
                const url = new URL(path, self.registration.scope).href;
                try {
                    const res = await fetch(url, { cache: 'no-cache' });
                    if (res.ok) await shellCache.put(url, res);
                } catch (e) {
                    console.warn(`[SW] Pre-cache failed for ${path}:`, e);
                }
            })
        );
        self.skipWaiting();
    })());
});

// Purge obsolete caches on activation
self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(
            keys.filter(k => !KEEP_CACHES.includes(k)).map(k => caches.delete(k))
        );
        await self.clients.claim();
    })());
});

// Request Interception Strategy
self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // 1. External CDN Assets (MathJax & Google Fonts) -> Cache-First
    if (EXT_HOSTS.includes(url.hostname)) {
        event.respondWith((async () => {
            const extCache = await caches.open(EXT_CACHE);
            const cached = await extCache.match(req);
            if (cached) return cached;

            try {
                const fetched = await fetch(req);
                if (isCacheable(fetched)) {
                    await putInCache(EXT_CACHE, req, fetched.clone());
                }
                return fetched;
            } catch (e) {
                return cached || new Response('Network unavailable', { status: 503 });
            }
        })());
        return;
    }

    // 2. Same-Origin Shell Assets -> Network-First with Cache Fallback
    if (url.origin === self.location.origin) {
        event.respondWith((async () => {
            const shellCache = await caches.open(SHELL_CACHE);
            try {
                const networkResponse = await fetch(req);
                if (networkResponse && networkResponse.ok) {
                    await putInCache(SHELL_CACHE, req, networkResponse.clone());
                    return networkResponse;
                }
            } catch (err) {
                // Offline fallback
            }

            const cached = await shellCache.match(req);
            if (cached) return cached;

            // HTML Navigation fallback to index.html
            if (req.mode === 'navigate') {
                const indexFallback = await shellCache.match(new URL('./', self.registration.scope).href);
                if (indexFallback) return indexFallback;
            }

            return new Response('Offline: Resource not available', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        })());
    }
});
