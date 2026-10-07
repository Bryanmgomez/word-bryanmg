import { idbGetAll, idbGet, idbPut, idbDelete, idbIndexAll } from './idb.js';
import { uid } from './util.js';
import { loadSettings, saveSettings } from './state.js';

const MAX_VERSIONS = 20;
const RECENTS_KEY = 'papiro.recents';

export const EMPTY_DOC_HTML = '<p><br></p>';

export async function listDocs() {
  const docs = await idbGetAll('docs');
  return docs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function listActiveDocs() {
  return (await listDocs()).filter((d) => !d.deletedAt);
}

export async function listFavorites() {
  return (await listActiveDocs()).filter((d) => d.favorite);
}

export async function setDocFavorite(id, fav) {
  const doc = await getDoc(id);
  if (!doc) return null;
  doc.favorite = !!fav;
  await idbPut('docs', doc);
  return doc;
}

export async function nextUntitledName() {
  const names = new Set();
  for (const doc of await idbGetAll('docs')) {
    let n = doc.name;
    const m = /^Documento sin título(?: (\d+))?$/.exec(n || '');
    names.add(m ? Number(m[1] || 1) : Infinity);
  }
  let i = 1;
  while (names.has(i)) i++;
  return 'Documento sin título ' + i;
}

export async function listTrash() {
  return (await listDocs()).filter((d) => d.deletedAt);
}

export async function getDoc(id) {
  return idbGet('docs', id);
}

export async function createDoc({ name, folderId = null, html = EMPTY_DOC_HTML, header = '', footer = '', switchTo = true } = {}) {
  const now = Date.now();
  const doc = {
    id: uid('doc'),
    name: name || 'Documento sin título',
    folderId,
    html,
    header,
    footer,
    showPageNum: false,
    favorite: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    words: 0
  };
  await idbPut('docs', doc);
  if (switchTo) pushRecent(doc.id);
  return doc;
}

export async function saveDoc(doc) {
  const existing = await getDoc(doc.id);
  const merged = { ...(existing || {}), ...doc, updatedAt: Date.now() };
  await idbPut('docs', merged);
  pushRecent(merged.id);
  return merged;
}

export async function renameDoc(id, name) {
  const doc = await getDoc(id);
  if (!doc) return null;
  doc.name = name;
  doc.updatedAt = Date.now();
  await idbPut('docs', doc);
  return doc;
}

export async function duplicateDoc(id) {
  const doc = await getDoc(id);
  if (!doc) return null;
  const copy = {
    ...doc,
    id: uid('doc'),
    name: doc.name + ' (copia)',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deletedAt: null
  };
  await idbPut('docs', copy);
  pushRecent(copy.id);
  return copy;
}

export async function moveToTrash(id) {
  const doc = await getDoc(id);
  if (!doc) return null;
  doc.deletedAt = Date.now();
  await idbPut('docs', doc);
  removeRecent(id);
  return doc;
}

export async function restoreDoc(id) {
  const doc = await getDoc(id);
  if (!doc) return null;
  doc.deletedAt = null;
  doc.updatedAt = Date.now();
  await idbPut('docs', doc);
  return doc;
}

export async function purgeDoc(id) {
  const versions = await idbIndexAll('versions', 'docId', id);
  for (const v of versions) await idbDelete('versions', v.id);
  await idbDelete('docs', id);
}

export async function emptyTrash() {
  const trash = await listTrash();
  for (const doc of trash) await purgeDoc(doc.id);
  return trash.length;
}

export async function listFolders() {
  const folders = await idbGetAll('folders');
  return folders.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export async function createFolder(name) {
  const folder = { id: uid('fld'), name: name || 'Carpeta sin nombre', createdAt: Date.now() };
  await idbPut('folders', folder);
  return folder;
}

export async function renameFolder(id, name) {
  const folder = await idbGet('folders', id);
  if (!folder) return null;
  folder.name = name;
  await idbPut('folders', folder);
  return folder;
}

export async function deleteFolder(id) {
  const docs = await idbIndexAll('docs', 'folderId', id);
  for (const doc of docs) {
    doc.folderId = null;
    await idbPut('docs', doc);
  }
  await idbDelete('folders', id);
  return docs.length;
}

/* ---------- Versiones (historial de cambios) ---------- */

export async function listVersions(docId) {
  const versions = await idbIndexAll('versions', 'docId', docId);
  return versions.sort((a, b) => b.createdAt - a.createdAt);
}

export async function addVersion(docId, html, header, footer, label) {
  const version = {
    id: uid('ver'),
    docId,
    html,
    header: header || '',
    footer: footer || '',
    label: label || 'Cambio',
    createdAt: Date.now()
  };
  await idbPut('versions', version);
  const all = await listVersions(docId);
  for (const old of all.slice(MAX_VERSIONS)) {
    await idbDelete('versions', old.id);
  }
  return version;
}

export async function deleteVersion(id) {
  await idbDelete('versions', id);
}

/* ---------- Recientes y ajustes ---------- */

export function getRecents() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENTS_KEY)) || [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function pushRecent(id) {
  const list = getRecents().filter((x) => x !== id);
  list.unshift(id);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, 10)));
}

export function removeRecent(id) {
  const list = getRecents().filter((x) => x !== id);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
}

export async function getRecentDocs(limit = 6) {
  const ids = getRecents();
  const docs = [];
  for (const id of ids) {
    const doc = await getDoc(id);
    if (doc && !doc.deletedAt) docs.push(doc);
    if (docs.length >= limit) break;
  }
  return docs;
}

export function getLastDocId() {
  return loadSettings().lastDocId || null;
}

export function setLastDocId(id) {
  saveSettings({ lastDocId: id });
}
