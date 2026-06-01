/* ============================================================
   STORAGE — LocalStorage + IndexedDB wrapper
   ============================================================ */
'use strict';

const Storage = (() => {
  const LS_PREFIX = 'pdftoolbox_';

  // ---- LocalStorage helpers ----
  function lsGet(key, fallback = null) {
    try {
      const v = localStorage.getItem(LS_PREFIX + key);
      return v !== null ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); return true; }
    catch { return false; }
  }
  function lsDel(key) {
    try { localStorage.removeItem(LS_PREFIX + key); return true; }
    catch { return false; }
  }

  // ---- Settings ----
  function getSetting(key, fallback) { return lsGet('setting_' + key, fallback); }
  function setSetting(key, value) { return lsSet('setting_' + key, value); }

  // ---- Recent files (metadata only, not binary) ----
  const RECENT_MAX = 20;
  function getRecentFiles() { return lsGet('recent_files', []); }
  function addRecentFile(meta) {
    // meta: { id, name, size, pages, tool, date }
    let list = getRecentFiles().filter(f => f.id !== meta.id);
    list.unshift({ ...meta, date: Date.now() });
    if (list.length > RECENT_MAX) list = list.slice(0, RECENT_MAX);
    lsSet('recent_files', list);
  }
  function clearRecentFiles() { lsDel('recent_files'); }
  function removeRecentFile(id) {
    const list = getRecentFiles().filter(f => f.id !== id);
    lsSet('recent_files', list);
  }

  // ---- Operation history ----
  const HISTORY_MAX = 50;
  function getHistory() { return lsGet('history', []); }
  function addHistory(entry) {
    // entry: { id, op, input, output, size_before, size_after, date, status }
    let list = getHistory();
    list.unshift({ ...entry, id: Date.now(), date: Date.now() });
    if (list.length > HISTORY_MAX) list = list.slice(0, HISTORY_MAX);
    lsSet('history', list);
  }
  function clearHistory() { lsDel('history'); }

  // ---- Stats ----
  function getStats() {
    return lsGet('stats', {
      totalProcessed: 0,
      totalBytesSaved: 0,
      merges: 0, splits: 0, compressions: 0, conversions: 0,
      ocr: 0, signatures: 0, watermarks: 0
    });
  }
  function incrementStat(key, amount = 1) {
    const stats = getStats();
    stats[key] = (stats[key] || 0) + amount;
    lsSet('stats', stats);
  }

  // ---- Favorite tools ----
  function getFavorites() { return lsGet('favorites', ['merge','split','compress','convert']); }
  function setFavorites(list) { lsSet('favorites', list); }
  function toggleFavorite(tool) {
    let fav = getFavorites();
    if (fav.includes(tool)) fav = fav.filter(t => t !== tool);
    else fav.push(tool);
    setFavorites(fav);
    return fav;
  }

  // ---- IndexedDB for file blobs ----
  let _db = null;
  const DB_NAME = 'pdftoolbox_db';
  const DB_VERSION = 1;
  const STORE_FILES = 'files';
  const STORE_CACHE = 'cache';

  function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_FILES)) {
          db.createObjectStore(STORE_FILES, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_CACHE)) {
          db.createObjectStore(STORE_CACHE, { keyPath: 'key' });
        }
      };
    });
  }

  async function saveFile(id, blob, meta = {}) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_FILES, 'readwrite');
      const store = tx.objectStore(STORE_FILES);
      const record = { id, blob, ...meta, saved: Date.now() };
      const req = store.put(record);
      req.onsuccess = () => resolve(id);
      req.onerror = () => reject(req.error);
    });
  }

  async function getFile(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_FILES, 'readonly');
      const store = tx.objectStore(STORE_FILES);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteFile(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_FILES, 'readwrite');
      const store = tx.objectStore(STORE_FILES);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function listFiles() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_FILES, 'readonly');
      const store = tx.objectStore(STORE_FILES);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result.map(r => ({ id: r.id, name: r.name, size: r.size, saved: r.saved })));
      req.onerror = () => reject(req.error);
    });
  }

  async function clearAllFiles() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_FILES, 'readwrite');
      const store = tx.objectStore(STORE_FILES);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // Cache store
  async function cacheSet(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CACHE, 'readwrite');
      const store = tx.objectStore(STORE_CACHE);
      const req = store.put({ key, value, ts: Date.now() });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function cacheGet(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CACHE, 'readonly');
      const store = tx.objectStore(STORE_CACHE);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => reject(req.error);
    });
  }

  // Init DB on load
  openDB().catch(console.warn);

  return {
    // LocalStorage
    get: lsGet, set: lsSet, del: lsDel,
    getSetting, setSetting,
    // Recent files
    getRecentFiles, addRecentFile, clearRecentFiles, removeRecentFile,
    // History
    getHistory, addHistory, clearHistory,
    // Stats
    getStats, incrementStat,
    // Favorites
    getFavorites, setFavorites, toggleFavorite,
    // IndexedDB files
    saveFile, getFile, deleteFile, listFiles, clearAllFiles,
    // Cache
    cacheSet, cacheGet,
    // DB open
    openDB
  };
})();

window.Storage = Storage;
