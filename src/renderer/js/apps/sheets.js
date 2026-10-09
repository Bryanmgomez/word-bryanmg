import { el, debounce, downloadBlob, readFileAsText, escapeRegExp } from '../core/util.js';
import { toast } from '../components/toast.js';
import { openDialog, confirmDialog, promptDialog } from '../components/dialogs.js';

const STORAGE_KEY = 'papiro.sheet.v1';
const DEFAULT_ROWS = 40;
const DEFAULT_COLS = 26;
const MAX_ROWS = 1000;
const MAX_COLS = 78;
const BASE_COL_W = 100;
const BASE_ROW_H = 27;
const ROWHEAD_W = 46;

let root = null;
let gridWrap = null;
let fxInput = null;
let refLabel = null;
let nameInput = null;
let sheetsList = null;
let statusStats = null;
let zoomLabel = null;

let workbook = null;
let active = 'A1';
let selAnchor = 'A1';
let selEnd = 'A1';
let dragging = false;
let resizing = null;
let selectOnFocus = false;
let editPushed = false;
let contextMenu = null;

let clipboard = null;
let history = [];
let future = [];

let valueCache = new Map();
let errorCache = new Set();
let computing = new Set();

/* ---------------- Persistencia ---------------- */

function makeSheet(name, rows = DEFAULT_ROWS, cols = DEFAULT_COLS, cells = {}) {
  return { name, rows, cols, cells, colWidths: {}, rowHeights: {}, merges: [] };
}

function seedWorkbook() {
  const cells = {
    A1: { v: 'Producto', s: { b: 1 } },
    B1: { v: 'Cantidad', s: { b: 1 } },
    C1: { v: 'Precio', s: { b: 1 } },
    D1: { v: 'Total', s: { b: 1 } },
    A2: { v: 'Cuaderno' }, B2: { v: '3' }, C2: { v: '2.5' }, D2: { v: '=B2*C2', s: { fmt: 'moneda' } },
    A3: { v: 'Bolígrafo' }, B3: { v: '10' }, C3: { v: '1.2' }, D3: { v: '=B3*C3', s: { fmt: 'moneda' } },
    A4: { v: 'Mochila' }, B4: { v: '2' }, C4: { v: '34.9' }, D4: { v: '=B4*C4', s: { fmt: 'moneda' } },
    A6: { v: 'Total general', s: { b: 1 } },
    D6: { v: '=SUMA(D2:D4)', s: { b: 1, fmt: 'moneda' } }
  };
  return { name: 'Libro1', active: 0, zoom: 1, gridlines: true, sheets: [makeSheet('Hoja 1', DEFAULT_ROWS, DEFAULT_COLS, cells)] };
}

function normalizeWorkbook(raw) {
  const wb = {
    name: typeof raw.name === 'string' ? raw.name : 'Libro1',
    active: Number(raw.active) || 0,
    zoom: raw.zoom ? Math.max(0.5, Math.min(2, Number(raw.zoom))) : 1,
    gridlines: raw.gridlines !== false,
    sheets: []
  };
  for (const s of raw.sheets || []) {
    if (!s || typeof s !== 'object') continue;
    wb.sheets.push({
      name: typeof s.name === 'string' ? s.name : 'Hoja',
      rows: Math.max(5, Math.min(MAX_ROWS, Number(s.rows) || DEFAULT_ROWS)),
      cols: Math.max(1, Math.min(MAX_COLS, Number(s.cols) || DEFAULT_COLS)),
      cells: s.cells && typeof s.cells === 'object' ? s.cells : {},
      colWidths: s.colWidths && typeof s.colWidths === 'object' ? s.colWidths : {},
      rowHeights: s.rowHeights && typeof s.rowHeights === 'object' ? s.rowHeights : {},
      merges: Array.isArray(s.merges) ? s.merges : []
    });
  }
  if (!wb.sheets.length) wb.sheets.push(makeSheet('Hoja 1'));
  wb.active = Math.max(0, Math.min(wb.active, wb.sheets.length - 1));
  return wb;
}

function loadWorkbook() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (raw && Array.isArray(raw.sheets) && raw.sheets.length) return normalizeWorkbook(raw);
  } catch { /* almacenamiento no disponible */ }
  return seedWorkbook();
}

const persist = debounce(() => writeWorkbook(), 600);

function writeWorkbook() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(workbook)); } catch { /* cuota llena */ }
}

/* ---------------- Hoja y celdas ---------------- */

const sheet = () => workbook.sheets[workbook.active];

function colName(n) {
  let s = '';
  n += 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function colIndex(name) {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const refName = (c, r) => colName(c) + (r + 1);

function parseRef(ref) {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref);
  if (!m) return { col: 0, row: 0 };
  return { col: colIndex(m[1]), row: parseInt(m[2], 10) - 1 };
}

function getRaw(ref) {
  const c = sheet().cells[ref];
  return c && typeof c.v === 'string' ? c.v : '';
}

function setRaw(ref, raw) {
  const s = sheet();
  const c = s.cells[ref];
  if (raw === '') {
    if (!c) return;
    c.v = '';
    if (!c.s) delete s.cells[ref];
    return;
  }
  if (c) c.v = raw;
  else s.cells[ref] = { v: raw };
}

function getStyle(ref) {
  const c = sheet().cells[ref];
  return c && c.s ? c.s : {};
}

function setStyle(ref, patch) {
  const s = sheet();
  const c = s.cells[ref] || (s.cells[ref] = { v: '' });
  c.s = Object.assign({}, c.s, patch);
  for (const k of Object.keys(c.s)) if (!c.s[k] && c.s[k] !== 0) delete c.s[k];
  if (!c.s || !Object.keys(c.s).length) delete c.s;
  if (!c.v && !c.s) delete s.cells[ref];
}

function clearCell(ref) {
  const s = sheet();
  const c = s.cells[ref];
  if (!c) return;
  delete c.v;
  if (!c.s) delete s.cells[ref];
}

function ensureSize(rows, cols) {
  const s = sheet();
  if (rows > s.rows) s.rows = Math.min(MAX_ROWS, rows);
  if (cols > s.cols) s.cols = Math.min(MAX_COLS, cols);
}

/* ---------------- Motor de fórmulas ---------------- */

function parseNumber(str) {
  if (typeof str === 'number') return isFinite(str) ? str : null;
  if (typeof str !== 'string') return null;
  const s = str.trim();
  if (s === '') return null;
  let t = s;
  if (t.includes(',') && !t.includes('.')) t = t.replace(',', '.');
  if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return Number(t);
  return null;
}

function toNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (v == null) return 0;
  if (typeof v === 'object' && v.__range) return toNum(evalRange(v)[0]);
  const n = parseNumber(v);
  return n == null ? 0 : n;
}

function isError(v) { return typeof v === 'string' && v[0] === '#'; }
function isNA(v) { return v === '#N/D' || v === '#¡N/D!' || v === '#N/A'; }

function toText(v) {
  if (v == null) return '';
  if (typeof v === 'object' && v.__range) return evalRange(v).map(toText).join('');
  return String(v);
}

function resetCache() {
  valueCache = new Map();
  errorCache = new Set();
  computing = new Set();
}

function computeCell(ref) {
  if (valueCache.has(ref)) return valueCache.get(ref);
  const c = sheet().cells[ref];
  if (!c || typeof c.v !== 'string' || c.v === '') {
    valueCache.set(ref, '');
    return '';
  }
  const raw = c.v;
  if (raw[0] === '=') {
    if (computing.has(ref)) { errorCache.add(ref); return '#¡REF!'; }
    computing.add(ref);
    let out;
    try { out = evaluate(raw.slice(1)); } catch { out = '#¡ERROR!'; errorCache.add(ref); }
    computing.delete(ref);
    if (out && typeof out === 'object' && out.__range) out = toNum(out);
    valueCache.set(ref, out);
    return out;
  }
  valueCache.set(ref, raw);
  return raw;
}

const getCellValue = (ref) => computeCell(ref);

function evalRange(rng) {
  const [a, b] = rng.__range;
  const c1 = Math.min(a.col, b.col), c2 = Math.max(a.col, b.col);
  const r1 = Math.min(a.row, b.row), r2 = Math.max(a.row, b.row);
  const out = [];
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push(getCellValue(refName(c, r)));
  return out;
}

function rangeMatrix(rng) {
  const [a, b] = rng.__range;
  const c1 = Math.min(a.col, b.col), c2 = Math.max(a.col, b.col);
  const r1 = Math.min(a.row, b.row), r2 = Math.max(a.row, b.row);
  const out = [];
  for (let r = r1; r <= r2; r++) {
    const row = [];
    for (let c = c1; c <= c2; c++) row.push(getCellValue(refName(c, r)));
    out.push(row);
  }
  return out;
}

function allValues(args) {
  const out = [];
  for (const a of args) {
    if (a && typeof a === 'object' && a.__range) out.push(...evalRange(a));
    else out.push(a);
  }
  return out;
}

function numericList(args) {
  const out = [];
  for (const v of allValues(args)) {
    if (typeof v === 'number') { if (isFinite(v)) out.push(v); }
    else if (typeof v === 'string' && !isError(v)) { const n = parseNumber(v); if (n != null) out.push(n); }
  }
  return out;
}

function sumArgs(a) { return numericList(a).reduce((x, y) => x + y, 0); }
function avgArgs(a) { const n = numericList(a); return n.length ? n.reduce((x, y) => x + y, 0) / n.length : 0; }
function minArgs(a) { const n = numericList(a); return n.length ? Math.min(...n) : 0; }
function maxArgs(a) { const n = numericList(a); return n.length ? Math.max(...n) : 0; }
function countArgs(a) { return numericList(a).length; }
function countaArgs(a) { return allValues(a).filter((v) => v !== '' && v != null && !isError(v)).length; }
function productArgs(a) { const n = numericList(a); return n.length ? n.reduce((x, y) => x * y, 1) : 0; }
function roundArgs(a) { const x = toNum(a[0]); const d = a.length > 1 ? Math.trunc(toNum(a[1])) : 0; const f = Math.pow(10, d); return Math.round(x * f) / f; }
function roundUpArgs(a) { const x = toNum(a[0]); const d = a.length > 1 ? Math.trunc(toNum(a[1])) : 0; const f = Math.pow(10, d); return Math.ceil(x * f) / f; }
function roundDownArgs(a) { const x = toNum(a[0]); const d = a.length > 1 ? Math.trunc(toNum(a[1])) : 0; const f = Math.pow(10, d); return Math.floor(x * f) / f; }
function absArgs(a) { return Math.abs(toNum(a[0])); }
function sqrtArgs(a) { const x = toNum(a[0]); return x < 0 ? '#¡NUM!' : Math.sqrt(x); }
function powArgs(a) { return Math.pow(toNum(a[0]), toNum(a[1])); }
function intArgs(a) { return Math.floor(toNum(a[0])); }
function modArgs(a) { const y = toNum(a[1]); return y === 0 ? '#¡DIV/0!' : toNum(a[0]) % y; }
function ifArgs(a) { return toNum(a[0]) ? a[1] : (a.length > 2 ? a[2] : 0); }
function iferrorArgs(a) { return isError(a[0]) ? a[1] : a[0]; }
function concatArgs(a) { return allValues(a).map(toText).join(''); }
function lenArgs(a) { return toText(a[0]).length; }
function upperArgs(a) { return toText(a[0]).toUpperCase(); }
function lowerArgs(a) { return toText(a[0]).toLowerCase(); }
function trimArgs(a) { return toText(a[0]).trim(); }
function todayArgs() { return new Date().toLocaleDateString('es-ES'); }
function nowArgs() { return new Date().toLocaleString('es-ES'); }
function randArgs() { return Math.random(); }
function randBetweenArgs(a) { const lo = Math.ceil(toNum(a[0])), hi = Math.floor(toNum(a[1])); return Math.floor(Math.random() * (hi - lo + 1)) + lo; }

function criteriaMatch(value, crit) {
  let c = crit;
  if (c && typeof c === 'object' && c.__range) c = evalRange(c)[0];
  if (typeof c === 'string') {
    const m = /^(<=|>=|<>|=|<|>)([\s\S]*)$/.exec(c.trim());
    if (m) {
      const op = m[1];
      const rhsRaw = m[2].trim();
      const rhsNum = parseNumber(rhsRaw);
      if (rhsNum != null && !isError(value)) {
        const x = toNum(value);
        if (op === '=') return x === rhsNum;
        if (op === '<>') return x !== rhsNum;
        if (op === '<') return x < rhsNum;
        if (op === '>') return x > rhsNum;
        if (op === '<=') return x <= rhsNum;
        if (op === '>=') return x >= rhsNum;
      }
      const ls = toText(value).toLowerCase();
      const rs = rhsRaw.toLowerCase();
      if (op === '=') return ls === rs;
      if (op === '<>') return ls !== rs;
      return false;
    }
    return toText(value).toLowerCase() === c.trim().toLowerCase();
  }
  return toText(value) === toText(c);
}

function countIfArgs(a) { const vals = allValues([a[0]]); let n = 0; for (const v of vals) if (criteriaMatch(v, a[1])) n++; return n; }
function sumIfArgs(a) {
  const vals = allValues([a[0]]);
  const sums = a.length > 2 ? allValues([a[2]]) : vals;
  let s = 0;
  for (let i = 0; i < vals.length; i++) if (criteriaMatch(vals[i], a[1])) s += toNum(sums[i]);
  return s;
}
function avgIfArgs(a) {
  const vals = allValues([a[0]]);
  const sums = a.length > 2 ? allValues([a[2]]) : vals;
  let s = 0, n = 0;
  for (let i = 0; i < vals.length; i++) if (criteriaMatch(vals[i], a[1])) { s += toNum(sums[i]); n++; }
  return n ? s / n : '#¡DIV/0!';
}

const sameText = (a, b) => toText(a).toLowerCase() === toText(b).toLowerCase();

function vlookupArgs(a) {
  const needle = a[0];
  const m = rangeMatrix(a[1]);
  const idx = Math.trunc(toNum(a[2])) - 1;
  const approx = a.length > 3 ? toNum(a[3]) : 0;
  if (approx) {
    let best = null;
    for (const row of m) if (toNum(row[0]) <= toNum(needle)) best = row;
    return best ? best[idx] : '#N/D';
  }
  for (const row of m) if (typeof row[0] === 'number' && typeof needle === 'number' ? row[0] === needle : sameText(row[0], needle)) return row[idx];
  return '#N/D';
}

function hlookupArgs(a) {
  const needle = a[0];
  const m = rangeMatrix(a[1]);
  const idx = Math.trunc(toNum(a[2])) - 1;
  if (!m.length) return '#N/D';
  const header = m[0];
  for (let c = 0; c < header.length; c++) {
    const match = typeof header[c] === 'number' && typeof needle === 'number' ? header[c] === needle : sameText(header[c], needle);
    if (match) return m[idx] ? m[idx][c] : '#N/D';
  }
  return '#N/D';
}

const FUNCTIONS = {
  SUMA: sumArgs, SUM: sumArgs,
  PROMEDIO: avgArgs, AVERAGE: avgArgs, MEDIA: avgArgs,
  MIN: minArgs, MAX: maxArgs,
  CONTAR: countArgs, COUNT: countArgs,
  CONTARA: countaArgs, COUNTA: countaArgs,
  CONTAR_SI: countIfArgs, 'CONTAR.SI': countIfArgs, COUNTIF: countIfArgs,
  SUMAR_SI: sumIfArgs, 'SUMAR.SI': sumIfArgs, SUMIF: sumIfArgs,
  PROMEDIO_SI: avgIfArgs, 'PROMEDIO.SI': avgIfArgs, AVERAGEIF: avgIfArgs,
  PRODUCTO: productArgs, PRODUCT: productArgs,
  REDONDEAR: roundArgs, ROUND: roundArgs,
  'REDONDEAR.MAS': roundUpArgs, REDONDEAR_MAS: roundUpArgs, ROUNDUP: roundUpArgs,
  'REDONDEAR.MENOS': roundDownArgs, REDONDEAR_MENOS: roundDownArgs, ROUNDDOWN: roundDownArgs,
  ABS: absArgs,
  RAIZ: sqrtArgs, SQRT: sqrtArgs,
  POTENCIA: powArgs, POWER: powArgs,
  ENTERO: intArgs, INT: intArgs,
  RESIDUO: modArgs, MOD: modArgs,
  SI: ifArgs, IF: ifArgs,
  'SI.ERROR': iferrorArgs, SI_ERROR: iferrorArgs, IFERROR: iferrorArgs,
  CONCAT: concatArgs, CONCATENAR: concatArgs,
  LARGO: lenArgs, LEN: lenArgs,
  MAYUSC: upperArgs, UPPER: upperArgs,
  MINUSC: lowerArgs, LOWER: lowerArgs,
  RECORTAR: trimArgs, TRIM: trimArgs,
  HOY: todayArgs, TODAY: todayArgs,
  AHORA: nowArgs, NOW: nowArgs,
  ALEATORIO: randArgs, RAND: randArgs,
  'ALEATORIO.ENTRE': randBetweenArgs, ALEATORIO_ENTRE: randBetweenArgs, RANDBETWEEN: randBetweenArgs,
  BUSCARV: vlookupArgs, VLOOKUP: vlookupArgs,
  BUSCARH: hlookupArgs, HLOOKUP: hlookupArgs
};

function tokenize(input) {
  const tokens = [];
  let i = 0;
  const isDigit = (c) => c >= '0' && c <= '9';
  const isDot = (c) => c === '.';
  const isWord = (c) => /[A-Za-z0-9_.\u00C0-\u024F]/.test(c);
  while (i < input.length) {
    const c = input[i];
    if (/\s/.test(c)) { i++; continue; }
    if (isDigit(c) || (isDot(c) && isDigit(input[i + 1]))) {
      let j = i;
      while (j < input.length && (isDigit(input[j]) || isDot(input[j]))) j++;
      tokens.push({ t: 'num', v: parseFloat(input.slice(i, j)) || 0 });
      i = j;
      continue;
    }
    if (/[A-Za-z\u00C0-\u024F]/.test(c)) {
      let j = i;
      while (j < input.length && isWord(input[j])) j++;
      const word = input.slice(i, j);
      const known = FUNCTIONS[word.toUpperCase()];
      const m = /^([A-Za-z]+)(\d+)$/.exec(word);
      if (m && !known) tokens.push({ t: 'ref', col: m[1].toUpperCase(), row: parseInt(m[2], 10) });
      else tokens.push({ t: 'id', v: word.toUpperCase() });
      i = j;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let str = '';
      while (j < input.length && input[j] !== '"') { str += input[j]; j++; }
      tokens.push({ t: 'str', v: str });
      i = j + 1;
      continue;
    }
    const two = input.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>') { tokens.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/^(),;:<>=&'.includes(c)) { tokens.push({ t: 'op', v: c }); i++; continue; }
    i++;
  }
  return tokens;
}

function callFunction(name, args) {
  const f = FUNCTIONS[name];
  if (!f) throw new Error('Función desconocida: ' + name);
  return f(args);
}

function evaluate(source) {
  const tokens = tokenize(source);
  let pos = 0;
  const peek = () => tokens[pos];
  const nextTok = () => tokens[pos++];
  const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;

  function expect(v) {
    if (!isOp(v)) throw new Error('Se esperaba ' + v);
    nextTok();
  }

  function expr() { return compare(); }

  function compare() {
    let left = concat();
    while (peek() && peek().t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(peek().v)) {
      const op = nextTok().v;
      const right = concat();
      const a = toNum(left), b = toNum(right);
      let r = false;
      if (op === '=') r = a === b;
      else if (op === '<>') r = a !== b;
      else if (op === '<') r = a < b;
      else if (op === '>') r = a > b;
      else if (op === '<=') r = a <= b;
      else if (op === '>=') r = a >= b;
      left = r ? 1 : 0;
    }
    return left;
  }

  function concat() {
    let left = add();
    while (isOp('&')) { nextTok(); left = toText(left) + toText(add()); }
    return left;
  }

  function add() {
    let left = mul();
    while (isOp('+') || isOp('-')) {
      const op = nextTok().v;
      const right = mul();
      left = op === '+' ? toNum(left) + toNum(right) : toNum(left) - toNum(right);
    }
    return left;
  }

  function mul() {
    let left = unary();
    while (isOp('*') || isOp('/')) {
      const op = nextTok().v;
      const right = unary();
      if (op === '*') left = toNum(left) * toNum(right);
      else { const d = toNum(right); left = d === 0 ? '#¡DIV/0!' : toNum(left) / d; }
    }
    return left;
  }

  function unary() {
    if (isOp('-') || isOp('+')) {
      const op = nextTok().v;
      const v = unary();
      return op === '-' ? -toNum(v) : toNum(v);
    }
    return power();
  }

  function power() {
    const base = primary();
    if (isOp('^')) { nextTok(); return Math.pow(toNum(base), toNum(unary())); }
    return base;
  }

  function primary() {
    const tok = peek();
    if (!tok) throw new Error('Fórmula incompleta');
    if (tok.t === 'num') { nextTok(); return tok.v; }
    if (tok.t === 'str') { nextTok(); return tok.v; }
    if (tok.t === 'ref') {
      const from = nextTok();
      if (isOp(':')) {
        nextTok();
        const to = peek();
        if (!to || to.t !== 'ref') throw new Error('Rango no válido');
        nextTok();
        return { __range: [{ col: colIndex(from.col), row: from.row - 1 }, { col: colIndex(to.col), row: to.row - 1 }] };
      }
      return getCellValue(refName(colIndex(from.col), from.row - 1));
    }
    if (tok.t === 'op' && tok.v === '(') {
      nextTok();
      const v = expr();
      expect(')');
      return v;
    }
    if (tok.t === 'id') {
      nextTok();
      if (isOp('(')) {
        nextTok();
        const args = [];
        if (!isOp(')')) {
          args.push(expr());
          while (isOp(',') || isOp(';')) { nextTok(); args.push(expr()); }
        }
        expect(')');
        return callFunction(tok.v, args);
      }
      return 0;
    }
    throw new Error('Símbolo inesperado');
  }

  return expr();
}

/* ---------------- Valores visibles ---------------- */

function formatNumber(v, st) {
  const fmt = st.fmt || 'general';
  const dec = typeof st.dec === 'number' ? st.dec : null;
  if (fmt === 'moneda') return v.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: dec == null ? 2 : dec, maximumFractionDigits: dec == null ? 2 : dec });
  if (fmt === 'porcentaje') return (v * 100).toLocaleString('es-ES', { minimumFractionDigits: dec == null ? 0 : dec, maximumFractionDigits: dec == null ? 2 : dec }) + ' %';
  if (fmt === 'numero') return v.toLocaleString('es-ES', { minimumFractionDigits: dec == null ? 0 : dec, maximumFractionDigits: dec == null ? 2 : dec });
  return String(Math.round(v * 1e10) / 1e10);
}

function displayValue(ref) {
  const v = computeCell(ref);
  if (isError(v)) return v;
  const st = getStyle(ref);
  if (typeof v === 'number') {
    if (!isFinite(v)) return '#¡NUM!';
    return formatNumber(v, st);
  }
  const fmt = st.fmt || 'general';
  if (fmt !== 'general' || typeof st.dec === 'number') {
    const n = parseNumber(v);
    if (n != null) return formatNumber(n, st);
  }
  return v == null ? '' : String(v);
}

/* ---------------- Historial ---------------- */

function snapshot() {
  return JSON.stringify({
    sheets: workbook.sheets,
    sheetIndex: workbook.active,
    cell: active,
    zoom: workbook.zoom,
    gridlines: workbook.gridlines
  });
}

function pushHistory() {
  history.push(snapshot());
  if (history.length > 100) history.shift();
  future = [];
}

function restore(str) {
  const o = JSON.parse(str);
  workbook.sheets = o.sheets;
  workbook.active = o.sheetIndex;
  workbook.zoom = o.zoom;
  workbook.gridlines = o.gridlines;
  if (typeof o.cell === 'string') active = o.cell;
}

function undo() {
  if (!history.length) { toast('Nada que deshacer'); return; }
  future.push(snapshot());
  restore(history.pop());
  afterStructural();
}

function redo() {
  if (!future.length) { toast('Nada que rehacer'); return; }
  history.push(snapshot());
  restore(future.pop());
  afterStructural();
}

function afterStructural() {
  const s = sheet();
  const p = parseRef(active);
  const row = Math.max(0, Math.min(s.rows - 1, p.row));
  const col = Math.max(0, Math.min(s.cols - 1, p.col));
  active = refName(col, row);
  selAnchor = active;
  selEnd = active;
  renderGrid();
  renderSheetsBar();
  applyZoom();
  applyGridlines();
  persist();
}

/* ---------------- Interfaz (construcción) ---------------- */

const TB = (icon, cmd, title) =>
  el('button', { class: 'sh-tb', dataset: { cmd }, title }, el('svg', { class: 'icon' }, el('use', { href: '#' + icon })));

const TXT = (label, cmd, title, extraClass) =>
  el('button', { class: 'sh-tb sh-tb-txt' + (extraClass ? ' ' + extraClass : ''), dataset: { cmd }, title }, el('span', { text: label }));

function group(label, ...items) {
  return el('div', { class: 'sh-group' },
    el('div', { class: 'sh-group-items' }, ...items),
    el('span', { class: 'sh-group-label', text: label })
  );
}

function buildShell() {
  nameInput = el('input', { class: 'sh-name', type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Nombre del libro' });
  nameInput.value = workbook.name;
  nameInput.addEventListener('input', () => { workbook.name = nameInput.value.trim() || 'Libro1'; persist(); });

  const top = el('div', { class: 'sh-top' },
    el('div', { class: 'sh-brand' },
      el('svg', { class: 'logo' }, el('use', { href: '#i-sheet' })),
      el('span', { class: 'sh-brand-txt', html: 'Hoja de cálculo <b>BryanMG</b>' })
    ),
    nameInput,
    el('div', { class: 'sh-actions' },
      el('button', { class: 'btn', dataset: { sh: 'functions' }, title: 'Funciones disponibles' }, el('svg', { class: 'icon' }, el('use', { href: '#i-help' })), el('span', { text: 'Funciones' })),
      el('button', { class: 'btn', dataset: { sh: 'import' }, title: 'Importar CSV' }, el('svg', { class: 'icon' }, el('use', { href: '#i-upload' })), el('span', { text: 'Importar' })),
      el('button', { class: 'btn', dataset: { sh: 'export' }, title: 'Exportar CSV' }, el('svg', { class: 'icon' }, el('use', { href: '#i-download' })), el('span', { text: 'Exportar' })),
      el('button', { class: 'btn primary', dataset: { sh: 'close' } }, el('span', { text: 'Cerrar' }))
    )
  );

  const colorBtn = (kind, symbol, color) =>
    el('label', { class: 'sh-color', title: kind === 'color' ? 'Color del texto' : 'Color de relleno' },
      el('span', { class: 'sh-color-' + symbol, text: symbol === 'a' ? 'A' : 'F' }),
      el('input', { type: 'color', value: color, dataset: { color: kind } })
    );

  const fmtSelect = el('select', { class: 'ctl sh-fmt', dataset: { fmt: '' }, title: 'Formato de número' },
    el('option', { value: 'general', text: 'General' }),
    el('option', { value: 'numero', text: 'Número' }),
    el('option', { value: 'moneda', text: 'Moneda €' }),
    el('option', { value: 'porcentaje', text: 'Porcentaje' })
  );

  const borderSelect = el('select', { class: 'ctl sh-border', dataset: { border: '' }, title: 'Bordes' },
    el('option', { value: '', text: 'Bordes…' }),
    el('option', { value: 'all', text: 'Todos' }),
    el('option', { value: 'outer', text: 'Exterior' }),
    el('option', { value: 'none', text: 'Sin bordes' })
  );

  const toolbar = el('div', { class: 'sh-toolbar' },
    group('Portapapeles',
      TB('i-paste', 'paste', 'Pegar (Ctrl+V)'),
      TB('i-cut', 'cut', 'Cortar (Ctrl+X)'),
      TB('i-copy', 'copy', 'Copiar (Ctrl+C)')
    ),
    group('Historial',
      TB('i-undo', 'undo', 'Deshacer (Ctrl+Z)'),
      TB('i-redo', 'redo', 'Rehacer (Ctrl+Y)')
    ),
    group('Fuente',
      TXT('B', 'bold', 'Negrita (Ctrl+B)', 'sh-b'),
      TXT('I', 'italic', 'Cursiva (Ctrl+I)', 'sh-i'),
      TXT('U', 'underline', 'Subrayado (Ctrl+U)', 'sh-u'),
      TXT('S', 'strike', 'Tachado', 'sh-s'),
      colorBtn('color', 'a', '#171b26'),
      colorBtn('bg', 'b', '#ffe066')
    ),
    group('Alineación',
      TB('i-align-left', 'align:left', 'Alinear a la izquierda'),
      TB('i-align-center', 'align:center', 'Centrar'),
      TB('i-align-right', 'align:right', 'Alinear a la derecha')
    ),
    group('Número',
      fmtSelect,
      TB('i-dec-dec', 'dec-dec', 'Menos decimales'),
      TB('i-dec-inc', 'dec-inc', 'Más decimales')
    ),
    group('Estilos',
      borderSelect,
      TB('i-clear', 'clear-fmt', 'Borrar todo (contenido y formato)')
    ),
    group('Celdas',
      TB('i-plus', 'insert-row', 'Insertar fila'),
      TB('i-plus', 'insert-col', 'Insertar columna'),
      TB('i-minus', 'delete-row', 'Eliminar fila'),
      TB('i-minus', 'delete-col', 'Eliminar columna'),
      TB('i-merge', 'merge', 'Combinar celdas'),
      TB('i-unmerge', 'unmerge', 'Separar celdas')
    ),
    group('Edición',
      TB('i-sigma', 'autosum', 'Suma automática (Σ)'),
      TB('i-fill-down', 'fill-down', 'Rellenar hacia abajo (Ctrl+D)'),
      TB('i-fill-right', 'fill-right', 'Rellenar a la derecha (Ctrl+R)')
    ),
    group('Datos',
      TB('i-sort-asc', 'sort-asc', 'Ordenar ascendente'),
      TB('i-sort-desc', 'sort-desc', 'Ordenar descendente'),
      TB('i-find', 'find', 'Buscar y reemplazar (Ctrl+F)')
    ),
    group('Ver',
      TB('i-grid', 'gridlines', 'Mostrar/ocultar cuadrícula')
    )
  );

  refLabel = el('span', { class: 'sh-ref', text: 'A1' });
  fxInput = el('input', { class: 'sh-fx', type: 'text', spellcheck: 'false', autocomplete: 'off', placeholder: 'Escribe un valor o una fórmula, p. ej. =SUMA(A1:A5)' });
  const formulaBar = el('div', { class: 'sh-formulabar' },
    refLabel,
    el('span', { class: 'sh-fx-ico', text: 'fx' }),
    fxInput
  );

  gridWrap = el('div', { class: 'sh-grid-wrap' });

  statusStats = el('span', { class: 'sh-status-stats' });
  zoomLabel = el('span', { class: 'sh-zoom-label', text: '100 %' });
  const status = el('div', { class: 'sh-status' },
    el('span', { class: 'sh-status-active', text: 'Listo' }),
    statusStats,
    el('div', { class: 'sh-status-right' },
      el('button', { class: 'sh-status-btn', dataset: { cmd: 'zoom-out' }, title: 'Alejar' }, el('span', { text: '−' })),
      zoomLabel,
      el('button', { class: 'sh-status-btn', dataset: { cmd: 'zoom-in' }, title: 'Acercar' }, el('span', { text: '+' }))
    )
  );

  sheetsList = el('div', { class: 'sh-tabs-list' });
  const tabs = el('div', { class: 'sh-tabs' },
    el('button', { class: 'sh-tab-add', dataset: { sh: 'add-sheet' }, title: 'Añadir hoja' }, el('span', { text: '+' })),
    sheetsList
  );

  root.append(top, toolbar, formulaBar, gridWrap, status, tabs);
}

/* ---------------- Cuadrícula ---------------- */

function applyStyleToInput(input, st) {
  input.style.fontWeight = st.b ? '700' : '';
  input.style.fontStyle = st.i ? 'italic' : '';
  input.style.textDecoration = [st.u ? 'underline' : '', st.s ? 'line-through' : ''].filter(Boolean).join(' ');
  input.style.textAlign = st.align || '';
  input.style.color = st.color || '';
  input.style.background = st.bg || '';
  const bd = st.bd || '';
  const line = '1px solid var(--sh-border-line, rgba(120,128,150,.55))';
  input.style.borderTop = bd.includes('t') ? line : '';
  input.style.borderRight = bd.includes('r') ? line : '';
  input.style.borderBottom = bd.includes('b') ? line : '';
  input.style.borderLeft = bd.includes('l') ? line : '';
}

function renderGrid() {
  resetCache();
  const s = sheet();
  const table = el('table', { class: 'sh-grid' });

  const cg = el('colgroup');
  cg.append(el('col', { style: 'width:' + ROWHEAD_W + 'px' }));
  for (let c = 0; c < s.cols; c++) cg.append(el('col', { style: 'width:' + (s.colWidths[c] || BASE_COL_W) + 'px' }));
  table.append(cg);

  const thead = el('thead');
  const htr = el('tr');
  htr.append(el('th', { class: 'sh-corner' }));
  for (let c = 0; c < s.cols; c++) {
    const th = el('th', { class: 'sh-col', dataset: { col: c }, text: colName(c) });
    th.append(el('span', { class: 'sh-rz', dataset: { rz: 'col', index: c } }));
    htr.append(th);
  }
  thead.append(htr);
  table.append(thead);

  const covered = new Set();
  const anchors = new Map();
  for (const m of (s.merges || [])) {
    anchors.set(m.r1 + ',' + m.c1, m);
    for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) {
      if (!(r === m.r1 && c === m.c1)) covered.add(r + ',' + c);
    }
  }

  const tbody = el('tbody');
  for (let r = 0; r < s.rows; r++) {
    const tr = el('tr');
    if (s.rowHeights[r]) tr.style.height = s.rowHeights[r] + 'px';
    const rh = el('th', { class: 'sh-rowhead', dataset: { row: r }, text: String(r + 1) });
    rh.append(el('span', { class: 'sh-rz', dataset: { rz: 'row', index: r } }));
    tr.append(rh);
    for (let c = 0; c < s.cols; c++) {
      if (covered.has(r + ',' + c)) continue;
      const ref = refName(c, r);
      const input = el('input', {
        class: 'sh-cell', type: 'text', spellcheck: 'false', autocomplete: 'off',
        dataset: { ref, row: r, col: c }
      });
      input.value = displayValue(ref);
      applyStyleToInput(input, getStyle(ref));
      const td = el('td', {}, input);
      const m = anchors.get(r + ',' + c);
      if (m) {
        if (m.c2 > m.c1) td.colSpan = m.c2 - m.c1 + 1;
        if (m.r2 > m.r1) td.rowSpan = m.r2 - m.r1 + 1;
        td.classList.add('sh-merged');
      }
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  gridWrap.replaceChildren(table);
  applyZoom();
  applyGridlines();
  paintSelection();
  updateFormulaBar();
  syncFormatButtons();
}

const cellInput = (ref) => gridWrap.querySelector('.sh-cell[data-ref="' + ref + '"]');

function rangeBounds() {
  const a = parseRef(selAnchor || active);
  const b = parseRef(selEnd || active);
  return {
    r1: Math.min(a.row, b.row), r2: Math.max(a.row, b.row),
    c1: Math.min(a.col, b.col), c2: Math.max(a.col, b.col)
  };
}

function isInRange(ref, b) {
  const { col, row } = parseRef(ref);
  return col >= b.c1 && col <= b.c2 && row >= b.r1 && row <= b.r2;
}

function paintSelection() {
  const b = rangeBounds();
  for (const inp of gridWrap.querySelectorAll('.sh-cell')) {
    inp.classList.toggle('sel', isInRange(inp.dataset.ref, b));
  }
  for (const th of gridWrap.querySelectorAll('.sh-col')) {
    const c = Number(th.dataset.col);
    th.classList.toggle('sel', c >= b.c1 && c <= b.c2);
  }
  for (const th of gridWrap.querySelectorAll('.sh-rowhead')) {
    const r = Number(th.dataset.row);
    th.classList.toggle('sel', r >= b.r1 && r <= b.r2);
  }
  updateStatus();
}

function updateStatus() {
  const b = rangeBounds();
  let sum = 0, cnt = 0;
  for (let r = b.r1; r <= b.r2; r++) for (let c = b.c1; c <= b.c2; c++) {
    const v = computeCell(refName(c, r));
    const n = typeof v === 'number' ? v : (isError(v) ? null : parseNumber(v));
    if (n != null) { sum += n; cnt++; }
  }
  let txt = '';
  if (cnt > 0) {
    const avg = sum / cnt;
    txt = 'Suma: ' + formatNumber(sum, {}) + '  ·  Promedio: ' + formatNumber(avg, {}) + '  ·  Contar: ' + cnt;
  }
  statusStats.textContent = txt;
  const activeEl = root && root.querySelector('.sh-status-active');
  if (activeEl) activeEl.textContent = active + (cnt > 1 ? '' : '');
}

function updateFormulaBar() {
  const b = rangeBounds();
  const single = b.r1 === b.r2 && b.c1 === b.c2;
  if (single) {
    const ref = refName(b.c1, b.r1);
    refLabel.textContent = ref;
    if (document.activeElement !== fxInput) fxInput.value = getRaw(ref);
  } else {
    refLabel.textContent = refName(b.c1, b.r1) + ':' + refName(b.c2, b.r2);
    if (document.activeElement !== fxInput) fxInput.value = '';
  }
}

function syncFormatButtons() {
  const st = getStyle(active);
  const map = { bold: st.b, italic: st.i, underline: st.u, strike: st.s };
  let alignActive = null;
  if (st.align === 'center') alignActive = 'align:center';
  else if (st.align === 'right') alignActive = 'align:right';
  else if (st.align === 'left') alignActive = 'align:left';
  for (const btn of root.querySelectorAll('.sh-tb[data-cmd]')) {
    const cmd = btn.dataset.cmd;
    let on = false;
    if (cmd in map) on = !!map[cmd];
    else if (cmd === alignActive) on = true;
    else if (cmd === 'gridlines') on = workbook.gridlines !== false;
    btn.classList.toggle('active', on);
  }
  for (const sel of root.querySelectorAll('.sh-fmt')) sel.value = st.fmt || 'general';
}

function refreshComputed() {
  resetCache();
  const focused = document.activeElement;
  for (const inp of gridWrap.querySelectorAll('.sh-cell')) {
    if (inp === focused) continue;
    const d = displayValue(inp.dataset.ref);
    if (inp.value !== d) inp.value = d;
  }
  for (const inp of gridWrap.querySelectorAll('.sh-cell')) applyStyleToInput(inp, getStyle(inp.dataset.ref));
  updateStatus();
}

function focusCell(ref, opts = {}) {
  active = ref;
  selAnchor = ref;
  selEnd = ref;
  const input = cellInput(ref);
  if (input) {
    if (opts.select) selectOnFocus = true;
    input.focus();
    if (!opts.select) {
      const len = input.value.length;
      try { input.setSelectionRange(len, len); } catch { /* input sin foco */ }
    }
    if (opts.scroll !== false) input.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  updateFormulaBar();
  paintSelection();
  syncFormatButtons();
}

function move(dr, dc) {
  const s = sheet();
  const { col, row } = parseRef(active);
  const nc = Math.max(0, Math.min(s.cols - 1, col + dc));
  const nr = Math.max(0, Math.min(s.rows - 1, row + dr));
  if (nr === row && nc === col) return;
  focusCell(refName(nc, nr), { select: true });
}

function applyZoom() {
  const z = workbook.zoom || 1;
  gridWrap.style.zoom = z;
  if (zoomLabel) zoomLabel.textContent = Math.round(z * 100) + ' %';
}

function setZoom(z) {
  workbook.zoom = Math.max(0.5, Math.min(2, Math.round(z * 10) / 10));
  applyZoom();
  persist();
}

function applyGridlines() {
  gridWrap.classList.toggle('sh-nogrid', workbook.gridlines === false);
}

/* ---------------- Formato sobre la selección ---------------- */

function forSelection(fn) {
  const b = rangeBounds();
  for (let r = b.r1; r <= b.r2; r++) for (let c = b.c1; c <= b.c2; c++) fn(refName(c, r));
}

function applyStyle(patch) {
  pushHistory();
  forSelection((ref) => setStyle(ref, patch));
  refreshComputed();
  const focused = document.activeElement;
  if (focused && focused.classList && focused.classList.contains('sh-cell')) {
    focused.value = displayValue(focused.dataset.ref);
  }
  persist();
  syncFormatButtons();
}

function toggleStyle(key) {
  const st = getStyle(active);
  applyStyle({ [key]: st[key] ? null : 1 });
}

function cloneStyle(st) {
  return st && Object.keys(st).length ? Object.assign({}, st) : undefined;
}

/* ---------------- Comandos ---------------- */

function clearContents() {
  pushHistory();
  forSelection((ref) => clearCell(ref));
  refreshComputed();
  renderGrid();
  persist();
}

function clearAll() {
  confirmDialog('Borrar todo', '¿Borrar contenido y formato de las celdas seleccionadas?').then((ok) => {
    if (!ok) return;
    pushHistory();
    const s = sheet();
    forSelection((ref) => { delete s.cells[ref]; });
    renderGrid();
    persist();
  });
}

function clearSheet() {
  confirmDialog('Vaciar hoja', '¿Borrar todas las celdas de esta hoja?').then((ok) => {
    if (!ok) return;
    pushHistory();
    sheet().cells = {};
    sheet().merges = [];
    renderGrid();
    persist();
    toast('Hoja vaciada', 'ok');
  });
}

function setBorders(mode) {
  pushHistory();
  const b = rangeBounds();
  for (let r = b.r1; r <= b.r2; r++) {
    for (let c = b.c1; c <= b.c2; c++) {
      let flags = '';
      if (mode === 'all') flags = 'trbl';
      else if (mode === 'outer') {
        if (r === b.r1) flags += 't';
        if (r === b.r2) flags += 'b';
        if (c === b.c1) flags += 'l';
        if (c === b.c2) flags += 'r';
      }
      setStyle(refName(c, r), { bd: flags || null });
    }
  }
  refreshComputed();
  persist();
}

function changeDecimals(delta) {
  const st = getStyle(active);
  const cur = typeof st.dec === 'number' ? st.dec : (st.fmt === 'moneda' ? 2 : 0);
  applyStyle({ dec: Math.max(0, Math.min(8, cur + delta)) });
}

/* ---------------- Edición estructural ---------------- */

function ensureEnough(r, c) {
  const s = sheet();
  if (r + 1 > s.rows) s.rows = Math.min(MAX_ROWS, r + 1);
  if (c + 1 > s.cols) s.cols = Math.min(MAX_COLS, c + 1);
}

function insertRow() {
  const s = sheet();
  if (s.rows >= MAX_ROWS) { toast('Máximo de filas alcanzado', 'error'); return; }
  const { row } = parseRef(active);
  pushHistory();
  const cells = {};
  for (const [ref, cell] of Object.entries(s.cells)) {
    const p = parseRef(ref);
    cells[refName(p.col, p.row >= row ? p.row + 1 : p.row)] = cell;
  }
  s.cells = cells;
  s.rows++;
  const rh = {};
  for (const [k, v] of Object.entries(s.rowHeights)) { const n = Number(k); rh[n >= row ? n + 1 : n] = v; }
  s.rowHeights = rh;
  s.merges = (s.merges || []).map((m) => {
    const nm = Object.assign({}, m);
    if (m.r1 >= row) nm.r1++;
    if (m.r2 >= row) nm.r2++;
    return nm;
  });
  renderGrid();
  persist();
}

function deleteRow() {
  const s = sheet();
  if (s.rows <= 5) { toast('No se pueden eliminar más filas', 'error'); return; }
  const { row } = parseRef(active);
  pushHistory();
  const cells = {};
  for (const [ref, cell] of Object.entries(s.cells)) {
    const p = parseRef(ref);
    if (p.row === row) continue;
    cells[refName(p.col, p.row > row ? p.row - 1 : p.row)] = cell;
  }
  s.cells = cells;
  s.rows--;
  const rh = {};
  for (const [k, v] of Object.entries(s.rowHeights)) {
    const n = Number(k);
    if (n === row) continue;
    rh[n > row ? n - 1 : n] = v;
  }
  s.rowHeights = rh;
  s.merges = (s.merges || [])
    .filter((m) => !(m.r1 <= row && m.r2 >= row && m.r1 === m.r2))
    .map((m) => {
      const nm = Object.assign({}, m);
      if (m.r1 > row) nm.r1--;
      if (m.r2 >= row) nm.r2--;
      return nm;
    })
    .filter((m) => m.r1 <= m.r2);
  renderGrid();
  persist();
}

function insertCol() {
  const s = sheet();
  if (s.cols >= MAX_COLS) { toast('Máximo de columnas alcanzado', 'error'); return; }
  const { col } = parseRef(active);
  pushHistory();
  const cells = {};
  for (const [ref, cell] of Object.entries(s.cells)) {
    const p = parseRef(ref);
    cells[refName(p.col >= col ? p.col + 1 : p.col, p.row)] = cell;
  }
  s.cells = cells;
  s.cols++;
  const cw = {};
  for (const [k, v] of Object.entries(s.colWidths)) { const n = Number(k); cw[n >= col ? n + 1 : n] = v; }
  s.colWidths = cw;
  s.merges = (s.merges || []).map((m) => {
    const nm = Object.assign({}, m);
    if (m.c1 >= col) nm.c1++;
    if (m.c2 >= col) nm.c2++;
    return nm;
  });
  renderGrid();
  persist();
}

function deleteCol() {
  const s = sheet();
  if (s.cols <= 1) { toast('No se pueden eliminar más columnas', 'error'); return; }
  const { col } = parseRef(active);
  pushHistory();
  const cells = {};
  for (const [ref, cell] of Object.entries(s.cells)) {
    const p = parseRef(ref);
    if (p.col === col) continue;
    cells[refName(p.col > col ? p.col - 1 : p.col, p.row)] = cell;
  }
  s.cells = cells;
  s.cols--;
  const cw = {};
  for (const [k, v] of Object.entries(s.colWidths)) {
    const n = Number(k);
    if (n === col) continue;
    cw[n > col ? n - 1 : n] = v;
  }
  s.colWidths = cw;
  s.merges = (s.merges || [])
    .filter((m) => !(m.c1 <= col && m.c2 >= col && m.c1 === m.c2))
    .map((m) => {
      const nm = Object.assign({}, m);
      if (m.c1 > col) nm.c1--;
      if (m.c2 >= col) nm.c2--;
      return nm;
    })
    .filter((m) => m.c1 <= m.c2);
  renderGrid();
  persist();
}

function overlaps(a, b) { return a.r1 <= b.r2 && a.r2 >= b.r1 && a.c1 <= b.c2 && a.c2 >= b.c1; }

function mergeCells() {
  const b = rangeBounds();
  if (b.r1 === b.r2 && b.c1 === b.c2) { toast('Selecciona varias celdas para combinar', 'error'); return; }
  pushHistory();
  const s = sheet();
  s.merges = (s.merges || []).filter((m) => !overlaps(m, b));
  s.merges.push({ r1: b.r1, c1: b.c1, r2: b.r2, c2: b.c2 });
  renderGrid();
  persist();
}

function unmergeCells() {
  const b = rangeBounds();
  const s = sheet();
  const before = (s.merges || []).length;
  pushHistory();
  s.merges = (s.merges || []).filter((m) => !overlaps(m, b));
  if (s.merges.length === before) { history.pop(); toast('No hay celdas combinadas en la selección', 'error'); return; }
  renderGrid();
  persist();
}

/* ---------------- Cortar / copiar / pegar ---------------- */

function selectionTSV() {
  const b = rangeBounds();
  const lines = [];
  for (let r = b.r1; r <= b.r2; r++) {
    const cells = [];
    for (let c = b.c1; c <= b.c2; c++) cells.push(getRaw(refName(c, r)));
    lines.push(cells.join('\t'));
  }
  return { text: lines.join('\n'), bounds: b };
}

function copySelection(cut) {
  const b = rangeBounds();
  const data = {};
  for (let r = b.r1; r <= b.r2; r++) for (let c = b.c1; c <= b.c2; c++) {
    const ref = refName(c, r);
    const cell = sheet().cells[ref];
    data[ref] = cell ? JSON.parse(JSON.stringify(cell)) : { v: '' };
  }
  const { text } = selectionTSV();
  clipboard = { data, bounds: b, cut: !!cut, text };
  try { navigator.clipboard && navigator.clipboard.writeText(text); } catch { /* sin permiso */ }
  toast(cut ? 'Cortado' : 'Copiado', 'ok');
}

function pasteInternal() {
  if (!clipboard) { toast('El portapapeles está vacío', 'error'); return; }
  const b = rangeBounds();
  const src = clipboard.bounds;
  const h = src.r2 - src.r1;
  const w = src.c2 - src.c1;
  pushHistory();
  for (let r = 0; r <= h; r++) for (let c = 0; c <= w; c++) {
    const fromRef = refName(src.c1 + c, src.r1 + r);
    const toC = b.c1 + c, toR = b.r1 + r;
    ensureEnough(toR, toC);
    const cell = clipboard.data[fromRef];
    const s = sheet();
    if (cell && (cell.v || cell.s)) s.cells[refName(toC, toR)] = JSON.parse(JSON.stringify(cell));
    else delete s.cells[refName(toC, toR)];
  }
  if (clipboard.cut) {
    for (const ref of Object.keys(clipboard.data)) delete sheet().cells[ref];
    clipboard = null;
  }
  renderGrid();
  persist();
}

function pasteText(text) {
  const rows = text.replace(/\r/g, '').split('\n');
  while (rows.length && rows[rows.length - 1] === '') rows.pop();
  if (!rows.length) return;
  const b = rangeBounds();
  pushHistory();
  const s = sheet();
  rows.forEach((line, r) => {
    line.split('\t').forEach((val, c) => {
      const toR = b.r1 + r, toC = b.c1 + c;
      ensureEnough(toR, toC);
      const ref = refName(toC, toR);
      if (val === '') { delete s.cells[ref]; return; }
      const existing = s.cells[ref];
      if (existing) existing.v = val;
      else s.cells[ref] = { v: val };
    });
  });
  if (clipboard && clipboard.cut) {
    for (const ref of Object.keys(clipboard.data)) delete s.cells[ref];
    clipboard = null;
  }
  renderGrid();
  persist();
  toast('Pegado', 'ok');
}

async function pasteClipboard() {
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch { /* sin permiso */ }
  if (text && text.trim() !== '') { pasteText(text); return; }
  if (clipboard) { pasteInternal(); return; }
  toast('El portapapeles está vacío', 'error');
}

/* ---------------- Rellenar y ordenar ---------------- */

function shiftFormula(raw, dr, dc) {
  if (!raw || raw[0] !== '=') return raw;
  return '=' + raw.slice(1).replace(/(\$?)([A-Za-z]{1,3})(\$?)(\d+)/g, (m, ac, letters, rc, digits) => {
    let col = colIndex(letters);
    let row = parseInt(digits, 10) - 1;
    if (!ac) col += dc;
    if (!rc) row += dr;
    if (col < 0 || row < 0) return '#¡REF!';
    return (ac || '') + colName(col) + (rc || '') + (row + 1);
  });
}

function fillDown() {
  const b = rangeBounds();
  if (b.r1 === b.r2) { toast('Selecciona al menos dos filas', 'error'); return; }
  pushHistory();
  for (let c = b.c1; c <= b.c2; c++) {
    const srcRef = refName(c, b.r1);
    const srcRaw = getRaw(srcRef);
    const st = cloneStyle(getStyle(srcRef));
    for (let r = b.r1 + 1; r <= b.r2; r++) {
      const ref = refName(c, r);
      const shifted = shiftFormula(srcRaw, r - b.r1, 0);
      setRaw(ref, shifted);
      setStyle(ref, st ? Object.assign({}, st) : {});
    }
  }
  renderGrid();
  persist();
}

function fillRight() {
  const b = rangeBounds();
  if (b.c1 === b.c2) { toast('Selecciona al menos dos columnas', 'error'); return; }
  pushHistory();
  for (let r = b.r1; r <= b.r2; r++) {
    const srcRef = refName(b.c1, r);
    const srcRaw = getRaw(srcRef);
    const st = cloneStyle(getStyle(srcRef));
    for (let c = b.c1 + 1; c <= b.c2; c++) {
      const ref = refName(c, r);
      const shifted = shiftFormula(srcRaw, 0, c - b.c1);
      setRaw(ref, shifted);
      setStyle(ref, st ? Object.assign({}, st) : {});
    }
  }
  renderGrid();
  persist();
}

function sortSelection(dir) {
  const b = rangeBounds();
  if (b.r1 === b.r2) { toast('Selecciona más de una fila para ordenar', 'error'); return; }
  pushHistory();
  const rows = [];
  for (let r = b.r1; r <= b.r2; r++) {
    const row = [];
    for (let c = b.c1; c <= b.c2; c++) {
      const cell = sheet().cells[refName(c, r)];
      row.push(cell ? JSON.parse(JSON.stringify(cell)) : { v: '' });
    }
    rows.push(row);
  }
  const keys = rows.map((row) => {
    const raw = row[0] && row[0].v;
    if (raw == null || raw === '') return { t: 2, v: 0 };
    const n = parseNumber(raw);
    return n != null ? { t: 0, v: n } : { t: 1, v: String(raw).toLowerCase() };
  });
  const order = rows.map((_, i) => i).sort((i, j) => {
    const a = keys[i], c = keys[j];
    if (a.t !== c.t) return a.t - c.t;
    if (a.t === 2) return i - j;
    if (a.v < c.v) return -dir;
    if (a.v > c.v) return dir;
    return i - j;
  });
  const s = sheet();
  for (let r = 0; r < order.length; r++) {
    const row = rows[order[r]];
    for (let c = 0; c < row.length; c++) {
      const ref = refName(b.c1 + c, b.r1 + r);
      const cell = row[c];
      if (cell && ((cell.v != null && cell.v !== '') || cell.s)) s.cells[ref] = cell;
      else delete s.cells[ref];
    }
  }
  renderGrid();
  persist();
  toast('Ordenado', 'ok');
}

function autoSum() {
  const b = rangeBounds();
  pushHistory();
  if (b.r1 === b.r2 && b.c1 === b.c2) {
    const p = parseRef(active);
    let top = p.row - 1;
    while (top >= 0 && getRaw(refName(p.col, top)) !== '') top--;
    top++;
    if (top < p.row) setRaw(active, '=SUMA(' + refName(p.col, top) + ':' + refName(p.col, p.row - 1) + ')');
    else setRaw(active, '=SUMA(A1:A1)');
  } else {
    const p = parseRef(active);
    const ref = refName(b.c2 + 1, p.row);
    ensureEnough(p.row, b.c2 + 1);
    setRaw(ref, '=SUMA(' + refName(b.c1, b.r1) + ':' + refName(b.c2, b.r2) + ')');
  }
  refreshComputed();
  renderGrid();
  persist();
}

/* ---------------- Buscar y reemplazar ---------------- */

function findNext(query) {
  if (!query) return null;
  const s = sheet();
  const q = query.toLowerCase();
  const refs = Object.keys(s.cells).sort((a, b) => {
    const pa = parseRef(a), pb = parseRef(b);
    return pa.row - pb.row || pa.col - pb.col;
  });
  const startIdx = refs.findIndex((ref) => ref === active);
  for (let k = 1; k <= refs.length; k++) {
    const ref = refs[(startIdx + k + refs.length) % refs.length];
    const raw = getRaw(ref);
    if (raw && raw.toLowerCase().includes(q)) {
      ensureSize(parseRef(ref).row + 1, parseRef(ref).col + 1);
      focusCell(ref, { select: true });
      return ref;
    }
  }
  return null;
}

function replaceAll(query, replacement) {
  if (!query) return 0;
  pushHistory();
  const s = sheet();
  const re = new RegExp(escapeRegExp(query), 'gi');
  let n = 0;
  for (const [ref, cell] of Object.entries(s.cells)) {
    if (typeof cell.v === 'string' && cell.v !== '' && !cell.v.startsWith('=') && re.test(cell.v)) {
      cell.v = cell.v.replace(re, replacement);
      if (cell.v === '') { delete cell.v; if (!cell.s) delete s.cells[ref]; }
      n++;
    }
    re.lastIndex = 0;
  }
  refreshComputed();
  renderGrid();
  persist();
  return n;
}

function findReplaceDialog() {
  const find = el('input', { class: 'field', placeholder: 'Buscar…' });
  const rep = el('input', { class: 'field', placeholder: 'Reemplazar por…' });
  const info = el('div', { class: 'sh-find-info' });
  const next = el('button', { class: 'btn', text: 'Buscar siguiente' });
  const all = el('button', { class: 'btn primary', text: 'Reemplazar todo' });
  next.addEventListener('click', () => {
    const r = findNext(find.value);
    info.textContent = r ? 'Coincidencia en ' + r : 'Sin coincidencias';
  });
  all.addEventListener('click', () => { info.textContent = replaceAll(find.value, rep.value) + ' reemplazo(s)'; });
  openDialog({
    title: 'Buscar y reemplazar',
    body: el('div', { class: 'sh-find' },
      el('label', { class: 'field-label', text: 'Buscar' }), find,
      el('label', { class: 'field-label', text: 'Reemplazar por' }), rep,
      el('div', { class: 'sh-find-btns' }, next, all),
      info
    ),
    buttons: [{ label: 'Cerrar', value: null, primary: true }]
  });
  setTimeout(() => find.focus(), 40);
}

/* ---------------- Menú contextual ---------------- */

function closeContextMenu() {
  if (contextMenu) { contextMenu.remove(); contextMenu = null; }
}

function openContextMenu(x, y) {
  closeContextMenu();
  const items = [
    ['Cortar', () => copySelection(true)],
    ['Copiar', () => copySelection(false)],
    ['Pegar', () => pasteClipboard()],
    '-',
    ['Insertar fila', insertRow],
    ['Insertar columna', insertCol],
    ['Eliminar fila', deleteRow],
    ['Eliminar columna', deleteCol],
    '-',
    ['Combinar celdas', mergeCells],
    ['Separar celdas', unmergeCells],
    '-',
    ['Suma automática', autoSum],
    ['Rellenar abajo', fillDown],
    ['Rellenar derecha', fillRight],
    '-',
    ['Ordenar A → Z', () => sortSelection(1)],
    ['Ordenar Z → A', () => sortSelection(-1)],
    '-',
    ['Borrar contenido', clearContents]
  ];
  contextMenu = el('div', { class: 'sh-menu' });
  for (const it of items) {
    if (it === '-') { contextMenu.append(el('div', { class: 'sh-menu-sep' })); continue; }
    const [label, fn] = it;
    const b = el('button', { class: 'sh-menu-item', text: label });
    b.addEventListener('click', () => { closeContextMenu(); fn(); });
    contextMenu.append(b);
  }
  document.getElementById('overlay-root').append(contextMenu);
  const rect = contextMenu.getBoundingClientRect();
  const px = Math.min(x, window.innerWidth - rect.width - 8);
  const py = Math.min(y, window.innerHeight - rect.height - 8);
  contextMenu.style.left = Math.max(8, px) + 'px';
  contextMenu.style.top = Math.max(8, py) + 'px';
  setTimeout(() => document.addEventListener('mousedown', onDocMouseDownForMenu, true), 0);
}

function onDocMouseDownForMenu(e) {
  if (contextMenu && !contextMenu.contains(e.target)) {
    closeContextMenu();
    document.removeEventListener('mousedown', onDocMouseDownForMenu, true);
  }
}

/* ---------------- Hojas (pestañas) ---------------- */

function renderSheetsBar() {
  sheetsList.replaceChildren();
  workbook.sheets.forEach((sh, idx) => {
    const tab = el('button', { class: 'sh-tab' + (idx === workbook.active ? ' active' : ''), text: sh.name });
    tab.addEventListener('click', () => {
      if (idx === workbook.active) return;
      workbook.active = idx;
      resetView();
    });
    tab.addEventListener('dblclick', async () => {
      const n = await promptDialog('Renombrar hoja', 'Nombre de la hoja', sh.name, { confirmLabel: 'Guardar' });
      if (n) { sh.name = n; renderSheetsBar(); persist(); }
    });
    if (workbook.sheets.length > 1) {
      const x = el('span', { class: 'sh-tab-x', text: '×', title: 'Eliminar hoja' });
      x.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await confirmDialog('Eliminar hoja', '¿Eliminar la hoja «' + sh.name + '»?');
        if (!ok) return;
        pushHistory();
        workbook.sheets.splice(idx, 1);
        workbook.active = Math.max(0, Math.min(workbook.active, workbook.sheets.length - 1));
        resetView();
      });
      tab.append(x);
    }
    sheetsList.append(tab);
  });
}

function resetView() {
  active = 'A1';
  selAnchor = 'A1';
  selEnd = 'A1';
  renderGrid();
  renderSheetsBar();
  applyZoom();
  applyGridlines();
  persist();
}

function addSheet() {
  const name = 'Hoja ' + (workbook.sheets.length + 1);
  pushHistory();
  workbook.sheets.push(makeSheet(name));
  workbook.active = workbook.sheets.length - 1;
  resetView();
  toast('Hoja añadida', 'ok');
}

/* ---------------- CSV ---------------- */

function csvEscape(v) {
  const s = String(v == null ? '' : v);
  return /["\n;,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function exportCSV() {
  const s = sheet();
  const lines = [];
  for (let r = 0; r < s.rows; r++) {
    const row = [];
    for (let c = 0; c < s.cols; c++) row.push(csvEscape(displayValue(refName(c, r))));
    lines.push(row.join(';'));
  }
  while (lines.length && lines[lines.length - 1].replace(/;/g, '').trim() === '') lines.pop();
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, (workbook.name || 'Hoja') + ' - ' + s.name + '.csv');
  toast('Exportado como CSV', 'ok');
}

function parseCSV(text, delim) {
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQ = true; continue; }
    if (ch === delim) { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  row.push(field);
  rows.push(row);
  return rows;
}

async function importCSV() {
  const input = el('input', { type: 'file', accept: '.csv,.txt,text/csv', hidden: true });
  const done = new Promise((resolve) => { input.addEventListener('change', () => resolve(input.files[0] || null)); });
  input.click();
  const file = await done;
  if (!file) return;
  try {
    const text = await readFileAsText(file);
    const firstLine = text.split(/\r?\n/)[0] || '';
    const delim = (firstLine.split(';').length > firstLine.split(',').length) ? ';' : ',';
    const rows = parseCSV(text, delim);
    pushHistory();
    const s = sheet();
    s.cells = {};
    s.merges = [];
    rows.forEach((row, r) => {
      row.forEach((val, c) => { if (val !== '') s.cells[refName(c, r)] = { v: val }; });
    });
    if (rows[0] && rows[0].length > s.cols) s.cols = Math.min(MAX_COLS, rows[0].length);
    if (rows.length > s.rows) s.rows = Math.min(MAX_ROWS, rows.length);
    renderGrid();
    persist();
    toast('CSV importado', 'ok');
  } catch {
    toast('No se pudo importar el CSV', 'error');
  }
}

/* ---------------- Ayuda de funciones ---------------- */

function functionsDialog() {
  const groups = [
    ['Matemáticas', 'SUMA, PROMEDIO, PRODUCTO, MIN, MAX, REDONDEAR, REDONDEAR.MAS, REDONDEAR.MENOS, ABS, RAIZ, POTENCIA, ENTERO, RESIDUO, ALEATORIO, ALEATORIO.ENTRE'],
    ['Estadística', 'CONTAR (números), CONTARA (no vacías), CONTAR.SI, SUMAR.SI, PROMEDIO.SI'],
    ['Búsqueda', 'BUSCARV(valor; rango; columna; [aprox]), BUSCARH(valor; rango; fila)'],
    ['Lógica', 'SI(condición; valor_si; valor_no), SI.ERROR(valor; si_error)'],
    ['Texto', 'CONCAT, LARGO, MAYUSC, MINUSC, RECORTAR'],
    ['Fecha', 'HOY, AHORA']
  ];
  openDialog({
    title: 'Funciones disponibles',
    body: el('div', {},
      el('p', { html: 'Empieza una fórmula con <b>=</b>. Combina referencias (<b>A1</b>), rangos (<b>A1:B5</b>) y operadores <b>+ - * / ^ ( )</b>. Separa argumentos con <b>;</b> o <b>,</b>.' }),
      el('div', { class: 'sh-func-list' },
        groups.flatMap(([name, list]) => [
          el('div', { class: 'sh-func-title', text: name }),
          el('div', { class: 'sh-func-desc', text: list })
        ])
      ),
      el('p', { html: 'Ejemplos: <b>=SUMA(A1:A5)*2</b>, <b>=BUSCARV(A2; A2:C10; 3; 0)</b> o <b>=SI(D2&gt;10; "Alto"; "Bajo")</b>.' })
    ),
    buttons: [{ label: 'Cerrar', value: null, primary: true }]
  });
}

/* ---------------- Eventos ---------------- */

function onGridFocusIn(e) {
  const inp = e.target.closest && e.target.closest('.sh-cell');
  if (!inp) return;
  const ref = inp.dataset.ref;
  if (active !== ref || (!dragging && selAnchor !== ref)) {
    active = ref;
    if (!dragging) { selAnchor = ref; selEnd = ref; }
  }
  inp.value = getRaw(ref);
  if (selectOnFocus) {
    selectOnFocus = false;
    try { inp.select(); } catch { /* sin foco */ }
  } else {
    const len = inp.value.length;
    try { inp.setSelectionRange(len, len); } catch { /* sin foco */ }
  }
  editPushed = false;
  updateFormulaBar();
  paintSelection();
  syncFormatButtons();
}

function onGridInput(e) {
  const inp = e.target.closest && e.target.closest('.sh-cell');
  if (!inp) return;
  if (!editPushed) { pushHistory(); editPushed = true; }
  setRaw(inp.dataset.ref, inp.value);
  refreshComputed();
  persist();
}

function onGridFocusOut(e) {
  const inp = e.target.closest && e.target.closest('.sh-cell');
  if (!inp) return;
  editPushed = false;
  refreshComputed();
  inp.value = displayValue(inp.dataset.ref);
}

function onGridMouseDown(e) {
  const rz = e.target.closest && e.target.closest('.sh-rz');
  if (rz) {
    e.preventDefault();
    startResize(rz.dataset.rz, Number(rz.dataset.index), e);
    return;
  }
  const inp = e.target.closest && e.target.closest('.sh-cell');
  if (!inp) return;
  dragging = true;
  active = inp.dataset.ref;
  selAnchor = active;
  selEnd = active;
  paintSelection();
  updateFormulaBar();
}

function startResize(kind, index, e) {
  const s = sheet();
  const size = kind === 'col' ? (s.colWidths[index] || BASE_COL_W) : (s.rowHeights[index] || BASE_ROW_H);
  pushHistory();
  resizing = { kind, index, start: kind === 'col' ? e.clientX : e.clientY, size };
}

function onDragMove(e) {
  if (resizing) {
    const s = sheet();
    if (resizing.kind === 'col') {
      const w = Math.max(28, Math.round(resizing.size + (e.clientX - resizing.start)));
      s.colWidths[resizing.index] = w;
      const col = gridWrap.querySelectorAll('col')[resizing.index + 1];
      if (col) col.style.width = w + 'px';
    } else {
      const h = Math.max(18, Math.round(resizing.size + (e.clientY - resizing.start)));
      s.rowHeights[resizing.index] = h;
      const tr = gridWrap.querySelectorAll('tbody tr')[resizing.index];
      if (tr) tr.style.height = h + 'px';
    }
    return;
  }
  if (!dragging) return;
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const inp = under && under.closest ? under.closest('.sh-cell') : null;
  if (!inp) return;
  selEnd = inp.dataset.ref;
  paintSelection();
  updateFormulaBar();
}

function onDragUp() {
  if (resizing) { resizing = null; persist(); return; }
  if (!dragging) return;
  dragging = false;
  syncFormatButtons();
}

function caretAtStart(input) { return input.selectionStart === 0 && input.selectionEnd === 0; }
function caretAtEnd(input) { return input.selectionStart === input.value.length && input.selectionEnd === input.value.length; }

function onRootKeydown(e) {
  e.stopPropagation();
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key;
  const target = e.target;
  const k = key.toLowerCase();

  if (key === 'Escape') {
    if (contextMenu) { closeContextMenu(); return; }
    e.preventDefault();
    closeSheets();
    return;
  }
  if (mod && k === 's') { e.preventDefault(); writeWorkbook(); toast('Libro guardado', 'ok'); return; }
  if (mod && k === 'z') { e.preventDefault(); undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 'c') { e.preventDefault(); copySelection(false); return; }
  if (mod && k === 'x') { e.preventDefault(); copySelection(true); return; }
  if (mod && k === 'v') { e.preventDefault(); pasteClipboard(); return; }
  if (mod && k === 'f') { e.preventDefault(); findReplaceDialog(); return; }
  if (mod && k === 'd') { e.preventDefault(); fillDown(); return; }
  if (mod && k === 'r') { e.preventDefault(); fillRight(); return; }
  if (mod && k === 'b') { e.preventDefault(); toggleStyle('b'); return; }
  if (mod && k === 'i') { e.preventDefault(); toggleStyle('i'); return; }
  if (mod && k === 'u') { e.preventDefault(); toggleStyle('u'); return; }
  if (mod && (key === '=' || key === '+')) { e.preventDefault(); return; }
  if (mod) return;

  const inner = target.closest ? target.closest('.sh-cell, .sh-fx') : null;
  if (!inner) return;

  if (target === fxInput) {
    if (key === 'Enter') { e.preventDefault(); move(1, 0); }
    return;
  }

  if (key === 'Enter' || key === 'ArrowDown') { e.preventDefault(); move(1, 0); return; }
  if (key === 'ArrowUp') { e.preventDefault(); move(-1, 0); return; }
  if (key === 'Tab') { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); return; }
  if (key === 'ArrowLeft' && caretAtStart(target)) { e.preventDefault(); move(0, -1); return; }
  if (key === 'ArrowRight' && caretAtEnd(target)) { e.preventDefault(); move(0, 1); return; }
  if (key === 'Home') { e.preventDefault(); focusCell(refName(0, parseRef(active).row), { select: true }); return; }
  if (key === 'End') { e.preventDefault(); focusCell(refName(sheet().cols - 1, parseRef(active).row), { select: true }); return; }
}

function doCmd(cmd) {
  if (cmd === 'bold') toggleStyle('b');
  else if (cmd === 'italic') toggleStyle('i');
  else if (cmd === 'underline') toggleStyle('u');
  else if (cmd === 'strike') toggleStyle('s');
  else if (cmd === 'undo') undo();
  else if (cmd === 'redo') redo();
  else if (cmd === 'paste') pasteClipboard();
  else if (cmd === 'copy') copySelection(false);
  else if (cmd === 'cut') copySelection(true);
  else if (cmd === 'dec-inc') changeDecimals(1);
  else if (cmd === 'dec-dec') changeDecimals(-1);
  else if (cmd === 'clear-fmt') clearAll();
  else if (cmd === 'insert-row') insertRow();
  else if (cmd === 'insert-col') insertCol();
  else if (cmd === 'delete-row') deleteRow();
  else if (cmd === 'delete-col') deleteCol();
  else if (cmd === 'merge') mergeCells();
  else if (cmd === 'unmerge') unmergeCells();
  else if (cmd === 'autosum') autoSum();
  else if (cmd === 'fill-down') fillDown();
  else if (cmd === 'fill-right') fillRight();
  else if (cmd === 'sort-asc') sortSelection(1);
  else if (cmd === 'sort-desc') sortSelection(-1);
  else if (cmd === 'find') findReplaceDialog();
  else if (cmd === 'gridlines') { workbook.gridlines = workbook.gridlines === false; applyGridlines(); syncFormatButtons(); persist(); }
  else if (cmd === 'zoom-in') setZoom((workbook.zoom || 1) + 0.1);
  else if (cmd === 'zoom-out') setZoom((workbook.zoom || 1) - 0.1);
  else if (cmd.startsWith('align:')) {
    const align = cmd.slice(6);
    applyStyle({ align: getStyle(active).align === align ? null : align });
  }
}

function onRootClick(e) {
  const btn = e.target.closest && e.target.closest('[data-sh]');
  if (btn) {
    const act = btn.dataset.sh;
    if (act === 'close') closeSheets();
    else if (act === 'export') exportCSV();
    else if (act === 'import') importCSV();
    else if (act === 'clear') clearSheet();
    else if (act === 'add-sheet') addSheet();
    else if (act === 'functions') functionsDialog();
    return;
  }
  const cmdBtn = e.target.closest && e.target.closest('[data-cmd]');
  if (cmdBtn) { doCmd(cmdBtn.dataset.cmd); }
}

function onRootChange(e) {
  const t = e.target;
  if (t.dataset && t.dataset.fmt !== undefined) {
    applyStyle({ fmt: t.value === 'general' ? null : t.value });
  } else if (t.dataset && t.dataset.color) {
    applyStyle({ [t.dataset.color]: t.value });
  } else if (t.dataset && t.dataset.border !== undefined) {
    if (t.value) setBorders(t.value);
    t.value = '';
  }
}

function onGridContextMenu(e) {
  const inp = e.target.closest && e.target.closest('.sh-cell');
  if (!inp) return;
  e.preventDefault();
  active = inp.dataset.ref;
  if (!isInRange(active, rangeBounds())) { selAnchor = active; selEnd = active; }
  paintSelection();
  updateFormulaBar();
  openContextMenu(e.clientX, e.clientY);
}

function mount() {
  workbook = loadWorkbook();
  root = el('div', { class: 'sheets-app', id: 'sheets-app' });
  buildShell();

  gridWrap.addEventListener('focusin', onGridFocusIn);
  gridWrap.addEventListener('input', onGridInput);
  gridWrap.addEventListener('focusout', onGridFocusOut);
  gridWrap.addEventListener('mousedown', onGridMouseDown);
  gridWrap.addEventListener('contextmenu', onGridContextMenu);
  root.addEventListener('keydown', onRootKeydown);
  root.addEventListener('click', onRootClick);
  root.addEventListener('change', onRootChange);

  fxInput.addEventListener('input', () => {
    if (!editPushed) { pushHistory(); editPushed = true; }
    const b = rangeBounds();
    const val = fxInput.value;
    for (let r = b.r1; r <= b.r2; r++) for (let c = b.c1; c <= b.c2; c++) setRaw(refName(c, r), val);
    refreshComputed();
    persist();
  });
  fxInput.addEventListener('blur', () => { editPushed = false; });

  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragUp);

  document.getElementById('overlay-root').append(root);

  active = 'A1';
  selAnchor = 'A1';
  selEnd = 'A1';
  renderGrid();
  renderSheetsBar();
  applyZoom();
  applyGridlines();
  focusCell('A1', { scroll: false });
}

/* ---------------- API ---------------- */

export function isSheetsOpen() {
  return Boolean(root);
}

export function openSheets() {
  if (root) {
    const inp = cellInput(active) || root.querySelector('.sh-cell');
    if (inp) inp.focus();
    return;
  }
  mount();
}

export function closeSheets() {
  if (!root) return;
  writeWorkbook();
  closeContextMenu();
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragUp);
  document.removeEventListener('mousedown', onDocMouseDownForMenu, true);
  root.remove();
  root = null;
}
