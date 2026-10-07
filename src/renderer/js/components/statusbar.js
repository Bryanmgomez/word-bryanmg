import { $ } from '../core/util.js';

export function setSaveState(state) {
  const node = $('#save-state');
  if (!node) return;
  node.dataset.state = state;
  node.textContent = {
    saved: 'Guardado',
    saving: 'Guardando…',
    dirty: 'Cambios sin guardar'
  }[state] || 'Guardado';
}

export function updateStats({ words, chars }) {
  const wordsNode = $('#st-words');
  const charsNode = $('#st-chars');
  if (wordsNode) wordsNode.textContent = words + (words === 1 ? ' palabra' : ' palabras');
  if (charsNode) charsNode.textContent = chars.toLocaleString('es') + ' caracteres';
}

export function updatePages(current, total) {
  const node = $('#st-pages');
  if (node) node.textContent = `Página ${current} de ${total}`;
}

export function updateZoom(zoom) {
  const node = $('#st-zoom');
  if (node) node.textContent = Math.round(zoom * 100) + ' %';
}

export function setSpellcheck(enabled) {
  const node = $('#st-spell');
  if (!node) return;
  node.classList.toggle('off', !enabled);
  node.title = enabled
    ? 'Corrector ortográfico activado (desactivar)'
    : 'Corrector ortográfico desactivado (activar)';
}

export function setAutosaveText(text) {
  const node = $('#st-autosave');
  if (node) node.textContent = text;
}
