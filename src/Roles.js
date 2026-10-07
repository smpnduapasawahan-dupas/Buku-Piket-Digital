/**
 * Peran diturunkan otomatis dari data, bukan disimpan per akun:
 *   Admin / Kepala Sekolah  -> dari tipe akun
 *   Guru Mapel              -> NIP muncul di JadwalPelajaran
 *   Wali Kelas              -> NIP muncul sebagai wali_nip di Kelas
 *   Guru Piket              -> bertugas HARI INI menurut JadwalPiket (tetap + tambahan - batal)
 * Peran guru berlaku untuk akun tipe apa pun yang memiliki NIP.
 */
const Roles = (function () {
  const CACHE_KEY = 'idx:teacher';

  function buildIndex() {
    const idx = { mapel: [], wali: [], piket: [] };
    function safeRead(def) {
      try {
        return Db.readAll(def);
      } catch (e) {
        if (e instanceof AppError && e.code === 'SCHEMA') {
          console.warn('Lewati peran dari sheet yang hilang: ' + e.message);
          return [];
        }
        throw e;
      }
    }
    const seenMapel = {};
    safeRead(SHEETS.SCHEDULE).forEach(function (r) {
      if (r.nip && !seenMapel[r.nip]) {
        seenMapel[r.nip] = true;
        idx.mapel.push(r.nip);
      }
    });
    const seenWali = {};
    safeRead(SHEETS.CLASSES).forEach(function (r) {
      if (r.wali_nip && !seenWali[r.wali_nip]) {
        seenWali[r.wali_nip] = true;
        idx.wali.push(r.wali_nip);
      }
    });
    safeRead(SHEETS.PIKET).forEach(function (r) {
      if (!r.nip) return;
      const tanggal = Util.dateOnly(r.tanggal_khusus);
      let jenis = String(r.jenis || '').toLowerCase();
      if (!jenis) jenis = tanggal ? 'tambahan' : 'tetap';
      idx.piket.push({ nip: r.nip, hari: String(r.hari || '').toLowerCase(), tanggal: tanggal, jenis: jenis });
    });
    return idx;
  }

  function index() {
    const cached = Cache_.get(CACHE_KEY);
    if (cached) return cached;
    const idx = buildIndex();
    Cache_.put(CACHE_KEY, idx, CONFIG.CACHE_SECONDS.ROLE_INDEX);
    return idx;
  }

  function invalidate() {
    Cache_.remove(CACHE_KEY);
  }

  /** Apakah NIP bertugas piket pada `info` ({date, day})? 'batal' pada tanggal itu mengalahkan semuanya. */
  function isOnPiket(idx, nip, info) {
    const mine = idx.piket.filter(function (r) { return r.nip === nip; });
    if (mine.some(function (r) { return r.jenis === 'batal' && r.tanggal === info.date; })) return false;
    return mine.some(function (r) {
      if (r.jenis === 'tetap') return !r.tanggal && r.hari === info.day.toLowerCase();
      if (r.jenis === 'tambahan') return r.tanggal === info.date;
      return false;
    });
  }

  /** Fungsi murni (mudah diuji): menghitung daftar peran dan peran awal. */
  function compute(user, idx, info) {
    const ids = [];
    if (user.tipe === CONFIG.TYPES.ADMIN) ids.push('admin');
    if (user.tipe === CONFIG.TYPES.PRINCIPAL) ids.push('kepsek');
    let piket = false;
    let mapel = false;
    let wali = false;
    if (user.nip) {
      piket = isOnPiket(idx, user.nip, info);
      mapel = idx.mapel.indexOf(user.nip) >= 0;
      wali = idx.wali.indexOf(user.nip) >= 0;
    }
    if (piket) ids.push('guru_piket');
    if (mapel) ids.push('guru_mapel');
    if (wali) ids.push('wali_kelas');

    const priority = ['guru_piket', 'admin', 'kepsek', 'guru_mapel', 'wali_kelas'];
    const defaultRole = priority.filter(function (id) { return ids.indexOf(id) >= 0; })[0] || null;
    return {
      roles: ids.map(function (id) { return { id: id, label: CONFIG.ROLE_LABELS[id] }; }),
      defaultRole: defaultRole
    };
  }

  function resolve(user, info) {
    return compute(user, index(), info || Util.todayInfo());
  }

  return { resolve: resolve, compute: compute, isOnPiket: isOnPiket, invalidate: invalidate };
})();
