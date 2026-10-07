/**
 * Pemeliharaan, dijalankan pemilik dari editor Apps Script.
 * Dijaga assertOwner_() karena fungsi publik dapat dipanggil pengunjung web app.
 */
function assertOwner_() {
  const active = Session.getActiveUser().getEmail();
  const effective = Session.getEffectiveUser().getEmail();
  if (!active || active !== effective) {
    throw new Error('Fungsi ini hanya dapat dijalankan pemilik skrip dari editor Apps Script.');
  }
}

function report_(title, lines) {
  const message = lines.join('\n');
  Logger.log('=== ' + title + ' ===\n' + message);
  try {
    SpreadsheetApp.getUi().alert(title, message, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    // Tidak ada UI saat dijalankan dari editor; log sudah cukup.
  }
}

/**
 * Menyiapkan aplikasi: menyimpan ID spreadsheet, membuat semua sheet, dan membuat akun
 * "admin" pertama. Aman dijalankan ulang (tidak menghapus data).
 */
function setupApp() {
  assertOwner_();
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error('Skrip harus dibuat dari dalam Google Spreadsheet (Ekstensi > Apps Script).');
  }
  PropertiesService.getScriptProperties().setProperty(CONFIG.PROP_SPREADSHEET_ID, active.getId());
  Db.reset();

  Object.keys(SHEETS).forEach(function (key) { Db.ensureSheet(SHEETS[key]); });

  const defaultSheet = active.getSheetByName('Sheet1') || active.getSheetByName('Lembar1');
  if (defaultSheet && defaultSheet.getLastRow() === 0 && active.getSheets().length > 1) {
    active.deleteSheet(defaultSheet);
  }

  if (Db.readAll(SHEETS.SETTINGS).length === 0) {
    Db.append(SHEETS.SETTINGS, { kunci: 'nama_sekolah', nilai: CONFIG.SCHOOL_NAME_DEFAULT });
  }

  const lines = ['Sheet siap: ' + Object.keys(SHEETS).map(function (k) { return SHEETS[k].name; }).join(', ') + '.'];
  const hasAdmin = Db.readAll(SHEETS.USERS).some(function (u) { return u.tipe === CONFIG.TYPES.ADMIN; });
  if (hasAdmin) {
    lines.push('Akun Admin sudah ada, tidak membuat akun baru.');
  } else {
    const tempPassword = Users.newTempPassword();
    const hash = Crypto_.hashPassword(tempPassword, CONFIG.PASSWORD.PBKDF2_ITERATIONS);
    Db.withLock(function () {
      Users.saveCredential('admin', hash, true);
      Db.append(SHEETS.USERS, {
        username: 'admin',
        nama: 'Administrator',
        tipe: CONFIG.TYPES.ADMIN,
        nip: '',
        aktif: CONFIG.YES,
        dibuat: Util.nowText()
      });
    });
    Users.invalidate();
    lines.push('Akun pertama dibuat.', 'Username : admin', 'Password : ' + tempPassword, 'Anda wajib menggantinya saat login pertama. Catat sekarang; password ini tidak ditampilkan lagi.');
  }
  report_('Buku Piket: setup selesai', lines);
}

/** Pemulihan bila password Admin lupa: membuat password sementara baru untuk akun "admin". */
function resetAdminPassword() {
  assertOwner_();
  const user = Users.find('admin');
  if (!user || user.tipe !== CONFIG.TYPES.ADMIN) {
    throw new Error('Akun "admin" tidak ditemukan. Jalankan setupApp terlebih dahulu.');
  }
  const tempPassword = Users.newTempPassword();
  const hash = Crypto_.hashPassword(tempPassword, CONFIG.PASSWORD.PBKDF2_ITERATIONS);
  Db.withLock(function () { Users.saveCredential('admin', hash, true); });
  Auth.revokeSessions('admin');
  Auth.clearFailures('admin');
  Audit.write('admin', 'resetAdminPassword', 'Dijalankan dari editor', 'sukses');
  report_('Buku Piket: password admin direset', ['Username : admin', 'Password : ' + tempPassword, 'Wajib diganti saat login berikutnya.']);
}

/**
 * Menyegarkan cache (daftar pengguna, indeks peran, pengaturan). Jalankan setelah mengubah
 * sheet Pengguna/Kelas/JadwalPelajaran/JadwalPiket/Pengaturan langsung di spreadsheet;
 * tanpa ini perubahan baru terlihat paling lama 5 menit kemudian.
 */
function refreshCache() {
  assertOwner_();
  Users.invalidate();
  Roles.invalidate();
  Settings.invalidate();
  Logger.log('Cache disegarkan.');
}
