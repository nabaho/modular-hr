/**
 * modular-hr 보안 PWA Service Worker
 * - UI 정적 셸만 캐시하며, /api/* (개인정보·급여·결재·실시간 스트림)는 절대 캐시하지 않는다.
 */

const SHELL_CACHE = 'modular-hr-shell-1c398065676d';
const STATIC_ASSETS = [
  './mobile.html',
  './mobile.css?v=1c398065676d',
  './mobile.js?v=1c398065676d',
  './manifest.webmanifest',
  './icon.svg',
  './index.html',
  './styles.css?v=1c398065676d',
  './app.js?v=1c398065676d',
  './static-api-runtime.mjs?v=1c398065676d',
  './virtual-server-worker.mjs?v=1c398065676d',
  './server-core.mjs?v=1c398065676d',
  './engine/browser-crypto-shim.mjs?v=1c398065676d',
  './engine/virtual-http-shim.mjs?v=1c398065676d',
  './engine/compliance-provisioner.mjs?v=1c398065676d',
  './engine/document-generator.mjs?v=1c398065676d',
  './engine/document-ingestion.mjs?v=1c398065676d',
  './engine/hr-operations-suite.mjs?v=1c398065676d',
  './engine/labor-rules.mjs?v=1c398065676d',
  './engine/lifecycle-payroll.mjs?v=1c398065676d',
  './engine/mobile-auth-realtime.mjs?v=1c398065676d',
  './engine/offboarding-registry.mjs?v=1c398065676d',
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
