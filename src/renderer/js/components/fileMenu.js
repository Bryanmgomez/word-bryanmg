import { el } from '../core/util.js';

let menuNode = null;

export function isFileMenuOpen() {
  return Boolean(menuNode);
}

export function closeFileMenu() {
  if (menuNode) {
    menuNode.remove();
    menuNode = null;
    document.removeEventListener('mousedown', outsideHandler, true);
  }
}

function outsideHandler(e) {
  if (e.target.closest?.('#btn-file')) return;
  if (menuNode && !menuNode.contains(e.target)) closeFileMenu();
}

function item(action, label, icon, shortcut) {
  return el('button', { class: 'fm-item', dataset: { action } },
    el('svg', { class: 'icon' }, el('use', { href: '#' + icon })),
    el('span', { text: label }),
    shortcut ? el('span', { class: 'fm-shortcut', text: shortcut }) : null
  );
}

export function toggleFileMenu() {
  if (menuNode) {
    closeFileMenu();
    return;
  }

  menuNode = el('div', { class: 'file-menu', role: 'menu' },
    el('div', { class: 'fm-group-title', text: 'Documentos' }),
    item('new', 'Nuevo documento', 'i-file-new', 'Ctrl+N'),
    item('open', 'Abrir…', 'i-folder-open', 'Ctrl+O'),
    item('import', 'Importar…', 'i-upload', ''),
    item('save', 'Guardar', 'i-save', 'Ctrl+S'),
    item('save-as', 'Guardar como…', 'i-save', 'Ctrl+Shift+S'),
    item('rename', 'Cambiar nombre…', 'i-edit', ''),
    el('div', { class: 'fm-sep' }),
    item('export', 'Exportar / Imprimir…', 'i-download', ''),
    item('print', 'Vista de impresión', 'i-print', 'Ctrl+P'),
    el('div', { class: 'fm-sep' }),
    item('manager', 'Organizar archivos', 'i-folder', ''),
    item('history', 'Historial de cambios', 'i-clock', ''),
    el('div', { class: 'fm-sep' }),
    item('settings', 'Configuración y personalización', 'i-sliders', ''),
    item('shortcuts', 'Atajos de teclado', 'i-help', ''),
    item('about', 'Acerca de Word BryanMG', 'i-help', '')
  );

  menuNode.addEventListener('click', (e) => {
    if (e.target.closest('[data-action]')) closeFileMenu();
  });

  document.getElementById('overlay-root').append(menuNode);
  setTimeout(() => document.addEventListener('mousedown', outsideHandler, true), 0);
}
