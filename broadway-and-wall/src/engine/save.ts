// IndexedDB saves: an autosave written every quarter plus named slots.
// A save is just the GameState — parcels/adjacency are static data.
import type { GameState } from "./types";

const DB = "broadway-and-wall";
const STORE = "saves";

export interface SaveMeta { slot: string; quarter: number; cash: number; savedAt: number }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  });
}

export async function saveGame(slot: string, state: GameState): Promise<void> {
  await tx("readwrite", (s) => s.put({ state, savedAt: Date.now() }, slot));
}

export async function loadGame(slot: string): Promise<GameState | null> {
  try {
    const rec = await tx<{ state: GameState } | undefined>("readonly", (s) => s.get(slot) as IDBRequest<{ state: GameState } | undefined>);
    return rec?.state ?? null;
  } catch {
    return null;
  }
}

export async function listSaves(): Promise<SaveMeta[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, "readonly");
      const store = t.objectStore(STORE);
      const metas: SaveMeta[] = [];
      const req = store.openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) { resolve(metas); db.close(); return; }
        const v = cur.value as { state: GameState; savedAt: number };
        metas.push({ slot: String(cur.key), quarter: v.state.quarter, cash: v.state.cash, savedAt: v.savedAt });
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function deleteSave(slot: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(slot));
}
