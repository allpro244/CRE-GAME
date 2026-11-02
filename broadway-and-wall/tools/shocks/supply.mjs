// SUPPLY SHOCKS (SHOCK_TESTS_PLAN.md group 1): +50% of a class's stock
// overnight, and -20% of it lost. Entered the way the engine enters a
// building: `s.built[bbl]` on a real lot, and the class's stock moved by its
// rentable feet (dev.ts `deliver` + supply.ts, and the teardown desk's
// demolition). No rent, vacancy or value is written; no RNG is drawn.
const CLASSES = ["office", "retail", "industrial", "multifamily"];
const LABEL = { office: "office", retail: "retail", industrial: "industrial", multifamily: "apartments" };
const START_YEAR = 2000;

// a stable order that is not the map's: lots by a hash of their bbl, so the
// lost buildings are spread across the town and its vintages
const hashB = (b) => { let h = 2166136261; for (let i = 0; i < b.length; i++) { h ^= b.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/** The class's standing rentable feet, read off the buildings (the landing check's own count, not econ.stock). */
function builtSf(g, city, E, k) {
  let sf = 0;
  for (const b in city.parcels) {
    const r = E.resolveRecBare(city.parcels, g, b);
    if (r && r.class === k && r.bldgArea > 0) sf += E.rentableSf(r);
  }
  return sf;
}
const near = (g, at, list) => list.includes(g.month - at);

function boom(k) {
  return {
    id: `supply-${k}-up50`, group: "supply", title: `+50% ${LABEL[k]} stock overnight`,
    what: `Half as much ${LABEL[k]} again, finished and empty, on the town's vacant lots where zoning allows it — best-located lots first, as a boom builds — each at its lot's legal envelope. Unowned, leasing up through the street like any delivery.`,
    sources: "Houston office 1983-87: vacancy to ~30%, effective rents roughly halved, a decade to absorb (Wheaton & Torto); real rent growth ≈ −2 to −3%/yr per point of vacancy over normal (Wheaton-Torto 1988); starts stop until vacancy recovers; values fall more than rents.",
    inject(g, city, i, ctx, E) {
      if (i !== 0) return;
      const target = 0.5 * (g.econ.stock?.[k] ?? 0);
      const cov = E.MAX_COVERAGE[k] ?? 0.6;
      const lots = Object.keys(city.parcels).map((b) => E.resolveRec(city.parcels, g, b)).filter((r) => r && r.class === "land" && !(r.bldgArea > 0)
        && !g.holdings?.[r.bbl] && !g.developments?.[r.bbl] && !(g.econ.landQueue ?? []).some?.((q) => q.bbl === r.bbl) && !E.zoneUseBar(r, k, g.econ))
        .sort((a, b) => (b.demandScore ?? 0) - (a.demandScore ?? 0));
      let added = 0, n = 0;
      for (const r of lots) {
        if (added >= target) break;
        const floors = Math.max(1, Math.floor(E.maxFloorsFor(r, cov, k)));
        const gross = Math.round(r.lotArea * cov * floors);
        if (!(gross > 2000)) continue;
        g.built[r.bbl] = { class: k, bldgArea: gross, floors, yearBuilt: START_YEAR + Math.floor(g.month / 12), cov };
        const rent = E.rentableSf({ bldgArea: gross, floors });
        E.addStock(g.econ, k, rent);
        added += rent; n++;
      }
      ctx.notes.push(`${n} buildings, ${(added / 1e6).toFixed(2)}M sf rentable = ${(100 * added / Math.max(1, target) / 2).toFixed(0)}% of the stock (target 50%)${added < 0.9 * target ? " — the town ran out of buildable lots" : ""}`);
    },
    probes: { built: (g, city, E) => (near(g, 120, [0, 1, 60]) ? builtSf(g, city, E, k) : NaN) },
    land(c, t) {
      const p = `supply-${k}-up50.built`;
      const r1 = t[1].probe[p] / c[1].probe[p], s1 = t[1].stock[k] / c[1].stock[k];
      return { ok: r1 >= 1.45 && s1 >= 1.45, msg: `buildings ×${r1.toFixed(2)}, econ.stock ×${s1.toFixed(2)} at +1 month` };
    },
    hold(c, t) {
      const p = `supply-${k}-up50.built`;
      const r = t[60]?.probe[p] / c[60]?.probe[p];
      return { ok: r >= 1.3, msg: `buildings ×${Number.isFinite(r) ? r.toFixed(2) : "—"} at +5 years` };
    },
    expect: [
      { obs: `vac.${k}`, unit: "pp", win: "impact", sign: +1, lo: 10, hi: 35, label: `${LABEL[k]} vacancy`, want: "+10 to +35pp (day one is about +30pp)" },
      { obs: `vac.${k}`, unit: "pp", win: "late", sign: +1, lo: 0, hi: 20, label: `${LABEL[k]} vacancy, years 8-15`, want: "smaller than the impact: absorbing (0 to +20pp)" },
      { obs: `eff.${k}`, unit: "rel", win: "impact", sign: -1, lo: -0.5, hi: -0.08, label: `${LABEL[k]} effective rent`, want: "falls 8-50%", trace: "rent rule for the class (streetRolls.ts / tenantMarket.ts)" },
      { obs: `val.${k}`, unit: "rel", win: "impact", sign: -1, lo: -0.6, hi: -0.1, label: `${LABEL[k]} values (existing buildings)`, want: "fall 10-60%, more than rents" },
      { obs: `starts.${k}`, unit: "rel", win: "mid", sign: -1, lo: -1, hi: -0.5, tiny: 0.1, label: `${LABEL[k]} starts, years 3-8`, want: "near zero: −50 to −100%", trace: "builders' pro formas (dev.ts developerLook)" },
      { obs: "land", unit: "rel", win: "impact", sign: -1, lo: -0.5, hi: -0.01, label: "land value", want: "falls (lower residuals)" },
      ...CLASSES.filter((o) => o !== k).map((o) => ({ obs: `eff.${o}`, unit: "rel", win: "impact", sign: 0, hi: 0.05, label: `${LABEL[o]} rent (should not move)`, want: "within ±5%" })),
    ],
    charts: [
      { title: `${LABEL[k]} vacancy, %`, obs: `vac.${k}`, scale: 100 },
      { title: `${LABEL[k]} effective rent index`, obs: `eff.${k}` },
      { title: `${LABEL[k]} starts, sf a month`, obs: `starts.${k}` },
    ],
  };
}

function loss(k) {
  return {
    id: `supply-${k}-down20`, group: "supply", title: `−20% ${LABEL[k]} stock lost`,
    what: `A fifth of the town's ${LABEL[k]} feet gone overnight (a fire, a wipe-out): buildings spread across the town and its vintages by a hash of their deed, not the player's own. Their tenants mid-lease go looking (streetRolls.ts: a firm is not demolished with its building).`,
    sources: "Scarcity raises rents and cuts vacancy; starts answer 1-3 years after the signal (Wheaton 1999), with overshoot; land in the class's districts rises.",
    inject(g, city, i, ctx, E) {
      if (i !== 0) return;
      const target = 0.2 * (g.econ.stock?.[k] ?? 0);
      const bs = Object.keys(city.parcels).filter((b) => !g.holdings?.[b] && !g.developments?.[b]).sort((a, b) => hashB(a) - hashB(b));
      let lost = 0, n = 0;
      for (const b of bs) {
        if (lost >= target) break;
        const r = E.resolveRec(city.parcels, g, b);
        if (!r || r.class !== k || !(r.bldgArea > 0)) continue;
        g.built[b] = { class: "land", bldgArea: 0, floors: 0, yearBuilt: 0 };
        const rent = E.rentableSf(r);
        E.addStock(g.econ, k, -rent);
        g.demolished = (g.demolished ?? 0) + 1;
        lost += rent; n++;
      }
      ctx.notes.push(`${n} buildings, ${(lost / 1e6).toFixed(2)}M sf rentable lost`);
    },
    probes: { built: (g, city, E) => (near(g, 120, [0, 1, 60]) ? builtSf(g, city, E, k) : NaN) },
    land(c, t) {
      const p = `supply-${k}-down20.built`;
      const r1 = t[1].probe[p] / c[1].probe[p], s1 = t[1].stock[k] / c[1].stock[k];
      return { ok: r1 <= 0.82 && s1 <= 0.82, msg: `buildings ×${r1.toFixed(2)}, econ.stock ×${s1.toFixed(2)} at +1 month` };
    },
    expect: [
      { obs: `vac.${k}`, unit: "pp", win: "impact", sign: -1, lo: -12, hi: -1, label: `${LABEL[k]} vacancy`, want: "falls 1-12pp (the displaced take the empty space)", trace: "do the displaced tenants relocate in town (toSeekers) or vanish?" },
      { obs: `eff.${k}`, unit: "rel", win: "impact", sign: +1, lo: 0.02, hi: 0.3, label: `${LABEL[k]} effective rent`, want: "rises 2-30%" },
      { obs: `starts.${k}`, unit: "rel", win: "mid", sign: +1, lo: 0.2, hi: 5, tiny: 0.1, label: `${LABEL[k]} starts, years 3-8`, want: "rise: a construction answer 1-3 years on" },
      { obs: "land", unit: "rel", win: "mid", sign: +1, lo: 0.01, hi: 0.5, label: "land value, years 3-8", want: "rises" },
    ],
    charts: [
      { title: `${LABEL[k]} vacancy, %`, obs: `vac.${k}`, scale: 100 },
      { title: `${LABEL[k]} effective rent index`, obs: `eff.${k}` },
      { title: `${LABEL[k]} starts, sf a month`, obs: `starts.${k}` },
    ],
  };
}

export const SHOCKS = CLASSES.flatMap((k) => [boom(k), loss(k)]);
