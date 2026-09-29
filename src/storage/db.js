// IndexedDB access (spec §9.1). A single database; the storage schema version is
// separate from the .pres format version (spec §9.9).
export const DB_NAME = 'presentation-editor';
export const STORAGE_VERSION = 1;

let dbPromise = null;
let onVersionChange = null;

export function setVersionChangeHandler(fn) {
  onVersionChange = fn;
}

function upgrade(db, oldVersion) {
  if (oldVersion < 1) {
    db.createObjectStore('presentations', { keyPath: 'id' });
    db.createObjectStore('documents', { keyPath: 'id' });
    const assets = db.createObjectStore('assets', { keyPath: ['presentation_id', 'asset_id'] });
    assets.createIndex('by_presentation', 'presentation_id');
    const snaps = db.createObjectStore('snapshots', { keyPath: 'id' });
    snaps.createIndex('by_presentation', 'presentation_id');
    db.createObjectStore('library', { keyPath: 'id' });
    db.createObjectStore('file_handles', { keyPath: 'id' });
    db.createObjectStore('editor_state', { keyPath: 'id' });
    db.createObjectStore('meta', { keyPath: 'key' });
  }
  // Future storage migrations go here: if (oldVersion < 2) { ... }
}

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser doesn’t support IndexedDB, so presentations can’t be stored.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, STORAGE_VERSION);
    req.onupgradeneeded = (e) => upgrade(req.result, e.oldVersion);
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        // A newer app version wants to upgrade storage (spec §9.9).
        try {
          onVersionChange?.();
        } finally {
          db.close();
          dbPromise = null;
        }
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Storage upgrade is blocked by another open tab. Close other tabs of this app and reload.'));
  });
  return dbPromise;
}

export function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

export async function tx(stores, mode, fn) {
  const db = await openDb();
  const t = db.transaction(stores, mode);
  const done = txDone(t);
  let result;
  try {
    result = await fn(t);
  } catch (e) {
    try {
      t.abort();
    } catch {
      /* already finished */
    }
    await done.catch(() => undefined);
    throw e;
  }
  await done;
  return result;
}

export async function get(store, key) {
  return tx([store], 'readonly', (t) => reqP(t.objectStore(store).get(key)));
}

export async function put(store, value) {
  return tx([store], 'readwrite', (t) => reqP(t.objectStore(store).put(value)));
}

export async function del(store, key) {
  return tx([store], 'readwrite', (t) => reqP(t.objectStore(store).delete(key)));
}

export async function getAll(store) {
  return tx([store], 'readonly', (t) => reqP(t.objectStore(store).getAll()));
}

export async function getAllByIndex(store, index, key) {
  return tx([store], 'readonly', (t) => reqP(t.objectStore(store).index(index).getAll(key)));
}

export function isQuotaError(e) {
  return e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''));
}
