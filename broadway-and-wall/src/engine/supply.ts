/**
 * ONE CONSTRUCTION DELIVERY QUEUE.
 *
 * The city used to carry every project twice: a physical job in `cityJobs` or
 * `developments`, and one anonymous cohort per use in `econ.cohorts`. The
 * cohort was what moved vacancy and rent, while the physical job was what put
 * a building on the map. When a sponsor failed, a schedule slipped, a site was
 * sold, or a ground lease ended, those two records could disagree. The market
 * then received space that never opened, or the map opened a building the
 * market had never expected.
 *
 * `deliveryQueue` is the authoritative bridge. One row represents one actual
 * project, with its complete use programme and delivery date. `cohorts` and
 * `pipeline` remain as derived compatibility views because the Economy page
 * and old saves speak that language; nobody should write them directly.
 */
import type { ParcelTable } from "@/data/types";
import type { BuiltClass, Econ, GameState, SupplyProject, SupplySource, UseMix } from "./types";

const CLASSES: BuiltClass[] = ["office", "retail", "multifamily", "industrial"];

function emptyByClass<T>(make: () => T): Record<BuiltClass, T> {
  return {
    office: make(),
    retail: make(),
    multifamily: make(),
    industrial: make(),
  };
}

/** Old saves only have class cohorts. Lift them into project rows once. */
function ensureQueue(e: Econ): SupplyProject[] {
  if (e.deliveryQueue) return e.deliveryQueue;
  const grouped = new Map<string, SupplyProject>();
  let anon = 0;
  for (const k of CLASSES) {
    for (const c of e.cohorts?.[k] ?? []) {
      // Tagged rows with the same parcel and date are legs of one mixed-use
      // project. Untagged legacy rows cannot safely be merged.
      const key = c.bbl ? `legacy:${c.bbl}:${c.m}` : `legacy:anon:${anon++}`;
      const p = grouped.get(key) ?? {
        id: key,
        bbl: c.bbl,
        source: "legacy" as SupplySource,
        startM: Math.max(0, c.m - 30),
        deliverM: c.m,
        sfByUse: {},
        status: "active" as const,
      };
      p.sfByUse[k] = (p.sfByUse[k] ?? 0) + c.sf;
      grouped.set(key, p);
    }
  }
  e.deliveryQueue = [...grouped.values()];
  syncSupplyViews(e);
  return e.deliveryQueue;
}

/** Rebuild the old per-class views from the one project queue. */
export function syncSupplyViews(e: Econ): void {
  const cohorts = emptyByClass<Array<{ m: number; sf: number; bbl?: string }>>(() => []);
  const pipeline = emptyByClass(() => 0);
  for (const p of e.deliveryQueue ?? []) {
    if (p.status !== "active") continue;
    for (const k of CLASSES) {
      const sf = Math.max(0, Math.round(p.sfByUse[k] ?? 0));
      if (!sf) continue;
      cohorts[k].push({ m: p.deliverM, sf, bbl: p.bbl });
      pipeline[k] += sf;
    }
  }
  e.cohorts = cohorts;
  e.pipeline = pipeline;
}

export function programmeSf(sf: number, mix: UseMix): Partial<Record<BuiltClass, number>> {
  const out: Partial<Record<BuiltClass, number>> = {};
  for (const k of CLASSES) {
    const leg = Math.round(sf * (mix[k] ?? 0));
    if (leg > 0) out[k] = leg;
  }
  return out;
}

export function queueSupplyProject(
  s: GameState,
  input: {
    bbl: string;
    source: SupplySource;
    startM?: number;
    deliverM: number;
    sfByUse: Partial<Record<BuiltClass, number>>;
  },
): void {
  const q = ensureQueue(s.econ);
  const startM = input.startM ?? s.month;
  const id = `${input.source}:${input.bbl}:${startM}`;
  const existing = q.find((p) => p.id === id);
  const row: SupplyProject = {
    id,
    bbl: input.bbl,
    source: input.source,
    startM,
    deliverM: input.deliverM,
    sfByUse: { ...input.sfByUse },
    status: "active",
  };
  if (existing) Object.assign(existing, row);
  else q.push(row);
  syncSupplyViews(s.econ);
}

export function rescheduleSupplyProject(s: GameState, bbl: string, deliverM: number): void {
  for (const p of ensureQueue(s.econ)) {
    if (p.bbl === bbl) {
      p.deliverM = deliverM;
      p.status = "active";
    }
  }
  syncSupplyViews(s.econ);
}

export function stallSupplyProject(s: GameState, bbl: string): void {
  for (const p of ensureQueue(s.econ)) if (p.bbl === bbl) p.status = "stalled";
  syncSupplyViews(s.econ);
}

export function cancelSupplyProject(s: GameState, bbl: string): void {
  s.econ.deliveryQueue = ensureQueue(s.econ).filter((p) => p.bbl !== bbl);
  syncSupplyViews(s.econ);
}

/**
 * Reconcile physical jobs before the economy settles this month's deliveries.
 * A stalled frame is still visible, but it is not deliverable supply. A job
 * whose site was sold or already built is cancelled before its square feet can
 * enter stock.
 */
export function reconcileSupplyQueue(s: GameState, parcels: ParcelTable): void {
  const q = ensureQueue(s.econ);
  const jobs = s.cityJobs ?? [];
  const cityByBbl = new Map(jobs.map((j) => [j.bbl, j]));

  for (const p of q) {
    if (!p.bbl || p.source === "legacy") continue;
    const d = s.developments[p.bbl];
    if (d) {
      p.deliverM = d.deliverM;
      // A repudiated player facility stops bank draws, not the job: the
      // sponsor carries work and interest in cash until another desk steps in.
      p.status = "active";
      continue;
    }
    const j = cityByBbl.get(p.bbl);
    if (!j) {
      p.status = "cancelled";
      continue;
    }
    const standing = s.built[p.bbl];
    const blocked = !parcels[p.bbl]
      || (!!s.holdings[p.bbl] && !j.groundLease)
      || !!(standing && standing.bldgArea > 0);
    if (blocked) {
      p.status = "cancelled";
      continue;
    }
    p.deliverM = j.deliverM;
    // A rival with a repudiated lender can also carry the work in cash.
    // It stalls only when `fundJobs` marks the frame orphaned.
    p.status = j.orphaned ? "stalled" : "active";
  }

  s.econ.deliveryQueue = q.filter((p) => p.status !== "cancelled");
  syncSupplyViews(s.econ);
}

/**
 * Settle all projects due this month atomically. Mixed-use legs arrive
 * together; stalled and cancelled jobs contribute nothing.
 */
export function settleSupplyDeliveries(
  s: GameState,
): Record<BuiltClass, number> {
  const delivered = emptyByClass(() => 0);
  const still: SupplyProject[] = [];
  for (const p of ensureQueue(s.econ)) {
    if (p.status !== "active" || p.deliverM > s.month) {
      still.push(p);
      continue;
    }
    for (const k of CLASSES) delivered[k] += Math.max(0, Math.round(p.sfByUse[k] ?? 0));
  }
  s.econ.deliveryQueue = still;
  syncSupplyViews(s.econ);
  return delivered;
}
