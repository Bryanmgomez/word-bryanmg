import { $, $$, el, escapeHtml, debounce, fmtDate, downloadBlob, bytesToBase64, docNameFromFile } from './core/util.js';
import { state, setState, loadSettings, saveSettings } from './core/state.js';
import {
  getDoc, saveDoc, createDoc, listActiveDocs, setLastDocId, pushRecent, addVersion, listVersions,
  getRecentDocs, listFavorites, nextUntitledName
} from './core/store.js';
import {
  initEditor, exec, getSelectionState, getHtml, setHtml, getMeta, setMeta, getStats,
  collectOutline, goToHeading, setZoom as applyEditorZoom, layoutPages, insertImageFile,
  insertTable, insertLink, insertPageBreak, setFontSizePx, applyLineHeight, focusEditor,
  setPageNumbers
} from './core/editor.js';
import { exportDocument, importDocumentFile } from './core/formats.js';
import { openDialog, promptDialog, handleEscape, anyDialogOpen } from './components/dialogs.js';
import { toast } from './components/toast.js';
import { initFindbar, openFind, closeFind, isFindOpen, findActions } from './components/findbar.js';
import { initImageTools, showImageTools, hideImageTools, isImageToolsOpen } from './components/imageTools.js';
import { initSidebar, setSidebarOpen, isSidebarOpen, setActiveTab, renderOutline, renderPageList, isNarrow } from './components/sidebar.js';
import { toggleFileMenu, closeFileMenu, isFileMenuOpen } from './components/fileMenu.js';
import { setSaveState, updateStats, updatePages, updateZoom, setSpellcheck, setAutosaveText } from './components/statusbar.js';
import { initFileManager, renderFileManager } from './pages/files.js';
import { openHistoryDialog } from './pages/history.js';
import { initShortcuts } from './core/shortcuts.js';
import { applyUISettings, openPersonalizationDialog } from './components/personalization.js';
import { openSheets, isSheetsOpen, closeSheets } from './apps/sheets.js';

const desktop = window.papiroDesktop || null;

let showPageNum = false;
let lastVersionAt = 0;
let editedSinceVersion = false;
let lastPageTotal = 0;
let lastActionEl = null;

const WELCOME_HTML = `
<h1>Te damos la bienvenida a Word BryanMG</h1>
<p><b>Word BryanMG</b> es un procesador de textos <b>moderno, elegante y en español</b> que funciona en Windows, en el navegador y en Android. Todo tu contenido se guarda en este dispositivo, así que puedes trabajar <b>sin conexión</b>.</p>
<h2>Empezar es fácil</h2>
<ul>
  <li>Escribe directamente aquí: este texto es totalmente editable.</li>
  <li>Usa la barra de herramientas para <i>negrita</i>, <u>subrayado</u>, listas, colores y títulos.</li>
  <li>Inserta imágenes, tablas y enlaces con los botones de “Insertar”.</li>
  <li>Abre el menú <b>Archivo</b> para guardar, importar o exportar en <b>DOCX, PDF, ODT y TXT</b>.</li>
</ul>
<blockquote>Consejo: guarda con Ctrl+S y revisa el historial de cambios cuando quieras volver atrás.</blockquote>
<h2>Organiza tu trabajo</h2>
<p>En el panel lateral tienes la pestaña <b>Archivos</b> para crear carpetas, marcar favoritos, renombrar documentos y gestionar la papelera. El esquema del documento se genera automáticamente con los títulos.</p>
<table><thead><tr><th>Atajo</th><th>Acción</th></tr></thead>
<tbody>
<tr><td>Ctrl+S</td><td>Guardar</td></tr>
<tr><td>Ctrl+F</td><td>Buscar</td></tr>
<tr><td>Ctrl+B</td><td>Negrita</td></tr>
<tr><td>Ctrl+K</td><td>Insertar enlace</td></tr>
</tbody></table>
<p>¡Comienza a escribir!</p>
`;

const TEMPLATES = [
  ['Currículum', 'Modelo profesional con secciones para tu experiencia y estudios.', (name) => `
<h1>Nombre Completo</h1>
<p>Correo · Teléfono · Ciudad</p>
<h2>Perfil profesional</h2>
<p>Breve resumen de tu trayectoria y objetivos.</p>
<h2>Experiencia laboral</h2>
<h3>Puesto — Empresa</h3>
<p>Fecha · Descripción de tus logros y responsabilidades.</p>
<h2>Formación</h2>
<p>Grado o título — Centro de estudios · Año.</p>`],
  ['Carta formal', 'Carta comercial con estructura clásica.', () => `
<h1>Estimado/a Sr./Sra.:</h1>
<p>Por medio de la presente …</p>
<p>Quedo a la espera de su respuesta. Atentamente,</p>
<p><b>Firma</b></p>
<p>Nombre y cargo</p>`],
  ['Informe', 'Informe técnico con resumen y conclusiones.', () => `
<h1>Título del informe</h1>
<h2>Resumen ejecutivo</h2>
<p>Resumen breve del contenido.</p>
<h2>Desarrollo</h2>
<p>Análisis y datos principales.</p>
<h2>Conclusiones</h2>
<p>Hallazgos y recomendaciones.</p>`],
  ['Nota de prensa', 'Comunicado listo para distribuir.', () => `
<h1>COMUNICADO DE PRENSA</h1>
<h2>Título llamativo</h2>
<p>Ciudad, fecha — Introducción con los datos más relevantes.</p>
<p>Cuerpo del comunicado.</p>
<p>Contacto de prensa: nombre · correo · teléfono</p>`],
  ['Lista de tareas', 'Lista de control con casillas de texto.', () => `
<h1>Lista de tareas</h1>
<ul>
<li><i>[ ]</i> Tarea uno</li>
<li><i>[ ]</i> Tarea dos</li>
<li><i>[ ]</i> Tarea tres</li>
</ul>`],
  ['Borrador', 'Página en blanco para ideas rápidas.', () => `
<h1>Ideas</h1>
<p>Empieza a anotar tus pensamientos…</p>`]
];

/* ---------------- Inicio ---------------- */

async function boot() {
  const settings = loadSettings();
  applyUISettings(settings);
  const spell = typeof settings.spellcheck === 'boolean' ? settings.spellcheck : true;
  setState({ spellcheck: spell });

  initEditor({
    editor: $('#editor'),
    page: $('#page'),
    scroller: $('#page-scroller'),
    zoomEl: $('#page-zoom'),
    header: $('#page-header'),
    footer: $('#page-footer'),
    guides: $('#page-guides'),
    counter: $('#page-counter'),
    callbacks: {
      onInput: markDirty,
      onSelection: syncToolbar,
      onMetaInput: markDirty,
      onImageClick: handleImageClick,
      onEscape: () => runAction('escape'),
      onNotice: (msg, type) => toast(msg, type || '')
    }
  });

  initFindbar();
  initImageTools({ onChange: markDirty });
  initSidebar({ onHeading: (id) => goToHeading(id) });
  initFileManager({ onOpenDoc: (id) => openDoc(id) });
  initShortcuts({ dispatch: (action) => runAction(action) });

  wireTitle();
  wireRibbon();
  wireMenu();
  wireInputs();
  wireDelegation();

  window.addEventListener('papiro:store-changed', onStoreChanged);
  window.addEventListener('pagehide', () => { if (state.dirty) saveNow({ silent: true }); });

  $('#editor').spellcheck = spell;
  setSpellcheck(spell);
  setZoom(Number(settings.zoom) || 1, { persist: false });
  setSaveState('saved');
  setAutosaveText('Autoguardado activo');

  await ensureInitialDoc();
  registerServiceWorker();

  setInterval(() => syncPages(), 1500);
  setInterval(periodicSave, 60000);

  hideSplash();
  showHome();

  window.__PAPIRO__ = { state, actions: ACTIONS, runAction };
}

/* ---------------- Documento actual ---------------- */

async function openDoc(id) {
  if (id && id === state.docId) {
    if (isNarrow()) setSidebarOpen(false);
    focusEditor();
    return;
  }
  if (state.dirty) await saveNow({ silent: true });

  const doc = await getDoc(id);
  if (!doc || doc.deletedAt) {
    toast('El documento no está disponible', 'error');
    return;
  }

  hideImageTools();
  closeFind();
  setState({ docId: doc.id, docName: doc.name, dirty: false });
  $('#doc-title').value = doc.name;
  showPageNum = Boolean(doc.showPageNum);
  setHtml(doc.html || '<p><br></p>');
  setMeta(doc.header, doc.footer);
  setPageNumbers(showPageNum);
  setLastDocId(doc.id);
  pushRecent(doc.id);
  document.title = doc.name + ' — Word BryanMG';
  setSaveState('saved');
  lastPageTotal = 0;

  try {
    const versions = await listVersions(doc.id);
    lastVersionAt = versions[0]?.createdAt || 0;
  } catch { lastVersionAt = 0; }
  editedSinceVersion = false;

  refreshDerived.flush?.();
  renderFileManager().catch(() => {});
  if (isNarrow()) setSidebarOpen(false);
}

async function newDoc() {
  if (state.dirty) await saveNow({ silent: true });
  const settings = loadSettings();
  const name = await nextUntitledName();
  const doc = await createDoc({
    name,
    header: settings.docHeader ? 'Word BryanMG' : ''
  });
  await openDoc(doc.id);
  if (settings.pageNumbers) {
    showPageNum = true;
    setPageNumbers(true);
    await saveDoc({ id: doc.id, showPageNum: true });
  }
  toast('Nuevo documento creado', 'ok');
  focusEditor();
}

async function saveNow({ silent = false, label = null } = {}) {
  if (!state.docId) return;
  autosave.cancel();
  setSaveState('saving');

  const meta = getMeta();
  const html = getHtml();
  const stats = getStats();
  const name = ($('#doc-title').value || '').trim() || 'Documento sin título';

  try {
    await saveDoc({
      id: state.docId, name, html,
      header: meta.header, footer: meta.footer,
      showPageNum, words: stats.words
    });
    setState({ dirty: false, docName: name });
    setSaveState('saved');
    setAutosaveText('Autoguardado ' + hora());

    if (label && Date.now() - lastVersionAt > 30000) {
      await addVersion(state.docId, html, meta.header, meta.footer, label);
      lastVersionAt = Date.now();
      editedSinceVersion = false;
    }
    if (!silent) toast('Documento guardado', 'ok');
  } catch (err) {
    console.error(err);
    setSaveState('dirty');
    if (!silent) toast('No se pudo guardar el documento', 'error');
  }
}

const autosave = debounce(() => saveNow({ silent: true }), 1200);

function markDirty() {
  if (!state.docId) return;
  editedSinceVersion = true;
  setState({ dirty: true });
  setSaveState('dirty');
  autosave();
  refreshDerived();
}

async function periodicSave() {
  try {
    if (state.dirty) await saveNow({ silent: true });
    if (state.docId && editedSinceVersion && Date.now() - lastVersionAt > 10 * 60 * 1000) {
      const meta = getMeta();
      await addVersion(state.docId, getHtml(), meta.header, meta.footer, 'Autoguardado automático');
      lastVersionAt = Date.now();
      editedSinceVersion = false;
    }
  } catch { /* se reintenta en el próximo ciclo */ }
}

async function saveAs() {
  const name = await promptDialog('Guardar como', 'Nombre del documento', state.docName, {
    placeholder: 'Nombre del documento', confirmLabel: 'Guardar'
  });
  if (!name) return;
  if (state.dirty) await saveNow({ silent: true });
  const meta = getMeta();
  const copy = await createDoc({ name, html: getHtml(), header: meta.header, footer: meta.footer });
  await saveDoc({ id: copy.id, showPageNum });
  await openDoc(copy.id);
  toast('Guardado como “' + name + '”', 'ok');
}

async function renameCurrent() {
  const name = await promptDialog('Cambiar nombre', 'Nombre del documento', state.docName, {
    confirmLabel: 'Guardar'
  });
  if (!name) return;
  $('#doc-title').value = name;
  setState({ docName: name });
  document.title = name + ' — Word BryanMG';
  await saveNow({ silent: true });
  toast('Nombre actualizado', 'ok');
  renderFileManager().catch(() => {});
}

async function ensureInitialDoc() {
  try {
    const last = loadSettings().lastDocId;
    if (last) {
      const doc = await getDoc(last);
      if (doc && !doc.deletedAt) { await openDoc(doc.id); return; }
    }
    const active = await listActiveDocs();
    if (active.length) { await openDoc(active[0].id); return; }
    const doc = await createDoc({ name: 'Bienvenido a Word BryanMG', html: WELCOME_HTML });
    await openDoc(doc.id);
  } catch (err) {
    console.error(err);
    toast('No se pudo cargar el almacenamiento local', 'error');
  }
}

/* ---------------- Derivados: estadísticas, esquema, páginas ---------------- */

const refreshDerived = debounce(() => {
  updateStats(getStats());
  renderOutline(collectOutline());
  syncPages();
}, 350);

function syncPages() {
  const res = layoutPages();
  if (!res) return;
  updatePages(res.current, res.total);
  if (res.total !== lastPageTotal) {
    lastPageTotal = res.total;
    renderPageList(res.total);
  }
}

function syncToolbar() {
  const st = getSelectionState();
  for (const btn of $$('button[data-cmd]')) {
    const cmd = btn.dataset.cmd;
    if (typeof st[cmd] === 'boolean') btn.classList.toggle('active', st[cmd]);
  }

  const selStyle = $('#sel-style');
  if ([...selStyle.options].some((o) => o.value === st.block)) selStyle.value = st.block;

  const selFont = $('#sel-font');
  if ([...selFont.options].some((o) => o.value === st.font)) selFont.value = st.font;

  const selSize = $('#sel-size');
  if (st.sizePt) {
    const options = [...selSize.options].map((o) => Number(o.value));
    const closest = options.reduce((a, b) => Math.abs(b - st.sizePt) < Math.abs(a - st.sizePt) ? b : a);
    selSize.value = String(closest);
  }

  if (st.color) $('#col-text').value = st.color;
  if (st.highlight) $('#col-hl').value = st.highlight;
}

/* ---------------- Conexión de controles ---------------- */

function wireTitle() {
  const input = $('#doc-title');
  input.addEventListener('input', () => {
    const name = input.value.trim() || 'Documento sin título';
    setState({ docName: name });
document.title = name + ' — Word BryanMG';
    markDirty();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); focusEditor(); }
  });
}

function wireRibbon() {
  $('#sel-style').addEventListener('change', (e) => exec('formatBlock', e.target.value));
  $('#sel-font').addEventListener('change', (e) => exec('fontName', e.target.value));
  $('#sel-size').addEventListener('change', (e) => setFontSizePx(Math.round(Number(e.target.value) / 0.75)));
  $('#sel-spacing').addEventListener('change', (e) => applyLineHeight(e.target.value));

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.type === 'color' && t.dataset.cmd) {
      exec(t.dataset.cmd, t.value);
    }
  });
}

function wireInputs() {
  $('#file-image').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) await insertImageFile(file);
  });

  $('#file-import').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) handleImportFile(file);
  });
}

function wireDelegation() {
  document.addEventListener('click', (e) => {
    const cmdBtn = e.target.closest('button[data-cmd]');
    if (cmdBtn) {
      exec(cmdBtn.dataset.cmd);
      return;
    }
    const actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      lastActionEl = actionEl;
      runAction(actionEl.dataset.action);
    }
  });
}

function wireMenu() {
  const tabs = $$('#menubar .mb-tab');
  if (!tabs.length) return;
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.toggle('active', t === tab));
      $$('#ribbon .rb-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === tab.dataset.tab));
    });
  });
}

function hideSplash() {
  const s = $('#splash');
  if (!s) return;
  s.classList.add('off');
  setTimeout(() => s.remove(), 600);
}

async function showHome() {
  const home = $('#home');
  if (!home) return;
  try {
    const lastId = loadSettings().lastDocId;
    const doc = lastId ? await getDoc(lastId) : null;
    if (doc && !doc.deletedAt) {
      $('#home-resume').innerHTML = '<svg class="icon"><use href="#i-clock"/></svg>Continuar con «' + escapeHtml(doc.name) + '»';
    }
  } catch { /* sin documento reciente */ }
  home.classList.remove('hidden');
}

function closeHome() {
  const home = $('#home');
  if (home) home.classList.add('hidden');
  focusEditor();
}

function homeBack() {
  const sub = $('#home-subview');
  const grid = $('#home-view-grid');
  if (sub) sub.classList.add('hidden');
  if (grid) grid.classList.remove('hidden');
}

function homeDocRow(doc, label) {
  const row = el('button', { class: 'home-doc' },
    el('div', { class: 'hdi' }, el('svg', { class: 'icon' }, el('use', { href: '#i-file-new' }))),
    el('div', { class: 'hd-main' },
      el('div', { class: 'hd-name', text: doc.name }),
      el('span', { class: 'hd-sub', text: label })
    ),
    doc.favorite ? el('span', { class: 'hd-star' }, el('svg', { class: 'icon' }, el('use', { href: '#i-star' }))) : null
  );
  row.addEventListener('click', () => { closeHome(); openDoc(doc.id).catch(() => {}); });
  return row;
}

async function homeGo(view) {
  const sub = $('#home-subview');
  const grid = $('#home-view-grid');
  const list = $('#home-list');
  const title = $('#home-sub-title');
  if (!sub || !list || !title) return;

  if (view === 'plantillas') {
    title.textContent = 'Plantillas';
    list.replaceChildren();
    for (const [name, desc] of TEMPLATES) {
      const row = el('button', { class: 'home-doc' },
        el('div', { class: 'hdi' }, el('svg', { class: 'icon' }, el('use', { href: '#i-layout' }))),
        el('div', { class: 'hd-main' },
          el('div', { class: 'hd-name', text: name }),
          el('span', { class: 'hd-sub', text: desc })
        )
      );
      row.addEventListener('click', () => {
        closeHome();
        createFromTemplate(name);
      });
      list.append(row);
    }
    grid.classList.add('hidden');
    sub.classList.remove('hidden');
    return;
  }

  let docs = [];
  let label = '';
  if (view === 'favoritos') {
    docs = await listFavorites();
    label = 'Favoritos';
  } else {
    docs = await getRecentDocs(8);
    label = 'Documentos recientes';
  }
  title.textContent = label;
  list.replaceChildren();
  if (!docs.length) {
    list.append(el('div', { class: 'home-empty', text: view === 'favoritos'
      ? 'Aún no tienes favoritos. Marca con una estrella tus documentos en el panel Archivos.'
      : 'No hay documentos recientes todavía.' }));
  }
  for (const doc of docs) list.append(homeDocRow(doc, 'Editado ' + fmtDate(doc.updatedAt)));

  grid.classList.add('hidden');
  sub.classList.remove('hidden');
}

async function createFromTemplate(name) {
  const tpl = TEMPLATES.find(([n]) => n === name);
  if (!tpl) return;
  const settings = loadSettings();
  const doc = await createDoc({
    name: tpl[0],
    html: tpl[2](name),
    header: settings.docHeader ? 'Word BryanMG' : ''
  });
  await openDoc(doc.id);
  toast('Plantilla creada: ' + name, 'ok');
  focusEditor();
}

async function openLastOrNew() {
  const lastId = loadSettings().lastDocId;
  if (lastId) {
    const doc = await getDoc(lastId);
    if (doc && !doc.deletedAt) { await openDoc(doc.id); return; }
  }
  const active = await listActiveDocs();
  if (active.length) { await openDoc(active[0].id); return; }
  await newDoc();
}

function toggleFullscreen() {
  const d = document.documentElement;
  if (document.fullscreenElement) {
    return document.exitFullscreen ? document.exitFullscreen().catch(() => {}) : Promise.resolve();
  }
  return d.requestFullscreen ? d.requestFullscreen().catch(() => {}) : Promise.resolve();
}

function handleImageClick(img) {
  if (img && img.closest('#editor')) {
    showImageTools(img, $('#page-scroller'));
  } else {
    hideImageTools();
  }
}

/* ---------------- Acciones ---------------- */

const ACTIONS = {
  'file-menu': toggleFileMenu,
  'new': newDoc,
  'open': openDocumentPicker,
  'import': importFlow,
  'save': () => saveNow({ label: 'Guardado manual' }),
  'save-as': saveAs,
  'rename': renameCurrent,
  'export': exportDialog,
  'print': doPrint,
  'history': showHistory,
  'stats': statsDialog,
  'shortcuts': shortcutsDialog,
  'about': aboutDialog,
  'manager': openFilesTab,
  'sidebar': () => setSidebarOpen(!isSidebarOpen()),
  'sidebar-close': () => setSidebarOpen(false),
  'theme': toggleTheme,
  'spell': toggleSpell,
  'find': () => openFind(false),
  'replace': () => openFind(true),
  'find-prev': () => findActions.prev(),
  'find-next': () => findActions.next(),
  'find-close': closeFind,
  'replace-one': () => findActions.replaceCurrent(),
  'replace-all': () => {
    const n = findActions.replaceAll();
    toast(n ? n + ' reemplazo' + (n === 1 ? '' : 's') + ' realizado' + (n === 1 ? '' : 's') : 'Sin coincidencias', n ? 'ok' : '');
  },
  'insert-image': () => $('#file-image').click(),
  'insert-table': tableDialog,
  'insert-link': linkDialog,
  'header-footer': headerFooterDialog,
  'page-break': insertPageBreak,
  'zoom-in': () => setZoom(state.zoom + 0.1),
  'zoom-out': () => setZoom(state.zoom - 0.1),
  'zoom-reset': () => setZoom(1),
  'escape': escapeAction,
  'undo': () => exec('undo'),
  'redo': () => exec('redo'),
  'settings': openPersonalizationDialog,
  'sheets': () => { closeHome(); openSheets(); },
  'home-new': () => { closeHome(); return newDoc(); },
  'home-open': () => { closeHome(); return openDocumentPicker(); },
  'home-go': () => homeGo(lastActionEl && lastActionEl.dataset.view),
  'home-back': homeBack,
  'home-resume': () => { closeHome(); return openLastOrNew(); },
  'home-settings': () => { closeHome(); return openPersonalizationDialog(); },
  'close-home': closeHome,
  'fullscreen': toggleFullscreen
};

function runAction(action) {
  if (typeof action !== 'string') return;
  if (action.startsWith('cmd:')) {
    exec(action.slice(4));
    return;
  }
  const fn = ACTIONS[action];
  if (fn) {
    if (action !== 'file-menu') closeFileMenu();
    Promise.resolve(fn()).catch((err) => {
      console.error(err);
      toast('Se produjo un error: ' + (err?.message || err), 'error');
    });
  }
}

function escapeAction() {
  if (anyDialogOpen()) { handleEscape(); return; }
  if (isSheetsOpen()) { closeSheets(); return; }
  if (isFindOpen()) { closeFind(); return; }
  if (isImageToolsOpen()) { hideImageTools(); return; }
  if (isFileMenuOpen()) { closeFileMenu(); return; }
  if (isSidebarOpen() && isNarrow()) { setSidebarOpen(false); return; }
}

function openFilesTab() {
  setSidebarOpen(true);
  setActiveTab('files');
  renderFileManager().catch(() => {});
}

/* ---------------- Abrir / importar ---------------- */

async function openDocumentPicker() {
  const docs = await listActiveDocs();
  const body = el('div', { class: 'open-list' });

  if (!docs.length) {
    body.append(el('div', { class: 'fm-empty' },
      el('svg', { class: 'icon' }, el('use', { href: '#i-folder-open' })),
      el('div', { text: 'No hay documentos guardados todavía.' })
    ));
  }

  for (const doc of docs) {
    body.append(el('button', { class: 'fm-row open-row', dataset: { docId: doc.id } },
      el('div', { class: 'fm-row-icon' }, el('svg', { class: 'icon' }, el('use', { href: '#i-file-new' }))),
      el('div', { class: 'fm-row-main' },
        el('div', { class: 'fm-row-name', text: doc.name }),
        el('span', { class: 'fm-row-sub', text: 'Editado ' + fmtDate(doc.updatedAt) })
      )
    ));
  }

  const d = openDialog({
    title: 'Abrir documento',
    body,
    buttons: [{ label: 'Cancelar', value: null }]
  });

  body.addEventListener('click', (e) => {
    const row = e.target.closest('[data-doc-id]');
    if (row) {
      d.close(null);
      openDoc(row.dataset.docId);
    }
  });
}

async function importFlow() {
  if (desktop) {
    try {
      const res = await desktop.openFile(['txt', 'md', 'html', 'htm', 'docx', 'odt']);
      if (!res?.ok) return;
      const ext = (res.filePath.split('.').pop() || 'txt').toLowerCase();
      const bytes = Uint8Array.from(atob(res.dataBase64), (c) => c.charCodeAt(0));
      await handleImportFile(new File([bytes], (res.name || 'documento') + '.' + ext));
    } catch (err) {
      console.error(err);
      toast('No se pudo abrir el archivo', 'error');
    }
    return;
  }
  $('#file-import').click();
}

async function handleImportFile(file) {
  toast('Importando «' + file.name + '»…');
  try {
    const result = await importDocumentFile(file);
    const doc = await createDoc({
      name: (result.title || docNameFromFile(file.name)).slice(0, 120),
      html: result.html
    });
    await openDoc(doc.id);
    toast('Documento importado', 'ok');
  } catch (err) {
    console.error(err);
    toast('No se pudo importar: ' + (err?.message || 'formato no compatible'), 'error');
  }
}

/* ---------------- Exportar / imprimir ---------------- */

async function exportDialog() {
  const formats = [
    ['pdf', 'PDF', 'Mediante el diálogo de impresión (calidad de imprenta)'],
    ['docx', 'DOCX', 'Documento Word BryanMG'],
    ['odt', 'ODT', 'OpenDocument (LibreOffice)'],
    ['txt', 'TXT', 'Texto plano sin formato'],
    ['html', 'HTML', 'Página web autónoma con estilos']
  ];

  const radios = formats.map(([value, label, desc], i) =>
    el('label', { class: 'export-option' },
      el('input', { type: 'radio', name: 'export-format', value, ...(i === 0 ? { checked: true } : {}) }),
      el('span', { class: 'export-main' },
        el('b', { text: label }),
        el('small', { text: desc })
      )
    )
  );
  radios.forEach((r) => r.querySelector('input').checked = r.querySelector('input').value === 'pdf');

  const d = openDialog({
    title: 'Exportar documento',
    body: el('div', { class: 'export-list' }, radios),
    buttons: [
      { label: 'Cancelar', value: null },
      { label: 'Exportar', value: '__ok__', primary: true }
    ]
  });

  const value = await d.promise;
  if (value !== '__ok__') return;
  const selected = d.body.querySelector('input[name="export-format"]:checked');
  if (selected) await doExport(selected.value);
}

async function doExport(format) {
  const meta = getMeta();
  const name = state.docName || 'documento';

  try {
    const result = await exportDocument({
      format, name, html: getHtml(),
      header: meta.header, footer: meta.footer, showPageNum
    });

    if (result.print) { doPrint(); return; }

    if (desktop?.saveFile) {
      const b64 = bytesToBase64(new Uint8Array(await result.blob.arrayBuffer()));
      const base = result.filename.replace(/\.[^.]+$/, '');
      const res = await desktop.saveFile(base, b64, format);
      if (res?.ok) toast('Guardado en ' + res.filePath, 'ok');
      else if (res && !res.canceled) toast('No se pudo guardar: ' + (res.error || 'error desconocido'), 'error');
      return;
    }

    downloadBlob(result.blob, result.filename);
    toast('Exportado como ' + result.filename, 'ok');
  } catch (err) {
    console.error(err);
    toast('No se pudo exportar: ' + (err?.message || err), 'error');
  }
}

function doPrint() {
  closeFind();
  hideImageTools();
  closeFileMenu();
  syncPages();
  if (desktop?.print) desktop.print();
  else window.print();
}

/* ---------------- Diálogos ---------------- */

function tableDialog() {
  const rows = el('input', { class: 'field', type: 'number', min: '1', max: '30', value: '3' });
  const cols = el('input', { class: 'field', type: 'number', min: '1', max: '12', value: '3' });
  const head = el('input', { type: 'checkbox', checked: true });

  const d = openDialog({
    title: 'Insertar tabla',
    body: el('div', {},
      el('div', { class: 'row' }, el('label', { class: 'field-label', text: 'Filas' }), rows),
      el('div', { class: 'row' }, el('label', { class: 'field-label', text: 'Columnas' }), cols),
      el('label', { class: 'check-row' }, head, el('span', { text: 'Con fila de encabezado' }))
    ),
    buttons: [
      { label: 'Cancelar', value: null },
      { label: 'Insertar', value: '__ok__', primary: true }
    ]
  });

  d.promise.then((value) => {
    if (value !== '__ok__') return;
    const r = Math.min(30, Math.max(1, parseInt(rows.value, 10) || 3));
    const c = Math.min(12, Math.max(1, parseInt(cols.value, 10) || 3));
    insertTable(r, c, head.checked);
  });
}

async function linkDialog() {
  const url = el('input', { class: 'field', type: 'text', placeholder: 'https://ejemplo.com', autocomplete: 'off' });
  const text = el('input', { class: 'field', type: 'text', placeholder: 'Texto del enlace (opcional)', autocomplete: 'off' });

  const d = openDialog({
    title: 'Insertar enlace',
    body: el('div', {},
      el('div', { class: 'row' }, el('label', { class: 'field-label', text: 'Dirección' }), url),
      el('div', { class: 'row' }, el('label', { class: 'field-label', text: 'Texto' }), text)
    ),
    buttons: [
      { label: 'Cancelar', value: null },
      { label: 'Insertar', value: '__ok__', primary: true }
    ]
  });

  const value = await d.promise;
  if (value !== '__ok__') return;
  let href = url.value.trim();
  if (!href) return;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) href = 'https://' + href;
  insertLink(href, text.value.trim());
}

async function headerFooterDialog() {
  const current = getMeta();
  const headerText = htmlToPlain(current.header);
  const footerText = htmlToPlain(current.footer);

  const header = el('input', { class: 'field', type: 'text', value: headerText, placeholder: 'Texto del encabezado' });
  const footer = el('input', { class: 'field', type: 'text', value: footerText, placeholder: 'Texto del pie de página' });
  const nums = el('input', { type: 'checkbox' });
  nums.checked = showPageNum;

  const d = openDialog({
    title: 'Encabezado y pie de página',
    body: el('div', {},
      el('div', { class: 'row' }, el('label', { class: 'field-label', text: 'Encabezado' }), header),
      el('div', { class: 'row' }, el('label', { class: 'field-label', text: 'Pie de página' }), footer),
      el('label', { class: 'check-row' }, nums,
        el('span', { text: 'Mostrar número de página (Página X de Y)' }))
    ),
    buttons: [
      { label: 'Cancelar', value: null },
      { label: 'Aplicar', value: '__ok__', primary: true }
    ]
  });

  const value = await d.promise;
  if (value !== '__ok__') return;
  setMeta(escapeHtml(header.value.trim()), escapeHtml(footer.value.trim()));
  showPageNum = nums.checked;
  setPageNumbers(showPageNum);
  markDirty();
}

function htmlToPlain(html) {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  return div.textContent.trim();
}

function statsDialog() {
  const s = getStats();
  const row = (label, value) =>
    el('div', { class: 'stat-row' }, el('span', { text: label }), el('b', { text: String(value) }));

  openDialog({
    title: 'Estadísticas del documento',
    body: el('div', { class: 'stats-box' },
      row('Palabras', s.words),
      row('Caracteres', s.chars),
      row('Caracteres sin espacios', s.charsNoSpaces),
      row('Párrafos', s.paragraphs),
      row('Páginas', lastPageTotal || 1),
      row('Tamaño estimado', new Blob([getHtml()]).size.toLocaleString('es') + ' bytes (HTML)')
    ),
    buttons: [{ label: 'Cerrar', value: null, primary: true }]
  });
}

function shortcutsDialog() {
  const rows = [
    ['Ctrl+S', 'Guardar documento'],
    ['Ctrl+Shift+S', 'Guardar como…'],
    ['Ctrl+N', 'Nuevo documento'],
    ['Ctrl+O', 'Abrir documento'],
    ['Ctrl+P', 'Vista de impresión'],
    ['Ctrl+F', 'Buscar'],
    ['Ctrl+H', 'Buscar y reemplazar'],
    ['Ctrl+K', 'Insertar enlace'],
    ['Ctrl+B / I / U', 'Negrita / cursiva / subrayado'],
    ['Ctrl+Z / Ctrl+Y', 'Deshacer / rehacer'],
    ['Ctrl+E / L / R / J', 'Centrar / izquierda / derecha / justificar'],
    ['Ctrl++ / Ctrl+- / Ctrl+0', 'Acercar / alejar / zoom al 100 %'],
    ['Ctrl+Alt+F', 'Menú de archivo'],
    ['Tab / Mayús+Tab', 'Sangría (en tabla: siguiente / anterior celda)'],
    ['Esc', 'Cerrar diálogo, búsqueda o herramientas'],
    ['Ctrl+Mayús+Clic enlace', 'Abrir enlace en otra pestaña']
  ];

  openDialog({
    title: 'Atajos de teclado',
    body: el('div', { class: 'kbd-list' },
      rows.flatMap(([keys, desc]) => [
        el('span', { class: 'k-desc', text: desc }),
        el('kbd', { text: keys })
      ])
    ),
    buttons: [{ label: 'Cerrar', value: null, primary: true }]
  });
}

async function aboutDialog() {
  let version = '1.0.0';
  let platform = 'navegador';
  if (desktop?.appInfo) {
    try {
      const info = await desktop.appInfo();
      version = info.version || version;
      platform = info.platform || platform;
    } catch { /* usar valores por defecto */ }
  }

  openDialog({
    title: 'Acerca de Word BryanMG',
    body: el('div', { class: 'about-box' },
      el('div', { class: 'about-logo' },
        el('svg', { class: 'logo lg' }, el('use', { href: '#i-logo' }))),
      el('p', { html: '<b>Word BryanMG</b> · Procesador de textos moderno, elegante y en español. Funciona en Windows, navegador y Android.' }),
      el('p', { html: '<b>Versión:</b> ' + escapeHtml(version) + ' · <b>Entorno:</b> ' + escapeHtml(platform) }),
      el('p', { text: 'Creado por BryanMG. Tus documentos se guardan localmente (IndexedDB) y la aplicación funciona sin conexión. No se envía ningún dato a servidores.' })
    ),
    buttons: [{ label: 'Cerrar', value: null, primary: true }]
  });
}

async function showHistory() {
  if (state.dirty) await saveNow({ silent: true });
  await openHistoryDialog({
    onRestore: async (version) => {
      if (state.dirty) await saveNow({ silent: true });
      setHtml(version.html);
      setMeta(version.header, version.footer);
      markDirty();
      toast('Versión restaurada', 'ok');
    }
  });
}

/* ---------------- Ajustes de la interfaz ---------------- */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  setState({ theme });
}

function toggleTheme() {
  const theme = state.theme === 'light' ? 'dark' : 'light';
  applyTheme(theme);
  saveSettings({ theme });
}

function toggleSpell() {
  const spell = !state.spellcheck;
  setState({ spellcheck: spell });
  $('#editor').spellcheck = spell;
  setSpellcheck(spell);
  saveSettings({ spellcheck: spell });
  toast(spell ? 'Corrector activado' : 'Corrector desactivado');
}

function setZoom(zoom, { persist = true } = {}) {
  const z = Math.min(2, Math.max(0.5, Math.round(zoom * 10) / 10));
  setState({ zoom: z });
  applyEditorZoom(z);
  updateZoom(z);
  if (persist) saveSettings({ zoom: z });
}

function onStoreChanged(e) {
  const detail = e.detail || {};
  renderFileManager().catch(() => {});

  if (detail.type === 'renamed' && detail.id === state.docId) {
    $('#doc-title').value = detail.name;
    setState({ docName: detail.name });
    document.title = detail.name + ' — Word BryanMG';
  }

  if (['trashed', 'purged', 'emptied'].includes(detail.type) && detail.id === state.docId) {
    toast('El documento actual está en la papelera', 'error');
  }

  if (detail.type === 'created' || detail.type === 'restored') refreshDerived();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register('sw.js').catch(() => { /* sin SW también funciona en local */ });
}

function hora() {
  return new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

boot().catch((err) => {
  console.error(err);
  toast('Error al iniciar Word BryanMG: ' + (err?.message || err), 'error');
});
