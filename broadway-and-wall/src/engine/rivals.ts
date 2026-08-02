// THE OTHER FIRMS ON THE STREET.
//
// Until now the market was a statistical process. Listings appeared from
// nowhere, an anonymous city built itself, and invisible buyers took deals out
// from under you with a line of news that said "another buyer". There was
// nobody to lose a deal TO, nobody whose overreach caused the crash, and
// nobody who wanted your corner because it finished their assemblage.
//
// So: five or six named firms with balance sheets. They own real parcels. They
// work the same tape you do, and their appetite is their dry powder times the
// credit window — which means in a boom you are bidding against people with
// too much money, and in a crunch you are the only bid in the room. They lever
// up when money is cheap because that is what wins in the short run, and the
// ones who levered hardest are the ones whose portfolios hit the tape at
// sixty cents when the window shuts.
//
// What is deliberately NOT modelled: rent rolls, per-asset loans, developments
// and tenants for each firm. A rival carries an aggregate balance sheet and a
// list of what it owns. That is enough to compete, to fail, and to be read —
// and it keeps the save file the size of a save file.
import type { ParcelRecord, ParcelTable } from "@/data/types";
import type { GameState, Rival, RivalStyle } from "./types";
import { rng, rrange } from "./market";
import { assetValue, initialCondition, noiAfterTaxYr, resolveRec } from "./value";

// Ashport is an old port town; its money has old-port-town names.
const FIRMS: { name: string; style: RivalStyle; equity: number; ltv: number }[] = [
  { name: "Calloway & Reed", style: "family", equity: 34_000_000, ltv: 0.32 },
  { name: "Harbor Point Partners", style: "core", equity: 62_000_000, ltv: 0.52 },
  { name: "Meridian Yield Group", style: "opportunistic", equity: 28_000_000, ltv: 0.71 },
  { name: "Alden Development Co.", style: "developer", equity: 41_000_000, ltv: 0.66 },
  { name: "Wentworth Trust", style: "core", equity: 88_000_000, ltv: 0.41 },
  { name: "Kestrel Capital", style: "opportunistic", equity: 19_000_000, ltv: 0.78 },
];

// What each kind of firm is FOR. These are the only behavioural differences,
// and every one of them is a real distinction between real shops.
const STYLE: Record<RivalStyle, {
  appetite: number;       // how often they are in the market at all
  procyclical: number;    // how much the credit window moves that appetite
  maxLtv: number;         // where they stop, or refuse to
  cashOut: number;        // how eagerly they refinance equity out in a boom
  classes: string[] | null;
  patience: number;       // how far above appraisal they will chase a deal
}> = {
  // sold their soul to nobody; buys quality, holds forever, sleeps at night
  family:        { appetite: 0.30, procyclical: 0.5, maxLtv: 0.50, cashOut: 0.00, classes: null, patience: 1.02 },
  // institutional money: steady, disciplined, buys stabilised income
  core:          { appetite: 0.75, procyclical: 1.0, maxLtv: 0.65, cashOut: 0.20, classes: ["office", "multifamily"], patience: 1.06 },
  // the ones who win the last three years of every cycle and lose the next one
  opportunistic: { appetite: 1.25, procyclical: 1.9, maxLtv: 0.88, cashOut: 0.85, classes: null, patience: 1.16 },
  // buys dirt and puts buildings on it; the city's growth is partly theirs
  developer:     { appetite: 0.85, procyclical: 1.5, maxLtv: 0.78, cashOut: 0.55, classes: ["land", "industrial", "retail"], patience: 1.10 },
};

const RATE_SPREAD = 1.9;   // what a firm of this size pays over the index

export function initRivals(s: GameState, parcels: ParcelTable, bbls: string[]): Rival[] {
  const out: Rival[] = [];
  // The built stock that isn't yours has to belong to SOMEBODY. Handing a
  // slice of it to named firms costs nothing on the map and means the town has
  // owners you can go and talk to.
  const built = bbls.filter((b) => {
    const r = parcels[b];
    return r && r.class !== "land" && r.bldgArea > 0;
  });
  const taken = new Set<string>();
  FIRMS.forEach((f, i) => {
    const r: Rival = {
      id: `r${i}`, name: f.name, style: f.style,
      cash: Math.round(f.equity * rrange(s, 0.06, 0.16)),
      bbls: [], debt: 0, targetLtv: f.ltv, bornM: 0,
    };
    // buy until the equity is spent
    let spend = f.equity;
    let guard = 0;
    while (spend > 0 && guard++ < 3000) {
      const bbl = built[Math.floor(rng(s) * built.length)];
      if (!bbl || taken.has(bbl)) continue;
      const rec = parcels[bbl];
      const v = assetValue(rec, s.econ, initialCondition(rec));
      if (v <= 0) continue;
      const styleOk = STYLE[f.style].classes === null || STYLE[f.style].classes!.includes(rec.class);
      if (!styleOk && rng(s) < 0.75) continue;
      const equityIn = v * (1 - f.ltv);
      if (equityIn > spend) { if (spend < f.equity * 0.08) break; else continue; }
      taken.add(bbl);
      r.bbls.push(bbl);
      r.debt += Math.round(v * f.ltv);
      spend -= equityIn;
    }
    out.push(r);
  });
  return out;
}

/** Gross asset value, annual NOI and leverage, marked today. */
export function markRival(s: GameState, parcels: ParcelTable, r: Rival): { aum: number; noiYr: number; ltv: number } {
  let aum = 0, noi = 0;
  for (const bbl of r.bbls) {
    const rec = resolveRec(parcels, s, bbl);
    if (!rec) continue;
    const cond = initialCondition(rec);
    const v = assetValue(rec, s.econ, cond);
    aum += v;
    noi += noiAfterTaxYr(rec, s.econ, cond, v);
  }
  return { aum, noiYr: noi, ltv: aum > 0 ? r.debt / aum : r.debt > 0 ? 9 : 0 };
}

/** Firms still standing. */
export function livingRivals(s: GameState): Rival[] {
  return (s.rivals ?? []).filter((r) => r.failedM === undefined);
}

/**
 * How much competing money is in the room for a deal today.
 *
 * 1 is a normal market. Above 1 you are bidding against people with more dry
 * powder than ideas; below 1 the phone has stopped ringing for everyone and a
 * disciplined buyer gets to name their price. This is the number that makes
 * waiting for the bottom a skill rather than a formality.
 */
export function marketAppetite(s: GameState): number {
  const ci = Math.max(0.4, Math.min(1.25, s.econ.creditIdx ?? 1));
  let a = 0, n = 0;
  for (const r of livingRivals(s)) {
    const st = STYLE[r.style];
    // a firm with no dry powder is not a bidder, however loudly it talks
    const dry = Math.max(0, Math.min(1.5, r.cash / Math.max(1, 0.04 * Math.max(1, r.aum ?? r.debt))));
    a += st.appetite * (1 + st.procyclical * (ci - 1)) * Math.min(1.15, 0.2 + dry);
    n++;
  }
  if (!n) return Math.max(0.25, ci);
  // normalised so a full street at a normal credit window reads 1.0 — the
  // number is meant to be compared to one, not to itself
  return Math.max(0.2, a / n / NEUTRAL_APPETITE);
}

// The reference a healthy street reads against, measured from play rather
// than derived: six firms at a normal credit window with normal dry powder.
// Getting this wrong is not cosmetic — appetite scales how fast listings are
// absorbed, and a number that sits below one all century means every building
// lingers on the tape and stale-reprices downward, which is a standing gift to
// whoever buys the most. It cost the audit its entire risk frontier once.
const NEUTRAL_APPETITE = 0.43;

/** The firm that owns this parcel, if any. */
export function ownerOf(s: GameState, bbl: string): Rival | null {
  for (const r of s.rivals ?? []) if (r.bbls.includes(bbl)) return r;
  return null;
}

/**
 * One month of the competition.
 *
 * Order matters and mirrors the real thing: mark the book, service the debt,
 * then decide whether you are a buyer or a seller — and if the answer is
 * neither because the bank is calling, you are a forced seller and the whole
 * market finds out.
 */
// Money that comes back. A firm that fails is replaced, because the buildings
// are still there and somebody always raises a fund to buy them — a city that
// loses three shops over a century and never gains one is not a city, it is a
// slow liquidation.
const NEW_FIRMS: { name: string; style: RivalStyle }[] = [
  { name: "Northgate Partners", style: "opportunistic" },
  { name: "Sable & Hale", style: "core" },
  { name: "Drydock Holdings", style: "developer" },
  { name: "Ostrander Group", style: "opportunistic" },
  { name: "Bellweather Estates", style: "family" },
  { name: "Quarry Lane Capital", style: "core" },
  { name: "Alden Municipal Pension", style: "core" },
  { name: "Fen & Marrow", style: "opportunistic" },
];
const MIN_FIRMS = 4;

function maybeNewFirm(s: GameState, ci: number) {
  const living = livingRivals(s);
  if (living.length >= MIN_FIRMS) return;
  // capital returns when the window is open, not while it is shut
  if (ci < 0.88 || rng(s) > 0.045) return;
  const used = new Set((s.rivals ?? []).map((r) => r.name));
  const pool = NEW_FIRMS.filter((f) => !used.has(f.name));
  if (!pool.length) return;
  const f = pool[Math.floor(rng(s) * pool.length)];
  // sized to the era, not to 2026 — a fund raised in year eighty is a year
  // eighty fund
  const scale = Math.max(1, living.reduce((a, r) => a + (r.aum ?? 0), 0) / 500_000_000);
  const equity = Math.round(rrange(s, 24_000_000, 58_000_000) * scale);
  const ltv = STYLE[f.style].maxLtv * rrange(s, 0.68, 0.88);
  s.rivals.push({
    id: `r${s.rivals.length}`, name: f.name, style: f.style,
    cash: equity, debt: 0, bbls: [], targetLtv: +ltv.toFixed(2), bornM: s.month,
  });
  s.news.unshift({
    q: s.month, kind: "event",
    text: `${f.name} has raised $${(equity / 1e6).toFixed(0)}M and is looking for buildings. There is competition on the tape again.`,
  });
}

export function tickRivals(s: GameState, parcels: ParcelTable) {
  if (!s.rivals?.length) return;
  const ci = Math.max(0.4, Math.min(1.25, s.econ.creditIdx ?? 1));
  const rate = s.econ.indexRate + RATE_SPREAD;
  maybeNewFirm(s, ci);

  for (const r of s.rivals) {
    // THE WORKOUT. A failed firm does not evaporate — a receiver holds the
    // book and sells it down over years, because dumping a hundred buildings
    // into one month would clear at nothing and everybody knows it. Releasing
    // them a couple at a time is both what happens and what keeps a failure
    // from handing the whole market a year of free money: the first version of
    // this listed the entire portfolio at once, and the resulting flood of
    // sixty-cent buildings made the most reckless strategy in the audit the
    // best one again.
    if (r.failedM !== undefined) {
      if (!r.bbls.length) continue;
      let release = 1 + Math.floor(rng(s) * 2);
      while (release-- > 0 && r.bbls.length) {
        const bbl = r.bbls[Math.floor(rng(s) * r.bbls.length)];
        r.bbls = r.bbls.filter((b) => b !== bbl);
        if (s.holdings[bbl] || s.listings.some((l) => l.bbl === bbl)) continue;
        const rec = resolveRec(parcels, s, bbl);
        if (!rec) continue;
        const v = assetValue(rec, s.econ, initialCondition(rec));
        s.listings.push({
          bbl, ask: Math.round(v * rrange(s, 0.66, 0.86) / 1000) * 1000,
          listedM: s.month, expiresM: s.month + Math.round(rrange(s, 6, 12)), distress: true,
        });
      }
      continue;
    }
    const st = STYLE[r.style];
    const { aum, noiYr, ltv } = markRival(s, parcels, r);
    r.aum = Math.round(aum);

    // --- the money -------------------------------------------------------
    // NOI in, interest and amortisation out. A firm this size amortises on a
    // thirty-year schedule; nobody gets pure interest-only forever.
    const interest = (r.debt * rate) / 100 / 12;
    const amort = r.debt > 0 ? r.debt / (30 * 12) : 0;
    r.cash += Math.round(noiYr / 12 - interest - amort);
    r.debt = Math.max(0, Math.round(r.debt - amort));

    // DISTRIBUTIONS. Every firm here answers to somebody — partners, a family,
    // a pension board — and none of them let a hundred years of free cash flow
    // sit in a bank account. A shop holds a working reserve and sends the rest
    // out the door, and that is why dry powder is a real constraint on a real
    // firm rather than an ever-growing number. Without it these balance sheets
    // compounded into tens of billions of idle cash, which made every firm
    // unkillable and every bidding war a foregone conclusion.
    const reserve = Math.max(2_000_000, aum * (r.style === "family" ? 0.09 : r.style === "core" ? 0.06 : 0.045));
    if (r.cash > reserve && !r.stressMs) {
      const out = Math.round((r.cash - reserve) * 0.35);
      r.cash -= out;
      r.distributed = (r.distributed ?? 0) + out;
    }

    // --- the overreach ---------------------------------------------------
    // Cheap money is a temptation and it is supposed to be taken. A firm that
    // refinances equity out at the top has more to buy with and less to lose
    // it with — which is exactly the trade that kills them two phases later.
    if (st.cashOut > 0 && ci > 1.02 && ltv < st.maxLtv - 0.06 && rng(s) < 0.06 * st.cashOut) {
      const room = Math.round((st.maxLtv - 0.04 - ltv) * aum);
      if (room > 1_000_000) {
        r.debt += room;
        r.cash += room;
      }
    }

    // --- taking profits --------------------------------------------------
    // Nobody accumulates for a hundred years without ever selling. A firm
    // trims into strength — it is where their returns are realised, it is what
    // their investors are waiting for, and it is why there is anything on the
    // tape in a good market at all. Without it the street simply ate the city.
    const hot = s.econ.phase === "peak" || s.econ.phase === "expansion";
    if (r.bbls.length > 6 && !r.stressMs && rng(s) < (hot ? 0.055 : 0.012) * (r.style === "family" ? 0.25 : 1)) {
      const bbl = r.bbls[Math.floor(rng(s) * r.bbls.length)];
      const rec = resolveRec(parcels, s, bbl);
      if (rec && !s.holdings[bbl] && !s.listings.some((l) => l.bbl === bbl)) {
        const v = assetValue(rec, s.econ, initialCondition(rec));
        // a willing seller asks a willing seller's price
        s.listings.push({
          bbl, ask: Math.round(v * rrange(s, 1.00, 1.14) / 1000) * 1000,
          listedM: s.month, expiresM: s.month + Math.round(rrange(s, 6, 12)),
        });
      }
    }

    // --- trouble ---------------------------------------------------------
    // Two ways to die, and they are the same two ways anyone dies: the value
    // fell through the debt, or the cash ran out. Neither is instant — a firm
    // sells into it first, which is what puts the tape full of good buildings
    // at bad prices exactly when nobody can finance them.
    const stressed = ltv > st.maxLtv + 0.05 || r.cash < 0;
    if (stressed && r.bbls.length) {
      r.stressMs = (r.stressMs ?? 0) + 1;
      // sell something, at whatever the room will pay
      if (r.stressMs % 2 === 0) {
        const bbl = r.bbls[Math.floor(rng(s) * r.bbls.length)];
        const rec = resolveRec(parcels, s, bbl);
        if (rec) {
          const v = assetValue(rec, s.econ, initialCondition(rec));
          const px = Math.round(v * rrange(s, 0.68, 0.88));
          r.bbls = r.bbls.filter((b) => b !== bbl);
          r.cash += px;
          r.debt = Math.max(0, r.debt - Math.round(px * 0.92));
          if (!s.listings.some((l) => l.bbl === bbl) && !s.holdings[bbl]) {
            s.listings.push({ bbl, ask: px, listedM: s.month, expiresM: s.month + 8, distress: true });
            s.news.unshift({
              q: s.month, kind: "event",
              text: `${r.name} is selling. ${rec.address} hits the tape at $${(px / 1e6).toFixed(2)}M — ${Math.round((1 - px / Math.max(1, v)) * 100)}% under appraisal. They have more where that came from.`,
            });
          }
        }
      }
      if (r.stressMs > 30 && (r.cash < 0 || ltv > st.maxLtv + 0.2)) {
        r.failedM = s.month;
        s.news.unshift({
          q: s.month, kind: "warn",
          text: `${r.name} is finished — ${r.bbls.length} building${r.bbls.length === 1 ? "" : "s"} go to the lenders. A firm that was buying everything two years ago could not roll a single loan this month. The receiver will be selling for years.`,
        });
      }
    } else if (r.stressMs) {
      r.stressMs = 0;
    }
  }
}

/**
 * Somebody else takes the deal. Called from listing absorption so the buyer
 * has a name — losing a building to Kestrel Capital twice in a year is
 * information, and "another buyer" was not.
 *
 * Returns the firm that bought it, or null if the money in the room today
 * could not close.
 */
export function rivalBuys(s: GameState, rec: ParcelRecord, price: number): Rival | null {
  // A listing may already belong to somebody — a firm selling out of a
  // position, or a receiver clearing a failed one. Whoever holds the deed is
  // the seller, and they are obviously not also the buyer.
  const seller = ownerOf(s, rec.bbl);
  const candidates = livingRivals(s).filter((r) => {
    if (r === seller) return false;
    const st = STYLE[r.style];
    if (st.classes && !st.classes.includes(rec.class)) return false;
    const equity = price * (1 - r.targetLtv);
    return r.cash >= equity;
  });
  if (!candidates.length) return null;
  // the hungriest firm with the money wins
  let best = candidates[0], bestW = -Infinity;
  for (const r of candidates) {
    const st = STYLE[r.style];
    const w = st.appetite * (1 + st.procyclical * ((s.econ.creditIdx ?? 1) - 1)) * (0.6 + rng(s) * 0.8);
    if (w > bestW) { bestW = w; best = r; }
  }
  if (seller) {
    seller.bbls = seller.bbls.filter((b) => b !== rec.bbl);
    const relief = Math.min(seller.debt, Math.round(price * seller.targetLtv));
    seller.debt -= relief;
    seller.cash += price - relief;
  }
  const equity = Math.round(price * (1 - best.targetLtv));
  best.cash -= equity;
  best.debt += price - equity;
  if (!best.bbls.includes(rec.bbl)) best.bbls.push(rec.bbl);
  return best;
}

/** What a rival will take for a building of theirs, and why. */
export function rivalAsk(s: GameState, parcels: ParcelTable, r: Rival, bbl: string): { ask: number; note: string } {
  const rec = resolveRec(parcels, s, bbl);
  const v = rec ? assetValue(rec, s.econ, initialCondition(rec)) : 0;
  const { ltv } = markRival(s, parcels, r);
  const st = STYLE[r.style];
  if (r.stressMs && r.stressMs > 4) {
    return { ask: Math.round(v * rrange(s, 0.80, 0.95)), note: `${r.name} needs the money — they are inside appraisal and they know you know.` };
  }
  if (ltv < st.maxLtv * 0.6 && r.style === "family") {
    return { ask: Math.round(v * rrange(s, 1.18, 1.45)), note: `${r.name} has owned it for two generations and does not need to sell. That is the number.` };
  }
  return { ask: Math.round(v * rrange(s, st.patience - 0.04, st.patience + 0.12)), note: `${r.name} will trade at the right price.` };
}
