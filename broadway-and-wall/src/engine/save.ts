// IndexedDB saves: named snapshots plus one debounced `auto` crash-protection
// slot. A save is just GameState — parcels/adjacency are deterministic city data.
import type { GameState } from "./types";
import { clearStyleOverrides, ensurePeople } from "./people";

const DB = "broadway-and-wall";
const STORE = "saves";

export interface SaveMeta { slot: string; month: number; cash: number; savedAt: number }

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

/**
 * A save written before extended paper had a field of its own. The date used to
 * be filed inside `heldSince` under an `ext|` prefix; it lives in `extendedTo`
 * now (see the note on `Rival`). Move what is still about a building the firm
 * owns, drop the rest — those were the leak, and a save is exactly where they
 * accumulated.
 */
function migrateExtendedPaper(state: GameState) {
  const EXT = "ext|";
  for (const r of state.rivals ?? []) {
    if (!r.heldSince) continue;
    const own = new Set(r.bbls ?? []);
    for (const k of Object.keys(r.heldSince)) {
      if (!k.startsWith(EXT)) continue;
      const bbl = k.slice(EXT.length);
      if (own.has(bbl)) (r.extendedTo ??= {})[bbl] = r.heldSince[k];
      delete r.heldSince[k];
    }
  }
}

export const SAVE_VERSION = 33 as const;

/** Pure save-shape migrations, also exported for a fast round-trip harness. */
export function migrateSaveState(state: GameState): GameState {
  migrateExtendedPaper(state);
  if (state.varianceApp) {
    state.varianceApps = {
      ...(state.varianceApps ?? {}),
      [state.varianceApp.bbl]: state.varianceApp,
    };
    delete state.varianceApp;
  }
  // v33 — The Principal: one Person type, peopleRng, drop free style dials.
  // ensurePeople synthesises a principal and rival faces from peopleRng only;
  // s.rng / staffRng step counts are untouched (BASELINE must stay bit-identical).
  clearStyleOverrides(state);
  ensurePeople(state);
  // Older campaigns bump forward once shape migrations have run. A future
  // hard break should refuse here rather than silently inventing fields.
  if (typeof state.v === "number" && state.v < SAVE_VERSION) {
    state.v = SAVE_VERSION;
  }
  state.v = SAVE_VERSION;
  return state;
}

/**
 * PURE CONTINUE PREP — migrate, version-gate, require a rebuildable town.
 * The store and the harness both call this so IndexedDB is not the only path
 * that proves a campaign can be resumed.
 */
export function prepareSaveForResume(state: GameState):
  { ok: true; state: GameState } | { ok: false; reason: string } {
  const migrated = migrateSaveState(structuredClone(state));
  if (migrated.v !== SAVE_VERSION) {
    return { ok: false, reason: "unsupported save version" };
  }
  if (migrated.citySeed === undefined) {
    return { ok: false, reason: "save has no city seed" };
  }
  return { ok: true, state: migrated };
}

export async function loadGame(slot: string): Promise<GameState | null> {
  try {
    const rec = await tx<{ state: GameState } | undefined>("readonly", (s) => s.get(slot) as IDBRequest<{ state: GameState } | undefined>);
    if (!rec?.state) return null;
    return migrateSaveState(rec.state);
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
        metas.push({ slot: String(cur.key), month: v.state.month, cash: v.state.cash, savedAt: v.savedAt });
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

/** Drop the whole save database — used when a new playable build lands so
 *  campaigns from a previous zip cannot resume against changed rules. */
export async function clearAllSaves(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("clearAllSaves failed"));
    // Another tab holding the DB open — treat as best-effort; boot continues.
    req.onblocked = () => resolve();
  });
}
