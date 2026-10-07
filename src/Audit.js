/** Catatan aktivitas (sheet LogAktivitas). Kegagalan mencatat tidak boleh menggagalkan permintaan. */
const Audit = (function () {
  function write(username, action, detail, result) {
    try {
      Db.append(SHEETS.LOG, {
        waktu: Util.nowText(),
        username: username || '-',
        aksi: action,
        detail: Util.text(detail, 300),
        hasil: result || 'sukses'
      });
    } catch (e) {
      console.error('Gagal menulis log aktivitas: ' + e.message);
    }
  }
  return { write: write };
})();

/** Pengaturan aplikasi (sheet Pengaturan) dengan nilai bawaan dan cache. */
const Settings = (function () {
  const CACHE_KEY = 'cfg:all';

  function defaults() {
    return { nama_sekolah: CONFIG.SCHOOL_NAME_DEFAULT };
  }

  function all() {
    const cached = Cache_.get(CACHE_KEY);
    if (cached) return cached;
    const result = defaults();
    try {
      Db.readAll(SHEETS.SETTINGS).forEach(function (row) {
        if (row.kunci && row.nilai !== '') result[row.kunci] = row.nilai;
      });
    } catch (e) {
      console.warn('Pengaturan memakai nilai bawaan: ' + e.message);
    }
    Cache_.put(CACHE_KEY, result, CONFIG.CACHE_SECONDS.SETTINGS);
    return result;
  }

  function invalidate() {
    Cache_.remove(CACHE_KEY);
  }

  return { all: all, invalidate: invalidate, defaults: defaults };
})();
