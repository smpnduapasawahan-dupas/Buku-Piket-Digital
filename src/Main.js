/**
 * Titik masuk web app. HANYA fungsi berikut yang boleh publik (tanpa garis bawah):
 *  - doGet, api  : dipakai pengunjung
 *  - setupApp, resetAdminPassword : pemeliharaan, dijaga oleh assertOwner_()
 * Fungsi publik di Apps Script dapat dipanggil pengunjung lewat google.script.run,
 * jadi semua logika lain berada di dalam objek ber-namespace.
 */
function doGet() {
  const template = HtmlService.createTemplateFromFile('Index');
  let schoolName = CONFIG.SCHOOL_NAME_DEFAULT;
  try {
    schoolName = Settings.all().nama_sekolah || schoolName;
  } catch (e) {
    console.warn('doGet memakai nama sekolah bawaan: ' + e.message);
  }
  template.appName = CONFIG.APP_NAME;
  // '<' di-escape agar nilai dari sheet tidak bisa menutup tag <script>.
  template.boot = JSON.stringify({ appName: CONFIG.APP_NAME, schoolName: schoolName }).replace(/</g, '\\u003c');
  return template
    .evaluate()
    .setTitle(CONFIG.APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** Dipanggil dari template: <?!= include_('Styles') ?> */
function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** Satu-satunya endpoint data. Selalu mengembalikan {ok, data} atau {ok:false, error}. */
function api(request) {
  return Api.handle(request);
}
