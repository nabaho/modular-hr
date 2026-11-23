/**
 * 브라우저 측 SharedWorker 클라이언트 어댑터 (동일 출처 + 앱 기준 경로 /api/* 요청만 한정 가로채기)
 * - SharedWorker 지원 브라우저: 모든 탭·팝업(PC 콘솔 ↔ 모바일 앱)이 단일 서버 상태를 실시간 공유
 * - SharedWorker 미지원 환경: virtual-server-worker.mjs 를 탭 내 직접 임포트하여 폴백 구동
 */

if (window.location.hostname.endsWith('.github.io') && window.top !== window.self) {
  document.documentElement.hidden = true;
  throw new Error('외부 프레임 삽입(Clickjacking)이 차단되었습니다.');
}

window.__MHR_STATIC_DEMO__ = true;

const APP_BASE_PATH = window.location.pathname
  .replace(/\/(?:index\.html|mobile\.html|404\.html)?$/, '')
  .replace(/\/$/, '');

// 데모 세션 토큰 메모리 격리 — Web Storage(localStorage / sessionStorage) 미저장
let memoryCookiePair = '';

function readTabCookie() {
  return memoryCookiePair;
}

function applySetCookieHeader(setCookieRaw) {
  if (!setCookieRaw) return;
  const firstPair = String(setCookieRaw).split(';')[0] || '';
  const eqIdx = firstPair.indexOf('=');
  if (eqIdx <= 0) return;
  const val = firstPair.slice(eqIdx + 1).trim();
  if (val) {
    memoryCookiePair = `${firstPair.slice(0, eqIdx).trim()}=${val}`;
  } else {
    memoryCookiePair = '';
  }
}

let transportReadyPromise = null;
let sharedPortRef = null;

function getTransport() {
  if (transportReadyPromise) return transportReadyPromise;
  transportReadyPromise = (async () => {
    if (typeof SharedWorker === 'function') {
      try {
        const workerUrl = new URL('./virtual-server-worker.mjs?v=ca7244dd8c0e', import.meta.url);
        const sw = new SharedWorker(workerUrl, {
          type: 'module',
          name: `modular-hr-shared-ca7244dd8c0e:${APP_BASE_PATH || '/'}`,
        });
        sharedPortRef = sw.port;
        const pending = new Map();
        const sseHandlers = new Map();
        let seq = 1;

        sw.port.onmessage = (ev) => {
          const msg = ev.data || {};
          if (msg.kind === 'PORT_PING') {
            try { sw.port.postMessage({ kind: 'PORT_PONG' }); } catch { /* ignore */ }
          } else if (msg.kind === 'SERVER_SYNC') {
            window.dispatchEvent(new CustomEvent('mhr-live-sync'));
          } else if (msg.kind === 'API_RES') {
            const resolver = pending.get(msg.reqId);
            if (resolver) {
              pending.delete(msg.reqId);
              resolver(msg);
            }
          } else if (msg.kind === 'SSE_CHUNK') {
            sseHandlers.get(msg.streamId)?.onChunk(msg.chunk);
          } else if (msg.kind === 'SSE_ERROR') {
            sseHandlers.get(msg.streamId)?.onError();
          }
        };
        sw.port.start();

        return {
          sendApi(payload) {
            return new Promise((resolve) => {
              const reqId = `r_${seq++}`;
              pending.set(reqId, resolve);
              sw.port.postMessage({ kind: 'API_REQ', reqId, payload });
            });
          },
          openSse(headers, onChunk, onError) {
            const streamId = `s_${seq++}`;
            sseHandlers.set(streamId, { onChunk, onError });
            sw.port.postMessage({ kind: 'SSE_OPEN', streamId, headers });
            return () => {
              sseHandlers.delete(streamId);
              try { sw.port.postMessage({ kind: 'SSE_CLOSE', streamId }); } catch { /* ignore */ }
            };
          },
        };
      } catch {
        // SharedWorker 생성 실패 시 탭 내 직접 실행 모드로 폴백
      }
    }

    const mod = await import('./virtual-server-worker.mjs?v=ca7244dd8c0e');
    return {
      sendApi(payload) {
        return mod.invokeDirectInTab(payload);
      },
      openSse(headers, onChunk, onError) {
        let closer = null;
        mod
          .invokeDirectInTab({ method: 'GET', url: '/api/mobile/stream', headers }, onChunk)
          .then((res) => {
            if (res.status !== 200) onError();
            else closer = res.closeStream || null;
          });
        return () => {
          if (closer) closer();
        };
      },
    };
  })();
  return transportReadyPromise;
}

function resolveVirtualApiPath(parsedUrl) {
  if (parsedUrl.origin !== window.location.origin) return null;
  if (APP_BASE_PATH && parsedUrl.pathname.startsWith(`${APP_BASE_PATH}/api/`)) {
    return parsedUrl.pathname.slice(APP_BASE_PATH.length) + parsedUrl.search;
  }
  if (parsedUrl.pathname.startsWith('/api/')) {
    return parsedUrl.pathname + parsedUrl.search;
  }
  return null;
}

const nativeFetch = window.fetch.bind(window);
window.fetch = async function patchedFetch(input, init = {}) {
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url || '';
  const parsed = new URL(rawUrl, window.location.href);
  const apiUrl = resolveVirtualApiPath(parsed);
  if (!apiUrl) {
    return nativeFetch(input, init);
  }

  const isReqObj = typeof Request !== 'undefined' && input instanceof Request;
  const method = String(init.method || (isReqObj ? input.method : 'GET')).toUpperCase();

  const headers = Object.create(null);
  const copyHeadersFrom = (src) => {
    if (!src) return;
    if (typeof Headers !== 'undefined' && src instanceof Headers) {
      src.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    } else if (typeof src === 'object') {
      for (const [k, v] of Object.entries(src)) {
        if (v !== undefined && v !== null) headers[k.toLowerCase()] = String(v);
      }
    }
  };
  if (isReqObj) copyHeadersFrom(input.headers);
  copyHeadersFrom(init.headers);

  const cookieVal = readTabCookie();
  if (cookieVal && !headers.cookie) {
    headers.cookie = cookieVal;
  }

  let bodyText = '';
  if (typeof init.body === 'string') {
    bodyText = init.body;
  } else if (isReqObj && method !== 'GET' && method !== 'HEAD') {
    bodyText = await input.clone().text();
  }

  const transport = await getTransport();
  const res = await transport.sendApi({ method, url: apiUrl, headers, bodyText });
  if (res.headers && res.headers['set-cookie']) {
    applySetCookieHeader(res.headers['set-cookie']);
  }

  const respHeaders = new Headers();
  for (const [k, v] of Object.entries(res.headers || {})) {
    if (k.toLowerCase() !== 'set-cookie') respHeaders.set(k, v);
  }
  return new Response(res.bodyText, { status: res.status, headers: respHeaders });
};

function parseSseFramesIntoEvents(bufferStr, dispatchFn) {
  const blocks = bufferStr.split('\n\n');
  const remainder = blocks.pop() || '';
  for (const block of blocks) {
    if (!block.trim() || block.startsWith(':')) continue;
    let evName = 'message';
    const dataLines = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) evName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    dispatchFn(evName, dataLines.join('\n'));
  }
  return remainder;
}

const activeEventSources = new Set();

class SharedWorkerEventSource {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.onerror = null;
    this.closed = false;
    this._buffer = '';
    this._cleanup = null;
    activeEventSources.add(this);

    const cookieVal = readTabCookie();
    getTransport().then((transport) => {
      if (this.closed) return;
      this._cleanup = transport.openSse(
        cookieVal ? { cookie: cookieVal } : {},
        (chunk) => {
          if (this.closed) return;
          this._buffer = parseSseFramesIntoEvents(this._buffer + chunk, (evName, dataStr) => {
            const cbs = this.listeners.get(evName) || [];
            for (const cb of cbs) {
              try { cb({ data: dataStr }); } catch { /* ignore */ }
            }
          });
        },
        () => {
          if (!this.closed && typeof this.onerror === 'function') {
            this.onerror(new Event('error'));
          }
        }
      );
    });
  }
  addEventListener(type, cb) {
    const arr = this.listeners.get(type) || [];
    arr.push(cb);
    this.listeners.set(type, arr);
  }
  close() {
    this.closed = true;
    activeEventSources.delete(this);
    if (this._cleanup) {
      this._cleanup();
      this._cleanup = null;
    }
  }
}

window.addEventListener('pagehide', (ev) => {
  for (const es of [...activeEventSources]) {
    es.close();
  }
  if (!ev.persisted && sharedPortRef) {
    try { sharedPortRef.postMessage({ kind: 'PORT_CLOSING' }); } catch { /* ignore */ }
    sharedPortRef = null;
    transportReadyPromise = null;
  }
});

window.addEventListener('pageshow', (ev) => {
  if (ev.persisted) {
    sharedPortRef = null;
    transportReadyPromise = null;
  }
});

window.EventSource = SharedWorkerEventSource;
