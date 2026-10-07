/**
 * Lapisan akses Spreadsheet. Kolom dipetakan lewat nama header sehingga urutan kolom
 * boleh berubah. Semua nilai dibaca sebagai teks (sheet diformat teks) agar aman
 * dikirim lewat google.script.run, yang tidak dapat membawa objek Date.
 */
const Db = (function () {
  let spreadsheet = null;
  const headerMaps = {};

  function reset() {
    spreadsheet = null;
    Object.keys(headerMaps).forEach(function (k) { delete headerMaps[k]; });
  }

  function open() {
    if (spreadsheet) return spreadsheet;
    const id = PropertiesService.getScriptProperties().getProperty(CONFIG.PROP_SPREADSHEET_ID);
    if (!id) {
      throw new AppError('NOT_SETUP', 'Aplikasi belum disiapkan. Jalankan fungsi setupApp dari editor Apps Script.');
    }
    spreadsheet = SpreadsheetApp.openById(id);
    return spreadsheet;
  }

  function sheetOf(def) {
    const sheet = open().getSheetByName(def.name);
    if (!sheet) {
      throw new AppError('SCHEMA', 'Sheet "' + def.name + '" tidak ditemukan. Jalankan setupApp untuk membuatnya.');
    }
    return sheet;
  }

  function headerMap(sheet, def) {
    if (headerMaps[def.name]) return headerMaps[def.name];
    const lastCol = sheet.getLastColumn();
    const header = lastCol > 0
      ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) { return String(v).trim(); })
      : [];
    const map = {};
    def.headers.forEach(function (h) {
      const i = header.indexOf(h);
      if (i < 0) {
        throw new AppError('SCHEMA', 'Sheet "' + def.name + '" tidak memiliki kolom "' + h + '". Perbaiki header atau jalankan setupApp.');
      }
      map[h] = i;
    });
    headerMaps[def.name] = { index: map, width: Math.max(lastCol, def.headers.length) };
    return headerMaps[def.name];
  }

  function toText(value) {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return Utilities.formatDate(value, CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
    return String(value);
  }

  /** Membaca semua baris data sebagai array objek {kolom: teks, _row: nomorBaris}. */
  function readAll(def) {
    const sheet = sheetOf(def);
    const map = headerMap(sheet, def);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    const values = sheet.getRange(2, 1, lastRow - 1, map.width).getValues();
    const rows = [];
    for (let r = 0; r < values.length; r++) {
      const obj = { _row: r + 2 };
      let filled = false;
      for (let c = 0; c < def.headers.length; c++) {
        const h = def.headers[c];
        const v = toText(values[r][map.index[h]]).trim();
        obj[h] = v;
        if (v !== '') filled = true;
      }
      if (filled) rows.push(obj);
    }
    return rows;
  }

  function buildRow(def, map, obj, base) {
    const row = base ? base.slice() : new Array(map.width).fill('');
    def.headers.forEach(function (h) {
      if (Object.prototype.hasOwnProperty.call(obj, h)) row[map.index[h]] = Util.cell(obj[h]);
    });
    return row;
  }

  /** Menambah satu baris di akhir (appendRow bersifat atomik di sisi Google). */
  function append(def, obj) {
    const sheet = sheetOf(def);
    const map = headerMap(sheet, def);
    sheet.appendRow(buildRow(def, map, obj, null));
  }

  /** Memperbarui kolom yang ada di `changes` pada baris bernomor `rowNumber`. */
  function update(def, rowNumber, changes) {
    const sheet = sheetOf(def);
    const map = headerMap(sheet, def);
    const range = sheet.getRange(rowNumber, 1, 1, map.width);
    const current = range.getValues()[0];
    range.setValues([buildRow(def, map, changes, current)]);
  }

  /** Menjalankan `fn` dengan kunci skrip agar penulisan serentak tidak saling menimpa. */
  function withLock(fn) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(CONFIG.LOCK_WAIT_MS)) {
      throw new AppError('BUSY', 'Server sedang sibuk. Coba lagi sebentar.');
    }
    try {
      return fn();
    } finally {
      lock.releaseLock();
    }
  }

  /** Membuat sheet bila belum ada (idempoten, tidak menghapus data). */
  function ensureSheet(def) {
    const ss = open();
    let sheet = ss.getSheetByName(def.name);
    if (!sheet) sheet = ss.insertSheet(def.name);
    const width = def.headers.length;
    if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
    const headRange = sheet.getRange(1, 1, 1, width);
    const existing = headRange.getValues()[0].map(function (v) { return String(v).trim(); });
    const hasHeader = existing.some(function (v) { return v !== ''; });
    if (!hasHeader) {
      // Format teks untuk SELURUH kolom (termasuk baris yang ditambahkan nanti) agar NIP 18 digit
      // tidak diubah menjadi angka dan kehilangan ketelitian.
      sheet.getRange('A:' + String.fromCharCode(64 + width)).setNumberFormat('@');
      headRange.setValues([def.headers]);
      headRange.setFontWeight('bold').setBackground('#0b2a4a').setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }
    if (def.hidden && !sheet.isSheetHidden()) {
      try {
        const protection = sheet.protect().setDescription('Berisi hash password. Jangan dibagikan.');
        protection.removeEditors(protection.getEditors());
      } catch (e) {
        console.warn('Tidak dapat memproteksi sheet ' + def.name + ': ' + e.message);
      }
      sheet.hideSheet();
    }
    delete headerMaps[def.name];
    return sheet;
  }

  function spreadsheetId() {
    return open().getId();
  }

  return {
    reset: reset,
    readAll: readAll,
    append: append,
    update: update,
    withLock: withLock,
    ensureSheet: ensureSheet,
    spreadsheetId: spreadsheetId,
    open: open
  };
})();
