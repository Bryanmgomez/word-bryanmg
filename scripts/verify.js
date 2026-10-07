const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const puppeteer = require(path.join(__dirname, '..', 'node_modules', 'puppeteer-core'));
const { startServer } = require('./serve.js');

const CHROME = process.env.PAPIRO_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = path.join(__dirname, '..');

let pass = 0;
let fail = 0;
const failures = [];
const consoleIssues = [];

function ok(msg) { pass++; console.log('  PASS  ' + msg); }
function bad(msg) { fail++; failures.push(msg); console.log('  FAIL  ' + msg); }
function info(msg) { console.log('        ' + msg); }

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function closeHome(page) {
  await page.evaluate(() => {
    const home = document.querySelector('#home');
    if (home && !home.classList.contains('hidden') && window.__PAPIRO__) {
      window.__PAPIRO__.runAction('close-home');
    }
  });
}

/* ---------- Decodificador de texto PDF (ToUnicode + zlib) ---------- */

function inflateAll(str) {
  const out = [];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(str))) {
    const s = m.index + m[0].length;
    const e = str.indexOf('endstream', s);
    if (e < 0) continue;
    try { out.push(zlib.inflateSync(Buffer.from(str.slice(s, e), 'latin1')).toString('latin1')); } catch { /* no inflable */ }
  }
  return out;
}

function pdfToUnicode(str) {
  const map = {};
  for (const c of inflateAll(str)) {
    if (!/bfchar|bfrange/.test(c)) continue;
    let m;
    const bc = /beginbfchar([\s\S]*?)endbfchar/g;
    while ((m = bc.exec(c))) {
      let p;
      const pr = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
      while ((p = pr.exec(m[1]))) map[parseInt(p[1], 16)] = String.fromCodePoint(parseInt(p[2], 16));
    }
    const br = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((m = br.exec(c))) {
      let p;
      const rr = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
      while ((p = rr.exec(m[1]))) {
        const lo = parseInt(p[1], 16), hi = parseInt(p[2], 16), dst = parseInt(p[3], 16);
        for (let x = lo; x <= hi && x - lo < 6000; x++) map[x] = String.fromCodePoint(dst + (x - lo));
      }
    }
  }
  return map;
}

function pdfPageTexts(pdfBuf) {
  const str = pdfBuf.toString('latin1');
  const map = pdfToUnicode(str);
  const dec = (hex) => {
    let o = '';
    for (let i = 0; i + 4 <= hex.length; i += 4) {
      const c = map[parseInt(hex.slice(i, i + 4), 16)];
      o += c !== undefined ? c : '';
    }
    return o;
  };
  const texts = [];
  for (const c of inflateAll(str)) {
    if (!/T[jJ]/.test(c)) continue;
    let text = '';
    const re = /<([0-9A-Fa-f]+)>\s*Tj|\[((?:<[0-9A-Fa-f]+>\s*)*)\]\s*TJ|\(((?:[^()\\]|\\.)*)\)\s*Tj/g;
    let m;
    while ((m = re.exec(c))) {
      if (m[1]) text += dec(m[1]);
      else if (m[2]) {
        const hexesInArr = [...m[2].matchAll(/<([0-9A-Fa-f]+)>/g)];
        for (const h of hexesInArr) text += dec(h[1]);
      } else if (m[3]) {
        text += m[3].replace(/\\([nrt\\()])/g, (_, c2) => (c2 === 'n' ? '\n' : c2 === 'r' ? '\r' : c2 === 't' ? '\t' : c2));
      }
    }
    texts.push(text);
  }
  return texts;
}

/* ---------- Utilidades de página ---------- */

async function waitFor(page, fn, ms = 6000, label = 'condición') {
  try {
    await page.waitForFunction(fn, { timeout: ms });
  } catch {
    throw new Error('No se cumplió: ' + label);
  }
}

async function setup(page) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleIssues.push(msg.text());
  });
  page.on('pageerror', (err) => {
    consoleIssues.push('pageerror: ' + (err.message || err));
  });
  page.on('requestfailed', (req) => {
    if (req.url().includes('/sw.js') && !fs.existsSync(path.join(BASE, 'src', 'renderer', 'sw.js'))) return;
    consoleIssues.push('requestfailed: ' + req.url() + ' :: ' + (req.failure() && req.failure().errorText));
  });
}

/* ---------- Pruebas ---------- */

async function tBootIntegrity(page) {
  console.log('\n[1] Arranque e integridad');
  await waitFor(page, () => window.__PAPIRO__ && document.querySelector('#editor'), 8000, 'boot()');

  const audit = await page.evaluate(() => {
    const acts = new Set(Object.keys(window.__PAPIRO__.actions));
    const bad = [...document.querySelectorAll('[data-action]')]
      .map((n) => n.dataset.action)
      .filter((a) => a && !acts.has(a));
    return { bad, hasPapi: !!window.__PAPIRO__, title: document.querySelector('#doc-title').value };
  });

  if (audit.hasPapi) ok('window.__PAPIRO__ expone state, actions y runAction');
  else bad('no existe window.__PAPIRO__');

  if (audit.bad.length === 0) ok('todos los botones [data-action] están registrados en ACTIONS');
  else bad('acciones sin registrar: ' + audit.bad.join(', '));

  if (audit.title.trim()) ok('documento inicial cargado: «' + audit.title + '»');
  else bad('no hay título de documento');

  if (consoleIssues.length) bad('errores de consola durante el arranque: ' + consoleIssues.slice(0, 5).join(' | '));
  else ok('sin errores de consola ni excepciones al arrancar');

  await closeHome(page);
}

async function tTypingStats(page) {
  console.log('\n[2] Escritura y estadísticas');
  const marker = 'FraseclaveX7';
  await page.focus('#editor');
  await page.keyboard.type('Hola ' + marker + ' mundo. ');
  await waitFor(page, () => !/^0 palabras$/.test(document.querySelector('#st-words').textContent), 5000, 'contador de palabras');
  const words = await page.$eval('#st-words', (n) => n.textContent);
  ok('contador de palabras actualizado (' + words + ')');
  const has = await page.evaluate((mk) => document.querySelector('#editor').textContent.includes(mk), marker);
  if (has) ok('texto escrito presente en el editor');
  else bad('el texto no quedó en el editor');
}

async function tBoldFormat(page) {
  console.log('\n[3] Formato (negrita)');
  await page.evaluate(() => {
    const ed = document.querySelector('#editor');
    ed.focus();
    const sel = window.getSelection();
    sel.selectAllChildren(ed);
  });
  await page.click('button[data-cmd="bold"]');
  const hasBold = await page.evaluate(() =>
    /font-weight:\s*bold|<b>|<strong>/i.test(document.querySelector('#editor').innerHTML));
  if (hasBold) ok('se aplicó negrita mediante ejecutar comando');
  else {
    const html = await page.$eval('#editor', (n) => n.innerHTML.slice(0, 160));
    info('HTML del editor: ' + html);
    bad('no se detectó negrita en la selección');
  }
}

async function tAutosaveReload(page) {
  console.log('\n[4] Autoguardado y persistencia');
  const marker = 'PersisteAhoRa88';
  await page.evaluate(() => window.getSelection().removeAllRanges());
  await page.focus('#editor');
  await page.keyboard.type(' ' + marker + ' ');
  await sleep(2300);
  await page.reload({ waitUntil: 'load' });
  await waitFor(page, () => window.__PAPIRO__ && document.querySelector('#editor'), 8000, 'boot tras recarga');
  await closeHome(page);
  const okText = await page.evaluate((mk) => document.querySelector('#editor').textContent.includes(mk), marker);
  if (okText) ok('el texto sobrevivió a una recarga (auto-guardado + IndexedDB)');
  else bad('no se recuperó el texto tras recargar');
}

async function tSearchReplace(page) {
  console.log('\n[5] Buscar y reemplazar');
  const term = 'FraseclaveX7';
  const rep = 'CerebroY9';
  await page.evaluate(() => window.__PAPIRO__.runAction('replace'));
  await waitFor(page, () => !document.querySelector('#findbar').classList.contains('hidden'), 4000, 'findbar abierta');
  await page.type('#find-input', term);
  await sleep(400);
  const count = await page.$eval('#find-count', (n) => n.textContent);
  if (/\/[1-9]/.test(count)) ok('búsqueda resalta resultados (' + count + ')');
  else bad('no hay coincidencias de búsqueda (' + count + ')');
  await page.type('#replace-input', rep);
  await page.click('[data-action="replace-all"]');
  await sleep(300);
  const res = await page.evaluate((r) => ({
    hasTerm: document.querySelector('#editor').textContent.includes(r.term),
    hasRep: document.querySelector('#editor').textContent.includes(r.rep)
  }), { term, rep });
  if (res.hasRep && !res.hasTerm) ok('reemplazar todo funcionó');
  else bad('reemplazo incorrecto (¿termino presente?: ' + res.hasTerm + ', ¿reemplazo?: ' + res.hasRep + ')');
  await page.evaluate(() => window.__PAPIRO__.runAction('find-close'));
}

async function tOutlineAndPages(page) {
  console.log('\n[6] Esquema y número de páginas');
  await page.waitForFunction(() => document.querySelectorAll('#outline-list .outline-item').length >= 2, { timeout: 6000 })
    .then(() => ok('el esquema lista títulos (>= 2 elementos)'))
    .catch(() => bad('el esquema no renderiza títulos'));

  const numParas = 80;
  await page.evaluate((n) => {
    const ed = document.querySelector('#editor');
    const frag = document.createDocumentFragment();
    for (let i = 1; i <= n; i++) {
      const p = document.createElement('p');
      p.textContent = 'Linea de prueba numero ' + i + '.';
      frag.appendChild(p);
    }
    ed.appendChild(frag);
    ed.dispatchEvent(new Event('input', { bubbles: true }));
  }, numParas);

  await waitFor(page, () => {
    const t = document.querySelector('#st-pages').textContent;
    const m = t.match(/de (\d+)/);
    return m && Number(m[1]) >= 2;
  }, 6000, '2+ páginas');
  const pages = await page.$eval('#st-pages', (n) => n.textContent);
  ok('se detectan varias páginas (' + pages + ')');
}

async function tFormats(page) {
  console.log('\n[7] Exportar e importar formatos');
  const marker = 'MarcaRonda33';
  const result = await page.evaluate(async (mk) => {
    const fm = await import('/js/core/formats.js');
    const zip = await import('/js/core/zip.js');
    const html = document.querySelector('#editor').innerHTML + '<p>' + mk + '</p>';
    const out = {};

    const txt = await fm.exportDocument({ format: 'txt', name: 't', html, header: 'H', footer: 'F' });
    out.txt = (await txt.blob.text()).includes(mk);

    const htm = await fm.exportDocument({ format: 'html', name: 't', html });
    out.html = (await htm.blob.text()).toLowerCase().includes('<html');

    async function getZip(fmt) {
      const b = await fm.exportDocument({
        format: fmt, name: 't', html,
        header: 'ENCABEZADO', footer: 'PIE', showPageNum: true
      });
      const arr = new Uint8Array(await b.blob.arrayBuffer());
      const files = await zip.readZip(arr);
      return { arr, files };
    }

    const d = await getZip('docx');
    const docXml = new TextDecoder().decode(d.files.get('word/document.xml') || new Uint8Array());
    out.docxOk = docXml.includes(mk);
    if (out.docxOk) {
      try {
        const res = await fm.importDocumentFile(new File([d.arr], 'round.docx'));
        out.docxImport = res.html.includes(mk);
        const allHeaders = [...d.files.keys()].join(',');
        out.docxHeader = allHeaders.includes('header1.xml');
      } catch (e) {
        out.docxImportErr = String(e && e.message || e);
      }
    }

    const o = await getZip('odt');
    const odtXml = new TextDecoder().decode(o.files.get('content.xml') || new Uint8Array());
    out.odtOk = odtXml.includes(mk);
    if (out.odtOk) {
      try {
        const res = await fm.importDocumentFile(new File([o.arr], 'round.odt'));
        out.odtImport = res.html.includes(mk);
      } catch (e) {
        out.odtImportErr = String(e && e.message || e);
      }
    }

    return out;
  }, marker);

  if (result.txt) ok('TXT exportado con contenido');
  else bad('TXT sin contenido');
  if (result.html) ok('HTML exportado como página autónoma');
  else bad('HTML autónomo incompleto');
  if (result.docxOk) ok('DOCX exportado con el marcador en document.xml');
  else bad('DOCX no contiene el marcador');
  if (result.docxImport) ok('DOCX importado correctamente (round-trip)');
  else bad('DOCX no se importó correctamente' + (result.docxImportErr ? ': ' + result.docxImportErr : ''));
  if (result.odtOk) ok('ODT exportado con el marcador en content.xml');
  else bad('ODT no contiene el marcador');
  if (result.odtImport) ok('ODT importado correctamente (round-trip)');
  else bad('ODT no se importó correctamente' + (result.odtImportErr ? ': ' + result.odtImportErr : ''));
}

async function tPdfPrint(page) {
  console.log('\n[8] Vista de impresión (PDF)');
  await page.evaluate(() => {
    const set = (sel, txt) => {
      const n = document.querySelector(sel);
      if (n) n.textContent = txt;
    };
    set('#page-header', 'HEADERPRUEBA');
    set('#page-footer', 'FOOTERPRUEBA');
  });
  const pdf = Buffer.from(await page.pdf({ format: 'A4', printBackground: true }));
  const texts = pdfPageTexts(pdf);
  const all = texts.join('\n');
  if (texts.length >= 2) ok('el PDF tiene varias páginas (' + texts.length + ')');
  else bad('el PDF tiene ' + texts.length + ' página(s)');
  if (all.includes('HEADERPRUEBA')) ok('el encabezado aparece impreso');
  else bad('no aparece el encabezado en el PDF');
  if (all.includes('FOOTERPRUEBA')) ok('el pie aparece impreso');
  else bad('no aparece el pie en el PDF');
  if (all.includes('Linea de prueba numero')) ok('el cuerpo del documento se imprime');
  else bad('no se ve el cuerpo en el PDF');
  if (!/Página \d/.test(all)) ok('los números de página se ocultan en impresión');
  else bad('el contador de página aparece en el PDF');
  fs.writeFileSync(path.join(os.tmpdir(), 'papiro-print-test.pdf'), pdf);
}

async function tHistory(page) {
  console.log('\n[9] Historial de cambios');
  await waitFor(page, () => document.querySelector('#save-state').dataset.state === 'saved', 6000, 'guardado');
  await page.evaluate(() => window.__PAPIRO__.runAction('save'));
  await waitFor(page, () => document.querySelector('#save-state').dataset.state === 'saved', 6000, 'guardar manual');
  await page.evaluate(() => window.__PAPIRO__.runAction('history'));
  await waitFor(page, () => document.querySelectorAll('#overlay-root [data-ver-restore]').length > 0, 5000, 'lista de versiones');
  const rows = await page.evaluate(() => document.querySelectorAll('#overlay-root [data-ver-restore]').length);
  ok('el historial lista versiones (' + rows + ' guardada(s))');
  await page.keyboard.press('Escape');
  await waitFor(page, () => !document.querySelector('#overlay-root .dialog'), 3000, 'cierre de diálogo');
  ok('Esc cierra el diálogo del historial');
}

async function confirmDialogBtn(page) {
  await waitFor(page, () => document.querySelectorAll('#overlay-root .dialog .btn.primary, #overlay-root .dialog .btn.danger').length > 0, 4000, 'dialogo de confirmación');
  await page.evaluate(() => {
    const b = document.querySelector('#overlay-root .dialog .btn.primary') || document.querySelector('#overlay-root .dialog .btn.danger');
    b && b.click();
  });
  await waitFor(page, () => !document.querySelector('#overlay-root .dialog'), 4000, 'cierre del diálogo');
}

async function tFiles(page) {
  console.log('\n[10] Gestor de archivos (carpetas, papelera)');
  await page.evaluate(() => window.__PAPIRO__.runAction('manager'));
  await waitFor(page, () => document.querySelector('#sb-files').classList.contains('active'), 4000, 'pestaña Archivos');
  ok('se abre la pestaña Archivos desde la barra');

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#fm-content [data-fm-action="new-folder"]')][0];
    btn && btn.click();
  });
  await waitFor(page, () => document.querySelector('#overlay-root input.field'), 3000, 'diálogo de carpeta');
  await page.type('#overlay-root input.field', 'Trabajo');
  await page.keyboard.press('Enter');
  await waitFor(page, () => [...document.querySelectorAll('#fm-content .fm-row-name')].some((n) => n.textContent === 'Trabajo'), 5000, 'carpeta creada');
  ok('se creó la carpeta «Trabajo»');

  const before = await page.evaluate(() => document.querySelectorAll('#fm-content [data-fm-action="dup-doc"]').length);
  if (before >= 1) {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('#fm-content [data-fm-action="dup-doc"]')][0];
      b && b.click();
    });
    await waitFor(page, () => document.querySelectorAll('#fm-content [data-fm-action="dup-doc"]').length >= 2, 5000, 'duplicar documento');
    ok('duplicar documento genera una copia');
  } else {
    bad('no hay filas de documento para duplicar');
  }

  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#fm-content .fm-row')];
    const target = rows.find((r) => r.querySelector('.fm-row-name') && r.querySelector('.fm-row-name').textContent.includes('copia'));
    if (target) target.querySelector('[data-fm-action="trash-doc"]').click();
  });
  await confirmDialogBtn(page);
  await waitFor(page, () => [...document.querySelectorAll('#fm-content [data-fm-nav="trash"]')].some((n) => n.textContent.includes('(1)')), 5000, 'papelera con 1 elemento');
  ok('mover a la papelera se refleja en el contador');

  await page.evaluate(() => {
    const t = [...document.querySelectorAll('#fm-content [data-fm-nav="trash"]')][0];
    t && t.click();
  });
  await waitFor(page, () => [...document.querySelectorAll('#fm-content .fm-row-name')].some((n) => n.textContent.includes('copia')), 5000, 'contenido de papelera');
  ok('la papelera lista el documento eliminado');

  await page.evaluate(() => {
    const r = [...document.querySelectorAll('#fm-content .fm-row')]
      .find((x) => x.querySelector('.fm-row-name') && x.querySelector('.fm-row-name').textContent.includes('copia'));
    if (r) r.querySelector('[data-fm-action="restore-doc"]').click();
  });
  await waitFor(page, () => [...document.querySelectorAll('#fm-content [data-fm-nav="trash"]')].length === 0, 5000, 'papelera vacía');
  ok('restaurar el documento lo recupera de la papelera');
}

async function tResponsive(page) {
  console.log('\n[11] Diseño adaptable (móvil)');
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: false });
  await page.reload({ waitUntil: 'load' });
  await waitFor(page, () => window.__PAPIRO__ && document.querySelector('#editor'), 8000, 'boot en móvil');
  await closeHome(page);
  const closed = await page.evaluate(() => {
    const sb = document.querySelector('#sidebar');
    const scrim = document.querySelector('#sidebar-scrim');
    return !sb.classList.contains('open') && (scrim.style.display === 'none' || getComputedStyle(scrim).display === 'none');
  });
  if (closed) ok('el panel lateral comienza cerrado en pantalla estrecha');
  else bad('panel lateral visible al arrancar en móvil');
  await page.evaluate(() => window.__PAPIRO__.runAction('sidebar'));
  const opened = await page.evaluate(() => document.querySelector('#sidebar').classList.contains('open'));
  if (opened) ok('botón de panel abre la barra lateral en móvil');
  else bad('no se abre el panel lateral en móvil');
  await page.evaluate(() => window.__PAPIRO__.runAction('sidebar'));
}

async function tOffline(page) {
  console.log('\n[12] Modo sin conexión (service worker)');
  const hasSW = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'no';
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? 'yes' : 'none';
  }).catch(() => 'error');
  if (hasSW === 'yes') {
    await page.setViewport({ width: 1280, height: 800 });
    await page.reload({ waitUntil: 'load' });
    await waitFor(page, () => window.__PAPIRO__, 8000, 'boot previo a offline');
    await closeHome(page);
    await page.setOfflineMode(true);
    try {
      await page.reload({ waitUntil: 'load', timeout: 12000 });
      await new Promise((r) => setTimeout(r, 500));
      await waitFor(page, () => window.__PAPIRO__ && window.__PAPIRO__.state && window.__PAPIRO__.state.docId, 20000, 'boot sin conexión');
      await closeHome(page);
      const alive = await page.evaluate(() => !!(window.__PAPIRO__ && window.__PAPIRO__.state && window.__PAPIRO__.state.docId));
      if (alive) ok('la aplicación funciona sin conexión (recargada desde la caché del SW)');
      else bad('la página cargó sin conexión pero no arrancó');
    } catch (e) {
      bad('la recarga sin conexión falló: ' + (e && e.message ? e.message : e));
    } finally {
      await page.setOfflineMode(false);
    }
  } else if (hasSW === 'none') {
    bad('el service worker no llegó a registrarse');
  } else {
    info('service worker no disponible (se omite la prueba de offline)');
  }
}

/* ---------- Ejecución ---------- */

(async function main() {
  if (!fs.existsSync(CHROME)) {
    console.error('No se encontró Chrome en ' + CHROME + '. Usa PAPIRO_CHROME para indicar otra ruta.');
    process.exit(1);
  }

  const server = await startServer(Number(process.env.PORT) || 4173);
  const port = server.address().port;
  console.log('Servidor de pruebas en http://127.0.0.1:' + port);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papiro-verify-'));
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--lang=es-ES'],
    userDataDir
  });
  const page = await browser.newPage();
  await setup(page);
  await page.setViewport({ width: 1280, height: 800 });

  try {
    await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'load', timeout: 20000 });

    await tBootIntegrity(page);
    await tTypingStats(page);
    await tBoldFormat(page);
    await tAutosaveReload(page);
    await tSearchReplace(page);
    await tOutlineAndPages(page);
    await tFormats(page);
    await tPdfPrint(page);
    await tHistory(page);
    await tFiles(page);
    await tResponsive(page);
    await tOffline(page);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('\n===============================');
  console.log('RESUMEN: ' + pass + ' correctas, ' + fail + ' fallidas');
  if (fail) {
    console.log('Fallos:');
    for (const f of failures) console.log('  - ' + f);
    process.exit(1);
  }
  console.log('Todo ha pasado. Word BryanMG está listo.');
})().catch((err) => {
  console.error('Error al ejecutar la verificación:', err);
  process.exit(2);
});