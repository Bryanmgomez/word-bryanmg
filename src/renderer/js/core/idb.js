const DB_NAME = 'papiro';
const DB_VERSION = 1;

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('docs')) {
        const store = db.createObjectStore('docs', { keyPath: 'id' });
        store.createIndex('folderId', 'folderId', { unique: false });
        store.createIndex('deletedAt', 'deletedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('folders')) {
        db.createObjectStore('folders', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('versions')) {
        const v = db.createObjectStore('versions', { keyPath: 'id' });
        v.createIndex('docId', 'docId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeNames, mode) {
  return openDB().then((db) => {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const t = db.transaction(names, mode);
    const stores = names.map((n) => t.objectStore(n));
    return { t, stores, db };
  });
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function idbGetAll(store) {
  const { stores } = await tx(store, 'readonly');
  return wrap(stores[0].getAll());
}

export async function idbGet(store, key) {
  const { stores } = await tx(store, 'readonly');
  return wrap(stores[0].get(key));
}

export async function idbPut(store, value) {
  const { stores } = await tx(store, 'readwrite');
  return wrap(stores[0].put(value));
}

export async function idbDelete(store, key) {
  const { stores } = await tx(store, 'readwrite');
  return wrap(stores[0].delete(key));
}

export async function idbIndexAll(store, indexName, value) {
  const { stores } = await tx(store, 'readonly');
  return wrap(stores[0].index(indexName).getAll(value));
}

export async function idbCount(store) {
  const { stores } = await tx(store, 'readonly');
  return wrap(stores[0].count());
}
