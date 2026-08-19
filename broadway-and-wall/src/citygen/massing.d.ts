// The generator is plain .mjs so that `pipeline/*.mjs` and the browser run the
// same code. This is the shape the renderer sees when it asks the generator for
// a silhouette.
declare module "@/citygen/massing.mjs" {
  export type Ring = [number, number][];
  export interface MassingTier {
    /** Metre ring. Identity-equal to the input ring when the tier is the whole footprint. */
    ring: Ring;
    base: number;
    top: number;
  }
  export interface MassingIn {
    /** The footprint in metres, open (no repeated last vertex). */
    ring: Ring;
    /** The deed in metres — only the two families that oversail at grade use it. */
    lotRing?: Ring | null;
    hM: number;
    year: number;
    klass: string;
    /** A stable [0,1) per building per question. Never Math.random. */
    u: (k: number) => number;
    /** An explicit shortlist, tried in hash order, instead of the era-and-lot pool. */
    families?: string[] | null;
  }
  export function massingStack(o: MassingIn): { name: string; tiers: MassingTier[] } | null;
  /** The families whose recipes cut the plan up rather than stepping one plate. */
  export const PLAN: Set<string>;
}
