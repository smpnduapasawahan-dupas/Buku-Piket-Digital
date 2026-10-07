/**
 * Konfigurasi global Buku Piket Digital.
 * File ini hanya berisi konstanta dan TIDAK boleh memanggil file lain saat dimuat.
 */
const CONFIG = Object.freeze({
  APP_NAME: 'Buku Piket Digital',
  SCHOOL_NAME_DEFAULT: 'SMPN 2 Pasawahan',
  TIMEZONE: 'Asia/Jakarta',
  PROP_SPREADSHEET_ID: 'SPREADSHEET_ID',

  /** Sesi tetap 6 jam sejak login (batas maksimum CacheService). */
  SESSION_SECONDS: 21600,

  PASSWORD: Object.freeze({
    MIN_LENGTH: 8,
    MAX_LENGTH: 128,
    /** Dinaikkan bila perlu; hash lama otomatis diperbarui saat login berikutnya. */
    PBKDF2_ITERATIONS: 60000,
    TEMP_LENGTH: 8,
    /** Tanpa huruf/angka yang mudah tertukar (0/O, 1/I/L). 32 simbol agar tanpa bias. */
    TEMP_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  }),

  LOCKOUT: Object.freeze({ MAX_ATTEMPTS: 5, SECONDS: 900 }),

  CACHE_SECONDS: Object.freeze({ USERS: 300, ROLE_INDEX: 300, SETTINGS: 600 }),
  LOCK_WAIT_MS: 10000,

  TYPES: Object.freeze({ TEACHER: 'Guru', PRINCIPAL: 'Kepala Sekolah', ADMIN: 'Admin' }),
  YES: 'YA',
  NO: 'TIDAK',

  ROLE_LABELS: Object.freeze({
    admin: 'Admin',
    kepsek: 'Kepala Sekolah',
    guru_piket: 'Guru Piket',
    guru_mapel: 'Guru Mapel',
    wali_kelas: 'Wali Kelas'
  }),

  DAY_NAMES: Object.freeze(['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'])
});

/** Skema sheet. Urutan header dipakai saat membuat sheet; pembacaan memakai nama header. */
const SHEETS = Object.freeze({
  USERS: Object.freeze({
    name: 'Pengguna',
    headers: ['username', 'nama', 'tipe', 'nip', 'aktif', 'dibuat']
  }),
  CREDENTIALS: Object.freeze({
    name: 'Kredensial',
    headers: ['username', 'hash', 'wajib_ganti', 'diubah'],
    hidden: true
  }),
  LOG: Object.freeze({
    name: 'LogAktivitas',
    headers: ['waktu', 'username', 'aksi', 'detail', 'hasil']
  }),
  SETTINGS: Object.freeze({
    name: 'Pengaturan',
    headers: ['kunci', 'nilai']
  }),
  CLASSES: Object.freeze({
    name: 'Kelas',
    headers: ['kelas', 'wali_nip']
  }),
  SCHEDULE: Object.freeze({
    name: 'JadwalPelajaran',
    headers: ['hari', 'jam_ke', 'kelas', 'mapel', 'nip']
  }),
  PIKET: Object.freeze({
    name: 'JadwalPiket',
    // jenis: tetap (tiap pekan, isi hari) | tambahan (isi tanggal_khusus) | batal (isi tanggal_khusus)
    headers: ['hari', 'nip', 'tanggal_khusus', 'jenis']
  })
});
