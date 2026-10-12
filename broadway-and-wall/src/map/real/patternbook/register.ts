// Wires every BookEntry into the pattern book's tables. Imported once, for its
// side effects, by RealCity before any family is built. Fails loudly at load
// on a malformed entry: a family that cannot be drawn should not ship quietly.
import {
  FAMILY_SPECS, VARIANTS, TINTS, FLAT_ROOFED, PALETTES, LIKE, STYLE_OF, COUSINS,
  TOWER_FAMS, GLASSY, WALKUP, TANK_FAMS, STONE_TOWER, RUSTIC_BASE, BAY_P, QUOIN_P,
} from "../facades";
import type { BookEntry, FacadeGroup } from "./types";
import { BOOK_STREET } from "./street";
import { BOOK_ORNAMENT } from "./ornament";
import { BOOK_WORKS } from "./works";
import { BOOK_GLASS } from "./glass";

export const BOOK: BookEntry[] = [...BOOK_STREET, ...BOOK_ORNAMENT, ...BOOK_WORKS, ...BOOK_GLASS];

/** What the Build desk lists for each book entry (RealCity appends these to FACADE_STYLES). */
export const BOOK_PICKER: { key: string; group: FacadeGroup; name: string; era: string; maxFloors: number; variants: string[] }[] = [];

const originals = new Set(FAMILY_SPECS.map((f) => f.key));
const seen = new Set<string>();
for (const e of BOOK) {
  const bad = (why: string) => { throw new Error(`pattern book: ${e.key}: ${why}`); };
  if (!/^[a-z][a-z0-9]*$/.test(e.key)) bad("key must be lowercase letters and digits");
  if (originals.has(e.key) || seen.has(e.key)) bad("duplicate key");
  if (!originals.has(e.like)) bad(`like "${e.like}" is not an original family`);
  if (e.variants.length !== 3) bad("needs exactly three variants");
  if (e.picker.variants.length !== 4) bad("needs four elevation names");
  if (!e.tints.length) bad("needs at least one tint");
  if (!e.city.length) bad("never stands in town: give it a city entry");
  seen.add(e.key);

  FAMILY_SPECS.push({ ...e.spec, key: e.key });
  VARIANTS[e.key] = e.variants;
  TINTS[e.key] = e.tints;
  LIKE[e.key] = e.like;
  if (e.palette) PALETTES[e.key] = e.palette;
  else if (e.palette === null) PALETTES[e.key] = { paintP: 0, walls: [], trimP: 0, trims: [], accP: 0, accents: [] };
  if (e.style) STYLE_OF[e.key] = e.style;
  if (e.flatRoof) FLAT_ROOFED.add(e.key);
  for (const s of [TOWER_FAMS, GLASSY, WALKUP, TANK_FAMS, STONE_TOWER]) if (s.has(e.like)) s.add(e.key);
  for (const t of [RUSTIC_BASE, BAY_P, QUOIN_P]) if (t[e.like] !== undefined) t[e.key] = t[e.like];
  for (const c of e.city) {
    const parent = c.parent ?? e.like;
    if (!originals.has(parent)) bad(`city parent "${parent}" is not an original family`);
    const list = COUSINS.get(parent) ?? [];
    list.push({ key: e.key, share: c.share, from: c.from, to: c.to ?? 9999, minH: c.minH ?? 0, maxH: c.maxH ?? 9999, cls: c.cls });
    COUSINS.set(parent, list);
  }
  BOOK_PICKER.push({ key: e.key, ...e.picker });
}
// a parent keeps at least half its own draws however many cousins it gathers
for (const [, list] of COUSINS) {
  const tot = list.reduce((a, c) => a + c.share, 0);
  if (tot > 0.5) for (const c of list) c.share *= 0.5 / tot;
}
