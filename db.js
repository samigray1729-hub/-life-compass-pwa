"use strict";

const LifeDB = (() => {
  const DB_NAME = "life-compass";
  const DB_VERSION = 2;
  const STORES = ["gauges", "progress", "todos", "notes", "goalBooks"];
  let connection;

  function open() {
    if (connection) return connection;
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("gauges")) db.createObjectStore("gauges", { keyPath: "id" });
        if (!db.objectStoreNames.contains("progress")) {
          const store = db.createObjectStore("progress", { keyPath: "id" });
          store.createIndex("gaugeId", "gaugeId");
        }
        if (!db.objectStoreNames.contains("todos")) {
          const store = db.createObjectStore("todos", { keyPath: "id" });
          store.createIndex("date", "date");
        }
        if (!db.objectStoreNames.contains("notes")) db.createObjectStore("notes", { keyPath: "id" });
        if (!db.objectStoreNames.contains("goalBooks")) db.createObjectStore("goalBooks", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return connection;
  }

  async function request(storeName, mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const result = action(tx.objectStore(storeName));
      result.onsuccess = () => resolve(result.result);
      result.onerror = () => reject(result.error);
    });
  }

  const all = store => request(store, "readonly", s => s.getAll());
  const put = (store, value) => request(store, "readwrite", s => s.put(value));
  const remove = (store, key) => request(store, "readwrite", s => s.delete(key));
  const clear = store => request(store, "readwrite", s => s.clear());

  async function replaceAll(data) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES, "readwrite");
      STORES.forEach(name => {
        const store = tx.objectStore(name);
        store.clear();
        (data[name] || []).forEach(item => store.put(item));
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  return { STORES, open, all, put, remove, clear, replaceAll };
})();
