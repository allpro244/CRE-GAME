/**
 * Written into the UI so a downloaded build can prove which tip it is.
 *
 * `commit` is a hand-set SLUG, not a sha, and it has to be: this is committed
 * source, so it cannot contain the hash of the commit that contains it. Move it
 * whenever the playable is refreshed for a new body of work, and make it say
 * what changed — a stamp reading `procedural-only` on a build whose headline
 * feature is Manhattan identifies nothing, which is exactly what it did.
 *
 * `rentBaseOffice` must equal RENT_BASE.office in engine/market.ts. It is here
 * so the footer can prove the economy in the download is the economy you think
 * it is; a stamp that drifts from the constant is worse than no stamp.
 */
export const BUILD_STAMP = {
  commit: "manhattan-deco",
  label: "nyc-artdeco-harbour",
  rentBaseOffice: 35.5,
} as const;
