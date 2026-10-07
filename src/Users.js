/** Akses data akun (sheet Pengguna dan Kredensial) serta manajemen akun oleh Admin. */
const Users = (function () {
  const CACHE_KEY = 'tbl:users';

  function publicView(u) {
    return { username: u.username, nama: u.nama, tipe: u.tipe, nip: u.nip, aktif: u.aktif };
  }

  function table() {
    const cached = Cache_.get(CACHE_KEY);
    if (cached) return cached;
    const rows = Db.readAll(SHEETS.USERS).map(function (r) {
      return { username: r.username.toLowerCase(), nama: r.nama, tipe: r.tipe, nip: r.nip, aktif: r.aktif, dibuat: r.dibuat };
    });
    Cache_.put(CACHE_KEY, rows, CONFIG.CACHE_SECONDS.USERS);
    return rows;
  }

  function invalidate() {
    Cache_.remove(CACHE_KEY);
  }

  function find(username) {
    const key = String(username || '').toLowerCase();
    const rows = table();
    for (let i = 0; i < rows.length; i++) if (rows[i].username === key) return rows[i];
    return null;
  }

  function findCredential(username) {
    const key = String(username || '').toLowerCase();
    const rows = Db.readAll(SHEETS.CREDENTIALS);
    for (let i = 0; i < rows.length; i++) if (rows[i].username.toLowerCase() === key) return rows[i];
    return null;
  }

  /** Menyimpan hash baru (membuat baris kredensial bila belum ada). Panggil di dalam withLock. */
  function saveCredential(username, hash, mustChange) {
    const existing = findCredential(username);
    const values = {
      username: username,
      hash: hash,
      wajib_ganti: mustChange ? CONFIG.YES : CONFIG.NO,
      diubah: Util.nowText()
    };
    if (existing) Db.update(SHEETS.CREDENTIALS, existing._row, values);
    else Db.append(SHEETS.CREDENTIALS, values);
  }

  function newTempPassword() {
    return Crypto_.randomString(CONFIG.PASSWORD.TEMP_LENGTH, CONFIG.PASSWORD.TEMP_ALPHABET);
  }

  // ---------- validasi ----------

  function cleanProfile(input) {
    const nama = Util.text(input.nama, 80);
    if (nama.length < 3) throw new AppError('VALIDATION', 'Nama lengkap minimal 3 karakter.');
    const tipe = String(input.tipe || '');
    const validTypes = Object.keys(CONFIG.TYPES).map(function (k) { return CONFIG.TYPES[k]; });
    if (validTypes.indexOf(tipe) < 0) throw new AppError('VALIDATION', 'Tipe akun tidak valid.');
    const nip = String(input.nip === undefined || input.nip === null ? '' : input.nip).replace(/\s+/g, '');
    if (nip && !/^[0-9]{5,30}$/.test(nip)) {
      throw new AppError('VALIDATION', 'NIP/NUPTK hanya boleh berisi angka (5–30 digit).');
    }
    if (tipe === CONFIG.TYPES.TEACHER && !nip) {
      throw new AppError('VALIDATION', 'NIP/NUPTK wajib diisi untuk akun Guru.');
    }
    return { nama: nama, tipe: tipe, nip: nip };
  }

  function assertUniqueNip(rows, nip, exceptUsername) {
    if (!nip) return;
    const clash = rows.filter(function (r) {
      return r.nip === nip && r.username.toLowerCase() !== exceptUsername;
    })[0];
    if (clash) {
      throw new AppError('DUPLICATE', 'NIP/NUPTK ini sudah dipakai akun "' + clash.username + '".');
    }
  }

  function activeAdminCount(rows) {
    return rows.filter(function (r) {
      return r.tipe === CONFIG.TYPES.ADMIN && r.aktif === CONFIG.YES;
    }).length;
  }

  // ---------- operasi Admin ----------

  function list() {
    const creds = {};
    Db.readAll(SHEETS.CREDENTIALS).forEach(function (c) {
      creds[c.username.toLowerCase()] = c.wajib_ganti === CONFIG.YES;
    });
    return Db.readAll(SHEETS.USERS)
      .map(function (r) {
        return {
          username: r.username.toLowerCase(),
          nama: r.nama,
          tipe: r.tipe,
          nip: r.nip,
          aktif: r.aktif === CONFIG.YES,
          dibuat: r.dibuat,
          belumGanti: creds[r.username.toLowerCase()] === true
        };
      })
      .sort(function (a, b) { return a.nama.localeCompare(b.nama, 'id'); });
  }

  function create(ctx, input) {
    const username = Util.normalizeUsername(input.username);
    if (!username) {
      throw new AppError('VALIDATION', 'Username 3–32 karakter: huruf kecil, angka, titik, garis bawah, atau strip.');
    }
    const profile = cleanProfile(input);
    const tempPassword = newTempPassword();
    const hash = Crypto_.hashPassword(tempPassword, CONFIG.PASSWORD.PBKDF2_ITERATIONS);

    Db.withLock(function () {
      const rows = Db.readAll(SHEETS.USERS);
      if (rows.some(function (r) { return r.username.toLowerCase() === username; })) {
        throw new AppError('DUPLICATE', 'Username "' + username + '" sudah dipakai.');
      }
      assertUniqueNip(rows, profile.nip, '');
      saveCredential(username, hash, true);
      Db.append(SHEETS.USERS, {
        username: username,
        nama: profile.nama,
        tipe: profile.tipe,
        nip: profile.nip,
        aktif: CONFIG.YES,
        dibuat: Util.nowText()
      });
      invalidate();
    });
    Audit.write(ctx.user.username, 'users.create', username + ' (' + profile.tipe + ')', 'sukses');
    return { username: username, nama: profile.nama, tempPassword: tempPassword };
  }

  function update(ctx, input) {
    const username = Util.normalizeUsername(input.username);
    if (!username) throw new AppError('VALIDATION', 'Username tidak valid.');
    const profile = cleanProfile(input);
    if (input.aktif !== true && input.aktif !== false) throw new AppError('VALIDATION', 'Status akun tidak valid.');
    const active = input.aktif === true;
    const isSelf = username === ctx.user.username;

    Db.withLock(function () {
      const rows = Db.readAll(SHEETS.USERS);
      const target = rows.filter(function (r) { return r.username.toLowerCase() === username; })[0];
      if (!target) throw new AppError('NOT_FOUND', 'Akun tidak ditemukan.');
      if (isSelf && (!active || profile.tipe !== CONFIG.TYPES.ADMIN)) {
        throw new AppError('FORBIDDEN_SELF', 'Anda tidak dapat menonaktifkan akun sendiri atau mengubah tipe akun Admin Anda.');
      }
      assertUniqueNip(rows, profile.nip, username);
      const remainingAdmins = activeAdminCount(rows.map(function (r) {
        if (r.username.toLowerCase() !== username) return r;
        return { tipe: profile.tipe, aktif: active ? CONFIG.YES : CONFIG.NO };
      }));
      if (remainingAdmins < 1) {
        throw new AppError('LAST_ADMIN', 'Harus ada minimal satu akun Admin yang aktif.');
      }
      Db.update(SHEETS.USERS, target._row, {
        nama: profile.nama,
        tipe: profile.tipe,
        nip: profile.nip,
        aktif: active ? CONFIG.YES : CONFIG.NO
      });
      invalidate();
    });
    if (!active) Auth.revokeSessions(username);
    Audit.write(ctx.user.username, 'users.update', username + (active ? '' : ' (dinonaktifkan)'), 'sukses');
    return { username: username };
  }

  function resetPassword(ctx, input) {
    const username = Util.normalizeUsername(input.username);
    if (!username) throw new AppError('VALIDATION', 'Username tidak valid.');
    if (username === ctx.user.username) {
      throw new AppError('FORBIDDEN_SELF', 'Gunakan menu Ganti password untuk akun Anda sendiri.');
    }
    const target = find(username);
    if (!target) throw new AppError('NOT_FOUND', 'Akun tidak ditemukan.');
    const tempPassword = newTempPassword();
    const hash = Crypto_.hashPassword(tempPassword, CONFIG.PASSWORD.PBKDF2_ITERATIONS);
    Db.withLock(function () {
      saveCredential(username, hash, true);
    });
    Auth.revokeSessions(username);
    Auth.clearFailures(username);
    Audit.write(ctx.user.username, 'users.resetPassword', username, 'sukses');
    return { username: username, nama: target.nama, tempPassword: tempPassword };
  }

  return {
    find: find,
    findCredential: findCredential,
    saveCredential: saveCredential,
    publicView: publicView,
    invalidate: invalidate,
    newTempPassword: newTempPassword,
    list: list,
    create: create,
    update: update,
    resetPassword: resetPassword
  };
})();
