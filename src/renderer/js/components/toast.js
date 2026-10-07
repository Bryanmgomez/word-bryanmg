import { el } from '../core/util.js';

const root = () => document.getElementById('toast-root');

export function toast(message, type = '') {
  const node = el('div', { class: 'toast' + (type ? ' ' + type : ''), text: message });
  root().append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .3s, transform .3s';
    node.style.opacity = '0';
    node.style.transform = 'translateY(8px)';
    setTimeout(() => node.remove(), 320);
  }, 2600);
  return node;
}
