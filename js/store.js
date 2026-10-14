// Persistance du fichier SQLite dans IndexedDB (survit aux rechargements de la page).
const DB_NAME = 'stockpilot';
const STORE = 'files';
const KEY = 'main.sqlite';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, op) {
  return open().then((idb) => new Promise((resolve, reject) => {
    const t = idb.transaction(STORE, mode);
    const req = op(t.objectStore(STORE));
    t.oncomplete = () => { idb.close(); resolve(req.result); };
    t.onerror = () => { idb.close(); reject(t.error); };
  }));
}

export async function load() {
  try {
    const bytes = await tx('readonly', (s) => s.get(KEY));
    return bytes ? new Uint8Array(bytes) : null;
  } catch {
    return null;
  }
}

export function save(bytes) {
  return tx('readwrite', (s) => s.put(bytes, KEY));
}

export function clear() {
  return tx('readwrite', (s) => s.delete(KEY)).catch(() => {});
}
