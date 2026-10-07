import { $, el, fmtDate } from '../core/util.js';
import { state, setState } from '../core/state.js';
import {
  listActiveDocs, listTrash, listFolders, createFolder, renameFolder, deleteFolder,
  renameDoc, duplicateDoc, moveToTrash, restoreDoc, purgeDoc, emptyTrash,
  getDoc, saveDoc, setDocFavorite
} from '../core/store.js';
import { confirmDialog, promptDialog, openDialog } from '../components/dialogs.js';
import { toast } from '../components/toast.js';

let onOpenDoc = null;

export function initFileManager({ onOpenDoc: cb } = {}) {
  onOpenDoc = cb;

  $('#fm-breadcrumb').addEventListener('click', (e) => {
    const crumb = e.target.closest('[data-fm-nav]');
    if (crumb) fmNavigate(crumb.dataset.fmNav === 'trash' ? 'trash' : crumb.dataset.fmNav || null);
  });

  $('#fm-content').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-fm-action]');
    if (btn) {
      e.stopPropagation();
      await handleAction(btn.dataset.fmAction, btn.dataset.fmId || null);
      return;
    }
    const nav = e.target.closest('[data-fm-nav]');
    if (nav) {
      e.stopPropagation();
      fmNavigate(nav.dataset.fmNav === 'trash' ? 'trash' : nav.dataset.fmNav || null);
    }
  });
}

export function fmNavigate(loc) {
  setState({ browseFolder: loc });
  renderFileManager();
}

export async function renderFileManager() {
  const crumb = $('#fm-breadcrumb');
  const content = $('#fm-content');
  if (!crumb || !content) return;

  const loc = state.browseFolder;
  crumb.replaceChildren(await renderBreadcrumb(loc));
  content.replaceChildren(await renderContent(loc));
}

async function renderBreadcrumb(loc) {
  const wrap = el('span');
  const home = el('button', {
    class: loc === null ? 'current' : '',
    dataset: { fmNav: '' },
    text: 'Inicio'
  });
  wrap.append(home);

  if (loc === 'trash') {
    wrap.append(el('span', { class: 'sep', text: '/' }));
    wrap.append(el('button', { class: 'current', text: 'Papelera' }));
    return wrap;
  }

  if (loc) {
    const folder = (await listFolders()).find((f) => f.id === loc);
    wrap.append(el('span', { class: 'sep', text: '/' }));
    wrap.append(el('button', { class: 'current', text: folder ? folder.name : 'Carpeta' }));
  }
  return wrap;
}

async function renderContent(loc) {
  const frag = document.createDocumentFragment();

  if (loc === 'trash') {
    const trash = await listTrash();
    frag.append(sectionTitle('Papelera',
      trash.length ? el('button', {
        class: 'btn', dataset: { fmAction: 'empty-trash' }, text: 'Vaciar papelera'
      }) : null));
    if (!trash.length) frag.append(emptyState('i-trash', 'La papelera está vacía.'));
    for (const doc of trash) frag.append(docRow(doc, 'trash'));
    return frag;
  }

  const folders = await listFolders();
  const all = await listActiveDocs();
  const inFolder = loc ? all.filter((d) => d.folderId === loc) : all.filter((d) => !d.folderId);

  if (loc === null) {
    frag.append(sectionTitle('Carpetas',
      el('button', {
        class: 'btn', dataset: { fmAction: 'new-folder' },
        html: '<svg class="icon"><use href="#i-plus"/></svg>Nueva'
      })));
    if (!folders.length) frag.append(emptyState('i-folder', 'Sin carpetas. Crea una para organizar tus documentos.'));
    for (const folder of folders) frag.append(folderRow(folder));
    frag.append(el('div', { class: 'sb-divider' }));
  }

  frag.append(sectionTitle(loc ? 'Documentos de la carpeta' : 'Documentos'));
  if (!inFolder.length) {
    frag.append(emptyState('i-file-new', 'No hay documentos aquí todavía.'));
  }
  for (const doc of inFolder) frag.append(docRow(doc, 'active'));

  if (loc === null) {
    const trashCount = (await listTrash()).length;
    if (trashCount) {
      frag.append(el('div', { class: 'sb-divider' }));
      frag.append(sectionTitle('Papelera',
        el('button', {
          class: 'btn', dataset: { fmNav: 'trash' },
          html: '<svg class="icon"><use href="#i-trash"/></svg>Abrir (' + trashCount + ')'
        })));
    }
  }

  return frag;
}

function sectionTitle(text, extra) {
  return el('div', { class: 'fm-section-title' }, el('span', { text }), extra || null);
}

function emptyState(icon, text) {
  return el('div', { class: 'fm-empty' },
    el('svg', { class: 'icon' }, el('use', { href: '#' + icon })),
    el('div', { text })
  );
}

function toolBtn(action, id, icon, title, danger = false) {
  return el('button', {
    class: 'ib' + (danger ? ' danger' : ''),
    title,
    dataset: { fmAction: action, fmId: id || '' },
    html: '<svg class="icon"><use href="#' + icon + '"/></svg>'
  });
}

function docRow(doc, mode) {
  const sub = mode === 'trash'
    ? 'Eliminado ' + fmtDate(doc.deletedAt)
    : 'Editado ' + fmtDate(doc.updatedAt);

  const tools = mode === 'trash'
    ? [
        toolBtn('restore-doc', doc.id, 'i-restore', 'Restaurar'),
        toolBtn('purge-doc', doc.id, 'i-trash', 'Eliminar definitivamente', true)
      ]
    : [
        el('button', {
          class: 'ib favbtn' + (doc.favorite ? ' on' : ''),
          title: doc.favorite ? 'Quitar de favoritos' : 'Marcar como favorito',
          dataset: { fmAction: 'fav-doc', fmId: doc.id },
          html: '<svg class="icon i-star"><use href="#i-star"/></svg><svg class="icon i-star-o"><use href="#i-star-o"/></svg>'
        }),
        toolBtn('rename-doc', doc.id, 'i-edit', 'Cambiar nombre'),
        toolBtn('dup-doc', doc.id, 'i-copy', 'Duplicar'),
        toolBtn('move-doc', doc.id, 'i-move', 'Mover a carpeta'),
        toolBtn('trash-doc', doc.id, 'i-trash', 'Mover a la papelera', true)
      ];

  return el('div', {
    class: 'fm-row' + (doc.id === state.docId ? ' current' : ''),
    dataset: mode === 'active' ? { fmAction: 'open-doc', fmId: doc.id } : {}
  },
    el('div', { class: 'fm-row-icon' }, el('svg', { class: 'icon' }, el('use', { href: '#i-file-new' }))),
    el('div', { class: 'fm-row-main' },
      el('div', { class: 'fm-row-name', text: doc.name }),
      el('span', { class: 'fm-row-sub', text: sub })
    ),
    el('div', { class: 'fm-row-tools' }, tools)
  );
}

function folderRow(folder) {
  return el('div', { class: 'fm-row' },
    el('div', { class: 'fm-row-icon' }, el('svg', { class: 'icon' }, el('use', { href: '#i-folder' }))),
    el('div', {
      class: 'fm-row-main',
      dataset: { fmNav: folder.id }
    },
      el('div', { class: 'fm-row-name', text: folder.name }),
      el('span', { class: 'fm-row-sub', text: 'Carpeta' })
    ),
    el('div', { class: 'fm-row-tools' },
      toolBtn('rename-folder', folder.id, 'i-edit', 'Cambiar nombre'),
      toolBtn('delete-folder', folder.id, 'i-trash', 'Eliminar carpeta', true)
    )
  );
}

function storeChanged(detail) {
  window.dispatchEvent(new CustomEvent('papiro:store-changed', { detail }));
}

async function handleAction(action, id) {
  switch (action) {
    case 'open-doc':
      if (id) onOpenDoc?.(id);
      break;

    case 'fav-doc': {
      const doc = await getDoc(id);
      if (!doc) return;
      await setDocFavorite(id, !doc.favorite);
      toast(doc.favorite ? 'Quitado de favoritos' : 'Añadido a favoritos', 'ok');
      renderFileManager();
      window.dispatchEvent(new CustomEvent('papiro:store-changed', { detail: { type: 'fav', id } }));
      break;
    }

    case 'new-folder': {
      const name = await promptDialog('Nueva carpeta', 'Nombre de la carpeta', '', {
        placeholder: 'Ej. Trabajo', confirmLabel: 'Crear'
      });
      if (name) {
        await createFolder(name);
        toast('Carpeta creada', 'ok');
        renderFileManager();
        storeChanged({ type: 'folders' });
      }
      break;
    }

    case 'rename-folder': {
      const folder = (await listFolders()).find((f) => f.id === id);
      if (!folder) return;
      const name = await promptDialog('Renombrar carpeta', 'Nombre', folder.name, { confirmLabel: 'Guardar' });
      if (name) {
        await renameFolder(id, name);
        renderFileManager();
        storeChanged({ type: 'folders' });
      }
      break;
    }

    case 'delete-folder': {
      const folder = (await listFolders()).find((f) => f.id === id);
      if (!folder) return;
      const ok = await confirmDialog(
        'Eliminar carpeta',
        `Se eliminará la carpeta “${folder.name}”. Sus documentos pasarán a la raíz.`,
        { confirmLabel: 'Eliminar', danger: true }
      );
      if (ok) {
        await deleteFolder(id);
        toast('Carpeta eliminada', 'ok');
        renderFileManager();
        storeChanged({ type: 'folders' });
      }
      break;
    }

    case 'rename-doc': {
      const docs = await listActiveDocs();
      const doc = docs.find((d) => d.id === id);
      if (!doc) return;
      const name = await promptDialog('Cambiar nombre', 'Nombre del documento', doc.name, { confirmLabel: 'Guardar' });
      if (name) {
        await renameDoc(id, name);
        toast('Nombre actualizado', 'ok');
        renderFileManager();
        storeChanged({ type: 'renamed', id, name });
      }
      break;
    }

    case 'dup-doc': {
      const copy = await duplicateDoc(id);
      if (copy) {
        toast('Copia creada: ' + copy.name, 'ok');
        renderFileManager();
        storeChanged({ type: 'created' });
      }
      break;
    }

    case 'move-doc': {
      const folders = await listFolders();
      const options = [
        el('option', { value: '', text: 'Sin carpeta (raíz)' }),
        ...folders.map((f) => el('option', { value: f.id, text: f.name }))
      ];
      const select = el('select', { class: 'field' }, options);
      const d = openDialog({
        title: 'Mover documento',
        body: el('div', { class: 'row' },
          el('label', { class: 'field-label', text: 'Carpeta de destino' }), select),
        buttons: [
          { label: 'Cancelar', value: null },
          { label: 'Mover', value: '__ok__', primary: true }
        ]
      });
      const value = await d.promise;
      if (value === '__ok__') {
        const doc = await getDoc(id);
        if (doc) {
          doc.folderId = select.value || null;
          await saveDoc(doc);
          toast('Documento movido', 'ok');
          renderFileManager();
          storeChanged({ type: 'moved', id });
        }
      }
      break;
    }

    case 'trash-doc': {
      const doc = await getDoc(id);
      const ok = await confirmDialog('Mover a la papelera',
        `“${doc?.name || 'El documento'}” irá a la papelera. Podrás restaurarlo después.`,
        { confirmLabel: 'Mover', danger: true });
      if (ok) {
        await moveToTrash(id);
        toast('Documento movido a la papelera');
        renderFileManager();
        storeChanged({ type: 'trashed', id });
      }
      break;
    }

    case 'restore-doc': {
      await restoreDoc(id);
      toast('Documento restaurado', 'ok');
      renderFileManager();
      storeChanged({ type: 'restored', id });
      break;
    }

    case 'purge-doc': {
      const ok = await confirmDialog('Eliminar definitivamente',
        'Esta acción no se puede deshacer. El documento y su historial se borrarán para siempre.',
        { confirmLabel: 'Eliminar', danger: true });
      if (ok) {
        await purgeDoc(id);
        toast('Documento eliminado');
        renderFileManager();
        storeChanged({ type: 'purged', id });
      }
      break;
    }

    case 'empty-trash': {
      const ok = await confirmDialog('Vaciar papelera',
        'Se eliminarán todos los documentos de la papelera de forma definitiva.',
        { confirmLabel: 'Vaciar', danger: true });
      if (ok) {
        const n = await emptyTrash();
        toast(n + ' documento' + (n === 1 ? '' : 's') + ' eliminado' + (n === 1 ? '' : 's'));
        renderFileManager();
        storeChanged({ type: 'emptied' });
      }
      break;
    }
  }
}
