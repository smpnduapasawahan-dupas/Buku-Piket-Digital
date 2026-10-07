'use strict';
/* Uji Crypto.js terhadap implementasi referensi bawaan Node (node:crypto). */
const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { Utilities: { getUuid: () => nodeCrypto.randomUUID() }, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/Crypto.js'), 'utf8') + '\nthis.C = Crypto_;', sandbox);
const C = sandbox.C;

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('sha256 cocok dengan node:crypto (berbagai panjang)', () => {
  for (const len of [0, 1, 3, 55, 56, 63, 64, 65, 119, 120, 1000]) {
    const buf = nodeCrypto.randomBytes(len);
    const expect = nodeCrypto.createHash('sha256').update(buf).digest('hex');
    assert.equal(C.toHex(C.sha256(Uint8Array.from(buf))), expect, 'len=' + len);
  }
});

test('utf8Bytes cocok dengan Buffer (termasuk emoji & aksara non-Latin)', () => {
  for (const s of ['', 'abc', 'kata sandi é ñ', 'パスワード', '🔐pwd🙂', 'a'.repeat(200)]) {
    assert.deepEqual(Array.from(C.utf8Bytes(s)), Array.from(Buffer.from(s, 'utf8')), s);
  }
});

test('pbkdf2 cocok dengan nodeCrypto.pbkdf2Sync', () => {
  const cases = [
    ['password', 'salt', 1], ['password', 'salt', 2], ['password', 'salt', 4096],
    ['x'.repeat(100), 'garam-panjang-sekali-123456', 500], ['', 'abcdefgh', 10],
    ['🔐kunci', nodeCrypto.randomBytes(16).toString('latin1'), 777]
  ];
  for (const [pw, salt, it] of cases) {
    const saltBytes = Uint8Array.from(Buffer.from(salt, 'latin1'));
    const got = C.toHex(C.pbkdf2(C.utf8Bytes(pw), saltBytes, it));
    const expect = nodeCrypto.pbkdf2Sync(Buffer.from(pw, 'utf8'), Buffer.from(salt, 'latin1'), it, 32, 'sha256').toString('hex');
    assert.equal(got, expect, `pw=${pw.slice(0, 8)} it=${it}`);
  }
});

test('hash & verify: benar, salah, format rusak', () => {
  const stored = C.hashPassword('Rahasia123', 2000);
  assert.match(stored, /^pbkdf2-sha256\$2000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.equal(C.verifyPassword('Rahasia123', stored), true);
  assert.equal(C.verifyPassword('rahasia123', stored), false);
  assert.equal(C.verifyPassword('', stored), false);
  for (const bad of ['', 'abc', 'md5$1$a$b', 'pbkdf2-sha256$1$aa$bb', null, undefined]) {
    assert.equal(C.verifyPassword('x', bad), false);
  }
});

test('salt berbeda tiap hash; needsRehash membaca jumlah iterasi', () => {
  const a = C.hashPassword('sama', 1000);
  const b = C.hashPassword('sama', 1000);
  assert.notEqual(a, b);
  assert.equal(C.needsRehash(a, 1000), false);
  assert.equal(C.needsRehash(a, 5000), true);
  assert.equal(C.needsRehash('rusak', 1000), true);
});

test('randomString: panjang & alfabet benar, sebaran wajar', () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const s = C.randomString(8, alphabet);
    assert.equal(s.length, 8);
    assert.match(s, /^[A-HJ-NP-Z2-9]{8}$/);
    seen.add(s);
  }
  assert.equal(seen.size, 400);
  assert.throws(() => C.randomString(8, 'abc'));
});

test('randomHex: panjang tepat dan tidak berulang', () => {
  const set = new Set();
  for (let i = 0; i < 200; i++) {
    const t = C.randomHex(32);
    assert.match(t, /^[0-9a-f]{64}$/);
    set.add(t);
  }
  assert.equal(set.size, 200);
});

test('constantTimeEquals', () => {
  assert.equal(C.constantTimeEquals('abc', 'abc'), true);
  assert.equal(C.constantTimeEquals('abc', 'abd'), false);
  assert.equal(C.constantTimeEquals('abc', 'abcd'), false);
  assert.equal(C.constantTimeEquals('', ''), true);
});

const t0 = process.hrtime.bigint();
C.pbkdf2(C.utf8Bytes('benchmark'), new Uint8Array(16), 30000);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`\n${passed} uji lulus. PBKDF2 30.000 iterasi di Node: ${ms.toFixed(0)} ms`);
