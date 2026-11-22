/**
 * 동일 출처·서브패스 내 모든 창(PC index.html · 상세/새창 팝업 · 모바일 mobile.html 팝업)이
 * 단일 createAppServer 인스턴스(원장·결재·세션·SSE)를 공유하는 SharedWorker 엔트리
 */

import { createAppServer } from './server-core.mjs?v=1c398065676d';

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
