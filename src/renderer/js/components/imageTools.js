import { el } from '../core/util.js';

let tools = null;
let currentImg = null;
let onChange = null;

export function initImageTools({ onChange: cb } = {}) {
  onChange = cb;
  document.addEventListener('mousedown', (e) => {
    if (!tools) return;
    if (tools.contains(e.target)) return;
    if (e.target === currentImg) return;
    hideImageTools();
  });
  document.addEventListener('scroll', () => position(), true);
  window.addEventListener('resize', () => hideImageTools());
}

export function isImageToolsOpen() {
  return Boolean(tools);
}

export function hideImageTools() {
  if (tools) tools.remove();
  tools = null;
  if (currentImg) currentImg.classList.remove('selected');
  currentImg = null;
}

export function showImageTools(img, container) {
  hideImageTools();
  currentImg = img;
  img.classList.add('selected');

  const setWidth = (pct) => {
    img.style.width = pct + '%';
    img.style.maxWidth = '100%';
    notify();
    position();
  };

  const setAlign = (mode) => {
    img.style.display = 'block';
    if (mode === 'center') {
      img.style.margin = '10px auto';
    } else if (mode === 'right') {
      img.style.margin = '10px 0 10px auto';
    } else {
      img.style.margin = '10px auto 10px 0';
    }
    notify();
    position();
  };

  const remove = () => {
    const parent = img.parentNode;
    img.remove();
    hideImageTools();
    if (parent) {
      if (!parent.textContent.trim() && !parent.querySelector('img')) {
        if (parent === document.getElementById('editor') || parent.tagName === 'LI' || parent.tagName === 'TD') {
          parent.append(el('p', {}, el('br')));
        }
      }
    }
    notify();
  };

  tools = el('div', { class: 'img-tools no-print' },
    el('button', { class: 'ib', text: '25 %', title: 'Ancho 25 %', onclick: () => setWidth(25) }),
    el('button', { class: 'ib', text: '50 %', title: 'Ancho 50 %', onclick: () => setWidth(50) }),
    el('button', { class: 'ib', text: '75 %', title: 'Ancho 75 %', onclick: () => setWidth(75) }),
    el('button', { class: 'ib', text: '100 %', title: 'Ancho original', onclick: () => setWidth(100) }),
    el('span', { class: 'sep' }),
    el('button', { class: 'ib', text: '⫷', title: 'Alinear a la izquierda', onclick: () => setAlign('left') }),
    el('button', { class: 'ib', text: '≡', title: 'Centrar', onclick: () => setAlign('center') }),
    el('button', { class: 'ib', text: '⫸', title: 'Alinear a la derecha', onclick: () => setAlign('right') }),
    el('span', { class: 'sep' }),
    el('button', { class: 'ib danger', text: '🗑', title: 'Eliminar imagen', onclick: remove })
  );

  container.append(tools);
  position();
}

function notify() {
  onChange?.();
  document.getElementById('editor')?.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

function position() {
  if (!tools || !currentImg) return;
  const op = tools.offsetParent;
  if (!op) return;
  const imgRect = currentImg.getBoundingClientRect();
  const opRect = op.getBoundingClientRect();

  let left = imgRect.left - opRect.left + (op.scrollLeft || 0);
  let top = imgRect.bottom - opRect.top + (op.scrollTop || 0) + 8;

  const toolsWidth = tools.offsetWidth || 300;
  const toolsHeight = tools.offsetHeight || 40;
  const maxLeft = Math.max(8, op.clientWidth - toolsWidth - 8);
  if (left > maxLeft) left = maxLeft;
  if (left < 8) left = 8;

  if (imgRect.bottom + toolsHeight + 16 > opRect.bottom) {
    top = imgRect.top - opRect.top + (op.scrollTop || 0) - toolsHeight - 8;
  }

  tools.style.top = top + 'px';
  tools.style.left = left + 'px';
}
