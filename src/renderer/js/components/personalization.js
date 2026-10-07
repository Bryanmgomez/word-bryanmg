import { el } from '../core/util.js';
import { setState, loadSettings, saveSettings } from '../core/state.js';
import { openDialog } from './dialogs.js';
import { toast } from './toast.js';

const THEMES = [
  ['light', 'Claro'],
  ['dark', 'Oscuro']
];
const SCALES = [
  ['0.85', 'Pequeña'],
  ['1', 'Mediana'],
  ['1.15', 'Grande'],
  ['1.3', 'Muy grande']
];
const TOOLBARS = [
  ['full', 'Completa'],
  ['icons', 'Solo iconos'],
  ['min', 'Minimizada']
];
const BGS = [
  ['papel', 'Papel', 'var(--paper)'],
  ['claro', 'Claro', '#fafbfc'],
  ['gris', 'Gris', '#e8eaef'],
  ['azul', 'Azul', '#e9eff9'],
  ['verde', 'Verde', '#e9f3ec'],
  ['oscuro', 'Oscuro', '#2a2e3b']
];

export function applyUISettings(settings = {}) {
  const theme = settings.theme || 'light';
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.scale = settings.scale || '1';
  document.body.dataset.toolbar = settings.toolbar || 'full';
  document.body.dataset.editorbg = settings.editorBg || 'papel';
  setState({ theme });
}

function opt(name, value, label, active) {
  return el('label', { class: 'seg-opt' + (active ? ' active' : '') },
    el('input', { type: 'radio', name, value, ...(active ? { checked: true } : {}) }),
    el('span', { text: label })
  );
}

function bgOpt(value, color, label, active) {
  return el('label', { class: 'seg-opt' + (active ? ' active' : '') },
    el('input', { type: 'radio', name: 'pw-editorbg', value, ...(active ? { checked: true } : {}) }),
    el('span', { class: 'seg-dot', style: 'background:' + color }),
    el('span', { text: label })
  );
}

export function openPersonalizationDialog() {
  const settings = loadSettings();
  const theme = settings.theme || 'light';
  const scale = settings.scale || '1';
  const toolbar = settings.toolbar || 'full';
  const editorBg = settings.editorBg || 'papel';

  const themeOpts = THEMES.map(([v, l]) => opt('pw-theme', v, l, v === theme));
  const themeRow = el('div', { class: 'seg' }, themeOpts);

  const scaleOpts = SCALES.map(([v, l]) => opt('pw-scale', v, l, String(v) === String(scale)));
  const scaleRow = el('div', { class: 'seg' }, scaleOpts);

  const toolbarOpts = TOOLBARS.map(([v, l]) => opt('pw-toolbar', v, l, v === toolbar));
  const toolbarRow = el('div', { class: 'seg' }, toolbarOpts);

  const bgOpts = BGS.map(([v, c, col]) => bgOpt(v, col, c, v === editorBg));
  const bgRow = el('div', { class: 'seg' }, bgOpts);

  const pageNum = el('input', { type: 'checkbox' });
  pageNum.checked = !!settings.pageNumbers;
  const docHeader = el('input', { type: 'checkbox' });
  docHeader.checked = !!settings.docHeader;

  const tabBtn = (key, label) => el('button', { class: 'cfg-tab', dataset: { cfgTab: key }, text: label });
  const apTab = tabBtn('apariencia', 'Apariencia');
  const docTab = tabBtn('documento', 'Documento');
  apTab.classList.add('active');

  const paneApariencia = el('div', { class: 'cfg-pane active', dataset: { cfgPane: 'apariencia' } },
    el('div', { class: 'cfg-section' },
      el('p', { class: 'cfg-title', text: 'Tema' }), themeRow),
    el('div', { class: 'cfg-section' },
      el('p', { class: 'cfg-title', text: 'Tamaño de la interfaz' }), scaleRow),
    el('div', { class: 'cfg-section' },
      el('p', { class: 'cfg-title', text: 'Apariencia de la barra de herramientas' }), toolbarRow),
    el('div', { class: 'cfg-section' },
      el('p', { class: 'cfg-title', text: 'Fondo del editor' }), bgRow)
  );

  const paneDocumento = el('div', { class: 'cfg-pane', dataset: { cfgPane: 'documento' } },
    el('div', { class: 'cfg-section' },
      el('label', { class: 'cfg-check' }, pageNum,
        el('span', { text: 'Mostrar número de página en los documentos nuevos (Página X de Y)' })),
      el('label', { class: 'cfg-check' }, docHeader,
        el('span', { text: 'Añadir el encabezado “Word BryanMG” a los documentos nuevos' }))),
    el('p', { class: 'cfg-check', style: 'color:var(--muted)' },
      el('span', { text: 'Estos ajustes se aplican a los documentos que crees a partir de ahora; no incluyen una marca de agua automática.' }))
  );

  const tabs = el('div', { class: 'cfg-tabs' }, apTab, docTab);
  const body = el('div', {}, tabs, paneApariencia, paneDocumento);

  const d = openDialog({
    title: 'Personalización de Word BryanMG',
    body,
    buttons: [
      { label: 'Cancelar', value: null },
      { label: 'Aplicar', value: '__ok__', primary: true }
    ]
  });

  function applyNow() {
    const sel = (name) => {
      const r = body.querySelector('input[name="' + name + '"]:checked');
      return r ? r.value : null;
    };
    const next = {
      theme: sel('pw-theme') || 'light',
      scale: sel('pw-scale') || '1',
      toolbar: sel('pw-toolbar') || 'full',
      editorBg: sel('pw-editorbg') || 'papel',
      pageNumbers: pageNum.checked,
      docHeader: docHeader.checked
    };
    applyUISettings(next);
    saveSettings(next);
  }

  body.addEventListener('change', (e) => {
    if (e.target.matches('input[type="radio"]')) {
      for (const g of body.querySelectorAll('.seg')) {
        const checked = g.querySelector('input:checked');
        for (const lbl of g.querySelectorAll('.seg-opt')) lbl.classList.toggle('active', !!checked && checked.closest('.seg-opt') === lbl);
      }
    }
    applyNow();
  });

  body.addEventListener('click', (e) => {
    const tab = e.target.closest('.cfg-tab');
    if (!tab) return;
    for (const t of tabs.querySelectorAll('.cfg-tab')) t.classList.toggle('active', t === tab);
    for (const p of body.querySelectorAll('.cfg-pane')) p.classList.toggle('active', p.dataset.cfgPane === tab.dataset.cfgTab);
  });

  d.promise.then((value) => {
    if (value === '__ok__') {
      applyNow();
      toast('Personalización aplicada', 'ok');
    } else {
      const prev = loadSettings();
      applyUISettings(prev);
    }
  });
}