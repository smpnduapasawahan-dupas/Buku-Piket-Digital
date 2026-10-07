/**
 * Autentikasi dan sesi.
 *  - Password: PBKDF2-HMAC-SHA256 + salt acak, disimpan hanya di sheet tersembunyi "Kredensial".
 *  - Sesi: token acak 256-bit di CacheService, berlaku tetap 6 jam sejak login.
 *  - Pencabutan: penanda waktu per pengguna; sesi yang dibuat sebelum penanda dianggap tidak sah.
 *  - Pembatasan percobaan: 5 kali gagal berturut-turut mengunci username selama 15 menit.
 */
const Auth = (function () {
  const SESSION_PREFIX = 'sess:';
  const REVOKE_PREFIX = 'rev:';
  const FAIL_PREFIX = 'fail:';
  const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
  const FIXED_SALT = Uint8Array.from([7, 21, 3, 99, 14, 52, 8, 71, 33, 5, 120, 64, 9, 18, 200, 41]);

  const E_INVALID = function () { return new AppError('INVALID_CREDENTIALS', 'Username atau password salah.'); };
  const E_UNAUTH = function () { return new AppError('UNAUTHENTICATED', 'Sesi berakhir. Silakan masuk kembali.'); };
  const E_LOCKED = function () {
    return new AppError('LOCKED', 'Terlalu banyak percobaan gagal. Akun dikunci sementara selama 15 menit.');
  };

  // ---------- pembatasan percobaan ----------

  function failureCount(username) {
    return Number(Cache_.get(FAIL_PREFIX + username)) || 0;
  }

  function isLocked(username) {
    return failureCount(username) >= CONFIG.LOCKOUT.MAX_ATTEMPTS;
  }

  /** Mengembalikan jumlah kegagalan terbaru. */
  function registerFailure(username) {
    const count = failureCount(username) + 1;
    Cache_.put(FAIL_PREFIX + username, count, CONFIG.LOCKOUT.SECONDS);
    return count;
  }

  function clearFailures(username) {
    Cache_.remove(FAIL_PREFIX + username);
  }

  /** Menghabiskan waktu setara satu verifikasi agar akun tak dikenal tidak terdeteksi lewat waktu respons. */
  function burnTime(password) {
    Crypto_.pbkdf2(Crypto_.utf8Bytes(password), FIXED_SALT, CONFIG.PASSWORD.PBKDF2_ITERATIONS);
  }

  // ---------- sesi ----------

  function createSession(username, mustChange, notBefore) {
    const token = Crypto_.randomHex(32);
    const session = { u: username, mc: !!mustChange, c: Math.max(Date.now(), (notBefore || 0) + 1) };
    Cache_.put(SESSION_PREFIX + token, session, CONFIG.SESSION_SECONDS);
    return token;
  }

  function destroySession(token) {
    if (typeof token === 'string' && TOKEN_PATTERN.test(token)) Cache_.remove(SESSION_PREFIX + token);
  }

  /** Mencabut semua sesi milik `username`. Mengembalikan waktu pencabutan (ms). */
  function revokeSessions(username) {
    const at = Date.now();
    Cache_.put(REVOKE_PREFIX + username, at, CONFIG.SESSION_SECONDS);
    return at;
  }

  /**
   * Memvalidasi token. Melempar UNAUTHENTICATED bila tidak sah, atau
   * PASSWORD_CHANGE_REQUIRED bila akun masih wajib ganti password dan aksi tidak mengizinkannya.
   */
  function requireSession(token, options) {
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) throw E_UNAUTH();
    const session = Cache_.get(SESSION_PREFIX + token);
    if (!session || typeof session.u !== 'string') throw E_UNAUTH();

    const revokedAt = Number(Cache_.get(REVOKE_PREFIX + session.u)) || 0;
    const expired = Date.now() - session.c > CONFIG.SESSION_SECONDS * 1000;
    const user = expired || session.c <= revokedAt ? null : Users.find(session.u);
    if (!user || user.aktif !== CONFIG.YES) {
      destroySession(token);
      throw E_UNAUTH();
    }
    if (session.mc && !(options && options.allowMustChange)) {
      throw new AppError('PASSWORD_CHANGE_REQUIRED', 'Anda harus mengganti password terlebih dahulu.');
    }
    return { token: token, session: session, user: user };
  }

  // ---------- muatan awal untuk klien ----------

  /** Semua yang dibutuhkan layar pertama dalam SATU panggilan. */
  function bootstrap(user, mustChange) {
    const info = Util.todayInfo();
    const resolved = mustChange ? { roles: [], defaultRole: null } : Roles.resolve(user, info);
    return {
      user: Users.publicView(user),
      mustChange: !!mustChange,
      roles: resolved.roles,
      defaultRole: resolved.defaultRole,
      settings: { namaSekolah: Settings.all().nama_sekolah },
      today: info
    };
  }

  // ---------- aksi publik ----------

  function login(payload) {
    const username = Util.normalizeUsername(payload.username);
    const password = typeof payload.password === 'string' ? payload.password : '';
    if (!username || !password || password.length > CONFIG.PASSWORD.MAX_LENGTH) {
      burnTime(password.slice(0, CONFIG.PASSWORD.MAX_LENGTH));
      throw E_INVALID();
    }
    if (isLocked(username)) throw E_LOCKED();

    const user = Users.find(username);
    const credential = user && user.aktif === CONFIG.YES ? Users.findCredential(username) : null;
    let valid = false;
    if (credential) valid = Crypto_.verifyPassword(password, credential.hash);
    else burnTime(password);

    if (!valid) {
      const count = registerFailure(username);
      Audit.write(user ? username : '-', 'login', user ? 'Password salah atau akun nonaktif' : 'Username tidak dikenal', 'gagal');
      throw count >= CONFIG.LOCKOUT.MAX_ATTEMPTS ? E_LOCKED() : E_INVALID();
    }

    clearFailures(username);
    if (Crypto_.needsRehash(credential.hash, CONFIG.PASSWORD.PBKDF2_ITERATIONS)) {
      const upgraded = Crypto_.hashPassword(password, CONFIG.PASSWORD.PBKDF2_ITERATIONS);
      Db.withLock(function () {
        Users.saveCredential(username, upgraded, credential.wajib_ganti === CONFIG.YES);
      });
    }
    const mustChange = credential.wajib_ganti === CONFIG.YES;
    const token = createSession(username, mustChange, 0);
    Audit.write(username, 'login', '', 'sukses');
    const data = bootstrap(user, mustChange);
    data.token = token;
    return data;
  }

  function logout(ctx) {
    destroySession(ctx.token);
    Audit.write(ctx.user.username, 'logout', '', 'sukses');
    return {};
  }

  function passwordProblem(newPassword, oldPassword, username) {
    if (typeof newPassword !== 'string' || newPassword.length < CONFIG.PASSWORD.MIN_LENGTH) {
      return 'Password baru minimal ' + CONFIG.PASSWORD.MIN_LENGTH + ' karakter.';
    }
    if (newPassword.length > CONFIG.PASSWORD.MAX_LENGTH) {
      return 'Password baru maksimal ' + CONFIG.PASSWORD.MAX_LENGTH + ' karakter.';
    }
    if (!newPassword.trim()) return 'Password tidak boleh hanya berisi spasi.';
    if (newPassword === oldPassword) return 'Password baru harus berbeda dari password lama.';
    if (newPassword.toLowerCase() === username) return 'Password tidak boleh sama dengan username.';
    return null;
  }

  function changePassword(ctx, payload) {
    const username = ctx.user.username;
    const oldPassword = typeof payload.oldPassword === 'string' ? payload.oldPassword : '';
    const newPassword = typeof payload.newPassword === 'string' ? payload.newPassword : '';

    const problem = passwordProblem(newPassword, oldPassword, username);
    if (problem) throw new AppError('WEAK_PASSWORD', problem);
    if (isLocked(username)) throw E_LOCKED();

    const credential = Users.findCredential(username);
    const oldOk = !!credential && oldPassword.length <= CONFIG.PASSWORD.MAX_LENGTH &&
      Crypto_.verifyPassword(oldPassword, credential.hash);
    if (!oldOk) {
      const count = registerFailure(username);
      Audit.write(username, 'changePassword', 'Password lama salah', 'gagal');
      throw count >= CONFIG.LOCKOUT.MAX_ATTEMPTS
        ? E_LOCKED()
        : new AppError('INVALID_CREDENTIALS', 'Password lama tidak sesuai.');
    }

    const hash = Crypto_.hashPassword(newPassword, CONFIG.PASSWORD.PBKDF2_ITERATIONS);
    Db.withLock(function () {
      Users.saveCredential(username, hash, false);
    });
    clearFailures(username);
    const revokedAt = revokeSessions(username);
    const token = createSession(username, false, revokedAt);
    Audit.write(username, 'changePassword', '', 'sukses');
    const data = bootstrap(ctx.user, false);
    data.token = token;
    return data;
  }

  function refresh(ctx) {
    return bootstrap(ctx.user, ctx.session.mc);
  }

  return {
    requireSession: requireSession,
    revokeSessions: revokeSessions,
    clearFailures: clearFailures,
    login: login,
    logout: logout,
    changePassword: changePassword,
    refresh: refresh,
    passwordProblem: passwordProblem
  };
})();
