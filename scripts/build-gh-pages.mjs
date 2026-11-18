/**
 * GitHub Pages(https://nabaho.github.io/modular-hr/) 무서버 정적 배포 번들 빌더 (SharedWorker + Server-Core 통합형)
 * - src/server.mjs(createAppServer)와 8개 코어 엔진(src/engine/*.mjs)을 코드 복제·축약 없이 그대로 변환해 포함하므로,
 *   급여 잠금(APPROVED_LOCKED 409), 모바일 4역할 RBAC, 비식별 파기 Tombstone 및 감사로그 삭제, 일용직 퇴사,
 *   5종 프리셋, 입력 스키마 검증이 로컬 서버와 100% 동일하게 동작한다.
 * - SharedWorker(virtual-server-worker.mjs) 위에서 단일 createAppServer 인스턴스를 공유하므로,
 *   PC 콘솔(index.html), 분리 팝업창, 모바일 폰 앱(mobile.html) 팝업이 동일한 실시간 원장·결재·SSE 스트림을 공유한다.
 *   (SharedWorker 미지원 모바일 구형 브라우저에서는 자동으로 탭 내 단일 서버 모드로 폴백한다.)
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(PROJECT_ROOT, 'dist-pages');
const OUT_ENGINE_DIR = path.join(OUT_DIR, 'engine');

const STATIC_CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'self'; form-action 'self'" />`;

function replaceStrict(source, searchValue, replaceValue, label) {
  const next = source.replace(searchValue, replaceValue);
  if (next === source) {
    throw new Error(`[build-gh-pages] 필수 코드 변환 실패 (${label}): 대상 패턴을 찾지 못했습니다.`);
  }
  return next;
}

const BROWSER_CRYPTO_SHIM_SOURCE = `/**
 * 브라우저 전용 경량 node:crypto 및 Buffer 호환 심
 * - 주의: 본 심의 키 파생 함수(deriveBrowserDemoKey)는 브라우저 내 시뮬레이터 데모 전용이며 실서비스·실개인정보 암호화에 재사용해서는 안 된다.
 */

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x, n) {
  return (x >>> n) | (x << (32 - n));
}

function utf8ToBytes(str) {
  return new TextEncoder().encode(String(str));
}

function hexToBytes(hex) {
  const s = String(hex).trim();
  if (s.length % 2 !== 0 || /[^0-9a-fA-F]/.test(s)) {
    const clean = s.replace(/[^0-9a-fA-F]/g, '');
    const out = new Uint8Array(Math.floor(clean.length / 2));
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function base64ToBytes(b64) {
  const norm = String(b64).replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm.length % 4 === 0 ? '' : '='.repeat(4 - (norm.length % 4));
  const bin = atob(norm + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

function bytesToBase64(bytes, urlSafe = false) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  return urlSafe ? b64.replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '') : b64;
}

class ByteBuf extends Uint8Array {
  toString(encoding = 'utf8') {
    const enc = String(encoding).toLowerCase();
    if (enc === 'hex') return bytesToHex(this);
    if (enc === 'base64') return bytesToBase64(this, false);
    if (enc === 'base64url') return bytesToBase64(this, true);
    return new TextDecoder().decode(this);
  }
}

function wrapBuf(u8) {
  const b = new ByteBuf(u8.length);
  b.set(u8);
  return b;
}

export const BufferShim = {
  from(input, encoding = 'utf8') {
    if (input instanceof Uint8Array) return wrapBuf(input);
    if (Array.isArray(input)) return wrapBuf(new Uint8Array(input));
    const enc = String(encoding).toLowerCase();
    if (enc === 'hex') return wrapBuf(hexToBytes(input));
    if (enc === 'base64' || enc === 'base64url') return wrapBuf(base64ToBytes(input));
    return wrapBuf(utf8ToBytes(input));
  },
  alloc(size, fill = 0) {
    const b = new ByteBuf(size);
    b.fill(fill);
    return b;
  },
  concat(list = []) {
    const total = list.reduce((s, item) => s + item.length, 0);
    const merged = new ByteBuf(total);
    let offset = 0;
    for (const item of list) {
      merged.set(item, offset);
      offset += item.length;
    }
    return merged;
  },
  byteLength(str) {
    return utf8ToBytes(str).length;
  },
};

globalThis.Buffer ??= BufferShim;
globalThis.process ??= { env: {} };

function sha256Bytes(msgBytes) {
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const bitLen = msgBytes.length * 8;
  const padLen = ((msgBytes.length + 9 + 63) & ~63);
  const padded = new Uint8Array(padLen);
  padded.set(msgBytes);
  padded[msgBytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
  dv.setUint32(padLen - 4, bitLen >>> 0, false);

  const w = new Uint32Array(64);
  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  const out = new ByteBuf(32);
  const outDv = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((v, idx) => outDv.setUint32(idx * 4, v, false));
  return out;
}

function toBytes(val) {
  if (val instanceof Uint8Array) return val;
  return utf8ToBytes(String(val));
}

function hmacSha256Bytes(keyInput, msgInput) {
  let key = toBytes(keyInput);
  const msg = toBytes(msgInput);
  if (key.length > 64) key = sha256Bytes(key);
  const oKey = new Uint8Array(64);
  const iKey = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    const kb = i < key.length ? key[i] : 0;
    oKey[i] = kb ^ 0x5c;
    iKey[i] = kb ^ 0x36;
  }
  const inner = new Uint8Array(64 + msg.length);
  inner.set(iKey, 0);
  inner.set(msg, 64);
  const innerHash = sha256Bytes(inner);
  const outer = new Uint8Array(64 + 32);
  outer.set(oKey, 0);
  outer.set(innerHash, 64);
  return sha256Bytes(outer);
}

// 데모 시뮬레이터 전용 키 파생 (실서비스 운영 암호화에 사용 금지)
function deriveBrowserDemoKey(plainText, saltInput, keylen = 32) {
  let block = hmacSha256Bytes(toBytes(saltInput), utf8ToBytes(String(plainText)));
  for (let r = 0; r < 64; r++) {
    block = hmacSha256Bytes(block, toBytes(saltInput));
  }
  return wrapBuf(block.slice(0, keylen));
}

const cryptoShim = {
  randomUUID() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    const b = cryptoShim.randomBytes(16);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = b.toString('hex');
    return \`\${h.slice(0, 8)}-\${h.slice(8, 12)}-\${h.slice(12, 16)}-\${h.slice(16, 20)}-\${h.slice(20)}\`;
  },
  randomBytes(size) {
    const b = new ByteBuf(size);
    globalThis.crypto.getRandomValues(b);
    return b;
  },
  randomInt(min, max) {
    const range = max - min;
    if (!Number.isInteger(range) || range <= 0) throw new RangeError('Invalid randomInt range');
    const maxUnbiased = Math.floor(0x100000000 / range) * range;
    const arr = new Uint32Array(1);
    while (true) {
      globalThis.crypto.getRandomValues(arr);
      if (arr[0] < maxUnbiased) {
        return min + (arr[0] % range);
      }
    }
  },
  createHash() {
    const chunks = [];
    return {
      update(data) {
        chunks.push(toBytes(data));
        return this;
      },
      digest(enc) {
        const total = chunks.reduce((s, c) => s + c.length, 0);
        const merged = new Uint8Array(total);
        let pos = 0;
        for (const c of chunks) { merged.set(c, pos); pos += c.length; }
        const digest = sha256Bytes(merged);
        return enc ? digest.toString(enc) : digest;
      },
    };
  },
  createHmac(_alg, secret) {
    const chunks = [];
    return {
      update(data) {
        chunks.push(toBytes(data));
        return this;
      },
      digest(enc) {
        const total = chunks.reduce((s, c) => s + c.length, 0);
        const merged = new Uint8Array(total);
        let pos = 0;
        for (const c of chunks) { merged.set(c, pos); pos += c.length; }
        const digest = hmacSha256Bytes(secret, merged);
        return enc ? digest.toString(enc) : digest;
      },
    };
  },
  scryptSync(password, salt, keylen = 32) {
    return deriveBrowserDemoKey(password, salt, keylen);
  },
  scrypt(password, salt, keylen, _opts, cb) {
    const callback = typeof _opts === 'function' ? _opts : cb;
    try {
      const derived = deriveBrowserDemoKey(password, salt, keylen);
      queueMicrotask(() => callback(null, derived));
    } catch (err) {
      queueMicrotask(() => callback(err));
    }
  },
  timingSafeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  },
  async createPublicKey({ key, format, type }) {
    if (format !== 'der' || type !== 'spki' || !(key instanceof Uint8Array) || key.length < 40) {
      throw new Error('Invalid SPKI key');
    }
    const rawCopy = new Uint8Array(key);
    const cryptoKey = await globalThis.crypto.subtle.importKey(
      'spki',
      rawCopy,
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['verify']
    );
    const jwk = await globalThis.crypto.subtle.exportKey('jwk', cryptoKey);
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') {
      throw new Error('Unsupported curve');
    }
    return {
      asymmetricKeyType: 'ec',
      asymmetricKeyDetails: { namedCurve: 'prime256v1' },
      _cryptoKey: cryptoKey,
    };
  },
  async verify(_alg, dataBuf, keySpec, sigBuf) {
    try {
      const cryptoKey = keySpec?.key?._cryptoKey;
      if (!cryptoKey) return false;
      return await globalThis.crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        cryptoKey,
        sigBuf,
        dataBuf
      );
    } catch {
      return false;
    }
  },
};

export default cryptoShim;
`;

const VIRTUAL_HTTP_SHIM_SOURCE = `/**
 * src/server.mjs 의 http.createServer(handler) 를 SharedWorker / 브라우저 메모리 안에서 구동하는 가상 HTTP 어댑터
 */

import { BufferShim } from './browser-crypto-shim.mjs';

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
          writeFn('event: sync\\ndata: {}\\n\\n');
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
`;

const VIRTUAL_SERVER_WORKER_SOURCE = `/**
 * 동일 출처·서브패스 내 모든 창(PC index.html · 상세/새창 팝업 · 모바일 mobile.html 팝업)이
 * 단일 createAppServer 인스턴스(원장·결재·세션·SSE)를 공유하는 SharedWorker 엔트리
 */

import { createAppServer } from './server-core.mjs';

const appInstance = createAppServer({ demoMode: true });
const virtualServer = appInstance.server;

const NON_BROADCAST_PATHS = new Set([
  '/api/mobile/login',
  '/api/mobile/logout',
  '/api/mobile/mfa/challenge',
  '/api/mobile/mfa/verify',
  '/api/document',
  '/api/mobile/document',
  '/api/validate-posting',
  '/api/preview-offboarding',
  '/api/onboarding/stage',
]);

export async function invokeDirectInTab(reqPayload, onSseChunk = null) {
  const res = await virtualServer.dispatchRequest(reqPayload, onSseChunk);
  if (
    reqPayload.method === 'POST' &&
    res.status >= 200 &&
    res.status < 300 &&
    !NON_BROADCAST_PATHS.has(reqPayload.url)
  ) {
    virtualServer.broadcastSyncFrame();
    res.didMutateState = true;
  }
  return res;
}

if (typeof self !== 'undefined' && 'onconnect' in self) {
  const connectedPorts = new Set();

  self.onconnect = (connectEvent) => {
    const port = connectEvent.ports[0];
    const portStreams = new Map();
    let lastPongAt = Date.now();
    let disposed = false;

    const disposePort = () => {
      if (disposed) return;
      disposed = true;
      clearInterval(pingTimer);
      connectedPorts.delete(port);
      for (const closer of portStreams.values()) {
        try { closer(); } catch { /* ignore */ }
      }
      portStreams.clear();
    };

    const pingTimer = setInterval(() => {
      if (Date.now() - lastPongAt > 15000) {
        disposePort();
        return;
      }
      try {
        port.postMessage({ kind: 'PORT_PING' });
      } catch {
        disposePort();
      }
    }, 5000);
    pingTimer.unref?.();

    connectedPorts.add(port);

    port.onmessage = async (msgEvent) => {
      lastPongAt = Date.now();
      const msg = msgEvent.data || {};
      if (msg.kind === 'PORT_PONG') {
        return;
      }
      if (msg.kind === 'PORT_CLOSING') {
        disposePort();
        return;
      }
      if (msg.kind === 'API_REQ') {
        const res = await invokeDirectInTab(msg.payload);
        port.postMessage({
          kind: 'API_RES',
          reqId: msg.reqId,
          status: res.status,
          headers: res.headers,
          bodyText: res.bodyText,
        });
        if (res.didMutateState) {
          for (const peer of connectedPorts) {
            if (peer !== port) {
              try { peer.postMessage({ kind: 'SERVER_SYNC' }); } catch { /* ignore */ }
            }
          }
        }
      } else if (msg.kind === 'SSE_OPEN') {
        const streamId = msg.streamId;
        const res = await virtualServer.dispatchRequest(
          { method: 'GET', url: '/api/mobile/stream', headers: msg.headers || {} },
          (rawSseChunk) => {
            try {
              port.postMessage({ kind: 'SSE_CHUNK', streamId, chunk: rawSseChunk });
            } catch {
              disposePort();
            }
          }
        );
        if (res.status !== 200) {
          port.postMessage({ kind: 'SSE_ERROR', streamId, status: res.status });
        } else if (res.closeStream) {
          if (disposed) {
            res.closeStream();
          } else {
            portStreams.set(streamId, res.closeStream);
          }
        }
      } else if (msg.kind === 'SSE_CLOSE') {
        const closer = portStreams.get(msg.streamId);
        if (closer) {
          closer();
          portStreams.delete(msg.streamId);
        }
      }
    };
    port.start();
  };
}
`;

const STATIC_API_RUNTIME_SOURCE = `/**
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
  .replace(/\\/(?:index\\.html|mobile\\.html|404\\.html)?$/, '')
  .replace(/\\/$/, '');

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
    memoryCookiePair = \`\${firstPair.slice(0, eqIdx).trim()}=\${val}\`;
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
        const workerUrl = new URL('./virtual-server-worker.mjs?v=__BUNDLE_HASH__', import.meta.url);
        const sw = new SharedWorker(workerUrl, {
          type: 'module',
          name: \`modular-hr-shared-__BUNDLE_HASH__:\${APP_BASE_PATH || '/'}\`,
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
              const reqId = \`r_\${seq++}\`;
              pending.set(reqId, resolve);
              sw.port.postMessage({ kind: 'API_REQ', reqId, payload });
            });
          },
          openSse(headers, onChunk, onError) {
            const streamId = \`s_\${seq++}\`;
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

    const mod = await import('./virtual-server-worker.mjs?v=__BUNDLE_HASH__');
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
  if (APP_BASE_PATH && parsedUrl.pathname.startsWith(\`\${APP_BASE_PATH}/api/\`)) {
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
  const blocks = bufferStr.split('\\n\\n');
  const remainder = blocks.pop() || '';
  for (const block of blocks) {
    if (!block.trim() || block.startsWith(':')) continue;
    let evName = 'message';
    const dataLines = [];
    for (const line of block.split('\\n')) {
      if (line.startsWith('event:')) evName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    dispatchFn(evName, dataLines.join('\\n'));
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
`;

const REDIRECT_404_JS = `/**
 * GitHub Pages 깊은 하위 경로 404 진입 시 무한 리다이렉트 없이 저장소 루트(./ 또는 /<repo>/)로 복귀
 */
(function redirectToAppBase() {
  const segs = window.location.pathname.split('/').filter(Boolean);
  const target = window.location.hostname.endsWith('.github.io') && segs.length > 0
    ? '/' + segs[0] + '/'
    : '/';
  if (window.location.pathname !== target) {
    window.location.replace(target);
  }
})();
`;

function buildServerCoreFromSource() {
  let src = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'server.mjs'), 'utf8');
  src = replaceStrict(
    src,
    "import http from 'node:http';",
    "import http from './engine/virtual-http-shim.mjs';",
    'server.mjs http import'
  );
  src = replaceStrict(
    src,
    "import crypto from 'node:crypto';",
    "import crypto from './engine/browser-crypto-shim.mjs';",
    'server.mjs crypto import'
  );
  src = replaceStrict(
    src,
    "import fs from 'node:fs';\nimport path from 'node:path';\nimport { fileURLToPath } from 'node:url';",
    '// 정적 자산 서빙은 GitHub Pages CDN이 담당하며 server-core.mjs는 /api/* 전용으로 구동됨',
    'server.mjs fs/path/url imports'
  );
  src = replaceStrict(
    src,
    "const __filename = fileURLToPath(import.meta.url);\nconst __dirname = path.dirname(__filename);\nconst PUBLIC_DIR = path.resolve(__dirname, 'public');",
    "const PUBLIC_DIR = '/';",
    'server.mjs dirname setup'
  );
  src = replaceStrict(
    src,
    'function buildAllowedOrigins(boundPort) {\n  const baseHosts = [\'127.0.0.1\', \'localhost\', \'[::1]\', ...CUSTOM_LOCAL_DOMAINS];\n  return baseHosts.map((h) => `http://${h}:${boundPort}`);\n}',
    `function buildAllowedOrigins(boundPort) {
  const baseHosts = ['127.0.0.1', 'localhost', '[::1]', ...CUSTOM_LOCAL_DOMAINS];
  const list = baseHosts.map((h) => \`http://\${h}:\${boundPort}\`);
  if (typeof globalThis.location?.origin === 'string') {
    list.push(globalThis.location.origin.toLowerCase());
  }
  return list;
}`,
    'server.mjs buildAllowedOrigins'
  );

  const directRunIdx = src.indexOf('const isDirectRun =');
  if (directRunIdx < 0) {
    throw new Error('[build-gh-pages] server.mjs 에서 isDirectRun 블록을 찾지 못했습니다.');
  }
  src = `${src.slice(0, directRunIdx)}const isDirectRun = false;\n`;
  return src;
}

function assertNoRemainingNodeImports(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      assertNoRemainingNodeImports(full);
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
      const txt = fs.readFileSync(full, 'utf8');
      if (/from\s+['"]node:/.test(txt)) {
        throw new Error(`[build-gh-pages] 브라우저 번들에 변환되지 않은 node: import 잔류 감지: ${full}`);
      }
    }
  }
}

function appendVersionQueryToRelativeEsmImports(code, hash) {
  return code.replace(/(from\s+['"])(\.\.?\/[^'"?]+\.mjs)(['"])/g, `$1$2?v=${hash}$3`);
}

function main() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_ENGINE_DIR, { recursive: true });

  const serverCoreRaw = buildServerCoreFromSource();
  const hashBuilder = crypto.createHash('sha256');
  hashBuilder.update(serverCoreRaw);
  hashBuilder.update(BROWSER_CRYPTO_SHIM_SOURCE);
  hashBuilder.update(VIRTUAL_HTTP_SHIM_SOURCE);
  hashBuilder.update(VIRTUAL_SERVER_WORKER_SOURCE);
  hashBuilder.update(STATIC_API_RUNTIME_SOURCE);
  hashBuilder.update(REDIRECT_404_JS);

  const engineDir = path.join(PROJECT_ROOT, 'src', 'engine');
  const rawEngines = new Map();
  for (const entry of fs.readdirSync(engineDir).sort()) {
    if (!entry.endsWith('.mjs')) continue;
    const content = fs.readFileSync(path.join(engineDir, entry), 'utf8');
    rawEngines.set(entry, content);
    hashBuilder.update(content);
  }
  const publicDir = path.join(PROJECT_ROOT, 'src', 'public');
  for (const pubName of ['index.html', 'mobile.html', 'app.js', 'mobile.js', 'styles.css', 'mobile.css', 'sw.js']) {
    hashBuilder.update(fs.readFileSync(path.join(publicDir, pubName), 'utf8'));
  }
  const bundleHash = hashBuilder.digest('hex').slice(0, 12);

  // 1) 8개 코어 엔진 모듈 변환 복사 (상대 ESM import 캐시 무효화 해시 부여)
  const engineFiles = [];
  for (const [entry, origSrc] of rawEngines.entries()) {
    engineFiles.push(`./engine/${entry}`);
    let src = origSrc;
    if (src.includes('node:crypto')) {
      src = replaceStrict(
        src,
        "import crypto from 'node:crypto';",
        "import crypto from './browser-crypto-shim.mjs';",
        `${entry} crypto import`
      );
    }
    if (entry === 'mobile-auth-realtime.mjs') {
      src = replaceStrict(
        src,
        'const MAX_SSE_PER_SESSION = 3;',
        'const MAX_SSE_PER_SESSION = 12;',
        'mobile-auth-realtime MAX_SSE_PER_SESSION'
      );
      src = replaceStrict(
        src,
        'pubKeyObj = crypto.createPublicKey({',
        'pubKeyObj = await crypto.createPublicKey({',
        'mobile-auth-realtime createPublicKey await'
      );
      src = replaceStrict(
        src,
        'verified = crypto.verify(',
        'verified = await crypto.verify(',
        'mobile-auth-realtime verify await'
      );
    }
    src = appendVersionQueryToRelativeEsmImports(src, bundleHash);
    fs.writeFileSync(path.join(OUT_ENGINE_DIR, entry), src, 'utf8');
  }

  // 2) public 자산 복사 (이진 안전 copyFileSync 기본, HTML 및 sw.js만 명시적 변환 + 빌드 해시 부여)
  for (const entry of fs.readdirSync(publicDir)) {
    const srcFile = path.join(publicDir, entry);
    const dstFile = path.join(OUT_DIR, entry);
    if (entry === 'index.html') {
      let html = fs.readFileSync(srcFile, 'utf8');
      html = replaceStrict(html, '<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n  ${STATIC_CSP_META}`, 'index.html CSP meta');
      html = replaceStrict(
        html,
        '<link rel="stylesheet" href="./styles.css" />',
        `<link rel="stylesheet" href="./styles.css?v=${bundleHash}" />`,
        'index.html styles hash'
      );
      html = replaceStrict(
        html,
        '<script type="module" src="./app.js"></script>',
        `<script type="module" src="./static-api-runtime.mjs?v=${bundleHash}"></script>\n  <script type="module" src="./app.js?v=${bundleHash}"></script>`,
        'index.html runtime script'
      );
      fs.writeFileSync(dstFile, html, 'utf8');
    } else if (entry === 'mobile.html') {
      let html = fs.readFileSync(srcFile, 'utf8');
      html = replaceStrict(html, '<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n  ${STATIC_CSP_META}`, 'mobile.html CSP meta');
      html = replaceStrict(
        html,
        '<link rel="stylesheet" href="./mobile.css" />',
        `<link rel="stylesheet" href="./mobile.css?v=${bundleHash}" />`,
        'mobile.html styles hash'
      );
      html = replaceStrict(
        html,
        '<script type="module" src="./mobile.js"></script>',
        `<script type="module" src="./static-api-runtime.mjs?v=${bundleHash}"></script>\n  <script type="module" src="./mobile.js?v=${bundleHash}"></script>`,
        'mobile.html runtime script'
      );
      fs.writeFileSync(dstFile, html, 'utf8');
    } else if (entry === 'sw.js') {
      let sw = fs.readFileSync(srcFile, 'utf8');
      sw = replaceStrict(
        sw,
        "const SHELL_CACHE = 'modular-hr-shell-v3';",
        `const SHELL_CACHE = 'modular-hr-shell-${bundleHash}';`,
        'sw.js SHELL_CACHE hash'
      );
      sw = replaceStrict(
        sw,
        "  './mobile.css',\n  './mobile.js',",
        `  './mobile.css?v=${bundleHash}',\n  './mobile.js?v=${bundleHash}',`,
        'sw.js mobile asset hashes'
      );
      const extraAssets = [
        './index.html',
        `./styles.css?v=${bundleHash}`,
        `./app.js?v=${bundleHash}`,
        `./static-api-runtime.mjs?v=${bundleHash}`,
        `./virtual-server-worker.mjs?v=${bundleHash}`,
        `./server-core.mjs?v=${bundleHash}`,
        `./engine/browser-crypto-shim.mjs?v=${bundleHash}`,
        `./engine/virtual-http-shim.mjs?v=${bundleHash}`,
        ...engineFiles.map((p) => `${p}?v=${bundleHash}`),
      ]
        .map((p) => `  '${p}',`)
        .join('\n');
      sw = replaceStrict(sw, "  './icon.svg',", `  './icon.svg',\n${extraAssets}`, 'sw.js offline asset list');
      fs.writeFileSync(dstFile, sw, 'utf8');
    } else {
      fs.copyFileSync(srcFile, dstFile);
    }
  }

  // 3) 심 · 가상 HTTP 어댑터 · 서버 코어 · SharedWorker · 404 생성 (모든 상대 ESM import 에 ?v=bundleHash 적용)
  fs.writeFileSync(
    path.join(OUT_ENGINE_DIR, 'browser-crypto-shim.mjs'),
    appendVersionQueryToRelativeEsmImports(BROWSER_CRYPTO_SHIM_SOURCE, bundleHash),
    'utf8'
  );
  fs.writeFileSync(
    path.join(OUT_ENGINE_DIR, 'virtual-http-shim.mjs'),
    appendVersionQueryToRelativeEsmImports(VIRTUAL_HTTP_SHIM_SOURCE, bundleHash),
    'utf8'
  );
  fs.writeFileSync(
    path.join(OUT_DIR, 'server-core.mjs'),
    appendVersionQueryToRelativeEsmImports(serverCoreRaw, bundleHash),
    'utf8'
  );
  fs.writeFileSync(
    path.join(OUT_DIR, 'virtual-server-worker.mjs'),
    appendVersionQueryToRelativeEsmImports(VIRTUAL_SERVER_WORKER_SOURCE, bundleHash),
    'utf8'
  );
  fs.writeFileSync(
    path.join(OUT_DIR, 'static-api-runtime.mjs'),
    STATIC_API_RUNTIME_SOURCE.replaceAll('__BUNDLE_HASH__', bundleHash),
    'utf8'
  );
  fs.writeFileSync(path.join(OUT_DIR, 'redirect-404.js'), REDIRECT_404_JS, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, '.nojekyll'), '', 'utf8');
  fs.writeFileSync(
    path.join(OUT_DIR, '404.html'),
    `<!DOCTYPE html>\n<html lang="ko">\n<head>\n  <meta charset="UTF-8" />\n  ${STATIC_CSP_META}\n  <title>MODULAR HR 이동 중</title>\n  <script src="/modular-hr/redirect-404.js?v=${bundleHash}"></script>\n</head>\n<body>\n  <a href="/modular-hr/">모듈형 인사노무 플랫폼 홈으로 이동</a>\n</body>\n</html>\n`,
    'utf8'
  );

  assertNoRemainingNodeImports(OUT_DIR);
  console.log(`[build-gh-pages] SharedWorker 통합형 정적 배포 번들 생성 완료 (hash=${bundleHash}): ${OUT_DIR}`);
}

main();
