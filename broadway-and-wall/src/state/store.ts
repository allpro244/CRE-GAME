import { create } from "zustand";
import type { Adjacency, DataManifest, ParcelTable } from "@/data/types";
import type { GameState } from "@/engine/types";
import { newGame, advanceQuarter, firstListings, portfolioQuarterlyCF } from "@/engine/sim";
import { buyListing, sellHolding, startRenovation } from "@/engine/actions";
import { netWorth } from "@/engine/value";
import { loadGame, saveGame } from "@/engine/save";

export type Lens = "none" | "land" | "demand";
export type Tab = "parcel" | "portfolio" | "market";

interface AppState {
  parcels: ParcelTable | null;
  bbls: string[];
  adjacency: Adjacency | null;
  manifest: DataManifest | null;
  game: GameState | null;
  selectedBBL: string | null;
  hoveredBBL: string | null;
  lens: Lens;
  tab: Tab;
  toast: { text: string; kind: "ok" | "err"; at: number } | null;
  fps: number;
  loadError: string | null;
  setData: (d: { parcels: ParcelTable; adjacency: Adjacency; manifest: DataManifest }) => void;
  select: (bbl: string | null) => void;
  hover: (bbl: string | null) => void;
  setLens: (l: Lens) => void;
  setTab: (t: Tab) => void;
  setFps: (fps: number) => void;
  setLoadError: (e: string) => void;
  advance: () => void;
  buy: (bbl: string, financed: boolean) => void;
  sell: (bbl: string) => void;
  renovate: (bbl: string) => void;
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
  tab: "market",
  toast: null,
  fps: 0,
  loadError: null,
  setData: (d) => set({ ...d, bbls: Object.keys(d.parcels) }),
  select: (bbl) => set({ selectedBBL: bbl, tab: bbl ? "parcel" : get().tab }),
  hover: (bbl) => set({ hoveredBBL: bbl }),
  setLens: (lens) => set({ lens }),
  setTab: (tab) => set({ tab }),
  setFps: (fps) => set({ fps }),
  setLoadError: (loadError) => set({ loadError }),

  advance: () => {
    const { game, parcels, bbls } = get();
    if (!game || !parcels || game.gameOver) return;
    const next = advanceQuarter(game, parcels, bbls);
    set({ game: next });
    void persist(next);
  },

  buy: (bbl, financed) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = buyListing(game, parcels, bbl, financed);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast("Deed recorded. The block knows your name now.");
    void persist(r.s);
  },

  sell: (bbl) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = sellHolding(game, parcels, bbl);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast("Sold. Cash is position.");
    void persist(r.s);
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

  newRun: () => {
    const { parcels, bbls } = get();
    if (!parcels) return;
    const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    const g = firstListings(newGame(seed), parcels, bbls);
    set({ game: g, selectedBBL: null, tab: "market" });
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

async function fetchGzJson(url: string) {
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
    const fitsCity = saved && saved.v === 1 &&
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
