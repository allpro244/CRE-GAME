// Building forms a player can choose (citygen/forms.mjs, FORMS_PLAN.md).
declare module "@/citygen/forms.mjs" {
  import type { MassingTier, Ring } from "@/citygen/massing.mjs";
  export interface PlayerForm { key: string; family: string; name: string; blurb: string; minFloors: number }
  export const PLAYER_FORMS: PlayerForm[];
  export interface FormIn { bbl: string; footprint: Ring; lotRing: Ring | null; hM: number; year: number; klass: string }
  export function formTiers(o: FormIn & { form: string }): MassingTier[] | null;
  export function formMetrics(footprint: Ring, tiers: MassingTier[], hM: number): { retained: number; skin: number };
  export function formsFor(o: FormIn & { floors: number }): (PlayerForm & { tiers: MassingTier[]; retained: number; skin: number })[];
}
