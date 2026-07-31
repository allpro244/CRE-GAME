import { create } from "zustand";
import type { Adjacency, DataManifest, ParcelTable } from "@/data/types";

interface AppState {
  parcels: ParcelTable | null;
  adjacency: Adjacency | null;
  manifest: DataManifest | null;
  selectedBBL: string | null;
  hoveredBBL: string | null;
  fps: number;
  loadError: string | null;
  setData: (d: { parcels: ParcelTable; adjacency: Adjacency; manifest: DataManifest }) => void;
  select: (bbl: string | null) => void;
  hover: (bbl: string | null) => void;
  setFps: (fps: number) => void;
  setLoadError: (e: string) => void;
}

export const useStore = create<AppState>((set) => ({
  parcels: null,
  adjacency: null,
  manifest: null,
  selectedBBL: null,
  hoveredBBL: null,
  fps: 0,
  loadError: null,
  setData: (d) => set(d),
  select: (bbl) => set({ selectedBBL: bbl }),
  hover: (bbl) => set({ hoveredBBL: bbl }),
  setFps: (fps) => set({ fps }),
  setLoadError: (loadError) => set({ loadError }),
}));

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
  } catch (e) {
    useStore.getState().setLoadError(
      `Game data missing (${(e as Error).message}). Run: pnpm pipeline (real data) or pnpm pipeline:dev (offline dev data), then reload.`,
    );
  }
}
