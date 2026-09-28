// WHICH USE A HARNESS BOT MAY BUILD ON A LOT: the first of its preferences the
// zoning hosts, asked with the engine's own rule (`zoneUseBar`, the one the
// land residual, the city, the rivals and the Develop desk all ask). A bot
// that wants "office" on an R lot builds flats there, as a player would have
// to — the rule is not loosened for the harness.
export const USES = ["office", "multifamily", "retail", "industrial"];
export function permittedUse(E, rec, econ, prefs = USES) {
  if (!rec) return null;
  for (const u of [...prefs, ...USES]) if (!E.zoneUseBar(rec, u, econ)) return u;
  return null;
}
