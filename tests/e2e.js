'use strict';
/* Menjalankan UI asli di Chromium; google.script.run dijembatani ke backend asli (harness vm). */
const fs = require('node:fs');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(path.join(process.env.NODE_PATH || '', 'playwright'))); }
const { createEnv } = require('./harness');

const SRC = path.join(__dirname, '../src');
const OUT = process.env.SHOTS || '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });

function buildHtml(boot) {
  const read = (n) => fs.readFileSync(path.join(SRC, n + '.html'), 'utf8');
  return read('Index')
    .replace('<?= appName ?>', 'Buku Piket Digital')
    .replace("<?!= include_('Styles') ?>", () => read('Styles'))
    .replace("<?!= include_('Client') ?>", () => read('Client'))
    .replace('<?!= boot ?>', () => JSON.stringify(boot));
}

(async () => {
  const env = createEnv();
  const adminTemp = env.setup();
  const boot = { appName: 'Buku Piket Digital', schoolName: 'SMPN 2 Pasawahan' };
  const html = buildHtml(boot);
  const problems = [];

  const browser = await chromium.launch();
  async function newPage(viewport, scheme) {
    const ctx = await browser.newContext({ viewport, colorScheme: scheme || 'light', deviceScaleFactor: 2, hasTouch: viewport.width < 600 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
    await page.exposeFunction('__api', (req) => JSON.parse(JSON.stringify(env.run(`api(${JSON.stringify(req)})`))));
    await page.addInitScript(() => {
      const make = (ok, fail) => ({
        withSuccessHandler(f) { return make(f, fail); },
        withFailureHandler(f) { return make(ok, f); },
        api(req) { window.__api(req).then((r) => setTimeout(() => ok && ok(r), 30), (e) => fail && fail(e)); }
      });
      window.google = { script: { run: make(null, null) } };
    });
    await page.route('**/app', (route) => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto('http://localhost/app');
    return page;
  }
  const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') });

  // ---- HP: login -> ganti password wajib -> beranda admin ----
  let page = await newPage({ width: 390, height: 780 });
  await page.waitForSelector('#loginForm');
  await shot(page, '01-login-hp');
  await page.fill('#lu', 'admin');
  await page.fill('#lp', 'salah-salah');
  await page.click('#loginBtn');
  await page.waitForSelector('#loginErr:not([hidden])');
  const errText = await page.textContent('#loginErr');
  if (!/salah/i.test(errText)) problems.push('pesan galat login tidak tampil: ' + errText);
  await page.fill('#lp', adminTemp);
  await page.click('#loginBtn');
  await page.waitForSelector('#pwForm');
  await shot(page, '02-ganti-password-hp');
  await page.fill('#pw0', adminTemp);
  await page.fill('#pw1', 'Sekolah-Baru-2026');
  await page.fill('#pw2', 'Sekolah-Baru-2026');
  await page.click('#pwBtn');
  await page.waitForSelector('.hero');
  await page.waitForSelector('.stat strong');
  await shot(page, '03-beranda-admin-hp');

  // ---- Pengguna: tambah guru ----
  await page.click('[data-nav="pengguna"]');
  await page.waitForSelector('.urow');
  await page.click('#addUser');
  await page.waitForSelector('#uForm');
  await page.fill('#fu', 'rina');
  await page.fill('#fn', 'Rina Marlina, S.Pd');
  await page.fill('#fp', '198001012005012001');
  await shot(page, '04-form-pengguna-hp');
  await page.click('#uSave');
  await page.waitForSelector('#tmpPw');
  const tmp = (await page.textContent('#tmpPw')).trim();
  await shot(page, '05-password-sementara-hp');
  await page.click('#done');
  await page.waitForSelector('.urow >> nth=1');
  await shot(page, '06-daftar-pengguna-hp');
  await page.click('.nav-item[data-nav="master"]');
  await page.waitForSelector('.soon');
  await shot(page, '07-segera-hadir-hp');

  // ---- jadwal guru agar peran muncul ----
  env.sheet('JadwalPelajaran').appendRow(['Senin', '1', '7A', 'IPA', '198001012005012001']);
  env.sheet('Kelas').appendRow(['8B', '198001012005012001']);
  env.sheet('JadwalPiket').appendRow([env.run('Util.todayInfo()').day, '198001012005012001', '', 'tetap']);
  env.run('refreshCache()'); // sama seperti pemilik menjalankannya dari editor setelah mengubah sheet

  // ---- Desktop: login guru (ganti password -> peran piket) ----
  let desk = await newPage({ width: 1280, height: 800 });
  await desk.waitForSelector('#loginForm');
  await shot(desk, '08-login-desktop');
  await desk.fill('#lu', 'rina');
  await desk.fill('#lp', tmp);
  await desk.click('#loginBtn');
  await desk.waitForSelector('#pwForm');
  await desk.fill('#pw0', tmp);
  await desk.fill('#pw1', 'GuruRina-2026!');
  await desk.fill('#pw2', 'GuruRina-2026!');
  await desk.click('#pwBtn');
  await desk.waitForSelector('#roleSelect');
  await shot(desk, '09-guru-piket-desktop');
  const roles = await desk.$$eval('#roleSelect option', (o) => o.map((x) => x.textContent));
  const activeNav = await desk.textContent('.nav-item[aria-current="page"]');
  console.log('peran guru:', roles.join(', '), '| menu awal:', activeNav.trim());
  await desk.selectOption('#roleSelect', 'wali_kelas');
  await desk.waitForSelector('.hero');
  await shot(desk, '10-wali-kelas-desktop');
  await desk.click('#accountBtn');
  await desk.waitForSelector('#accPw');
  await shot(desk, '11-akun-desktop');
  await desk.click('[data-close]');

  // ---- Desktop admin: daftar pengguna ----
  const adm = await newPage({ width: 1280, height: 800 });
  await adm.fill('#lu', 'admin'); await adm.fill('#lp', 'Sekolah-Baru-2026'); await adm.click('#loginBtn');
  await adm.waitForSelector('.hero');
  await adm.click('[data-nav="pengguna"]');
  await adm.waitForSelector('.uhead');
  await shot(adm, '12-pengguna-desktop');
  await adm.fill('#q', 'rina');
  await adm.waitForFunction(() => document.querySelectorAll('.urow').length === 1);

  // ---- Mode gelap HP ----
  const dark = await newPage({ width: 390, height: 780 }, 'dark');
  await dark.fill('#lu', 'rina'); await dark.fill('#lp', 'GuruRina-2026!'); await dark.click('#loginBtn');
  await dark.waitForSelector('.nav-item');
  await shot(dark, '13-guru-gelap-hp');

  // ---- Pemeriksaan tata letak: tidak ada luapan horizontal di lebar kecil ----
  for (const [name, p] of [['hp', page], ['gelap', dark]]) {
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 0) problems.push(`luapan horizontal ${overflow}px di ${name}`);
  }
  const tiny = await newPage({ width: 320, height: 640 });
  await tiny.fill('#lu', 'admin'); await tiny.fill('#lp', 'Sekolah-Baru-2026'); await tiny.click('#loginBtn');
  await tiny.waitForSelector('.hero');
  await tiny.click('[data-nav="pengguna"]');
  await tiny.waitForSelector('.urow');
  const overflow320 = await tiny.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow320 > 0) problems.push('luapan horizontal ' + overflow320 + 'px di lebar 320');
  await shot(tiny, '14-pengguna-320');

  // ---- Target sentuh >= 44px pada HP ----
  const small = await page.evaluate(() => Array.from(document.querySelectorAll('button, .nav-item, select, input')).filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return { t: (e.textContent || e.id || e.tagName).trim().slice(0, 20), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.h < 40 || x.w < 40));
  if (small.length) console.log('target sentuh kecil:', JSON.stringify(small));

  await browser.close();
  console.log(problems.length ? 'MASALAH:\n - ' + problems.join('\n - ') : 'Tidak ada galat konsol/halaman.');
  console.log('Tangkapan layar di', OUT);
})().catch((e) => { console.error('E2E gagal:', e); process.exit(1); });
