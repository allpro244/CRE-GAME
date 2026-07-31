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

export async function loadData() {
  const base = import.meta.env.BASE_URL + "data/";
  try {
    const [parcels, adjacency, manifest] = await Promise.all([
      fetch(base + "parcels.json").then((r) => { if (!r.ok) throw new Error(`parcels.json ${r.status}`); return r.json(); }),
      fetch(base + "adjacency.json").then((r) => { if (!r.ok) throw new Error(`adjacency.json ${r.status}`); return r.json(); }),
      fetch(base + "manifest.json").then((r) => { if (!r.ok) throw new Error(`manifest.json ${r.status}`); return r.json(); }),
    ]);
    useStore.getState().setData({ parcels, adjacency, manifest });
  } catch (e) {
    useStore.getState().setLoadError(
      `Game data missing (${(e as Error).message}). Run: pnpm pipeline (real data) or pnpm pipeline:dev (offline dev data), then reload.`,
    );
  }
}
