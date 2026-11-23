/**
 * modular-hr 보안 PWA Service Worker
 * - UI 정적 셸만 캐시하며, /api/* (개인정보·급여·결재·실시간 스트림)는 절대 캐시하지 않는다.
 */

const SHELL_CACHE = 'modular-hr-shell-ca7244dd8c0e';
const STATIC_ASSETS = [
  './mobile.html',
  './mobile.css?v=ca7244dd8c0e',
  './mobile.js?v=ca7244dd8c0e',
  './manifest.webmanifest',
  './icon.svg',
  './index.html',
  './styles.css?v=ca7244dd8c0e',
  './app.js?v=ca7244dd8c0e',
  './static-api-runtime.mjs?v=ca7244dd8c0e',
  './virtual-server-worker.mjs?v=ca7244dd8c0e',
  './server-core.mjs?v=ca7244dd8c0e',
  './engine/browser-crypto-shim.mjs?v=ca7244dd8c0e',
  './engine/virtual-http-shim.mjs?v=ca7244dd8c0e',
  './engine/compliance-provisioner.mjs?v=ca7244dd8c0e',
  './engine/document-generator.mjs?v=ca7244dd8c0e',
  './engine/document-ingestion.mjs?v=ca7244dd8c0e',
  './engine/hr-operations-suite.mjs?v=ca7244dd8c0e',
  './engine/labor-rules.mjs?v=ca7244dd8c0e',
  './engine/lifecycle-payroll.mjs?v=ca7244dd8c0e',
  './engine/mobile-auth-realtime.mjs?v=ca7244dd8c0e',
  './engine/offboarding-registry.mjs?v=ca7244dd8c0e',
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
