/**
 * Satu pintu masuk untuk semua panggilan klien. Setiap rute menyatakan sendiri
 * apakah memerlukan sesi dan tipe akun apa yang boleh memakainya; pemeriksaan
 * dilakukan di server, bukan hanya dengan menyembunyikan menu di klien.
 */
const Api = (function () {
  const MAX_REQUEST_CHARS = 20000;

  const ROUTES = {
    'auth.login': { public: true, run: function (ctx, p) { return Auth.login(p); } },
    'auth.logout': { allowMustChange: true, run: function (ctx) { return Auth.logout(ctx); } },
    'auth.changePassword': { allowMustChange: true, run: function (ctx, p) { return Auth.changePassword(ctx, p); } },
    'session.bootstrap': { allowMustChange: true, run: function (ctx) { return Auth.refresh(ctx); } },
    'users.list': { admin: true, run: function () { return { users: Users.list() }; } },
    'users.create': { admin: true, run: function (ctx, p) { return Users.create(ctx, p); } },
    'users.update': { admin: true, run: function (ctx, p) { return Users.update(ctx, p); } },
    'users.resetPassword': { admin: true, run: function (ctx, p) { return Users.resetPassword(ctx, p); } }
  };

  function fail(code, message, extra) {
    const error = { code: code, message: message };
    if (extra) error.ref = extra;
    return { ok: false, error: error };
  }

  function handle(request) {
    try {
      if (!request || typeof request !== 'object') throw new AppError('BAD_REQUEST', 'Permintaan tidak valid.');
      const action = typeof request.action === 'string' ? request.action : '';
      const route = Object.prototype.hasOwnProperty.call(ROUTES, action) ? ROUTES[action] : null;
      if (!route) throw new AppError('NOT_FOUND', 'Aksi tidak dikenal.');
      const payload = request.payload && typeof request.payload === 'object' ? request.payload : {};
      if (JSON.stringify(payload).length > MAX_REQUEST_CHARS) {
        throw new AppError('BAD_REQUEST', 'Data yang dikirim terlalu besar.');
      }

      let ctx = null;
      if (!route.public) {
        ctx = Auth.requireSession(request.token, { allowMustChange: route.allowMustChange === true });
        if (route.admin && ctx.user.tipe !== CONFIG.TYPES.ADMIN) {
          throw new AppError('FORBIDDEN', 'Anda tidak memiliki akses untuk tindakan ini.');
        }
      }
      return { ok: true, data: route.run(ctx, payload) };
    } catch (e) {
      if (e instanceof AppError) return fail(e.code, e.message);
      const ref = Util.ref();
      console.error('[' + ref + '] ' + (e && e.stack ? e.stack : e));
      return fail('INTERNAL', 'Terjadi kesalahan pada server. Coba lagi, dan laporkan kode ' + ref + ' ke admin bila berulang.', ref);
    }
  }

  return { handle: handle, routes: ROUTES };
})();
