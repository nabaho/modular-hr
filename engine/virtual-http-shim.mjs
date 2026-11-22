/**
 * src/server.mjs 의 http.createServer(handler) 를 SharedWorker / 브라우저 메모리 안에서 구동하는 가상 HTTP 어댑터
 */

import { BufferShim } from './browser-crypto-shim.mjs?v=7df477f6fc75';

export function createVirtualHttpServer(handler) {
  const closeListeners = [];
  const activeSseResponses = new Set();

  return {
    address() {
      return { port: 4330 };
    },
    on(ev, fn) {
      if (ev === 'close') closeListeners.push(fn);
    },
    close(cb) {
      for (const fn of closeListeners) {
        try { fn(); } catch { /* ignore */ }
      }
      if (typeof cb === 'function') cb();
    },
    broadcastSyncFrame() {
      for (const writeFn of activeSseResponses) {
        try {
          writeFn('event: sync\ndata: {}\n\n');
        } catch {
          // ignore
        }
      }
    },
    dispatchRequest({ method = 'GET', url = '/', headers = {}, bodyText = '' }, onSseChunk = null) {
      return new Promise((resolve) => {
        const reqListeners = new Map();
        const normHeaders = Object.create(null);
        for (const [k, v] of Object.entries(headers || {})) {
          if (v !== undefined && v !== null) normHeaders[k.toLowerCase()] = String(v);
        }
        normHeaders.host = '127.0.0.1:4330';
        if (!normHeaders.origin && method !== 'GET' && method !== 'HEAD') {
          normHeaders.origin = 'http://127.0.0.1:4330';
        }

        const req = {
          method,
          url,
          headers: normHeaders,
          socket: { remoteAddress: '127.0.0.1' },
          on(ev, fn) {
            const list = reqListeners.get(ev) || [];
            list.push(fn);
            reqListeners.set(ev, list);
          },
          resume() {},
          _emitClose() {
            for (const fn of reqListeners.get('close') || []) {
              try { fn(); } catch { /* ignore */ }
            }
          },
        };

        const resHeaders = Object.create(null);
        let statusCode = 200;
        const outChunks = [];
        const isSse = url.startsWith('/api/mobile/stream');

        const forwardSse = (txt) => {
          if (onSseChunk) onSseChunk(String(txt));
        };

        const res = {
          headersSent: false,
          setHeader(k, v) {
            resHeaders[String(k).toLowerCase()] = String(v);
          },
          writeHead(code, hdrs = {}) {
            statusCode = code;
            res.headersSent = true;
            for (const [k, v] of Object.entries(hdrs)) {
              resHeaders[String(k).toLowerCase()] = String(v);
            }
            if (isSse && statusCode === 200) {
              activeSseResponses.add(forwardSse);
              resolve({
                status: 200,
                headers: resHeaders,
                bodyText: '',
                closeStream() {
                  activeSseResponses.delete(forwardSse);
                  req._emitClose();
                },
              });
            }
          },
          write(chunk) {
            if (isSse && statusCode === 200) {
              forwardSse(chunk);
            } else {
              outChunks.push(String(chunk ?? ''));
            }
            return true;
          },
          end(chunk) {
            res.headersSent = true;
            if (chunk !== undefined && chunk !== null) {
              if (isSse && statusCode === 200) forwardSse(chunk);
              else outChunks.push(String(chunk));
            }
            if (isSse) {
              activeSseResponses.delete(forwardSse);
            }
            resolve({
              status: statusCode,
              headers: resHeaders,
              bodyText: outChunks.join(''),
            });
          },
        };

        Promise.resolve(handler(req, res)).catch((err) => {
          resolve({
            status: err?.statusCode || 500,
            headers: { 'content-type': 'application/json; charset=utf-8' },
            bodyText: JSON.stringify({ error: err?.message || 'Internal Error' }),
          });
        });

        queueMicrotask(() => {
          if (bodyText && bodyText.length > 0) {
            const buf = BufferShim.from(bodyText, 'utf8');
            for (const fn of reqListeners.get('data') || []) fn(buf);
          }
          for (const fn of reqListeners.get('end') || []) fn();
        });
      });
    },
  };
}

export default { createServer: createVirtualHttpServer };
