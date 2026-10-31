import type { ParcelRecord } from "@/data/types";
import type { GameState } from "./types";

/**
 * The grocer's sales reader (towngrowth.ts grocerSales), handed in by
 * towngrowth when it loads: value.ts importing towngrowth would close a module
 * cycle through dev.ts whose top-level constants then initialise out of order.
 * It lives in this leaf module (type imports only) so it exists before either
 * side runs: defined in value.ts, the browser bundle reached towngrowth's
 * assignment first and the game crashed on load (3a1da0c → #557).
 */
export const GROCER_SALES: { read?: (s: GameState, parcels: Record<string, ParcelRecord>, bbl: string) => number | undefined } = {};
