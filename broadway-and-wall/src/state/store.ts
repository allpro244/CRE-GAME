import { create } from "zustand";
import type { Adjacency, DataManifest, ParcelTable } from "@/data/types";
import type { GameState, Contract, DevUse } from "@/engine/types";
import { newGame, advanceQuarter, advanceUntilAttention, firstListings, portfolioQuarterlyCF } from "@/engine/sim";
import { buyListing, buyOffMarket, approachOwner, counterOffMarket, listForSale, delist, acceptSaleOffer, declineSaleOffer, counterSale, startRenovation,  setBroker, assembleLots, grantGroundLease, bestAndFinal, acceptBid, type BuyProduct } from "@/engine/actions";
import { negotiate, acceptCounter, walkAway, closeDeal } from "@/engine/acquire";
import { respondLOI, buildSpecSuites, blendExtend, type LOIAction } from "@/engine/leasing";
import { recapitalise } from "@/engine/equity";
import { setInsurance } from "@/engine/peril";
import { fileVariance } from "@/engine/zoning";
import { refinance, buyRateCap } from "@/engine/debt";
import { drawLoc, repayLoc } from "@/engine/credit";
import { startDevelopment, startProgram, setStance, demolish } from "@/engine/dev";
import { normalizeParcels } from "@/engine/mix";
import { netWorth } from "@/engine/value";
import { loadGame, saveGame, listSaves, deleteSave, type SaveMeta } from "@/engine/save";
import { currentCity, dataBase } from "@/state/city";

export type Lens = "none" | "land" | "demand" | "owners";
export type Page = "none" | "portfolio" | "deals" | "market" | "research" | "economy" | "books" | "leasing" | "property" | "saves";

interface AppState {
  parcels: ParcelTable | null;
  bbls: string[];
  adjacency: Adjacency | null;
  manifest: DataManifest | null;
  game: GameState | null;
  selectedBBL: string | null;
  hoveredBBL: string | null;
  // A standing request to put the camera on a parcel. The counter is what makes
  // it fire — asking twice for the same building has to move the map twice, and
  // a bare bbl compares equal to itself.
  flyTo: { bbl: string; n: number } | null;
  lens: Lens;
  page: Page;
  toast: { text: string; kind: "ok" | "err"; at: number } | null;
  fps: number;
  loadError: string | null;
  setData: (d: { parcels: ParcelTable; adjacency: Adjacency; manifest: DataManifest }) => void;
  select: (bbl: string | null) => void;
  hover: (bbl: string | null) => void;
  /** Select it AND take the camera there. */
  focus: (bbl: string, closePanel?: boolean) => void;
  setLens: (l: Lens) => void;
  setPage: (p: Page) => void;
  setFps: (fps: number) => void;
  setLoadError: (e: string) => void;
  advance: () => void;
  advanceYear: () => void;
  advanceUntil: () => void;
  counterOff: (bbl: string, px?: number) => void;
  buy: (bbl: string, product: BuyProduct, lev?: number, bid?: number) => void;
  buyOff: (bbl: string, product: BuyProduct, lev?: number, bid?: number) => void;
  approach: (bbl: string) => void;
  respondLoi: (id: number, action: LOIAction, fund?: boolean, counter?: { rentPsf?: number; tiPsf?: number }) => void;
  refi: (bbl: string, product: string, lev?: number) => void;
  develop: (bbl: string, use: DevUse, floors: number, coverage: number, contract: Contract, ltcWanted?: number) => void;
  offer: (bbl: string, price: number) => void;
  closeDeal: (product: string, lev: number) => void;
  acceptCounter: () => void;
  walkAway: () => void;
  raze: (bbl: string) => void;
  program: (bbl: string, id: string) => void;
  stance: (bbl: string, v: -1 | 0 | 1) => void;
  listSale: (bbl: string, ask: number, mode?: "quiet" | "marketed") => void;
  runBestAndFinal: (bbl: string) => void;
  takeBid: (bbl: string, index: number) => void;
  raiseEquity: (bbl: string, share: number) => void;
  applyVariance: (bbl: string) => void;
  bindInsurance: (deductiblePct: number, flood: boolean) => void;
  prebuild: (bbl: string, use: string, sf: number) => void;
  extendLease: (bbl: string, idx: number) => void;
  assemble: (bbls: string[]) => void;
  groundLease: (bbl: string, years: number) => void;
  delistSale: (bbl: string) => void;
  acceptOffer: (bbl: string, exchange?: boolean) => void;
  declineOffer: (bbl: string) => void;
  counterSale: (bbl: string, price: number) => void;
  renovate: (bbl: string) => void;
  broker: (bbl: string, on: boolean) => void;
  rateCap: (bbl: string) => void;
  setAgent: (on: boolean) => void;
  drawCredit: (amt: number) => void;
  repayCredit: (amt: number) => void;
  newRun: () => void;
  devGrant: () => void;
  saveTo: (slot: string) => Promise<void>;
  loadFrom: (slot: string) => Promise<void>;
  dropSave: (slot: string) => Promise<void>;
  slots: SaveMeta[];
  refreshSlots: () => Promise<void>;
}

function toast(text: string, kind: "ok" | "err" = "ok") {
  useStore.setState({ toast: { text, kind, at: Date.now() } });
}

// Every city keeps its own autosave, so switching cities never clobbers the
// campaign you were running in the other one.
const AUTO = () => "auto@" + currentCity();
async function persist(game: GameState) {
  try { await saveGame(AUTO(), game); } catch { /* private-mode browsers: play on without saves */ }
}

export const useStore = create<AppState>((set, get) => ({
  parcels: null,
  bbls: [],
  adjacency: null,
  manifest: null,
  game: null,
  selectedBBL: null,
  hoveredBBL: null,
  flyTo: null,
  lens: "none",
  page: "none",
  toast: null,
  fps: 0,
  loadError: null,
  slots: [],
  setData: (d) => set({ ...d, bbls: Object.keys(d.parcels) }),
  select: (bbl) => set({ selectedBBL: bbl, page: bbl && get().page !== "property" ? "none" : get().page }),
  hover: (bbl) => set({ hoveredBBL: bbl }),
  // Reading about a building and finding it are two different things, and a
  // list of addresses in a panel is not a place. Every row that names a
  // property can put the camera on it.
  focus: (bbl, closePanel = false) => set((st) => ({
    selectedBBL: bbl,
    flyTo: { bbl, n: (st.flyTo?.n ?? 0) + 1 },
    ...(closePanel ? { page: "none" as Page } : {}),
  })),
  setLens: (lens) => set({ lens }),
  setPage: (page) => set({ page }),
  setFps: (fps) => set({ fps }),
  setLoadError: (loadError) => set({ loadError }),

  advance: () => {
    const { game, parcels, bbls, adjacency } = get();
    if (!game || !parcels || game.gameOver) return;
    const next = advanceQuarter(game, parcels, bbls, adjacency);
    set({ game: next });
    void persist(next);
  },

  // A year in one click — but stop early the moment something new needs you.
  advanceYear: () => {
    const { game, parcels, bbls, adjacency } = get();
    if (!game || !parcels || game.gameOver) return;
    const r = advanceUntilAttention(game, parcels, bbls, adjacency, 12);
    set({ game: r.s });
    toast(r.reason ? `Stopped after ${r.months} mo: ${r.reason}` : "A year passes.");
    void persist(r.s);
  },

  // Skip ahead until the game needs a decision (up to 3 years).
  advanceUntil: () => {
    const { game, parcels, bbls, adjacency } = get();
    if (!game || !parcels || game.gameOver) return;
    const r = advanceUntilAttention(game, parcels, bbls, adjacency, 36);
    set({ game: r.s });
    toast(r.reason ? `${r.months} mo later: ${r.reason}` : "Three quiet years. New Alden hums along.");
    void persist(r.s);
  },

  counterOff: (bbl, px) => {
    const { game, parcels, adjacency } = get();
    if (!game || !parcels || !adjacency) return;
    const r = counterOffMarket(game, parcels, adjacency, bbl, px);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    if (r.msg) toast(r.msg);
    void persist(r.s);
  },

  buy: (bbl, product, lev, bid) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = buyListing(game, parcels, bbl, product, lev, bid);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "Deed recorded. The block knows your name now.");
    void persist(r.s);
  },

  buyOff: (bbl, product, lev, bid) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = buyOffMarket(game, parcels, bbl, product, lev, bid);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "Off-market. Nobody saw it trade.");
    void persist(r.s);
  },

  approach: (bbl) => {
    const { game, parcels, adjacency } = get();
    if (!game || !parcels || !adjacency) return;
    const r = approachOwner(game, parcels, adjacency, bbl);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.refused ? "The owner isn't selling." : "They named a number.", r.refused ? "err" : "ok");
    void persist(r.s);
  },

  respondLoi: (id, action, fund, counter) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = respondLOI(game, parcels, id, action, fund, counter);
    // An error can still carry a new state — a counter the tenant took but you
    // could not fund kills the deal, and that has to stick.
    if (r.err) { toast(r.err, "err"); if (r.s !== game) { set({ game: r.s }); void persist(r.s); } return; }
    set({ game: r.s });
    if (r.msg) toast(r.msg);
    void persist(r.s);
  },

  refi: (bbl, product, lev) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = refinance(game, parcels, bbl, product, lev);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast("Repriced. New paper, new clock.");
    void persist(r.s);
  },

  develop: (bbl, use, floors, coverage, contract, ltcWanted) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = startDevelopment(game, parcels, bbl, use, floors, coverage, contract, ltcWanted);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast("Ground broken. Watch it rise.");
    void persist(r.s);
  },

  // Buying is a conversation now: the same call opens it and answers their
  // counter, which is why there is one action and not three. It never asks for
  // a lender — agreeing a price and funding the purchase are separate acts.
  offer: (bbl, price) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = negotiate(game, parcels, bbl, price);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s }); void persist(r.s);
    if (r.msg) toast(r.msg);
  },

  closeDeal: (product, lev) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = closeDeal(game, parcels, product, lev);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s }); void persist(r.s);
    toast(r.msg ?? "Closed. The deed is yours.");
  },

  acceptCounter: () => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = acceptCounter(game, parcels);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s }); void persist(r.s);
    if (r.msg) toast(r.msg);
  },

  walkAway: () => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = walkAway(game, parcels);
    set({ game: r.s }); void persist(r.s);
    if (r.msg) toast(r.msg);
  },
  raze: (bbl) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = demolish(game, parcels, bbl);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast("Down it comes.");
    void persist(r.s);
  },

  program: (bbl, id) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = startProgram(game, parcels, bbl, id);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast("Program funded.");
    void persist(r.s);
  },

  stance: (bbl, v) => {
    const { game } = get();
    if (!game) return;
    const next = setStance(game, bbl, v);
    set({ game: next });
    void persist(next);
  },

  listSale: (bbl, ask, mode = "quiet") => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = listForSale(game, parcels, bbl, ask, mode);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(mode === "marketed" ? "Campaign under way. Offers are due on the date." : "On the market. Now we wait.");
    void persist(r.s);
  },

  runBestAndFinal: (bbl) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = bestAndFinal(game, parcels, bbl);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "Bids refreshed.");
    void persist(r.s);
  },

  takeBid: (bbl, index) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = acceptBid(game, parcels, bbl, index);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "Under contract.", r.msg === "They retraded you." ? "err" : undefined);
    void persist(r.s);
  },

  raiseEquity: (bbl, share) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = recapitalise(game, parcels, bbl, share);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "Partner in.");
    void persist(r.s);
  },

  prebuild: (bbl, use, sf) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = buildSpecSuites(game, parcels, bbl, use as never, sf);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "Pre-build under way.");
    void persist(r.s);
  },

  extendLease: (bbl, idx) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = blendExtend(game, parcels, bbl, idx);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "Extended.");
    void persist(r.s);
  },

  bindInsurance: (deductiblePct, flood) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = setInsurance(game, parcels, deductiblePct, flood);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "Bound.");
    void persist(r.s);
  },

  applyVariance: (bbl) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = fileVariance(game, parcels, bbl);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "Filed.");
    void persist(r.s);
  },

  assemble: (bbls) => {
    const { game, parcels, adjacency } = get();
    if (!game || !parcels || !adjacency) return;
    const r = assembleLots(game, parcels, adjacency, bbls);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "Assembled.");
    void persist(r.s);
  },

  groundLease: (bbl, years) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = grantGroundLease(game, parcels, bbl, years);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "Ground-leased.");
    void persist(r.s);
  },

  delistSale: (bbl) => {
    const { game } = get();
    if (!game) return;
    const next = delist(game, bbl);
    set({ game: next });
    toast("Pulled from the market.");
    void persist(next);
  },

  acceptOffer: (bbl, exchange) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = acceptSaleOffer(game, parcels, bbl, exchange);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(exchange ? "Closed — the 1031 clock is running." : "Closed. Cash is position.");
    void persist(r.s);
  },

  counterSale: (bbl, price) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = counterSale(game, parcels, bbl, price);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s }); void persist(r.s);
    if (r.msg) toast(r.msg);
  },

  declineOffer: (bbl) => {
    const { game } = get();
    if (!game) return;
    const next = declineSaleOffer(game, bbl);
    set({ game: next });
    toast("Passed. The ask stands.");
    void persist(next);
  },

  renovate: (bbl) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = startRenovation(game, parcels, bbl);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast("Crews mobilized.");
    void persist(r.s);
  },

  broker: (bbl, on) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = setBroker(game, parcels, bbl, on);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(on ? "Exclusive signed." : "Broker dismissed.");
    void persist(r.s);
  },

  rateCap: (bbl) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = buyRateCap(game, parcels, bbl);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast("Capped. Sleep better.");
    void persist(r.s);
  },

  setAgent: (on) => {
    const { game } = get();
    if (!game) return;
    const next = { ...game, agent: on };
    set({ game: next });
    toast(on ? "Your agent has the book. 6% on everything they sign." : "You're handling leasing yourself again.");
    void persist(next);
  },

  drawCredit: (amt) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = drawLoc(game, parcels, amt);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast("Drawn. The meter is running.");
    void persist(r.s);
  },

  repayCredit: (amt) => {
    const { game } = get();
    if (!game) return;
    const r = repayLoc(game, amt);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast("Paid down.");
    void persist(r.s);
  },

  refreshSlots: async () => {
    const all = await listSaves();
    set({ slots: all.filter((m) => m.slot !== "auto" && !m.slot.startsWith("auto@")).sort((a, b) => b.savedAt - a.savedAt) });
  },

  saveTo: async (slot) => {
    const { game } = get();
    if (!game) return;
    await saveGame(slot, game);
    await get().refreshSlots();
    toast(`Saved to “${slot}”.`);
  },

  loadFrom: async (slot) => {
    const { parcels } = get();
    const saved = await loadGame(slot);
    if (!saved || !parcels) { toast("That save wouldn't open.", "err"); return; }
    const fits = saved.v === 20 &&
      Object.keys(saved.holdings).every((b) => parcels[b]) &&
      saved.listings.every((l) => parcels[l.bbl]);
    if (!fits) { toast("That save was made on a different city — it can't be loaded here.", "err"); return; }
    set({ game: saved, selectedBBL: null, page: "none" });
    void persist(saved);
    toast(`Loaded “${slot}”.`);
  },

  dropSave: async (slot) => {
    await deleteSave(slot);
    await get().refreshSlots();
    toast("Save deleted.");
  },

  // Testing money. Not a game mechanic — a debug lever, and it says so.
  devGrant: () => {
    const { game } = get();
    if (!game) return;
    const g: GameState = { ...game, cash: game.cash + 100_000_000 };
    g.news = [{ q: g.month, kind: "info", text: "DEV: $100.0M of testing capital wired in. This never happens in the real game." }, ...g.news];
    set({ game: g });
    void persist(g);
    toast("+$100M (testing).");
  },

  newRun: () => {
    const { parcels, bbls } = get();
    if (!parcels) return;
    const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    const g = firstListings(newGame(seed, parcels), parcels, bbls);
    set({ game: g, selectedBBL: null, page: "none" });
    void persist(g);
  },
}));

// handle for automated playtests and screenshots, same as window.__map
(window as unknown as { __store?: typeof useStore }).__store = useStore;


export function derivedNetWorth(): number {
  const { game, parcels } = useStore.getState();
  if (!game || !parcels) return 0;
  return netWorth(game, parcels);
}

export function derivedQuarterCF(): number {
  const { game, parcels } = useStore.getState();
  if (!game || !parcels) return 0;
  return portfolioQuarterlyCF(game, parcels);
}

export async function fetchGzJson(url: string) {
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`${url.split("/").pop()} ${r.status}`);
  const buf = await r.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Response(buf).body!.pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).json();
  }
  // some hosts transparently decode .gz via Content-Encoding — already JSON
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function loadData() {
  const base = dataBase();
  try {
    const [parcels, adjacency, manifest] = await Promise.all([
      fetchGzJson(base + "parcels.json.gz"),
      fetchGzJson(base + "adjacency.json.gz"),
      fetch(base + "manifest.json").then((r) => { if (!r.ok) throw new Error(`manifest.json ${r.status}`); return r.json(); }),
    ]);
    // Any record the pipeline still files as "mixed" becomes its dominant use
    // plus an explicit mix, once, at the door — so no downstream table lookup
    // has to know that legacy class ever existed.
    useStore.getState().setData({ parcels: normalizeParcels(parcels), adjacency, manifest });
    // resume the autosave — unless it references parcels that no longer
    // exist (a save from a different city/dataset), in which case start over
    // migration: pre-city saves lived in a flat "auto" slot
    const saved = (await loadGame(AUTO())) ?? (await loadGame("auto"));
    const fitsCity = saved && saved.v === 20 &&
      Object.keys(saved.holdings).every((b) => parcels[b]) &&
      saved.listings.every((l) => parcels[l.bbl]);
    if (fitsCity) {
      useStore.setState({ game: saved });
    } else {
      useStore.getState().newRun();
    }
  } catch (e) {
    useStore.getState().setLoadError(
      `Game data missing (${(e as Error).message}). Run: pnpm pipeline (real data) or pnpm pipeline:dev (offline dev data), then reload.`,
    );
  }
}
