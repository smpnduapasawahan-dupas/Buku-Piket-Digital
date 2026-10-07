/**
 * Kriptografi password tanpa dependensi: SHA-256 dan PBKDF2-HMAC-SHA256 murni JavaScript.
 * Apps Script tidak menyediakan bcrypt/scrypt, dan Utilities.computeHmacSha256Signature
 * terlalu lambat bila dipanggil puluhan ribu kali, sehingga iterasi dilakukan lokal.
 */
const Crypto_ = (function () {
  const K = new Int32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);
  const IV = new Int32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);
  const W = new Int32Array(64);

  function rotr(x, n) {
    return (x >>> n) | (x << (32 - n));
  }

  /** Memproses satu blok 16 kata (big-endian) ke dalam state. */
  function compress(state, block) {
    for (let i = 0; i < 16; i++) W[i] = block[i];
    for (let i = 16; i < 64; i++) {
      const w15 = W[i - 15];
      const w2 = W[i - 2];
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let a = state[0], b = state[1], c = state[2], d = state[3];
    let e = state[4], f = state[5], g = state[6], h = state[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    state[0] = (state[0] + a) | 0; state[1] = (state[1] + b) | 0;
    state[2] = (state[2] + c) | 0; state[3] = (state[3] + d) | 0;
    state[4] = (state[4] + e) | 0; state[5] = (state[5] + f) | 0;
    state[6] = (state[6] + g) | 0; state[7] = (state[7] + h) | 0;
  }

  function bytesToWords(bytes, offset) {
    const words = new Int32Array(16);
    for (let i = 0; i < 16; i++) {
      const p = offset + i * 4;
      words[i] = (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3];
    }
    return words;
  }

  /**
   * Melanjutkan hash dari state yang sudah ada dengan pesan `bytes`.
   * prefixBytes = jumlah byte yang sudah diproses sebelumnya (kelipatan 64).
   */
  function finish(state, bytes, prefixBytes) {
    const total = bytes.length;
    const padded = new Uint8Array(Math.ceil((total + 9) / 64) * 64);
    padded.set(bytes);
    padded[total] = 0x80;
    const bitLen = (prefixBytes + total) * 8;
    const view = padded.length;
    padded[view - 4] = (bitLen >>> 24) & 0xff;
    padded[view - 3] = (bitLen >>> 16) & 0xff;
    padded[view - 2] = (bitLen >>> 8) & 0xff;
    padded[view - 1] = bitLen & 0xff;
    for (let off = 0; off < padded.length; off += 64) compress(state, bytesToWords(padded, off));
    return state;
  }

  function wordsToBytes(words) {
    const out = new Uint8Array(words.length * 4);
    for (let i = 0; i < words.length; i++) {
      out[i * 4] = (words[i] >>> 24) & 0xff;
      out[i * 4 + 1] = (words[i] >>> 16) & 0xff;
      out[i * 4 + 2] = (words[i] >>> 8) & 0xff;
      out[i * 4 + 3] = words[i] & 0xff;
    }
    return out;
  }

  function toHex(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return s;
  }

  function fromHex(hex) {
    if (typeof hex !== 'string' || hex.length % 2 !== 0 || /[^0-9a-f]/.test(hex)) return null;
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function sha256(bytes) {
    return wordsToBytes(finish(new Int32Array(IV), bytes, 0));
  }

  /** Encoder UTF-8 manual (TextEncoder tidak tersedia di Apps Script). */
  function utf8Bytes(str) {
    const out = [];
    for (let i = 0; i < str.length; i++) {
      let cp = str.charCodeAt(i);
      if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < str.length) {
        const next = str.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          cp = 0x10000 + ((cp - 0xd800) << 10) + (next - 0xdc00);
          i++;
        }
      }
      if (cp < 0x80) out.push(cp);
      else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
      else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
    return Uint8Array.from(out);
  }

  /** PBKDF2-HMAC-SHA256, panjang kunci 32 byte (satu blok). Mengembalikan Uint8Array. */
  function pbkdf2(passwordBytes, saltBytes, iterations) {
    let key = passwordBytes;
    if (key.length > 64) key = sha256(key);
    const ipad = new Uint8Array(64).fill(0x36);
    const opad = new Uint8Array(64).fill(0x5c);
    for (let i = 0; i < key.length; i++) {
      ipad[i] ^= key[i];
      opad[i] ^= key[i];
    }
    const innerBase = new Int32Array(IV);
    const outerBase = new Int32Array(IV);
    compress(innerBase, bytesToWords(ipad, 0));
    compress(outerBase, bytesToWords(opad, 0));

    // U1 = HMAC(P, salt || INT_32_BE(1))
    const msg = new Uint8Array(saltBytes.length + 4);
    msg.set(saltBytes);
    msg[msg.length - 1] = 1;
    const innerFirst = finish(new Int32Array(innerBase), msg, 64);
    const u = finish(new Int32Array(outerBase), wordsToBytes(innerFirst), 64);

    const t = new Int32Array(u);
    const block = new Int32Array(16);
    const inner = new Int32Array(8);
    const outer = new Int32Array(8);
    const LEN_BITS = (64 + 32) * 8;
    for (let n = 1; n < iterations; n++) {
      // inner = SHA256(ipad || U)
      inner.set(innerBase);
      for (let j = 0; j < 8; j++) block[j] = u[j];
      block[8] = 0x80000000 | 0;
      for (let j = 9; j < 15; j++) block[j] = 0;
      block[15] = LEN_BITS;
      compress(inner, block);
      // U = SHA256(opad || inner)
      outer.set(outerBase);
      for (let j = 0; j < 8; j++) block[j] = inner[j];
      compress(outer, block);
      for (let j = 0; j < 8; j++) {
        u[j] = outer[j];
        t[j] ^= outer[j];
      }
    }
    return wordsToBytes(t);
  }

  /** Mengambil `count` karakter hex acak dari UUID v4 (membuang digit versi/varian yang tetap). */
  function randomHexChars(count) {
    let out = '';
    while (out.length < count) {
      const raw = Utilities.getUuid().replace(/-/g, '');
      out += raw.slice(0, 12) + raw.slice(13, 16) + raw.slice(17);
    }
    return out.slice(0, count);
  }

  function randomHex(byteCount) {
    return randomHexChars(byteCount * 2);
  }

  /** String acak dari alfabet berukuran 32 (256 % 32 == 0, jadi tanpa bias). */
  function randomString(length, alphabet) {
    if (alphabet.length !== 32) throw new Error('Alfabet harus 32 karakter.');
    const bytes = fromHex(randomHexChars(length * 2));
    let out = '';
    for (let i = 0; i < length; i++) out += alphabet.charAt(bytes[i] % 32);
    return out;
  }

  function constantTimeEquals(a, b) {
    const x = String(a);
    const y = String(b);
    let diff = x.length ^ y.length;
    const n = Math.max(x.length, y.length);
    for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
    return diff === 0;
  }

  const FORMAT = 'pbkdf2-sha256';

  /** Format tersimpan: pbkdf2-sha256$iterasi$saltHex$hashHex */
  function hashPassword(password, iterations) {
    const salt = fromHex(randomHex(16));
    const derived = pbkdf2(utf8Bytes(password), salt, iterations);
    return [FORMAT, iterations, toHex(salt), toHex(derived)].join('$');
  }

  function parseStored(stored) {
    const parts = String(stored || '').split('$');
    if (parts.length !== 4 || parts[0] !== FORMAT) return null;
    const iterations = Number(parts[1]);
    if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 2000000) return null;
    const salt = fromHex(parts[2]);
    if (!salt || salt.length < 8) return null;
    if (!fromHex(parts[3]) || parts[3].length !== 64) return null;
    return { iterations: iterations, salt: salt, hash: parts[3] };
  }

  function verifyPassword(password, stored) {
    const parsed = parseStored(stored);
    if (!parsed) return false;
    const derived = toHex(pbkdf2(utf8Bytes(password), parsed.salt, parsed.iterations));
    return constantTimeEquals(derived, parsed.hash);
  }

  function needsRehash(stored, iterations) {
    const parsed = parseStored(stored);
    return !parsed || parsed.iterations < iterations;
  }

  return {
    sha256: sha256,
    utf8Bytes: utf8Bytes,
    pbkdf2: pbkdf2,
    toHex: toHex,
    randomHex: randomHex,
    randomString: randomString,
    constantTimeEquals: constantTimeEquals,
    hashPassword: hashPassword,
    verifyPassword: verifyPassword,
    needsRehash: needsRehash
  };
})();
