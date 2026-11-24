/**
 * modular-hr 보안 PWA Service Worker
 * - UI 정적 셸만 캐시하며, /api/* (개인정보·급여·결재·실시간 스트림)는 절대 캐시하지 않는다.
 */

const SHELL_CACHE = 'modular-hr-shell-8740b2361cb9';
const STATIC_ASSETS = [
  './mobile.html',
  './mobile.css?v=8740b2361cb9',
  './mobile.js?v=8740b2361cb9',
  './manifest.webmanifest',
  './icon.svg',
  './index.html',
  './styles.css?v=8740b2361cb9',
  './app.js?v=8740b2361cb9',
  './static-api-runtime.mjs?v=8740b2361cb9',
  './virtual-server-worker.mjs?v=8740b2361cb9',
  './server-core.mjs?v=8740b2361cb9',
  './engine/browser-crypto-shim.mjs?v=8740b2361cb9',
  './engine/virtual-http-shim.mjs?v=8740b2361cb9',
  './engine/compliance-provisioner.mjs?v=8740b2361cb9',
  './engine/document-generator.mjs?v=8740b2361cb9',
  './engine/document-ingestion.mjs?v=8740b2361cb9',
  './engine/hr-operations-suite.mjs?v=8740b2361cb9',
  './engine/labor-rules.mjs?v=8740b2361cb9',
  './engine/lifecycle-payroll.mjs?v=8740b2361cb9',
  './engine/mobile-auth-realtime.mjs?v=8740b2361cb9',
  './engine/offboarding-registry.mjs?v=8740b2361cb9',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('modular-hr-shell-') && k !== SHELL_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 보안 원칙: API 및 실시간 SSE 요청은 단말 캐시에 절대 저장하지 않고 네트워크로만 직결
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/api/')) {
    return;
  }
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) {
    return;
  }

  event.respondWith(
    fetch(req).catch(() => caches.open(SHELL_CACHE).then((cache) => cache.match(req)))
  );
});
