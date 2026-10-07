import { $, escapeRegExp, debounce } from '../core/util.js';
import { getElement, focusEditor, getRefs } from '../core/editor.js';

let marks = [];
let current = -1;
let opened = false;
let replaceMode = false;

const refsUI = {};

export function isFindOpen() {
  return opened;
}

export function initFindbar() {
  refsUI.bar = $('#findbar');
  refsUI.input = $('#find-input');
  refsUI.count = $('#find-count');
  refsUI.replaceRow = $('#find-replace-row');
  refsUI.replaceInput = $('#replace-input');
  refsUI.caseBox = $('#find-case');

  refsUI.input.addEventListener('input', debounce(() => runSearch(true), 180));
  refsUI.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.shiftKey ? prev() : next();
    }
    if (e.key === 'Escape') closeFind();
  });
  refsUI.replaceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      replaceCurrent();
    }
    if (e.key === 'Escape') closeFind();
  });
  refsUI.caseBox.addEventListener('change', () => runSearch(true));
}

export function openFind(withReplace) {
  opened = true;
  replaceMode = Boolean(withReplace);
  refsUI.bar.classList.remove('hidden');
  refsUI.replaceRow.classList.toggle('hidden', !replaceMode);
  refsUI.input.focus();
  refsUI.input.select();
  runSearch(true);
}

export function closeFind() {
  if (!opened) return;
  opened = false;
  refsUI.bar.classList.add('hidden');
  clearMarks();
  current = -1;
  focusEditor();
}

export function refreshIfOpen() {
  if (opened) runSearch(false);
}

function textNodes() {
  const result = [];
  const walker = document.createTreeWalker(getElement(), NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.length) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest('.page-break')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let n;
  while ((n = walker.nextNode())) result.push(n);
  return result;
}

export function clearMarks() {
  const editor = getElement();
  editor.querySelectorAll('mark[data-mark="find"]').forEach((mark) => {
    const parent = mark.parentNode;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    mark.remove();
    parent.normalize();
  });
  marks = [];
}

function runSearch(keepTerm) {
  const term = refsUI.input.value;
  clearMarks();
  current = -1;
  if (!term) {
    updateCount();
    return;
  }

  const flags = refsUI.caseBox.checked ? 'g' : 'gi';
  const regex = new RegExp(escapeRegExp(term), flags);
  const nodes = textNodes();

  for (const node of nodes) {
    const text = node.nodeValue;
    regex.lastIndex = 0;
    if (!regex.test(text)) continue;
    regex.lastIndex = 0;

    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match[0].length === 0) {
        regex.lastIndex++;
        continue;
      }
      if (match.index > lastIndex) {
        fragment.append(text.slice(lastIndex, match.index));
      }
      const mark = document.createElement('mark');
      mark.setAttribute('data-mark', 'find');
      mark.textContent = match[0];
      fragment.append(mark);
      marks.push(mark);
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) fragment.append(text.slice(lastIndex));
    if (fragment.childNodes.length) node.replaceWith(fragment);
  }

  if (marks.length) setCurrent(0);
  else updateCount();
}

function updateCount() {
  const total = marks.length;
  const idx = total ? current + 1 : 0;
  refsUI.count.textContent = idx + '/' + total;
  refsUI.count.style.color = total ? '' : 'var(--muted)';
}

function setCurrent(i) {
  marks.forEach((m) => m.classList.remove('current'));
  if (!marks.length) {
    current = -1;
    updateCount();
    return;
  }
  current = ((i % marks.length) + marks.length) % marks.length;
  const mark = marks[current];
  mark.classList.add('current');
  mark.scrollIntoView({ block: 'center' });

  const range = document.createRange();
  range.selectNodeContents(mark);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  updateCount();
}

function next() {
  if (!marks.length) {
    runSearch(true);
    if (!marks.length) return;
  }
  setCurrent(current + 1);
}

function prev() {
  if (!marks.length) {
    runSearch(true);
    if (!marks.length) return;
  }
  setCurrent(current - 1);
}

function replaceCurrent() {
  if (!marks.length) {
    runSearch(true);
    if (!marks.length) return;
  }
  const idx = Math.max(0, current);
  const mark = marks[idx];
  if (!mark) return;
  const replacement = refsUI.replaceInput.value;
  const textNode = document.createTextNode(replacement);
  mark.replaceWith(textNode);
  textNode.parentNode?.normalize?.();

  runSearch(false);
  if (marks.length) setCurrent(Math.min(idx, marks.length - 1));
  getElement().dispatchEvent(new InputEvent('input', { bubbles: true }));
}

function replaceAll() {
  const term = refsUI.input.value;
  if (!term) return 0;
  clearMarks();
  const flags = refsUI.caseBox.checked ? 'g' : 'gi';
  const regex = new RegExp(escapeRegExp(term), flags);
  const replacement = refsUI.replaceInput.value;
  let count = 0;

  for (const node of textNodes()) {
    const text = node.nodeValue;
    regex.lastIndex = 0;
    if (!regex.test(text)) continue;
    regex.lastIndex = 0;

    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match[0].length === 0) {
        regex.lastIndex++;
        continue;
      }
      if (match.index > lastIndex) fragment.append(text.slice(lastIndex, match.index));
      fragment.append(replacement);
      count++;
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) fragment.append(text.slice(lastIndex));
    if (fragment.childNodes.length) node.replaceWith(fragment);
  }

  if (count) {
    getElement().dispatchEvent(new InputEvent('input', { bubbles: true }));
  }
  runSearch(false);
  return count;
}

export const findActions = {
  next,
  prev,
  replaceCurrent,
  replaceAll
};
