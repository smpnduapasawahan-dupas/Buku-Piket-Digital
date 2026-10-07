'use strict';
const assert = require('node:assert/strict');
const { createEnv } = require('./harness');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok -', name); }
  catch (e) { failures.push(name); console.log('  GAGAL -', name, '\n    ', e.message.split('\n')[0]); }
}
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
const err = (r, code) => { assert.equal(r.ok, false, 'seharusnya gagal'); assert.equal(r.error.code, code, JSON.stringify(r.error)); return r.error; };

// ---------- setup & login dasar ----------
const env = createEnv();
let adminTemp;
test('setupApp membuat semua sheet, admin pertama, dan menyembunyikan Kredensial', () => {
  adminTemp = env.setup();
  assert.match(adminTemp, /^[A-HJ-NP-Z2-9]{8}$/);
  for (const n of ['Pengguna', 'Kredensial', 'LogAktivitas', 'Pengaturan', 'Kelas', 'JadwalPelajaran', 'JadwalPiket']) {
    assert.ok(env.sheet(n), 'sheet ' + n);
  }
  assert.equal(env.sheet('Sheet1'), null, 'Sheet1 kosong dihapus');
  assert.equal(env.sheet('Kredensial').hidden, true);
  const cred = env.sheet('Kredensial').dump();
  assert.match(cred[1][1], /^pbkdf2-sha256\$60000\$/);
  assert.ok(!JSON.stringify(env.sheet('Pengguna').dump()).includes(adminTemp), 'password tidak ada di Pengguna');
});

test('setupApp aman dijalankan ulang (tidak membuat admin kedua)', () => {
  env.logger.length = 0;
  env.run('setupApp()');
  assert.equal(env.sheet('Pengguna').dump().length, 2);
  assert.match(env.logger.join(''), /sudah ada/);
});

test('fungsi pemeliharaan ditolak untuk pengunjung anonim', () => {
  const anon = createEnv({ owner: false });
  assert.throws(() => anon.run('setupApp()'), /pemilik skrip/);
  assert.throws(() => anon.run('resetAdminPassword()'), /pemilik skrip/);
});

test('login: pesan sama untuk username salah, tidak dikenal, dan tak valid', () => {
  const a = err(env.call('auth.login', { username: 'admin', password: 'salah-salah' }), 'INVALID_CREDENTIALS');
  const b = err(env.call('auth.login', { username: 'tidakada', password: 'salah-salah' }), 'INVALID_CREDENTIALS');
  const c = err(env.call('auth.login', { username: 'A B!', password: 'x' }), 'INVALID_CREDENTIALS');
  assert.equal(a.message, b.message);
  assert.equal(b.message, c.message);
});

test('login: 5 kegagalan mengunci akun, bahkan untuk password benar; terbuka setelah 15 menit', () => {
  const e = createEnv();
  const pw = e.setup();
  for (let i = 0; i < 4; i++) err(e.call('auth.login', { username: 'admin', password: 'bukan' }), 'INVALID_CREDENTIALS');
  err(e.call('auth.login', { username: 'admin', password: 'bukan' }), 'LOCKED');
  err(e.call('auth.login', { username: 'admin', password: pw }), 'LOCKED');
  e.advance(15 * 60 * 1000 + 1000);
  ok(e.call('auth.login', { username: 'admin', password: pw }));
});

test('login admin: wajib ganti password; aksi lain diblokir, bootstrap diizinkan', () => {
  const d = ok(env.call('auth.login', { username: 'ADMIN ', password: adminTemp }));
  assert.equal(d.mustChange, true);
  assert.match(d.token, /^[0-9a-f]{64}$/);
  assert.deepEqual(d.roles, []);
  err(env.call('users.list', {}, d.token), 'PASSWORD_CHANGE_REQUIRED');
  const b = ok(env.call('session.bootstrap', {}, d.token));
  assert.equal(b.mustChange, true);
  assert.equal(b.user.username, 'admin');
});

// ---------- ganti password ----------
let adminToken;
const ADMIN_PW = 'Sekolah-Baru-2026';
test('ganti password: aturan password baru ditegakkan di server', () => {
  const t0 = ok(env.call('auth.login', { username: 'admin', password: adminTemp })).token;
  err(env.call('auth.changePassword', { oldPassword: adminTemp, newPassword: 'pendek' }, t0), 'WEAK_PASSWORD');
  err(env.call('auth.changePassword', { oldPassword: adminTemp, newPassword: adminTemp }, t0), 'WEAK_PASSWORD');
  err(env.call('auth.changePassword', { oldPassword: adminTemp, newPassword: '        ' }, t0), 'WEAK_PASSWORD');
  err(env.call('auth.changePassword', { oldPassword: adminTemp, newPassword: 'x'.repeat(129) }, t0), 'WEAK_PASSWORD');
  err(env.call('auth.changePassword', { oldPassword: 'salah-lama', newPassword: ADMIN_PW }, t0), 'INVALID_CREDENTIALS');
  const d = ok(env.call('auth.changePassword', { oldPassword: adminTemp, newPassword: ADMIN_PW }, t0));
  adminToken = d.token;
  assert.equal(d.mustChange, false);
  assert.deepEqual(d.roles.map((r) => r.id), ['admin']);
  assert.equal(d.defaultRole, 'admin');
  err(env.call('session.bootstrap', {}, t0), 'UNAUTHENTICATED');
  ok(env.call('session.bootstrap', {}, adminToken));
});

test('password sementara lama tidak berlaku lagi; password baru berlaku', () => {
  err(env.call('auth.login', { username: 'admin', password: adminTemp }), 'INVALID_CREDENTIALS');
  const d = ok(env.call('auth.login', { username: 'admin', password: ADMIN_PW }));
  assert.equal(d.mustChange, false);
  adminToken = d.token;
});

test('password sama dengan username ditolak', () => {
  err(env.call('auth.changePassword', { oldPassword: ADMIN_PW, newPassword: 'ADMIN' }, adminToken), 'WEAK_PASSWORD');
});

// ---------- manajemen pengguna ----------
let guruTemp;
test('admin membuat akun Guru; validasi & duplikat', () => {
  err(env.call('users.create', { username: 'Bu Rina!', nama: 'Rina Marlina', tipe: 'Guru', nip: '1980' }, adminToken), 'VALIDATION');
  err(env.call('users.create', { username: 'rina', nama: 'Ri', tipe: 'Guru', nip: '198001012005012001' }, adminToken), 'VALIDATION');
  err(env.call('users.create', { username: 'rina', nama: 'Rina Marlina', tipe: 'Guru', nip: '' }, adminToken), 'VALIDATION');
  err(env.call('users.create', { username: 'rina', nama: 'Rina Marlina', tipe: 'Guru', nip: '12ab' }, adminToken), 'VALIDATION');
  err(env.call('users.create', { username: 'rina', nama: 'Rina Marlina', tipe: 'Guru ', nip: '198001012005012001' }, adminToken), 'VALIDATION');
  const d = ok(env.call('users.create', { username: 'Rina', nama: '  Rina   Marlina, S.Pd ', tipe: 'Guru', nip: '1980 0101 2005 0120 01' }, adminToken));
  assert.equal(d.username, 'rina');
  assert.equal(d.nama, 'Rina Marlina, S.Pd');
  assert.match(d.tempPassword, /^[A-HJ-NP-Z2-9]{8}$/);
  guruTemp = d.tempPassword;
  err(env.call('users.create', { username: 'RINA', nama: 'Lain Orang', tipe: 'Guru', nip: '111111' }, adminToken), 'DUPLICATE');
  err(env.call('users.create', { username: 'rina2', nama: 'Lain Orang', tipe: 'Guru', nip: '198001012005012001' }, adminToken), 'DUPLICATE');
});

test('nama berawalan "=" disimpan sebagai teks (anti injeksi rumus)', () => {
  ok(env.call('users.create', { username: 'kepsek', nama: '=HYPERLINK("http://x","klik")', tipe: 'Kepala Sekolah', nip: '' }, adminToken));
  const list = ok(env.call('users.list', {}, adminToken)).users;
  const k = list.find((u) => u.username === 'kepsek');
  assert.equal(k.nama, '=HYPERLINK("http://x","klik")');
  // sel di sheet tidak dimulai dengan rumus aktif: Util.cell menambah apostrof pelindung
  assert.equal(env.run('Util.cell("=1+1")'), "'=1+1");
});

test('users.list tidak membocorkan hash/password; membawa status belumGanti', () => {
  const res = env.call('users.list', {}, adminToken);
  const text = JSON.stringify(res);
  assert.ok(!/pbkdf2|hash|password/i.test(text.replace(/belumGanti/g, '')));
  const rina = res.data.users.find((u) => u.username === 'rina');
  assert.equal(rina.belumGanti, true);
  assert.equal(rina.aktif, true);
  assert.equal(res.data.users.find((u) => u.username === 'admin').belumGanti, false);
});

// ---------- otorisasi ----------
let guruToken;
const GURU_PW = 'GuruRina-2026!';
test('guru: login pertama wajib ganti password; tidak bisa memakai aksi Admin', () => {
  const d = ok(env.call('auth.login', { username: 'rina', password: guruTemp }));
  assert.equal(d.mustChange, true);
  err(env.call('users.list', {}, d.token), 'PASSWORD_CHANGE_REQUIRED');
  const c = ok(env.call('auth.changePassword', { oldPassword: guruTemp, newPassword: GURU_PW }, d.token));
  guruToken = c.token;
  err(env.call('users.list', {}, guruToken), 'FORBIDDEN');
  err(env.call('users.create', { username: 'x1x', nama: 'Xxx Xxx', tipe: 'Admin' }, guruToken), 'FORBIDDEN');
  err(env.call('users.resetPassword', { username: 'admin' }, guruToken), 'FORBIDDEN');
  assert.deepEqual(c.roles, [], 'belum ada jadwal: belum ada peran guru');
  assert.equal(c.defaultRole, null);
});

test('permintaan tanpa token / token palsu / aksi aneh ditolak', () => {
  err(env.call('users.list', {}, undefined), 'UNAUTHENTICATED');
  err(env.call('users.list', {}, 'a'.repeat(64)), 'UNAUTHENTICATED');
  err(env.call('users.list', {}, "'; DROP"), 'UNAUTHENTICATED');
  for (const a of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '', 'users.delete']) {
    err(env.call(a, {}, adminToken), 'NOT_FOUND');
  }
  env.sandbox.__req = null;
  err(JSON.parse(JSON.stringify(env.run('api(null)'))), 'BAD_REQUEST');
  err(JSON.parse(JSON.stringify(env.run('api("teks")'))), 'BAD_REQUEST');
  err(env.call('auth.login', { username: 'admin', password: 'x'.repeat(30000) }), 'BAD_REQUEST');
});

// ---------- peran turunan ----------
test('peran guru diturunkan dari jadwal: mapel, wali kelas, piket hari ini', () => {
  const nip = '198001012005012001';
  env.sheet('JadwalPelajaran').appendRow(['Senin', '1', '7A', 'IPA', nip]);
  env.sheet('Kelas').appendRow(['8B', nip]);
  const hari = env.run('Util.todayInfo()');
  env.sheet('JadwalPiket').appendRow([hari.day, nip, '', 'tetap']);
  env.advance(301 * 1000); // lewati TTL cache indeks peran
  const d = ok(env.call('auth.login', { username: 'rina', password: GURU_PW }));
  assert.deepEqual(d.roles.map((r) => r.id).sort(), ['guru_mapel', 'guru_piket', 'wali_kelas']);
  assert.equal(d.defaultRole, 'guru_piket', 'hari piket: Guru Piket menjadi layar awal');
  guruToken = d.token;
});

test('Roles.compute: piket tetap / tambahan / batal / hari lain / tipe akun', () => {
  const idx = {
    mapel: ['111'], wali: ['222'],
    piket: [
      { nip: '111', hari: 'rabu', tanggal: '', jenis: 'tetap' },
      { nip: '333', hari: '', tanggal: '2026-10-07', jenis: 'tambahan' },
      { nip: '444', hari: 'rabu', tanggal: '', jenis: 'tetap' },
      { nip: '444', hari: '', tanggal: '2026-10-07', jenis: 'batal' }
    ]
  };
  const rabu = { date: '2026-10-07', day: 'Rabu' };
  const kamis = { date: '2026-10-08', day: 'Kamis' };
  env.sandbox.__i = idx; env.sandbox.__r = rabu; env.sandbox.__k = kamis;
  const ids = (user, info) => JSON.parse(env.run(`JSON.stringify(Roles.compute(${JSON.stringify(user)}, __i, ${info}).roles.map(r => r.id))`));
  assert.deepEqual(ids({ tipe: 'Guru', nip: '111' }, '__r'), ['guru_piket', 'guru_mapel']);
  assert.deepEqual(ids({ tipe: 'Guru', nip: '111' }, '__k'), ['guru_mapel'], 'hari lain: peran piket hilang');
  assert.deepEqual(ids({ tipe: 'Guru', nip: '333' }, '__r'), ['guru_piket'], 'piket tambahan tanggal itu');
  assert.deepEqual(ids({ tipe: 'Guru', nip: '333' }, '__k'), []);
  assert.deepEqual(ids({ tipe: 'Guru', nip: '444' }, '__r'), [], 'batal mengalahkan piket tetap');
  assert.deepEqual(ids({ tipe: 'Guru', nip: '444' }, '__k'), []);
  assert.deepEqual(ids({ tipe: 'Admin', nip: '' }, '__r'), ['admin']);
  assert.deepEqual(ids({ tipe: 'Kepala Sekolah', nip: '222' }, '__r'), ['kepsek', 'wali_kelas']);
  const def = (user, info) => env.run(`Roles.compute(${JSON.stringify(user)}, __i, ${info}).defaultRole`);
  assert.equal(def({ tipe: 'Admin', nip: '111' }, '__k'), 'admin', 'admin lebih dulu dari guru mapel');
  assert.equal(def({ tipe: 'Guru', nip: '222' }, '__r'), 'wali_kelas');
  assert.equal(def({ tipe: 'Guru', nip: '999' }, '__r'), null);
});

// ---------- reset, nonaktif, perlindungan admin ----------
test('reset password: sesi lama dicabut, kunci dibuka, wajib ganti lagi; tak bisa reset diri sendiri', () => {
  err(env.call('users.resetPassword', { username: 'admin' }, adminToken), 'FORBIDDEN_SELF');
  err(env.call('users.resetPassword', { username: 'tidakada' }, adminToken), 'NOT_FOUND');
  for (let i = 0; i < 5; i++) env.call('auth.login', { username: 'rina', password: 'salah-terus' });
  err(env.call('auth.login', { username: 'rina', password: GURU_PW }), 'LOCKED');
  const r = ok(env.call('users.resetPassword', { username: 'rina' }, adminToken));
  assert.match(r.tempPassword, /^[A-HJ-NP-Z2-9]{8}$/);
  err(env.call('session.bootstrap', {}, guruToken), 'UNAUTHENTICATED');
  err(env.call('auth.login', { username: 'rina', password: GURU_PW }), 'INVALID_CREDENTIALS');
  const d = ok(env.call('auth.login', { username: 'rina', password: r.tempPassword }));
  assert.equal(d.mustChange, true);
  guruTemp = r.tempPassword;
  guruToken = d.token;
});

test('nonaktifkan akun: sesi langsung tidak sah, login ditolak; aktifkan kembali berfungsi', () => {
  const up = (aktif) => env.call('users.update', { username: 'rina', nama: 'Rina Marlina', tipe: 'Guru', nip: '198001012005012001', aktif }, adminToken);
  ok(up(false));
  err(env.call('session.bootstrap', {}, guruToken), 'UNAUTHENTICATED');
  err(env.call('auth.login', { username: 'rina', password: guruTemp }), 'INVALID_CREDENTIALS');
  ok(up(true));
  ok(env.call('auth.login', { username: 'rina', password: guruTemp }));
});

test('admin tidak bisa menonaktifkan/menurunkan diri sendiri; admin terakhir terlindungi', () => {
  const me = (extra) => env.call('users.update', Object.assign({ username: 'admin', nama: 'Administrator', tipe: 'Admin', nip: '', aktif: true }, extra), adminToken);
  err(me({ aktif: false }), 'FORBIDDEN_SELF');
  err(me({ tipe: 'Guru', nip: '555555' }), 'FORBIDDEN_SELF');
  ok(me({ nama: 'Administrator Sekolah' }));
  // admin kedua lalu nonaktifkan: boleh; admin pertama tetap aktif
  ok(env.call('users.create', { username: 'admin2', nama: 'Operator Dua', tipe: 'Admin' }, adminToken));
  ok(env.call('users.update', { username: 'admin2', nama: 'Operator Dua', tipe: 'Admin', nip: '', aktif: false }, adminToken));
  err(env.call('users.update', { username: 'tidakada', nama: 'Nama Palsu', tipe: 'Guru', nip: '123456', aktif: true }, adminToken), 'NOT_FOUND');
  err(env.call('users.update', { username: 'rina', nama: 'Rina', tipe: 'Guru', nip: '198001012005012001', aktif: 'ya' }, adminToken), 'VALIDATION');
});

test('NIP unik saat mengubah akun', () => {
  ok(env.call('users.create', { username: 'budi', nama: 'Budi Santoso', tipe: 'Guru', nip: '197501012000011001' }, adminToken));
  err(env.call('users.update', { username: 'budi', nama: 'Budi Santoso', tipe: 'Guru', nip: '198001012005012001', aktif: true }, adminToken), 'DUPLICATE');
});

// ---------- sesi, hash, galat ----------
test('sesi kedaluwarsa tepat setelah 6 jam', () => {
  const t = ok(env.call('auth.login', { username: 'admin', password: ADMIN_PW })).token;
  env.advance(5 * 3600 * 1000);
  ok(env.call('session.bootstrap', {}, t));
  env.advance(1.1 * 3600 * 1000);
  err(env.call('session.bootstrap', {}, t), 'UNAUTHENTICATED');
});

test('logout menghancurkan token', () => {
  const t = ok(env.call('auth.login', { username: 'admin', password: ADMIN_PW })).token;
  ok(env.call('auth.logout', {}, t));
  err(env.call('session.bootstrap', {}, t), 'UNAUTHENTICATED');
});

test('hash lama (iterasi lebih rendah) diperbarui otomatis saat login', () => {
  const e = createEnv();
  const pw = e.setup();
  const stored = e.run(`Crypto_.hashPassword(${JSON.stringify(pw)}, 2000)`);
  e.sheet('Kredensial').set(2, 2, stored);
  ok(e.call('auth.login', { username: 'admin', password: pw }));
  assert.match(e.sheet('Kredensial').get(2, 2), /^pbkdf2-sha256\$60000\$/);
  ok(e.call('auth.login', { username: 'admin', password: pw }));
});

test('galat tak terduga: pesan umum + kode rujukan, tanpa bocor stack trace', () => {
  const fresh = ok(env.call('auth.login', { username: 'admin', password: ADMIN_PW })).token;
  env.run('globalThis.__origList = Users.list; Users.list = function () { throw new Error("rahasia internal /src/Users.js:99"); }');
  const res = env.call('users.list', {}, fresh);
  env.run('Users.list = globalThis.__origList');
  const e = err(res, 'INTERNAL');
  assert.ok(!/rahasia|Users\.js|at /.test(JSON.stringify(res)));
  assert.match(e.ref, /^[0-9a-f]{8}$/);
  assert.ok(env.consoleLines.error.some((l) => l.includes(e.ref) && l.includes('rahasia internal')), 'detail ada di log server');
});

test('log aktivitas mencatat login, ganti password, dan aksi admin', () => {
  const log = env.sheet('LogAktivitas').dump().slice(1).map((r) => r[2]);
  for (const a of ['login', 'changePassword', 'users.create', 'users.resetPassword', 'users.update', 'logout']) {
    assert.ok(log.includes(a), 'log ' + a);
  }
  assert.ok(!JSON.stringify(env.sheet('LogAktivitas').dump()).match(/pbkdf2|GuruRina|Sekolah-Baru/), 'log tidak memuat rahasia');
});

test('resetAdminPassword (pemilik): password baru, wajib ganti, sesi lama dicabut', () => {
  env.logger.length = 0;
  env.run('resetAdminPassword()');
  const pw = env.logger.join('').match(/Password : ([A-Z2-9]{8})/)[1];
  err(env.call('session.bootstrap', {}, adminToken), 'UNAUTHENTICATED');
  assert.equal(ok(env.call('auth.login', { username: 'admin', password: pw })).mustChange, true);
});

test('hasil api() selalu dapat diserialisasi (tanpa Date/undefined) untuk google.script.run', () => {
  const e = createEnv();
  const pw = e.setup();
  const d = ok(e.call('auth.login', { username: 'admin', password: pw }));
  const raw = e.run(`api({action:'session.bootstrap', token:${JSON.stringify(d.token)}})`);
  const walk = (v) => {
    if (v === undefined || v instanceof e.sandbox.Date) throw new Error('nilai tak dapat diserialisasi');
    if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(raw);
});

console.log(`\n${passed} lulus, ${failures.length} gagal`);
if (failures.length) { console.log('Gagal:', failures.join('; ')); process.exit(1); }
