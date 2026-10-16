/**
 * EVERY BUILDING ON THE STREET HAS TENANTS (2026-10-15).
 *
 * A building the player did not own carried no tenants of its own: its
 * occupancy was recomputed each month from the street-wide totals plus a fixed
 * per-building hash, and a rival firm's book was one occupancy number. So a
 * failing trade emptied "the market" evenly; nobody's tower lost its anchor;
 * a buyer could not see which buildings were carrying weak tenants.
 *
 * Now each standing commercial building the player does not own keeps a real
 * rent roll — named tenants with leases, covenants and the same hidden books
 * the player's tenants keep (tenantBooks.ts). Each month:
 *
 *   sync       buildings join and leave the street: a fresh delivery opens
 *              empty and leases up; a building the player sells carries its
 *              tenants over with their books; one the player buys, or that
 *              comes down, leaves.
 *   tick       every tenant's books run; tenants fail off them and hand their
 *              suite back; leases expire and renew (about 55% of office, 65%
 *              of shop and 75% of shed space, CBRE / JLL / Prologis) or leave.
 *   reconcile  the city's space market (market.ts) still decides how much of
 *              the street is let — it is the calibrated aggregate, with the
 *              regional stock off the map. The rolls decide WHERE: newcomers
 *              take vacant suites in proportion to the space and to how good
 *              the building is (its overall score) and how hard its owner
 *              leases; when the market shrinks, the weakest buildings' tenants
 *              are the ones that go.
 *
 * The street's failures beyond the background feed the city's space market
 * as space handed back (`streetFailShare`), replacing the representative
 * cohorts. Draws are hashed on the tenant and the month, or run on a private
 * stream, so the rest of the world's dice do not move with the street.
 */
import type { ParcelTable } from "@/data/types";
import type { BuiltClass, Condition, GameState, Holding, Tenant } from "./types";
import { START_YEAR } from "./types";
import { resolveRec, useRentableSf, overallScore, initialCondIdx, useRentPsfYr, assetValue, occCharacter } from "./value";
import { genRentRoll, isCommercial, streetNewTenant, bumpOf, minLettableSf } from "./leasing";
import { gradeOf, paramsOf } from "./rivals";
import { tickTenantFin, tenantFailOdds, BACKGROUND_FAIL } from "./tenantBooks";
import { rng } from "./market";

export interface StreetRoll { t: Tenant[] }

const COMM: ("office" | "retail" | "industrial")[] = ["office", "retail", "industrial"];
/** Share of expiring space that renews in place (CBRE / JLL lease-expiry studies; Prologis retention). */
const RENEW: Record<string, number> = { office: 0.55, retail: 0.65, industrial: 0.75 };
/** How strongly a building's character steers newcomers (log-weight per unit of occupancy character). */
const CHAR_W = 6;
/** Score points per e-fold of a building's draw on a looking tenant. */
const SCORE_W = 20;
/**
 * How hard a shrinking market singles out the weakest buildings (power on the
 * inverse draw). At 1 the weak emptied in a spiral; at 0.5 the space leaves
 * every building, tilted toward the weak — and the measured spread was the
 * same within noise, because it is set by the lumpiness of a small building's
 * two or three suites, not by the weights.
 */
const SHED_P = 0.5;

/** A uniform [0,1) from a key — the same tenant in the same month always draws the same number. */
function hashU(seed: number, key: string): number {
  let h = 2166136261 ^ (seed >>> 0);
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** Run `fn` on a private "leasing" stream seeded from the key; the world's streams are restored after. */
function privately<T>(s: GameState, key: string, fn: () => T): T {
  const saved = s.rng;
  const savedStreams = s.streams ? { ...s.streams } : undefined;
  const seed = Math.max(1, Math.floor(hashU(s.seed, key) * 4294967295));
  s.rng = seed;
  if (s.streams) s.streams = { ...s.streams, leasing: seed };
  try { return fn(); } finally { s.rng = saved; if (savedStreams) s.streams = savedStreams; }
}

function eligible(s: GameState, parcels: ParcelTable, bbl: string) {
  if (s.holdings[bbl]) return null;
  const rec = resolveRec(parcels, s, bbl);
  if (!rec || rec.class === "land" || !(rec.bldgArea > 0) || !isCommercial(rec)) return null;
  return rec;
}

/** Buildings join and leave the street. */
export function syncStreetRolls(s: GameState, parcels: ParcelTable, bbls: string[]) {
  const e = s.econ;
  const opening = !e.streetRolls;
  e.streetRolls ??= {};
  const year = START_YEAR + Math.floor(s.month / 12);
  for (const bbl of bbls) {
    const rec = eligible(s, parcels, bbl);
    const has = e.streetRolls[bbl];
    if (!rec) { if (has) delete e.streetRolls[bbl]; continue; }
    if (has) continue;
    // A building the player has just sold keeps the tenants it had, books and all.
    const sold = e.heldTenants?.[bbl];
    if (sold) { e.streetRolls[bbl] = { t: structuredClone(sold).filter((t) => t.use !== "multifamily") }; continue; }
    // A delivery opens empty and leases up through the street's leasing below.
    if (!opening && year - (rec.yearBuilt || 1900) <= 1) { e.streetRolls[bbl] = { t: [] }; continue; }
    // Otherwise the standing roll: the same draw a listing of it would show.
    const cond: Condition = gradeOf(s, rec);
    const vessel = { bbl, boughtM: s.month, costBasis: 0, assessed: assetValue(rec, s.econ, cond), loan: null, condition: cond,
      condIdx: initialCondIdx(rec, s.month, cond), tenants: [], cfHistory: [] } as unknown as Holding;
    genRentRoll(s, rec, vessel, false, false);
    e.streetRolls[bbl] = { t: vessel.tenants.filter((t) => t.use !== "multifamily") };
  }
  // What the player holds today, so a sale next month can carry it to the street.
  e.heldTenants = Object.fromEntries(Object.entries(s.holdings).map(([b, h]) => [b, h.tenants ?? []]));
}

/**
 * The street's tenants live a month: books, failures, expiries, bumps.
 * Writes `streetFailShare` — the share of the street's let space, by class,
 * whose tenants failed beyond the background a market's churn already carries.
 */
export function tickStreetRolls(s: GameState, parcels: ParcelTable) {
  const e = s.econ;
  if (!e.streetRolls) return;
  const letSf: Record<string, number> = { office: 0, retail: 0, industrial: 0 };
  const excess: Record<string, number> = { office: 0, retail: 0, industrial: 0 };
  for (const [bbl, roll] of Object.entries(e.streetRolls)) {
    const rec = resolveRec(parcels, s, bbl);
    if (!rec) continue;
    const keep: Tenant[] = [];
    for (const t of roll.t) {
      const use = (t.use ?? "office") as string;
      // Headcount follows the trade's payroll month to month.
      const emp = e.firmBooks?.[t.sector]?.emp ?? 1;
      const tt = t as Tenant & { empRef?: number };
      const prev = tt.empRef ?? emp;
      tt.empRef = emp;
      t.staff = Math.max(0.4, Math.min(2.6, (t.staff ?? 1) * emp / Math.max(1e-6, prev)));
      // The contractual bump on each anniversary.
      const age = s.month - t.startM;
      if (age > 0 && age % 12 === 0) t.rentPsf = +(t.rentPsf * (1 + bumpOf(t) / 100)).toFixed(2);
      const f = tickTenantFin(e, t, s.month < (t.freeUntilM ?? -1) ? 0 : t.rentPsf * t.sf, e.creditIdx ?? 1);
      const odds = tenantFailOdds(f, t.credit);
      if (use in excess) excess[use] += Math.max(0, odds - BACKGROUND_FAIL[t.credit]) * t.sf;
      if (hashU(s.seed, `${bbl}|${t.name}|${t.startM}|${s.month}`) < odds) {
        (e.streetFailed ??= []).push({ m: s.month, bbl, name: t.name, sf: t.sf, use: use as BuiltClass, why: "dark" });
        continue;                                   // went dark: the suite is empty
      }
      if (t.endM <= s.month) {
        if (hashU(s.seed, `${bbl}|${t.name}|${t.startM}|renew|${s.month}`) < (RENEW[use] ?? 0.6)) {
          // Renews at today's market for the building, for a fresh term.
          t.rentPsf = +(useRentPsfYr(rec, e, gradeOf(s, rec), use as BuiltClass) * 0.97).toFixed(2);
          t.endM = s.month + 36 + Math.round(60 * hashU(s.seed, `${bbl}|${t.name}|term|${s.month}`));
          // ...AND FOR THE SPACE ITS PEOPLE NEED NOW. A firm that has grown
          // since it signed takes the suite next door if the building has
          // one; one that has shrunk hands floors back. Space per head is
          // sticky (a tenant trims, it does not halve), so the move is half
          // the change in headcount, within a third either way.
          const tt = t as Tenant & { staffSign?: number };
          const ratio = (t.staff ?? 1) / Math.max(0.2, tt.staffSign ?? 1);
          const want = Math.round(t.sf * Math.max(0.67, Math.min(1.33, 1 + 0.5 * (ratio - 1))));
          // ...never below the smallest suite the building lets.
          if (want < t.sf) t.sf = Math.max(Math.min(t.sf, minLettableSf(rec, use as BuiltClass)), want);
          else if (want > t.sf) {
            const cap = useRentableSf(rec, use as BuiltClass);
            const let_ = roll.t.reduce((a, x) => a + ((x.use ?? "office") === use ? x.sf : 0), 0);
            t.sf += Math.max(0, Math.min(want - t.sf, cap - let_));
          }
          tt.staffSign = t.staff ?? 1;
        } else {                                    // moved on
          (e.streetFailed ??= []).push({ m: s.month, bbl, name: t.name, sf: t.sf, use: use as BuiltClass, why: "left" });
          continue;
        }
      }
      keep.push(t);
      if (use in letSf) letSf[use] += t.sf;
    }
    roll.t = keep;
  }
  if (e.streetFailed && e.streetFailed.length > 600) e.streetFailed = e.streetFailed.slice(-600);
  e.streetFailShare = Object.fromEntries(COMM.map((k) => [k, letSf[k] > 0 ? excess[k] / letSf[k] : 0])) as Record<string, number>;
}

/**
 * The market says how much of the street is let; the rolls say where. Leases
 * newcomers into vacant suites, or lets the weakest buildings' tenants go,
 * until the street's rolls run at the market's occupancy for the class.
 */
export function reconcileStreetRolls(s: GameState, parcels: ParcelTable) {
  const e = s.econ;
  if (!e.streetRolls) return;
  privately(s, `streetlease|${s.month}`, () => {
    const owners = new Map<string, NonNullable<GameState["rivals"]>[number]>();
    for (const r of s.rivals ?? []) for (const b of r.bbls) owners.set(b, r);
    for (const k of COMM) {
      type B = { bbl: string; rec: NonNullable<ReturnType<typeof resolveRec>>; cap: number; let: number; w: number };
      const bs: B[] = [];
      let cap = 0, lets = 0;
      for (const [bbl, roll] of Object.entries(e.streetRolls!)) {
        const rec = resolveRec(parcels, s, bbl);
        if (!rec) continue;
        const c = useRentableSf(rec, k);
        if (!(c > 0)) continue;
        const l = roll.t.reduce((a, t) => a + ((t.use ?? "office") === k ? t.sf : 0), 0);
        // How strongly a looking tenant is drawn here: the building's overall
        // score (location first, then the building), and how hard its owner
        // leases — an institution's leasing desk against a family's.
        const owner = owners.get(bbl);
        const care = owner ? owner.leaseW ?? 0.85 + 0.3 * (paramsOf(owner).care.lease ?? 0.5) : 1;
        // ...and the building's own character: the persistent idiosyncrasy and
        // the troubled one in eight (value.ts occCharacter) — the dark lobby
        // a broker steers a tenant away from.
        const w = Math.exp((overallScore(rec, e, k) - 55) / SCORE_W + CHAR_W * occCharacter(rec, k)) * care;
        bs.push({ bbl, rec, cap: c, let: l, w });
        cap += c; lets += l;
      }
      if (!bs.length) continue;
      const occRate = 1 - (e.streetVac?.[k] ?? e.cityVac?.[k] ?? 0.1);
      const target = cap * Math.max(0, Math.min(1, occRate));
      let gap = target - lets;
      const tol = Math.max(1500, cap * 0.002);
      if (gap > tol) {
        // LEASE: pick buildings in proportion to vacant space x draw.
        for (let guard = 0; guard < 400 && gap > tol; guard++) {
          let tot = 0;
          for (const b of bs) { const v = b.cap - b.let; if (v > 800) tot += v * b.w; }
          if (tot <= 0) break;
          let u = rng(s, "leasing") * tot;
          let pick = bs[0];
          for (const b of bs) { const v = b.cap - b.let; if (v <= 800) continue; u -= v * b.w; if (u <= 0) { pick = b; break; } }
          const cond = gradeOf(s, pick.rec);
          const nt = streetNewTenant(s, pick.rec, cond, initialCondIdx(pick.rec, s.month, cond), k, Math.min(pick.cap - pick.let, Math.max(gap, 1500)));
          if (!nt) { pick.let = pick.cap; continue; }
          e.streetRolls![pick.bbl].t.push(nt);
          pick.let += nt.sf; gap -= nt.sf;
        }
      } else if (gap < -tol) {
        // SHED: the space the market no longer holds leaves the weakest
        // buildings first — the tenant whose lease is nearest its end goes.
        for (let guard = 0; guard < 400 && gap < -tol; guard++) {
          let tot = 0;
          for (const b of bs) if (b.let > 0) tot += b.let / b.w ** SHED_P;
          if (tot <= 0) break;
          let u = rng(s, "leasing") * tot;
          let pick = bs[0];
          for (const b of bs) { if (b.let <= 0) continue; u -= b.let / b.w ** SHED_P; if (u <= 0) { pick = b; break; } }
          const roll = e.streetRolls![pick.bbl];
          let at = -1;
          for (let i = 0; i < roll.t.length; i++) if ((roll.t[i].use ?? "office") === k && (at < 0 || roll.t[i].endM < roll.t[at].endM)) at = i;
          if (at < 0) { pick.let = 0; continue; }
          const gone = roll.t.splice(at, 1)[0];
          pick.let -= gone.sf; gap += gone.sf;
        }
      }
    }
  });
}
