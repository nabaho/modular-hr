/**
 * modular-hr 보안 PWA Service Worker
 * - UI 정적 셸만 캐시하며, /api/* (개인정보·급여·결재·실시간 스트림)는 절대 캐시하지 않는다.
 */

const SHELL_CACHE = 'modular-hr-shell-c39fc7444a1f';
const STATIC_ASSETS = [
  './mobile.html',
  './mobile.css?v=c39fc7444a1f',
  './mobile.js?v=c39fc7444a1f',
  './manifest.webmanifest',
  './icon.svg',
  './index.html',
  './styles.css?v=c39fc7444a1f',
  './app.js?v=c39fc7444a1f',
  './static-api-runtime.mjs?v=c39fc7444a1f',
  './virtual-server-worker.mjs?v=c39fc7444a1f',
  './server-core.mjs?v=c39fc7444a1f',
  './engine/browser-crypto-shim.mjs?v=c39fc7444a1f',
  './engine/virtual-http-shim.mjs?v=c39fc7444a1f',
  './engine/compliance-provisioner.mjs?v=c39fc7444a1f',
  './engine/document-generator.mjs?v=c39fc7444a1f',
  './engine/document-ingestion.mjs?v=c39fc7444a1f',
  './engine/hr-operations-suite.mjs?v=c39fc7444a1f',
  './engine/labor-rules.mjs?v=c39fc7444a1f',
  './engine/lifecycle-payroll.mjs?v=c39fc7444a1f',
  './engine/mobile-auth-realtime.mjs?v=c39fc7444a1f',
  './engine/offboarding-registry.mjs?v=c39fc7444a1f',
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
