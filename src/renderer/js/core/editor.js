import { $, $$, escapeHtml, debounce } from './util.js';
import { sanitizeHtml, sanitizeTextToHtml } from './sanitize.js';

let refs = {};
let handlers = {};
let savedRange = null;
let fontSizePx = null;

const MM_PROBE_ID = 'mm-probe';

function ensureMmProbe() {
  let probe = document.getElementById(MM_PROBE_ID);
  if (!probe) {
    probe = document.createElement('div');
    probe.id = MM_PROBE_ID;
    probe.style.cssText = 'position:absolute;width:100mm;height:0;visibility:hidden;pointer-events:none;left:-9999px;top:0';
    document.body.append(probe);
  }
  return probe;
}

export function pxPer100mm() {
  return ensureMmProbe().getBoundingClientRect().width || 377.95;
}

export function pageHeightPx() {
  return Math.round(pxPer100mm() * 2.97);
}

function saveSelection() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount && refs.editor.contains(sel.anchorNode)) {
    savedRange = sel.getRangeAt(0).cloneRange();
  }
}

function restoreSelection() {
  if (!savedRange) {
    refs.editor.focus();
    return;
  }
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(savedRange);
}

export function initEditor({ editor, page, scroller, zoomEl, header, footer, guides, counter, callbacks = {} }) {
  refs = { editor, page, scroller, zoomEl, header, footer, guides, counter };
  handlers = callbacks;
  savedRange = null;

  try {
    document.execCommand('defaultParagraphSeparator', false, 'p');
    document.execCommand('styleWithCSS', false, 'true');
  } catch { /* no disponible */ }

  document.addEventListener('selectionchange', () => {
    saveSelection();
    if (refs.editor.contains(document.getSelection()?.anchorNode)) {
      handlers.onSelection?.();
      scheduleLayout();
    }
  });

  editor.addEventListener('input', () => {
    toggleEmpty();
    handlers.onInput?.();
    scheduleLayout();
  });

  editor.addEventListener('focus', () => handlers.onFocus?.());
  editor.addEventListener('blur', () => handlers.onBlur?.());

  editor.addEventListener('click', (e) => {
    const img = e.target.closest?.('img');
    if (img && editor.contains(img)) {
      handlers.onImageClick?.(img, e);
      return;
    }
    handlers.onImageClick?.(null, e);
    const link = e.target.closest?.('a');
    if (link && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const href = link.getAttribute('href');
      if (href && /^https?:/i.test(href)) window.open(href, '_blank');
    }
  });

  editor.addEventListener('paste', handlePaste);
  editor.addEventListener('drop', handleDrop);
  editor.addEventListener('keydown', handleKeydown);

  refs.header.addEventListener('input', () => handlers.onMetaInput?.());
  refs.footer.addEventListener('input', () => handlers.onMetaInput?.());

  window.addEventListener('resize', () => scheduleLayout());
  const ro = new ResizeObserver(() => scheduleLayout());
  ro.observe(editor);

  toggleEmpty();
  scheduleLayout();
}

function toggleEmpty() {
  const text = refs.editor.textContent.replace(/\u200B/g, '').trim();
  const hasBlocks = refs.editor.querySelector('img, table, hr, .page-break');
  refs.editor.classList.toggle('is-empty', !text && !hasBlocks);
}

function handleKeydown(e) {
  if (e.key === 'Tab') {
    const inTable = e.target.closest?.('table');
    if (inTable) {
      e.preventDefault();
      moveInTable(e.target, e.shiftKey ? -1 : 1);
      return;
    }
    e.preventDefault();
    exec(e.shiftKey ? 'outdent' : 'indent');
  }
  if (e.key === 'Escape') {
    handlers.onEscape?.();
  }
}

function moveInTable(cell, dir) {
  const cells = $$('td, th', cell.closest('table'));
  const idx = cells.indexOf(cell.closest('td, th'));
  const next = cells[idx + dir];
  if (next) {
    const range = document.createRange();
    range.selectNodeContents(next);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    refs.editor.focus();
  } else if (dir > 0) {
    insertParagraphAfter(cell.closest('table'));
  }
}

function insertParagraphAfter(node) {
  const p = document.createElement('p');
  p.innerHTML = '<br>';
  node.after(p);
  const range = document.createRange();
  range.selectNodeContents(p);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  refs.editor.focus();
}

async function handlePaste(e) {
  e.preventDefault();
  const dt = e.clipboardData;
  if (!dt) return;

  for (const item of Array.from(dt.items || [])) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        await insertImageFile(file);
        return;
      }
    }
  }

  const html = dt.getData('text/html');
  if (html && html.trim()) {
    insertHtml(sanitizeHtml(html));
    return;
  }

  const text = dt.getData('text/plain');
  if (!text) return;
  if (text.includes('\n') || text.includes('\r')) {
    insertHtml(sanitizeTextToHtml(text));
  } else {
    document.execCommand('insertText', false, text);
  }
  toggleEmpty();
  handlers.onInput?.();
}

function handleDrop(e) {
  const files = Array.from(e.dataTransfer?.files || []);
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (images.length) {
    e.preventDefault();
    images.forEach((file) => insertImageFile(file));
  }
}

/* ---------- Comandos de formato ---------- */

function withCssMode(mode, fn) {
  try {
    document.execCommand('styleWithCSS', false, mode);
  } catch { /* ignorar */ }
  const result = fn();
  try {
    document.execCommand('styleWithCSS', false, 'true');
  } catch { /* ignorar */ }
  return result;
}

export function focusEditor() {
  if (document.activeElement !== refs.editor &&
      !refs.header.contains(document.activeElement) &&
      !refs.footer.contains(document.activeElement)) {
    refs.editor.focus();
    restoreSelection();
  }
}

export function exec(cmd, arg) {
  if (!refs.editor) return;
  if (cmd !== 'undo' && cmd !== 'redo') {
    if (document.activeElement !== refs.editor) restoreSelection();
    refs.editor.focus();
  }

  switch (cmd) {
    case 'foreColor':
      withCssMode('true', () => document.execCommand('foreColor', false, arg));
      break;
    case 'hiliteColor': {
      const ok = withCssMode('true', () =>
        document.execCommand('hiliteColor', false, arg) || document.execCommand('backColor', false, arg)
      );
      if (!ok) toastFallback('El navegador no permitió resaltar');
      break;
    }
    case 'formatBlock':
      document.execCommand('formatBlock', false, '<' + arg + '>');
      break;
    case 'fontSizePx':
      setFontSizePx(arg);
      return;
    case 'insertHtml':
      document.execCommand('insertHTML', false, arg);
      break;
    case 'insertText':
      document.execCommand('insertText', false, arg);
      break;
    case 'cut':
    case 'copy': {
      const ok = document.execCommand(cmd);
      if (!ok) toastFallback('El navegador bloqueó ' + (cmd === 'cut' ? 'cortar' : 'copiar') + '. Usa Ctrl+' + (cmd === 'cut' ? 'X' : 'C') + '.');
      break;
    }
    case 'paste': {
      if (navigator.clipboard?.readText) {
        navigator.clipboard.readText()
          .then((text) => {
            if (!text) return;
            exec(text.includes('\n') ? 'insertHtml' : 'insertText',
              text.includes('\n') ? sanitizeTextToHtml(text) : text);
            handlers.onInput?.();
          })
          .catch(() => toastFallback('Usa Ctrl+V para pegar'));
      } else {
        toastFallback('Usa Ctrl+V para pegar');
      }
      return;
    }
    default:
      document.execCommand(cmd, false, arg);
  }

  toggleEmpty();
  handlers.onInput?.();
  handlers.onSelection?.();
  scheduleLayout();
}

function toastFallback(msg) {
  handlers.onNotice?.(msg);
}

export function setFontSizePx(px) {
  fontSizePx = px;
  focusEditor();
  withCssMode('false', () => document.execCommand('fontSize', false, '7'));
  const fonts = $$('font[size="7"]', refs.editor);
  const xxxSpans = $$('span', refs.editor).filter(
    (s) => /xxx-large|font-size:\s*xxx/i.test(s.getAttribute('style') || '')
  );
  for (const node of [...fonts, ...xxxSpans]) {
    const span = document.createElement('span');
    span.style.fontSize = px + 'px';
    while (node.firstChild) span.append(node.firstChild);
    if (node.hasAttribute('size')) node.removeAttribute('size');
    node.replaceWith(span);
    if (!span.firstChild) span.append(document.createTextNode(''));
  }
  toggleEmpty();
  handlers.onInput?.();
  handlers.onSelection?.();
}

export function applyLineHeight(value) {
  focusEditor();
  forEachBlock((block) => {
    if (value) block.style.lineHeight = value;
    else block.style.removeProperty('line-height');
  });
  handlers.onInput?.();
  scheduleLayout();
}

export function forEachBlock(fn) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const blocks = $$('p, h1, h2, h3, h4, h5, h6, li, blockquote, td, th, div, pre', refs.editor)
    .filter((b) => {
      try { return range.intersectsNode(b); } catch { return false; }
    });
  const targets = blocks.length ? blocks : [refs.editor];
  targets.forEach(fn);
}

export function insertHtml(html) {
  focusEditor();
  document.execCommand('insertHTML', false, html);
  toggleEmpty();
  handlers.onInput?.();
  scheduleLayout();
}

export async function insertImageFile(file) {
  if (!file) return false;
  if (!file.type.startsWith('image/')) {
    handlers.onNotice?.('Solo se pueden insertar imágenes');
    return false;
  }
  if (file.size > 8 * 1024 * 1024) {
    handlers.onNotice?.('La imagen supera el límite de 8 MB');
    return false;
  }
  const dataUrl = await readFileDataURL(file);
  insertHtml('<img src="' + dataUrl + '" alt="' + escapeHtml(file.name || 'imagen') + '">');
  handlers.onNotice?.('Imagen insertada', 'ok');
  return true;
}

function readFileDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function insertTable(rows, cols, headerRow) {
  const parts = ['<table>'];
  if (headerRow) {
    parts.push('<thead><tr>' + Array.from({ length: cols }, () => '<th><br></th>').join('') + '</tr></thead>');
  }
  parts.push('<tbody>');
  const bodyRows = headerRow ? Math.max(0, rows - 1) : rows;
  for (let r = 0; r < bodyRows; r++) {
    parts.push('<tr>' + Array.from({ length: cols }, () => '<td><br></td>').join('') + '</tr>');
  }
  parts.push('</tbody></table><p><br></p>');
  insertHtml(parts.join(''));
}

export function insertLink(href, text) {
  const sel = window.getSelection();
  const hasSelection = sel && sel.rangeCount && !sel.getRangeAt(0).collapsed &&
    refs.editor.contains(sel.anchorNode);
  focusEditor();
  if (hasSelection) {
    document.execCommand('createLink', false, href);
    const anchor = sel.anchorNode?.parentElement?.closest?.('a');
    if (anchor) anchor.setAttribute('rel', 'noopener');
  } else {
    const label = text || href.replace(/^https?:\/\//, '');
    insertHtml('<a href="' + escapeHtml(href) + '" rel="noopener">' + escapeHtml(label) + '</a>');
  }
  handlers.onInput?.();
}

export function insertPageBreak() {
  insertHtml('<div class="page-break" contenteditable="false"></div><p><br></p>');
}

/* ---------- Consulta de estado ---------- */

export function getSelectionState() {
  const sel = window.getSelection();
  const inEditor = sel && sel.rangeCount && refs.editor.contains(sel.anchorNode);
  const state = {
    inEditor,
    bold: false, italic: false, underline: false, strikeThrough: false,
    justifyLeft: false, justifyCenter: false, justifyRight: false, justifyFull: false,
    insertOrderedList: false, insertUnorderedList: false,
    block: 'p', font: '', sizePt: 12, color: '', highlight: ''
  };
  if (!inEditor) return state;

  const q = (cmd) => { try { return document.queryCommandState(cmd); } catch { return false; } };
  state.bold = q('bold');
  state.italic = q('italic');
  state.underline = q('underline');
  state.strikeThrough = q('strikeThrough');
  state.justifyLeft = q('justifyLeft');
  state.justifyCenter = q('justifyCenter');
  state.justifyRight = q('justifyRight');
  state.justifyFull = q('justifyFull');
  state.insertOrderedList = q('insertOrderedList');
  state.insertUnorderedList = q('insertUnorderedList');

  let node = sel.anchorNode;
  if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  const block = node?.closest?.('h1,h2,h3,h4,h5,h6,blockquote,p,li,div');
  if (block && refs.editor.contains(block)) {
    state.block = block.tagName.toLowerCase().replace(/h(\d)/, 'h$1');
    if (state.block === 'div') state.block = 'p';
    const cs = getComputedStyle(block);
    const px = parseFloat(cs.fontSize);
    state.sizePt = Math.round(px * 0.75);
    state.color = rgbToHex(cs.color);
    if (!state.color || state.color === '#ffffff') {
      const inlineColor = (block.getAttribute('style') || '').match(/color:\s*([^;]+)/);
      if (inlineColor) state.color = rgbToHex(inlineColor[1]);
    }
    state.font = (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim();
  }
  const inline = node?.parentElement;
  if (inline && refs.editor.contains(inline)) {
    const cs = getComputedStyle(inline);
    if (inline.style.fontFamily) state.font = inline.style.fontFamily.split(',')[0].replace(/["']/g, '');
    if (inline.style.fontSize) state.sizePt = Math.round(parseFloat(cs.fontSize) * 0.75);
    if (inline.style.color) state.color = rgbToHex(cs.color);
    if (inline.style.backgroundColor) state.highlight = rgbToHex(cs.backgroundColor);
  }
  return state;
}

function rgbToHex(rgb) {
  if (!rgb) return '';
  if (rgb.startsWith('#')) return rgb.toLowerCase();
  const m = rgb.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (!m) return '';
  const hex = (n) => Number(n).toString(16).padStart(2, '0');
  return ('#' + hex(m[1]) + hex(m[2]) + hex(m[3])).toLowerCase();
}

/* ---------- Contenido ---------- */

export function getHtml() {
  const clone = refs.editor.cloneNode(true);
  clone.querySelectorAll('mark[data-mark="find"]').forEach((mark) => {
    while (mark.firstChild) mark.parentNode.insertBefore(mark.firstChild, mark);
    mark.remove();
  });
  clone.querySelectorAll('[style]').forEach((node) => {
    if (!node.getAttribute('style')) node.removeAttribute('style');
  });
  let html = clone.innerHTML.trim();
  return html || '<p><br></p>';
}

export function setHtml(html) {
  refs.editor.innerHTML = html || '<p><br></p>';
  toggleEmpty();
  handlers.onSelection?.();
  scheduleLayout();
  refs.scroller.scrollTop = 0;
}

export function getMeta() {
  const cleanClone = (node) => {
    const clone = node.cloneNode(true);
    clone.querySelectorAll('.page-numbers').forEach((n) => n.remove());
    return clone.innerHTML.trim();
  };
  return {
    header: cleanClone(refs.header),
    footer: cleanClone(refs.footer)
  };
}

export function setMeta(header, footer) {
  refs.header.innerHTML = header || '';
  refs.footer.innerHTML = footer || '';
}

export function getStats() {
  const text = refs.editor.innerText || '';
  const trimmed = text.replace(/\u00A0/g, ' ').trim();
  const words = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
  const chars = (refs.editor.textContent || '').length;
  const charsNoSpaces = chars - (text.match(/\s/g) || []).length;
  const paragraphs = refs.editor.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, td').length || (trimmed ? 1 : 0);
  return { words, chars, charsNoSpaces, paragraphs };
}

/* ---------- Esquema (encabezados) ---------- */

export function collectOutline() {
  const items = [];
  $$('h1, h2, h3, h4, h5, h6', refs.editor).forEach((h, i) => {
    if (!h.id) h.id = 'h-' + i + '-' + Math.random().toString(36).slice(2, 6);
    const text = h.textContent.trim();
    if (text) items.push({ id: h.id, text, level: Number(h.tagName[1]) });
  });
  return items;
}

export function goToHeading(id) {
  const target = document.getElementById(id);
  if (!target || !refs.editor.contains(target)) return;
  const scroller = refs.scroller;
  const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 70;
  scroller.scrollTo({ top, behavior: 'smooth' });
  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

export function getElement() {
  return refs.editor;
}

export function getRefs() {
  return refs;
}

/* ---------- Zoom ---------- */

export function setZoom(zoom) {
  refs.zoomEl.style.zoom = String(zoom);
}

/* ---------- Diseño de páginas ---------- */

const scheduleLayout = debounce(() => layoutPages(), 220);

export function scheduleLayoutNow() {
  scheduleLayout();
}

export function layoutPages() {
  if (!refs.page) return null;
  const pageH = pageHeightPx();
  document.documentElement.style.setProperty('--page-h', pageH + 'px');

  const sheetH = Math.max(refs.page.scrollHeight, pageH);
  const total = Math.max(1, Math.ceil((sheetH - 2) / pageH));

  const frag = document.createDocumentFragment();
  for (let i = 1; i < total; i++) {
    const guide = document.createElement('div');
    guide.className = 'page-guide';
    guide.style.top = (i * pageH) + 'px';
    const label = document.createElement('span');
    label.textContent = String(i + 1);
    guide.append(label);
    frag.append(guide);
  }
  refs.guides.replaceChildren(frag);

  const current = currentPage(pageH);
  refs.counter.textContent = total > 1 ? current + ' / ' + total : '';
  updateFooterPageNumber(current, total);

  return { pageH, total, current };
}

function currentPage(pageH) {
  const zoom = stateZoom();
  const pageTop = refs.page.getBoundingClientRect().top;
  let viewportY = null;

  const sel = window.getSelection();
  if (sel && sel.rangeCount && refs.editor.contains(sel.anchorNode)) {
    const range = sel.getRangeAt(0);
    let rect = range.getBoundingClientRect();
    if (!rect || (!rect.height && !rect.width)) {
      const node = range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer
        : range.startContainer.parentElement;
      rect = node?.getBoundingClientRect?.();
    }
    if (rect && typeof rect.top === 'number') viewportY = rect.top;
  }

  if (viewportY === null) {
    const scRect = refs.scroller.getBoundingClientRect();
    viewportY = scRect.top + scRect.height / 2;
  }

  const layoutTop = Math.max(0, (viewportY - pageTop) / zoom);
  return Math.floor(layoutTop / pageH) + 1;
}

function stateZoom() {
  const z = parseFloat(refs.zoomEl.style.zoom || '1');
  return Number.isFinite(z) && z > 0 ? z : 1;
}

export function setPageNumberingEnabled(enabled) {
  refs.counter.style.display = enabled ? '' : 'none';
}

function updateFooterPageNumber(current, total) {
  let span = refs.footer.querySelector('.page-numbers');
  const docWants = document.body.dataset.pageNumbers === 'true';
  if (!docWants) {
    if (span) span.remove();
    return;
  }
  if (!span) {
    span = document.createElement('span');
    span.className = 'page-numbers';
    span.contentEditable = 'false';
    span.style.cssText = 'float:right;color:inherit';
    refs.footer.append(span);
  }
  span.textContent = 'Página ' + current + ' de ' + total;
}

export function setPageNumbers(enabled) {
  document.body.dataset.pageNumbers = enabled ? 'true' : 'false';
  layoutPages();
}

export function refreshLayout() {
  layoutPages();
}
