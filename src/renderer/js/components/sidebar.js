import { $, $$, el } from '../core/util.js';

let onHeading = null;
let stateRef = { open: true, tab: 'outline' };

export function initSidebar({ onHeading: cb } = {}) {
  onHeading = cb;

  $$('.sb-tab').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => setActiveTab(tabBtn.dataset.tab));
  });

  window.addEventListener('resize', applyResponsive);
  applyResponsive();
}

export function setActiveTab(tab) {
  stateRef.tab = tab;
  $$('.sb-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#sb-outline')?.classList.toggle('active', tab === 'outline');
  $('#sb-files')?.classList.toggle('active', tab === 'files');
}

export function getActiveTab() {
  return stateRef.tab;
}

export function isNarrow() {
  return window.matchMedia('(max-width: 1100px)').matches;
}

export function setSidebarOpen(open) {
  stateRef.open = open;
  const sidebar = $('#sidebar');
  const scrim = $('#sidebar-scrim');
  if (!sidebar) return;

  sidebar.classList.toggle('open', open);
  sidebar.classList.toggle('closed', !open);

  if (scrim) scrim.classList.toggle('show', open && isNarrow());

  $$('[data-action="sidebar"]').forEach((b) => b.classList.toggle('active', open));
}

export function isSidebarOpen() {
  return stateRef.open;
}

function applyResponsive() {
  if (!isNarrow()) {
    $('#sidebar-scrim')?.classList.remove('show');
    $('#sidebar')?.classList.remove('open');
    if (!stateRef.open) $('#sidebar')?.classList.add('closed');
  } else {
    const sidebar = $('#sidebar');
    sidebar?.classList.remove('closed');
    sidebar?.classList.toggle('open', stateRef.open);
    $('#sidebar-scrim')?.classList.toggle('show', stateRef.open);
  }
}

export function renderOutline(items, activeId = null) {
  const list = $('#outline-list');
  if (!list) return;
  list.replaceChildren();

  if (!items.length) {
    list.append(el('div', { class: 'fm-empty' },
      el('svg', { class: 'icon' }, el('use', { href: '#i-header' })),
      'Aún no hay encabezados. Usa “Título 1”, “Título 2”… desde la barra de herramientas para estructurar el documento.'
    ));
    return;
  }

  for (const item of items) {
    const btn = el('button', {
      class: 'outline-item lv' + Math.min(4, item.level) + (item.id === activeId ? ' current' : ''),
      text: item.text,
      title: item.text,
      dataset: { headingId: item.id },
      onclick: () => {
        $$('.outline-item').forEach((b) => b.classList.remove('current'));
        btn.classList.add('current');
        onHeading?.(item.id);
      }
    });
    list.append(btn);
  }
}

export function renderPageList(total) {
  const list = $('#page-list');
  if (!list) return;
  list.replaceChildren();
  if (total <= 1) {
    list.append(el('div', { class: 'sb-note', text: 'El documento tiene una sola página.' }));
    return;
  }
  for (let i = 1; i <= total; i++) {
    list.append(el('div', { class: 'page-chip' },
      el('b', { text: 'Pág. ' + i })
    ));
  }
}
