/**
 * FLOORPLATE INVENTORY — a building is a stack of plates, not a pre-cut of N
 * equal suites. Tenants arrive with a size; the landlord demises to fit
 * (Phase 2). Vacant inventory is contiguous blocks. See LEASING_OVERHAUL_PLAN.
 *
 * This file is the physical layer. It does not price a lease and it does not
 * decide who signs. It answers: what plates does this building have, which
 * floors is this tenant on, and what vacant blocks are left.
 */
import type { ParcelRecord } from "@/data/types";
import type { BuiltClass, Holding, Tenant, GameState } from "./types";
import { useSf, uses } from "./mix";
import { rng } from "./market";

export type CommercialUse = Exclude<BuiltClass, "multifamily" | "land">;

/** One commercial component of one building, as floors. */
export interface PlateStack {
  use: CommercialUse;
  plateSf: number;
  floors: number;
  /** 1-indexed from grade, inclusive. */
  floorLo: number;
  floorHi: number;
}

/** A contiguous vacant space. Derived; optional cache on the holding. */
export interface SpaceBlock {
  id: number;
  use: BuiltClass;
  floorLo: number;
  floorHi: number;
  sf: number;
  kind: "floors" | "partial" | "remnant";
  /** Demising walls standing on this space. */
  cuts: number;
}

/**
 * A partial floor is a remnant when it is under 35% of its plate AND under
 * the class's market-norm suite. Shape parameter: a space that cannot take a
 * standard suite layout without borrowing the corridor. Not a fact; not
 * turned to make a median run look right.
 */
export const REMNANT_OF_PLATE = 0.35;

/**
 * Market-norm suite by class — the size the demand distribution is aimed at,
 * not a cut the building is forced into. Office median ~5k is CompStak / JLL
 * national lease comps (plan §0.3). Retail smaller; industrial a bay.
 */
export const MARKET_NORM_SF: Record<CommercialUse, number> = {
  office: 5_000,
  retail: 2_500,
  industrial: 12_000,
};

/**
 * Log-normal size draw for a new tenancy (Phase 1 rent-roll + Phase 2
 * prospects). μ = ln(median). σ is set so p95 is one large office plate
 * (~15k — the "large suite, not an anchor floor" already cited at
 * leasing.ts on the 614k tower). Floor is a commercial tenancy, not a kiosk
 * (same 2,000 sf fact as COMMERCIAL_SUITE_MIN).
 */
export const SIZE_DIST: Record<CommercialUse, { mu: number; sigma: number; floor: number }> = {
  office:     { mu: Math.log(5_000),  sigma: (Math.log(15_000) - Math.log(5_000)) / 1.645, floor: 2_000 },
  retail:     { mu: Math.log(2_500),  sigma: (Math.log(8_000) - Math.log(2_500)) / 1.645,  floor: 2_000 },
  industrial: { mu: Math.log(12_000), sigma: (Math.log(90_000) - Math.log(12_000)) / 1.645, floor: 2_000 },
};

const isCommercialUse = (u: BuiltClass): u is CommercialUse =>
  u === "office" || u === "retail" || u === "industrial";

export function commercialUsesOf(rec: ParcelRecord): CommercialUse[] {
  return uses(rec).filter(isCommercialUse);
}

/**
 * Stack the commercial components. Retail at grade, then industrial, then
 * office. Multifamily is out of scope — flats stay an occupancy rate.
 * Floors are allocated by area share of the commercial part and always sum
 * to the commercial storey count.
 */
export function stacksOf(rec: ParcelRecord): PlateStack[] {
  const totalFloors = Math.max(1, rec.floors || 1);
  const commUses = commercialUsesOf(rec);
  const weights = commUses
    .map((use) => ({ use, sf: useSf(rec, use) }))
    .filter((w) => w.sf > 0);
  const commSf = weights.reduce((a, w) => a + w.sf, 0);
  if (commSf <= 0) return [];

  const mfSf = useSf(rec, "multifamily");
  const bldg = rec.bldgArea || commSf + mfSf;
  let commFloors = totalFloors;
  if (mfSf > 0 && bldg > 0) {
    commFloors = Math.max(1, Math.min(totalFloors, Math.round((commSf / bldg) * totalFloors)));
  }

  const order: CommercialUse[] = ["retail", "industrial", "office"];
  const sorted = [...weights].sort((a, b) => {
    const ia = order.indexOf(a.use);
    const ib = order.indexOf(b.use);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  let cursor = 1;
  let remaining = commFloors;
  const stacks: PlateStack[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const { use, sf } = sorted[i];
    const after = sorted.length - i - 1;
    // Not enough storeys left for an exclusive floor — this use sits
    // beside the last one (shop and office on the same grade plate).
    if (remaining <= 0 && stacks.length) {
      const last = stacks[stacks.length - 1];
      stacks.push({
        use,
        plateSf: sf / last.floors,
        floors: last.floors,
        floorLo: last.floorLo,
        floorHi: last.floorHi,
      });
      continue;
    }
    const last = i === sorted.length - 1;
    let floors: number;
    if (last) {
      floors = Math.max(1, remaining);
    } else {
      const want = Math.max(1, Math.round((sf / commSf) * commFloors));
      // Leave a storey for each remaining use when there are storeys to leave.
      const cap = remaining > after ? remaining - after : remaining;
      floors = Math.max(1, Math.min(want, Math.max(1, cap)));
    }
    floors = Math.max(1, Math.min(floors, Math.max(1, remaining || 1)));
    stacks.push({
      use,
      plateSf: sf / floors,
      floors,
      floorLo: cursor,
      floorHi: cursor + floors - 1,
    });
    cursor += floors;
    remaining = Math.max(0, remaining - floors);
  }
  return stacks;
}

export function stackForUse(rec: ParcelRecord, use: BuiltClass): PlateStack | undefined {
  if (!isCommercialUse(use)) return undefined;
  return stacksOf(rec).find((s) => s.use === use);
}

export function marketNormSuiteSf(use: BuiltClass, plateSf: number): number {
  if (!isCommercialUse(use)) return 900;
  return Math.min(plateSf, MARKET_NORM_SF[use]);
}

export function remnantSf(sf: number, plateSf: number, use: BuiltClass): boolean {
  if (!(sf > 0) || !(plateSf > 0)) return false;
  return sf < plateSf * REMNANT_OF_PLATE && sf < marketNormSuiteSf(use, plateSf);
}

export function blockKind(sf: number, plateSf: number, use: BuiltClass): SpaceBlock["kind"] {
  if (sf + 0.5 >= plateSf) return "floors";
  if (remnantSf(sf, plateSf, use)) return "remnant";
  return "partial";
}

/**
 * Stamp floorLo/floorHi on tenants that lack them. Largest tenant gets the
 * lowest floor, per component, stable by tenant index. NO RNG — migrations
 * and first reads must not touch any stream.
 */
export function assignTenantFloors(rec: ParcelRecord, tenants: Tenant[]): void {
  const stacks = stacksOf(rec);
  for (const stack of stacks) {
    const mine = tenants
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => (t.use ?? stack.use) === stack.use)
      .sort((a, b) => (b.t.sf - a.t.sf) || (a.i - b.i));
    const free = Array.from({ length: stack.floors }, () => stack.plateSf);
    const floorAt = (i: number) => stack.floorLo + i;

    const occupy = (t: Tenant, from: number, to: number, take: number[]) => {
      t.floorLo = floorAt(from);
      t.floorHi = floorAt(to);
      for (let i = from; i <= to; i++) free[i] = Math.max(0, free[i] - (take[i - from] ?? 0));
    };

    for (const { t } of mine) {
      if (t.floorLo != null && t.floorHi != null) {
        for (let f = t.floorLo; f <= t.floorHi; f++) {
          const i = f - stack.floorLo;
          if (i < 0 || i >= stack.floors) continue;
          const span = t.floorHi - t.floorLo + 1;
          free[i] = Math.max(0, free[i] - t.sf / span);
        }
        continue;
      }
      let remaining = t.sf;
      let start = -1;
      const take: number[] = [];
      for (let i = 0; i < stack.floors && remaining > 0.5; i++) {
        if (free[i] <= 0.5) {
          if (start >= 0 && remaining <= 0.5) break;
          if (start >= 0 && remaining > 0.5) {
            // hole — dump the rest on the last started run's last floor
            take[take.length - 1] = (take[take.length - 1] ?? 0) + remaining;
            remaining = 0;
            break;
          }
          continue;
        }
        if (start < 0) start = i;
        const bite = Math.min(free[i], remaining);
        take.push(bite);
        remaining -= bite;
      }
      if (start < 0) {
        t.floorLo = stack.floorLo;
        t.floorHi = stack.floorLo;
        continue;
      }
      if (remaining > 0.5) take[take.length - 1] = (take[take.length - 1] ?? 0) + remaining;
      occupy(t, start, start + take.length - 1, take);
    }
  }
}

function tenantUse(t: Tenant, rec: ParcelRecord): BuiltClass {
  return t.use ?? (commercialUsesOf(rec)[0] ?? "office");
}

/**
 * Vacant inventory as contiguous blocks. Source of truth for the physical
 * layer. Assigns missing tenant floors first (deterministic, no RNG).
 * Vacant sf is useSf minus sitting tenants, laid on from the top of the
 * stack — largest tenant already took the bottom — so the identity
 * Σ blocks.sf + Σ tenants.sf == useSf holds to the foot by construction.
 */
export function blocksOf(rec: ParcelRecord, h: Holding): SpaceBlock[] {
  assignTenantFloors(rec, h.tenants);
  const stacks = stacksOf(rec);
  const blocks: SpaceBlock[] = [];
  let nextId = 1;
  for (const stack of stacks) {
    const tenantSf = h.tenants
      .filter((t) => tenantUse(t, rec) === stack.use)
      .reduce((a, t) => a + t.sf, 0);
    let vacant = Math.max(0, useSf(rec, stack.use) - tenantSf);
    if (vacant <= 0.5) continue;
    // Vacant from the top. Full empty floors merge; a leftover partial or
    // remnant is its own block at the cut.
    let hi = stack.floorHi;
    while (vacant > 0.5 && hi >= stack.floorLo) {
      const fullFloors = Math.min(Math.floor((vacant + 0.5) / stack.plateSf), hi - stack.floorLo + 1);
      if (fullFloors >= 1 && vacant + 0.5 >= stack.plateSf) {
        const take = fullFloors * stack.plateSf;
        blocks.push({
          id: nextId++,
          use: stack.use,
          floorLo: hi - fullFloors + 1,
          floorHi: hi,
          sf: take,
          kind: "floors",
          cuts: hi - fullFloors + 1 > stack.floorLo ? 1 : 0,
        });
        vacant -= take;
        hi -= fullFloors;
        continue;
      }
      blocks.push({
        id: nextId++,
        use: stack.use,
        floorLo: hi,
        floorHi: hi,
        sf: vacant,
        kind: remnantSf(vacant, stack.plateSf, stack.use) ? "remnant" : "partial",
        cuts: 1,
      });
      vacant = 0;
    }
  }
  h.blocks = blocks;
  return blocks;
}

/** Per-use identity the invariant checks. */
export function blockIdentity(rec: ParcelRecord, h: Holding): { use: BuiltClass; tenantSf: number; blockSf: number; useSf: number; ok: boolean }[] {
  const blocks = blocksOf(rec, h);
  return commercialUsesOf(rec).map((use) => {
    const tenantSf = h.tenants.filter((t) => tenantUse(t, rec) === use).reduce((a, t) => a + t.sf, 0);
    const blockSf = blocks.filter((b) => b.use === use).reduce((a, b) => a + b.sf, 0);
    const area = useSf(rec, use);
    return { use, tenantSf, blockSf, useSf: area, ok: Math.abs(tenantSf + blockSf - area) < 1 };
  });
}

function gaussLeasing(s: GameState): number {
  const u = Math.max(1e-9, rng(s, "leasing"));
  const v = Math.max(1e-9, rng(s, "leasing"));
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Size a tenancy from the class log-normal, capped by what is left.
 * Industrial sheds often take the whole remaining plate — whole-bay product.
 */
export function drawTenantSf(
  s: GameState, use: BuiltClass, plateSf: number, cap: number,
): number {
  if (!(cap > 0)) return 0;
  if (!isCommercialUse(use)) return Math.round(Math.min(cap, 900));
  const d = SIZE_DIST[use];
  const raw = Math.exp(d.mu + d.sigma * gaussLeasing(s));
  let sf = Math.min(cap, Math.max(d.floor, raw));
  if (use === "industrial" && cap <= plateSf * 1.05 && rng(s, "leasing") < 0.45) {
    sf = cap;
  }
  if (sf > plateSf && sf < plateSf * 1.15) sf = plateSf;
  return Math.max(1, Math.round(Math.min(cap, sf)));
}

/** Smallest vacant block of this use that can hold `sf`, else the nearest cover. */
export function blockIdForSf(
  rec: ParcelRecord, h: Holding, use: BuiltClass, sf: number,
): number | undefined {
  const blocks = blocksOf(rec, h).filter((b) => b.use === use);
  if (!blocks.length) return undefined;
  const exact = blocks.find((b) => Math.abs(b.sf - sf) < 1);
  if (exact) return exact.id;
  const cover = blocks.filter((b) => b.sf + 0.5 >= sf).sort((a, b) => a.sf - b.sf);
  return (cover[0] ?? blocks[0]).id;
}

/** Place a tenant on the lowest floors of a stack that still have room. */
export function placeOnStack(
  rec: ParcelRecord, tenants: Tenant[], t: Tenant, stack: PlateStack,
): boolean {
  assignTenantFloors(rec, tenants);
  const used = Array.from({ length: stack.floors }, () => 0);
  for (const x of tenants) {
    if (tenantUse(x, rec) !== stack.use) continue;
    if (x.floorLo == null || x.floorHi == null) continue;
    const span = Math.max(1, x.floorHi - x.floorLo + 1);
    const per = x.sf / span;
    for (let f = x.floorLo; f <= x.floorHi; f++) {
      const i = f - stack.floorLo;
      if (i >= 0 && i < stack.floors) used[i] += per;
    }
  }
  let remaining = t.sf;
  let start = -1;
  const take: number[] = [];
  for (let i = 0; i < stack.floors && remaining > 0.5; i++) {
    const free = Math.max(0, stack.plateSf - used[i]);
    if (free <= 0.5) {
      if (start >= 0) break;
      continue;
    }
    if (start < 0) start = i;
    const bite = Math.min(free, remaining);
    take.push(bite);
    remaining -= bite;
  }
  if (start < 0 || remaining > 1) return false;
  t.use = stack.use;
  t.floorLo = stack.floorLo + start;
  t.floorHi = stack.floorLo + start + take.length - 1;
  return true;
}
