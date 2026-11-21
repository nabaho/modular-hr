/**
 * modular-hr 보안 PWA Service Worker
 * - UI 정적 셸만 캐시하며, /api/* (개인정보·급여·결재·실시간 스트림)는 절대 캐시하지 않는다.
 */

const SHELL_CACHE = 'modular-hr-shell-ded2c66c4e77';
const STATIC_ASSETS = [
  './mobile.html',
  './mobile.css?v=ded2c66c4e77',
  './mobile.js?v=ded2c66c4e77',
  './manifest.webmanifest',
  './icon.svg',
  './index.html',
  './styles.css?v=ded2c66c4e77',
  './app.js?v=ded2c66c4e77',
  './static-api-runtime.mjs?v=ded2c66c4e77',
  './virtual-server-worker.mjs?v=ded2c66c4e77',
  './server-core.mjs?v=ded2c66c4e77',
  './engine/browser-crypto-shim.mjs?v=ded2c66c4e77',
  './engine/virtual-http-shim.mjs?v=ded2c66c4e77',
  './engine/compliance-provisioner.mjs?v=ded2c66c4e77',
  './engine/document-generator.mjs?v=ded2c66c4e77',
  './engine/document-ingestion.mjs?v=ded2c66c4e77',
  './engine/hr-operations-suite.mjs?v=ded2c66c4e77',
  './engine/labor-rules.mjs?v=ded2c66c4e77',
  './engine/lifecycle-payroll.mjs?v=ded2c66c4e77',
  './engine/mobile-auth-realtime.mjs?v=ded2c66c4e77',
  './engine/offboarding-registry.mjs?v=ded2c66c4e77',
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
