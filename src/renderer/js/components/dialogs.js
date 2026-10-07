import { el, escapeHtml } from '../core/util.js';

const overlayRoot = () => document.getElementById('overlay-root');
const stack = [];

export function anyDialogOpen() {
  return stack.length > 0;
}

export function closeAllDialogs() {
  while (stack.length) stack[stack.length - 1].close(null);
}

export function openDialog({ title, body, buttons = [], wide = false, onClose } = {}) {
  const root = overlayRoot();
  const bodyNode = typeof body === 'string' ? el('div', { html: body }) : body;

  let resolveP;
  const promise = new Promise((resolve) => { resolveP = resolve; });
  let closed = false;

  const dialog = el('div', { class: 'dialog' + (wide ? ' wide' : '') },
    el('div', { class: 'dialog-head' },
      el('h3', { class: 'dialog-title', text: title }),
      el('button', { class: 'ib', title: 'Cerrar', html: '<span class="glyph-x">&times;</span>', onclick: () => close(null) })
    ),
    el('div', { class: 'dialog-body' }, bodyNode),
    buttons.length
      ? el('div', { class: 'dialog-foot' },
          buttons.map((btn) =>
            el('button', {
              class: 'btn' + (btn.primary ? ' primary' : '') + (btn.danger ? ' danger' : ''),
              text: btn.label,
              onclick: () => close(btn.value)
            })
          )
        )
      : null
  );

  const backdrop = el('div', {
    class: 'dialog-backdrop',
    onmousedown: (e) => { if (e.target === backdrop) close(null); }
  }, dialog);

  function close(value) {
    if (closed) return;
    closed = true;
    const idx = stack.indexOf(entry);
    if (idx >= 0) stack.splice(idx, 1);
    backdrop.remove();
    onClose?.(value);
    resolveP(value);
  }

  const entry = { close };
  stack.push(entry);
  root.append(backdrop);

  const focusable = dialog.querySelector('input:not([type=hidden]), textarea, select, button.btn.primary');
  setTimeout(() => focusable?.focus(), 30);

  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(null);
      return;
    }
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
      const primary = buttons.find((b) => b.primary);
      if (primary) {
        e.preventDefault();
        close(primary.value);
      }
    }
    e.stopPropagation();
  });

  return { promise, close, dialog, body: bodyNode };
}

export function handleEscape() {
  if (!stack.length) return false;
  stack[stack.length - 1].close(null);
  return true;
}

export function confirmDialog(title, message, { confirmLabel = 'Aceptar', danger = false } = {}) {
  const d = openDialog({
    title,
    body: `<p>${escapeHtml(message)}</p>`,
    buttons: [
      { label: 'Cancelar', value: false },
      { label: confirmLabel, value: true, primary: !danger, danger }
    ]
  });
  return d.promise;
}

export function promptDialog(title, label, value = '', { placeholder = '', confirmLabel = 'Aceptar' } = {}) {
  const input = el('input', {
    class: 'field',
    type: 'text',
    value,
    placeholder,
    spellcheck: 'false',
    autocomplete: 'off'
  });
  const d = openDialog({
    title,
    body: el('div', { class: 'row' },
      el('label', { class: 'field-label', text: label }),
      input
    ),
    buttons: [
      { label: 'Cancelar', value: null },
      { label: confirmLabel, value: '__ok__', primary: true }
    ]
  });
  return d.promise.then((v) => (v === '__ok__' ? input.value.trim() : null));
}
