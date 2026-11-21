/**
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
  return urlSafe ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64;
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
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
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
