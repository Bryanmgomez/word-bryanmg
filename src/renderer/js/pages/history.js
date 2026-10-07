import { el, fmtDate } from '../core/util.js';
import { state } from '../core/state.js';
import { listVersions, deleteVersion } from '../core/store.js';
import { openDialog, confirmDialog } from '../components/dialogs.js';
import { toast } from '../components/toast.js';

export async function openHistoryDialog({ onRestore }) {
  const docId = state.docId;
  if (!docId) return;

  const versions = await listVersions(docId);
  const body = el('div', { class: 'history-list' });

  if (!versions.length) {
    body.append(el('div', { class: 'fm-empty' },
      el('svg', { class: 'icon' }, el('use', { href: '#i-clock' })),
      el('div', { text: 'Todavía no hay versiones guardadas. Guarda el documento (Ctrl+S) para crear una.' })
    ));
  }

  for (const v of versions) {
    body.append(el('div', { class: 'fm-row' },
      el('div', { class: 'fm-row-icon' }, el('svg', { class: 'icon' }, el('use', { href: '#i-clock' }))),
      el('div', { class: 'fm-row-main' },
        el('div', { class: 'fm-row-name', text: v.label || 'Cambio' }),
        el('span', { class: 'fm-row-sub', text: fmtDate(v.createdAt) })
      ),
      el('div', { class: 'fm-row-tools' },
        el('button', {
          class: 'ib', title: 'Restaurar esta versión',
          dataset: { verRestore: v.id },
          html: '<svg class="icon"><use href="#i-restore"/></svg>'
        }),
        el('button', {
          class: 'ib danger', title: 'Eliminar versión',
          dataset: { verDelete: v.id },
          html: '<svg class="icon"><use href="#i-trash"/></svg>'
        })
      )
    ));
  }

  const d = openDialog({
    title: 'Historial de cambios',
    body,
    wide: false,
    buttons: [{ label: 'Cerrar', value: null, primary: true }]
  });

  body.addEventListener('click', async (e) => {
    const restoreBtn = e.target.closest('[data-ver-restore]');
    if (restoreBtn) {
      const version = versions.find((v) => v.id === restoreBtn.dataset.verRestore);
      if (!version) return;
      const ok = await confirmDialog('Restaurar versión',
        'Se reemplazará el contenido actual por esta versión. El contenido actual quedará guardado antes.',
        { confirmLabel: 'Restaurar' });
      if (ok) {
        d.close(null);
        onRestore?.(version);
      }
      return;
    }

    const delBtn = e.target.closest('[data-ver-delete]');
    if (delBtn) {
      const ok = await confirmDialog('Eliminar versión',
        'Esta versión del historial se borrará definitivamente.', { confirmLabel: 'Eliminar', danger: true });
      if (ok) {
        await deleteVersion(delBtn.dataset.verDelete);
        delBtn.closest('.fm-row')?.remove();
        toast('Versión eliminada');
        if (!body.querySelector('.fm-row')) {
          body.replaceChildren(el('div', { class: 'fm-empty' },
            el('svg', { class: 'icon' }, el('use', { href: '#i-clock' })),
            el('div', { text: 'No quedan versiones guardadas.' })
          ));
        }
      }
    }
  });

  return d;
}
