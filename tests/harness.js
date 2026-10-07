'use strict';
/**
 * Harness uji: memuat semua file src/*.js ke satu konteks vm (seperti ruang global Apps Script)
 * dengan tiruan layanan Google (Spreadsheet, Cache, Lock, Properties, Utilities, Session).
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const nodeCrypto = require('node:crypto');

const LOAD_ORDER = ['Config', 'Util', 'Crypto', 'Db', 'Audit', 'Users', 'Roles', 'Auth', 'Api', 'Main', 'Setup'];

function formatDate(date, tz, pattern) {
  const parts = {};
  new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short'
  }).formatToParts(date).forEach((p) => { parts[p.type] = p.value; });
  if (pattern === 'u') return String({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[parts.weekday]);
  return pattern
    .replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day)
    .replace('HH', parts.hour).replace('mm', parts.minute).replace('ss', parts.second);
}

class MockRange {
  constructor(sheet, row, col, nrows, ncols) { Object.assign(this, { sheet, row, col, nrows, ncols }); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nrows; r++) {
      const line = [];
      for (let c = 0; c < this.ncols; c++) line.push(this.sheet.get(this.row + r, this.col + c));
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    values.forEach((line, r) => line.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v)));
    return this;
  }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
}

class MockSheet {
  constructor(name) { this.name = name; this.cells = new Map(); this.hidden = false; this.maxCols = 26; this.frozen = 0; }
  key(r, c) { return r + ':' + c; }
  get(r, c) { return this.cells.has(this.key(r, c)) ? this.cells.get(this.key(r, c)) : ''; }
  set(r, c, v) {
    // Meniru Sheets: awalan apostrof menandai teks dan tidak ikut tersimpan sebagai nilai.
    if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1);
    this.cells.set(this.key(r, c), v);
  }
  getLastRow() { let m = 0; this.cells.forEach((v, k) => { if (v !== '') m = Math.max(m, Number(k.split(':')[0])); }); return m; }
  getLastColumn() { let m = 0; this.cells.forEach((v, k) => { if (v !== '') m = Math.max(m, Number(k.split(':')[1])); }); return m; }
  getMaxColumns() { return this.maxCols; }
  getMaxRows() { return 1000; }
  insertColumnsAfter(_, n) { this.maxCols += n; }
  getRange(r, c, nr, nc) {
    if (typeof r === 'string') return new MockRange(this, 1, 1, 0, 0); // notasi A1 kolom penuh: hanya untuk format
    return new MockRange(this, r, c, nr || 1, nc || 1);
  }
  appendRow(values) { const r = this.getLastRow() + 1; values.forEach((v, i) => this.set(r, i + 1, v)); }
  setFrozenRows(n) { this.frozen = n; }
  isSheetHidden() { return this.hidden; }
  hideSheet() { this.hidden = true; }
  protect() { return { setDescription() { return this; }, removeEditors() {}, getEditors() { return []; } }; }
  dump() {
    const rows = [];
    for (let r = 1; r <= this.getLastRow(); r++) {
      const line = [];
      for (let c = 1; c <= this.getLastColumn(); c++) line.push(this.get(r, c));
      rows.push(line);
    }
    return rows;
  }
}

class MockSpreadsheet {
  constructor(id) { this.id = id; this.sheets = [new MockSheet('Sheet1')]; }
  getId() { return this.id; }
  getSheets() { return this.sheets; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n) { const s = new MockSheet(n); this.sheets.push(s); return s; }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
}

function createEnv(options) {
  const opts = Object.assign({ owner: true, loadOrder: LOAD_ORDER }, options);
  const clock = { offset: 0 };
  const realNow = Date.now.bind(Date);
  class FakeDate extends Date {
    constructor(...args) { if (args.length === 0) super(realNow() + clock.offset); else super(...args); }
    static now() { return realNow() + clock.offset; }
  }

  const spreadsheet = new MockSpreadsheet('SS-TEST');
  const props = {};
  const cacheData = new Map();
  const logger = [];
  const consoleLines = { error: [], warn: [] };
  const session = { active: opts.owner ? 'owner@sekolah.id' : '', effective: 'owner@sekolah.id' };

  const sandbox = {
    Date: FakeDate,
    console: {
      log() {}, info() {},
      warn: (...a) => consoleLines.warn.push(a.join(' ')),
      error: (...a) => consoleLines.error.push(a.join(' '))
    },
    Logger: { log: (m) => logger.push(String(m)) },
    Utilities: { getUuid: () => nodeCrypto.randomUUID(), formatDate },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => {
          const e = cacheData.get(k);
          if (!e) return null;
          if (e.exp <= FakeDate.now()) { cacheData.delete(k); return null; }
          return e.v;
        },
        put: (k, v, s) => {
          if (String(v).length > 100 * 1024) throw new Error('Argument too large');
          cacheData.set(k, { v: String(v), exp: FakeDate.now() + (s || 600) * 1000 });
        },
        remove: (k) => { cacheData.delete(k); }
      })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } })
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      openById: (id) => { if (id !== spreadsheet.id) throw new Error('not found'); return spreadsheet; },
      getUi: () => { throw new Error('no ui'); }
    },
    Session: {
      getActiveUser: () => ({ getEmail: () => session.active }),
      getEffectiveUser: () => ({ getEmail: () => session.effective })
    }
  };
  vm.createContext(sandbox);
  opts.loadOrder.forEach((name) => {
    const file = path.join(__dirname, '../src', name + '.js');
    new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }).runInContext(sandbox);
  });

  const run = (code) => vm.runInContext(code, sandbox);
  return {
    sandbox, spreadsheet, clock, logger, consoleLines, session, cacheData, props,
    run,
    sheet: (name) => spreadsheet.getSheetByName(name),
    advance: (ms) => { clock.offset += ms; },
    /** Memanggil api() persis seperti google.script.run (JSON-roundtrip memastikan hasil dapat diserialisasi). */
    call(action, payload, token) {
      sandbox.__req = { action, payload, token };
      const res = run('api(__req)');
      return JSON.parse(JSON.stringify(res));
    },
    setup() {
      run('setupApp()');
      const text = logger.join('\n');
      const m = text.match(/Password : ([A-Z2-9]{8})/);
      return m ? m[1] : null;
    }
  };
}

module.exports = { createEnv, LOAD_ORDER };
