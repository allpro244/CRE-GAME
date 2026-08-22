/**
 * Layer signatures for the dynamic skyline.
 *
 * Finished stock and live jobs are different pictures. A construction frame
 * grows every month (~0.3–3 m), and folding that height into one signature
 * used to rebuild every delivered tower too. Stock only changes when a
 * building is delivered, demolished, restyled, or wears opening bunting.
 *
 * @typedef {{
 *   bbl: string,
 *   cls: string,
 *   heightM: number,
 *   floors: number,
 *   construction: boolean,
 *   fresh?: boolean,
 *   styleOverride?: number,
 *   cov?: number,
 *   year?: number,
 * }} SkylineItem
 */

/** @param {SkylineItem[]} items */
export function playerSkylineLayerSig(items, construction) {
  const bits = [];
  for (const i of items) {
    if (!!i.construction !== construction) continue;
    bits.push(construction
      ? `${i.bbl}:${i.heightM.toFixed(1)}:${i.floors}:${i.cls}:${i.cov ?? ""}`
      : `${i.bbl}:${i.heightM.toFixed(2)}:${i.floors}:${i.cls}:${i.fresh ? "f" : ""}:${i.year ?? ""}:${i.cov ?? ""}:${i.styleOverride ?? ""}`);
  }
  return bits.join("|");
}
