'use strict';
/*
 * Apps Script memuat file sesuai urutan proyek (clasp: alfabet bila filePushOrder tidak diisi).
 * Kode tidak boleh bergantung pada urutan itu saat dimuat; uji dengan banyak urutan acak + terbalik.
 */
const assert = require('node:assert/strict');
const { createEnv, LOAD_ORDER } = require('./harness');

function shuffle(arr, seed) {
  const a = arr.slice();
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) % 4294967296;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const orders = [
  LOAD_ORDER.slice().sort(),            // alfabet (bawaan clasp)
  LOAD_ORDER.slice().sort().reverse(),  // terbalik
  LOAD_ORDER.slice().reverse()
];
for (let i = 1; i <= 25; i++) orders.push(shuffle(LOAD_ORDER, i));

orders.forEach((order, i) => {
  const env = createEnv({ loadOrder: order });
  const pw = env.setup();
  const d = env.call('auth.login', { username: 'admin', password: pw });
  assert.equal(d.ok, true, 'urutan #' + i + ': ' + order.join(','));
});
console.log(`  ok - ${orders.length} urutan pemuatan berbeda: semua berjalan`);
