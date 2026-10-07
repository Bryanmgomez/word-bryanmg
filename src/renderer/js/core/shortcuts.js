export function initShortcuts({ dispatch }) {
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const target = e.target;
    const inField = target instanceof Element &&
      target.closest('input, textarea, select, [contenteditable="true"]');

    if (e.key === 'Escape') {
      dispatch('escape');
      return;
    }

    if (!mod) return;

    if (e.altKey && key === 'f') {
      e.preventDefault();
      dispatch('file-menu');
      return;
    }

    if (e.shiftKey) {
      if (key === 's') { e.preventDefault(); dispatch('save-as'); }
      if (key === 'z') { e.preventDefault(); dispatch('redo'); }
      return;
    }

    switch (key) {
      case 's':
        e.preventDefault();
        dispatch('save');
        break;
      case 'o':
        e.preventDefault();
        dispatch('open');
        break;
      case 'n':
        e.preventDefault();
        dispatch('new');
        break;
      case 'p':
        e.preventDefault();
        dispatch('print');
        break;
      case 'f':
        e.preventDefault();
        dispatch('find');
        break;
      case 'h':
        e.preventDefault();
        dispatch('replace');
        break;
      case 'k':
        e.preventDefault();
        dispatch('insert-link');
        break;
      case 'z':
        if (!inField) { e.preventDefault(); dispatch('undo'); }
        break;
      case 'y':
        if (!inField) { e.preventDefault(); dispatch('redo'); }
        break;
      case 'b':
        if (!inField) { e.preventDefault(); dispatch('cmd:bold'); }
        break;
      case 'i':
        if (!inField) { e.preventDefault(); dispatch('cmd:italic'); }
        break;
      case 'u':
        if (!inField) { e.preventDefault(); dispatch('cmd:underline'); }
        break;
      case '=':
      case '+':
        e.preventDefault();
        dispatch('zoom-in');
        break;
      case '-':
        e.preventDefault();
        dispatch('zoom-out');
        break;
      case '0':
        e.preventDefault();
        dispatch('zoom-reset');
        break;
      default:
        break;
    }
  });
}
