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

export const SAVE_VERSION = 39 as const;

/**
 * THE VERSION AT WHICH THE GENERATED ISLAND'S GROUND MOVED.
 *
 * A save is `(island, seed, size, build-out)` and the town is REBUILT from it,
 * so anything that changes what a seed produces changes the ground under a
 * campaign's deeds. v39 is the plat overhaul, and it moves nearly every lot
 * line in the town:
 *
 *   · A wedge where two surveys or a boulevard met used to be shredded into
 *     slivers. A stakeable one is now ONE flatiron lot that always builds;
 *     an unstakeable one is a paved gore, the way a traffic island is paved.
 *   · The splitter refuses cuts that would leave a lot under eight metres
 *     wide, and folds sub-minimum scraps into the neighbour they share their
 *     longest line with.
 *   · An edge fronting a boulevard reservation pays that clearance once,
 *     not a second street width on top of it — about thirty lots an island
 *     that were being erased by a double charge.
 *   · Creeks bend. The path-tracer preferred the wiggle it had already
 *     drawn, and the ribbon painter could not draw a curve at all without
 *     self-intersecting on the inner bank; both are fixed, so a brook is a
 *     brook and stops slicing the trading floor in half.
 *   · Boulevard reservations are two carriageways around planted ground
 *     rather than one field of asphalt, and a radial circus is turfed.
 *
 * v38 recut the creek centreline and the park programme. A save stamped 38
 * still stands on that plat: opening it here would put every surviving BBL
 * on different ground.
 */
const ISLAND_GROUND_MOVED_AT = 39;
const PROCEDURAL_ISLAND = "somewhere";   // citygen's PROCEDURAL, not imported: engine does not depend on citygen
const LEGACY_DRAWN_ISLANDS = new Set(["newalden", "kestrel"]);

/**
 * THE GROUND MOVES PER ISLAND, NOT ONCE FOR THE WHOLE GAME.
 *
 * The gate above was written when there was one island, so it asks
 * `cityIsland === PROCEDURAL_ISLAND` — and that made it unreachable for any
 * second city. A save stamped `manhattan` at any stale version took the
 * "ground did not move" branch, was bumped silently to current, and passed.
 * The first time a Manhattan coast vertex or block pitch changed, that is
 * exactly the corruption `5660e0e` measured on the generated island: about 30%
 * of deeds vanish outright, about 70% survive by BBL, and of those 99% are on
 * DIFFERENT GROUND — same lot number, different parcel, different size,
 * somewhere else entirely — and the campaign opens without a word.
 *
 * So each island carries its own watermark: the SAVE_VERSION at which that
 * island's plat last moved. A save is refused when it predates its own island's
 * watermark, and an island absent from the table has never moved its ground.
 * Add a row the moment you change a coastline, a pitch, a bearing or a
 * partition — the whole point is that this is edited in the same commit as the
 * geometry, not afterwards when somebody notices.
 */
const GROUND_MOVED_AT: Record<string, number> = {
  [PROCEDURAL_ISLAND]: ISLAND_GROUND_MOVED_AT,
  // MANHATTAN ARRIVES AT 39 and its ground has not moved since, because 39 is
  // the version it was born at — no Manhattan save can predate its own island.
  // SAVE_VERSION does NOT move for it: a new city is additive, the generated
  // island's plat is untouched (proved by hashing the parcel table), and the one
  // new field on the save is optional. Bumping would refuse every live campaign
  // to add a city none of them is on.
  //
  // WHEN MANHATTAN'S PLAT DOES MOVE — a nudged coast vertex, a changed pitch or
  // bearing, a re-cut partition — bump SAVE_VERSION and set this to the new
  // number IN THE SAME COMMIT. That is the whole contract, and the reason this
  // table exists instead of one global constant.
  manhattan: 39,
};

/**
 * The islands this build can actually construct. Kept here rather than imported
 * from citygen for the same reason PROCEDURAL_ISLAND is: the engine does not
 * depend on the generator.
 */
const KNOWN_ISLANDS = new Set([PROCEDURAL_ISLAND, "manhattan"]);

/** Did this save predate the plat its own island now stands on? */
function groundMovedUnder(state: { v?: unknown; cityIsland?: string }): boolean {
  const mark = GROUND_MOVED_AT[state.cityIsland ?? PROCEDURAL_ISLAND];
  return mark !== undefined && typeof state.v === "number" && state.v < mark;
}

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
  // The Principal: one Person type, peopleRng, drop free style dials.
  // ensurePeople synthesises a principal and rival faces from peopleRng only;
  // s.rng / staffRng step counts are untouched (BASELINE must stay bit-identical).
  clearStyleOverrides(state);
  ensurePeople(state);
  // Floorplate inventory (LEASING_OVERHAUL Phase 1): Tenant.floorLo/floorHi
  // and Holding.blocks are optional. Old saves stamp lazily on first
  // blocksOf / assignTenantFloors — largest tenant, lowest floor, stable by
  // index, no RNG. Do not bump SAVE_VERSION for this.
  // Older campaigns bump forward once shape migrations have run — EXCEPT
  // across a break the migration cannot repair. This is the "future hard
  // break" the note above anticipated: no rearrangement of the save's fields
  // can put a deed back on ground the generator no longer cuts, so the save is
  // left at its own version and the gate below refuses it. Refusing a campaign
  // is bad; opening one whose every deed points somewhere else is worse, and
  // it is worse quietly.
  //
  // The bump is CONDITIONAL and must stay conditional — an unconditional
  // `state.v = SAVE_VERSION` after this block would make the gate below
  // unreachable and quietly restore the corruption.
  if (typeof state.v === "number" && state.v < SAVE_VERSION) {
    if (!groundMovedUnder(state)) state.v = SAVE_VERSION;
  } else {
    state.v = SAVE_VERSION;
  }
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
  if (migrated.cityIsland && LEGACY_DRAWN_ISLANDS.has(migrated.cityIsland)) {
    return {
      ok: false,
      reason: "this campaign was on a hand-drawn island that is no longer in the game — start a new run on a generated town",
    };
  }
  if (migrated.v !== SAVE_VERSION) {
    // Say WHICH kind of stale it is. "Older build" sends somebody looking for
    // a bug in the save format; the truth is that the island itself is cut
    // differently now and the deeds no longer describe real ground.
    return {
      ok: false,
      reason: groundMovedUnder(migrated)
        ? "this campaign's island was drawn by an older map generator, and its deeds no longer match the ground"
        : "unsupported save version",
    };
  }
  if (migrated.citySeed === undefined) {
    return { ok: false, reason: "save has no city seed" };
  }
  // AN ISLAND THIS BUILD DOES NOT HAVE is a refusal, not a crash. Without this
  // rung a save naming a city added after the build sailed through every check
  // and then threw inside makeCity, which the store surfaces as "The city would
  // not build. This is a bug — please report it." It is not a bug and it is not
  // the player's fault; it is a newer save than the build.
  if (migrated.cityIsland && !KNOWN_ISLANDS.has(migrated.cityIsland)) {
    return {
      ok: false,
      reason: `this campaign is on ${migrated.cityIsland}, which this build does not have — it was saved by a newer version`,
    };
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
