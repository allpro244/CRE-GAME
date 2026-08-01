import { create } from "zustand";
import type { Adjacency, DataManifest, ParcelTable } from "@/data/types";
import type { GameState } from "@/engine/types";
import { newGame, advanceQuarter, firstListings, portfolioQuarterlyCF } from "@/engine/sim";
import { buyListing, buyOffMarket, approachOwner, listForSale, delist, acceptSaleOffer, declineSaleOffer, startRenovation, setBroker, type BuyProduct } from "@/engine/actions";
import { respondLOI, type LOIAction } from "@/engine/leasing";
import { refinance, buyRateCap } from "@/engine/debt";
import { startDevelopment, startProgram, setStance } from "@/engine/dev";
import type { BuiltClass } from "@/engine/types";
import { netWorth } from "@/engine/value";
import { loadGame, saveGame } from "@/engine/save";

export type Lens = "none" | "land" | "demand";
export type Page = "none" | "portfolio" | "deals" | "market";

interface AppState {
  parcels: ParcelTable | null;
  bbls: string[];
  adjacency: Adjacency | null;
  manifest: DataManifest | null;
  game: GameState | null;
  selectedBBL: string | null;
  hoveredBBL: string | null;
  lens: Lens;
  page: Page;
  toast: { text: string; kind: "ok" | "err"; at: number } | null;
  fps: number;
  loadError: string | null;
  setData: (d: { parcels: ParcelTable; adjacency: Adjacency; manifest: DataManifest }) => void;
  select: (bbl: string | null) => void;
  hover: (bbl: string | null) => void;
  setLens: (l: Lens) => void;
  setPage: (p: Page) => void;
  setFps: (fps: number) => void;
  setLoadError: (e: string) => void;
  advance: () => void;
  buy: (bbl: string, product: BuyProduct) => void;
  buyOff: (bbl: string, product: BuyProduct) => void;
  approach: (bbl: string) => void;
  respondLoi: (id: number, action: LOIAction) => void;
  refi: (bbl: string, product: "fixed" | "float") => void;
  develop: (bbl: string, use: BuiltClass, farFrac: number, preLease?: boolean) => void;
  program: (bbl: string, id: string) => void;
  stance: (bbl: string, v: -1 | 0 | 1) => void;
  listSale: (bbl: string, ask: number) => void;
  delistSale: (bbl: string) => void;
  acceptOffer: (bbl: string, exchange?: boolean) => void;
  declineOffer: (bbl: string) => void;
  renovate: (bbl: string) => void;
  broker: (bbl: string, on: boolean) => void;
  rateCap: (bbl: string) => void;
  newRun: () => void;
}

function toast(text: string, kind: "ok" | "err" = "ok") {
  useStore.setState({ toast: { text, kind, at: Date.now() } });
}

async function persist(game: GameState) {
  try { await saveGame("auto", game); } catch { /* private-mode browsers: play on without saves */ }
}

export const useStore = create<AppState>((set, get) => ({
  parcels: null,
  bbls: [],
  adjacency: null,
  manifest: null,
  game: null,
  selectedBBL: null,
  hoveredBBL: null,
  lens: "none",
  page: "none",
  toast: null,
  fps: 0,
  loadError: null,
  setData: (d) => set({ ...d, bbls: Object.keys(d.parcels) }),
  select: (bbl) => set({ selectedBBL: bbl, page: bbl ? "none" : get().page }),
  hover: (bbl) => set({ hoveredBBL: bbl }),
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

  buy: (bbl, product) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = buyListing(game, parcels, bbl, product);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast("Deed recorded. The block knows your name now.");
    void persist(r.s);
  },

  buyOff: (bbl, product) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = buyOffMarket(game, parcels, bbl, product);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast("Off-market. Nobody saw it trade.");
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

  respondLoi: (id, action) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = respondLOI(game, parcels, id, action);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    if (r.msg) toast(r.msg);
    void persist(r.s);
  },

  refi: (bbl, product) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = refinance(game, parcels, bbl, product);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast("Repriced. New paper, new clock.");
    void persist(r.s);
  },

  develop: (bbl, use, farFrac, preLease) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = startDevelopment(game, parcels, bbl, use, farFrac, preLease);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast("Ground broken. Watch it rise.");
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

  listSale: (bbl, ask) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = listForSale(game, parcels, bbl, ask);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast("On the market. Now we wait.");
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

  newRun: () => {
    const { parcels, bbls } = get();
    if (!parcels) return;
    const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    const g = firstListings(newGame(seed, parcels), parcels, bbls);
    set({ game: g, selectedBBL: null, page: "none" });
    void persist(g);
  },
}));

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
  const base = import.meta.env.BASE_URL + "data/";
  try {
    const [parcels, adjacency, manifest] = await Promise.all([
      fetchGzJson(base + "parcels.json.gz"),
      fetchGzJson(base + "adjacency.json.gz"),
      fetch(base + "manifest.json").then((r) => { if (!r.ok) throw new Error(`manifest.json ${r.status}`); return r.json(); }),
    ]);
    useStore.getState().setData({ parcels, adjacency, manifest });
    // resume the autosave — unless it references parcels that no longer
    // exist (a save from a different city/dataset), in which case start over
    const saved = await loadGame("auto");
    const fitsCity = saved && saved.v === 6 &&
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
