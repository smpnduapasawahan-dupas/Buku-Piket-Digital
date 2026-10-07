/** Galat terkontrol: pesan aman ditampilkan ke pengguna, `code` dipakai klien untuk bercabang. */
class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

/** Pembantu umum. Tidak memanggil file lain saat dimuat. */
const Util = (function () {
  const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

  function nowText() {
    return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  }

  /** {date: 'yyyy-MM-dd', day: 'Senin'} untuk zona waktu sekolah. */
  function todayInfo(date) {
    const d = date || new Date();
    const isoDay = Number(Utilities.formatDate(d, CONFIG.TIMEZONE, 'u')); // 1=Senin ... 7=Minggu
    return {
      date: Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd'),
      day: CONFIG.DAY_NAMES[isoDay % 7]
    };
  }

  /** Teks rapi: string, spasi ganda dipadatkan, dipotong ke `max` karakter. */
  function text(value, max) {
    const s = value === null || value === undefined ? '' : String(value);
    return s.replace(/\s+/g, ' ').trim().slice(0, max || 200);
  }

  /** Mencegah injeksi rumus spreadsheet: teks berawalan = + - @ dijadikan teks biasa. */
  function cell(value) {
    const s = value === null || value === undefined ? '' : String(value);
    return /^[=+\-@]/.test(s) ? "'" + s : s;
  }

  /** Mengembalikan username baku (huruf kecil) atau '' bila format tidak valid. */
  function normalizeUsername(value) {
    const s = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return USERNAME_PATTERN.test(s) ? s : '';
  }

  /** Mengambil bagian tanggal 'yyyy-MM-dd' dari teks tanggal/waktu; '' bila tidak valid. */
  function dateOnly(value) {
    const s = String(value || '').trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  }

  function ref() {
    return Utilities.getUuid().slice(0, 8);
  }

  return {
    nowText: nowText,
    todayInfo: todayInfo,
    text: text,
    cell: cell,
    normalizeUsername: normalizeUsername,
    dateOnly: dateOnly,
    ref: ref
  };
})();

/** Pembungkus CacheService (cache skrip, dibagi semua pengguna). */
const Cache_ = (function () {
  function store() {
    return CacheService.getScriptCache();
  }

  function get(key) {
    const raw = store().get(key);
    if (raw === null || raw === undefined) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  /** Mengembalikan false (tanpa melempar) bila nilai terlalu besar (>100 KB) atau cache gagal. */
  function put(key, value, seconds) {
    try {
      store().put(key, JSON.stringify(value), seconds);
      return true;
    } catch (e) {
      return false;
    }
  }

  function remove(key) {
    store().remove(key);
  }

  return { get: get, put: put, remove: remove };
})();
