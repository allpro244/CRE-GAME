// DEMAND SHOCKS (SHOCK_TESTS_PLAN.md group 2): the largest employer leaves,
// an arrivals wave of +30% of the people, remote work (-30% office per
// worker), and a fifth of shop spending moving online. Each enters the way
// the engine's own events do — a firm closing (streetRolls.ts, the going-dark
// path), the arrivals swan's hook (blackswans.ts / households.ts), the feet a
// worker takes (streetRolls.ts `lvlNow`), households' online share (market.ts
// ONLINE, read by economy.ts `spendVector`). No rent, vacancy or value is
// written; no RNG is drawn.
const COMM = ["office", "retail", "industrial"];
const at = (g, list) => list.includes(g.month - 120);

// ---------------------------------------------------------------- 2a. the largest employer leaves
// The firm with the most heads at the snapshot, found the first time a probe
// or the injector looks (row 0, the snapshot, in every run): the same firm in
// both twins. Module state is per process, and each run is its own process.
let TOP = null;
function largestFirm(g, E) {
  if (TOP) return TOP;
  const firms = new Map();
  const add = (t) => {
    const k = t.use ?? "office";
    if (t.fid === undefined || !COMM.includes(k)) return;
    const f = firms.get(t.fid) ?? { fid: t.fid, name: t.name, use: k, heads: 0, sf: 0, leases: 0 };
    f.heads += E.tenantHeads(t); f.sf += t.sf; f.leases++;
    firms.set(t.fid, f);
  };
  for (const r of Object.values(g.econ.streetRolls ?? {})) for (const t of r.t) add(t);
  for (const h of Object.values(g.holdings ?? {})) for (const t of h.tenants ?? []) add(t);
  // a firm between premises counts its heads, not its floor (it holds none)
  for (const sk of g.econ.seekers ?? []) if (sk.t && !sk.from && !firms.has(sk.t.fid)) { add(sk.t); firms.get(sk.t.fid) && (firms.get(sk.t.fid).sf = 0); }
  let best = null;
  for (const f of firms.values()) if (!best || f.heads > best.heads) best = f;
  TOP = best;
  return TOP;
}
function headsOfFid(g, E, fid) {
  let h = 0;
  for (const r of Object.values(g.econ.streetRolls ?? {})) for (const t of r.t) if (t.fid === fid) h += E.tenantHeads(t);
  for (const x of Object.values(g.holdings ?? {})) for (const t of x.tenants ?? []) if (t.fid === fid) h += E.tenantHeads(t);
  for (const sk of g.econ.seekers ?? []) if (sk.t?.fid === fid && !sk.from) h += E.tenantHeads(sk.t);
  return h;
}

const employer = {
  id: "demand-employer-leaves", group: "demand", title: "The largest employer leaves",
  what: "The named firm with the most heads closes its local operation at the snapshot. It goes the way a street firm that fails goes (streetRolls.ts `tickFirms`, the dark path): every lease it holds ends, the suites go to make-ready and back on the market, the closure is filed (`streetFailed`, `failedSf`), and it leaves the search queue. The town's books then close it as they close any firm missing from the street (economy.ts `tickFirms`): its heads come off its industry's employment that month, the register lets its earners go, and its supply links lapse. Not written: the replacement — whether new firms form into the gap is the engine's answer.",
  sources: "Plant closures cost a metro about 0.5-1.5 further local jobs per direct job (Moretti 2010 multipliers, run in reverse); office vacancy rises by about the firm's floor; some laid-off households leave, so apartment vacancy rises over 1-2 years; shops follow with a lag.",
  inject(g, city, i, ctx, E) {
    if (i !== 0) return;
    const f = largestFirm(g, E);
    if (!f) { ctx.notes.push("no named firm found"); return; }
    const e = g.econ, m = g.month + 1;          // the month the closure lands in (advanceMonth increments first)
    let n = 0, sf = 0;
    // Mirrors streetRolls.ts's going-dark branch: `vacate` (make-ready, then
    // showable) and the failure record. Its local `lost` (the shed movers'
    // pool) and `handed` (the turnover measure) are inside tickFirms and
    // cannot be reached from here.
    for (const [bbl, roll] of Object.entries(e.streetRolls ?? {})) {
      const keep = [];
      for (const t of roll.t) {
        if (t.fid !== f.fid) { keep.push(t); continue; }
        const k = t.use ?? "office";
        (roll.ready ??= []).push({ use: k, sf: t.sf, readyM: m + Math.max(1, Math.round(E.reletMonths(k) * 0.5)) });
        (e.streetFailed ??= []).push({ m, bbl, name: t.name, fid: t.fid, sf: t.sf, use: k, why: "dark", credit: t.credit });
        (e.failedSf ??= { office: 0, retail: 0, multifamily: 0, industrial: 0 })[k] += t.sf;
        n++; sf += t.sf;
      }
      roll.t = keep;
    }
    // a firm that is the player's tenant goes dark in the player's building too (its rent stops)
    for (const h of Object.values(g.holdings ?? {})) if (h.tenants?.some((t) => t.fid === f.fid)) {
      for (const t of h.tenants) if (t.fid === f.fid) { n++; sf += t.sf; }
      h.tenants = h.tenants.filter((t) => t.fid !== f.fid);
    }
    e.seekers = (e.seekers ?? []).filter((sk) => sk.fid !== f.fid);
    ctx.notes.push(`${f.name} (fid ${f.fid}, ${f.use}): ${Math.round(f.heads)} heads = ${(100 * f.heads / Math.max(1, e.jobs)).toFixed(2)}% of the town's jobs; ${n} lease(s), ${(sf / 1000).toFixed(1)}k sf = ${(100 * sf / Math.max(1, e.stock?.[f.use] ?? 1)).toFixed(2)}% of ${f.use} stock`);
  },
  probes: {
    heads: (g, city, E) => { const f = largestFirm(g, E); return f && at(g, [0, 1, 2, 60]) ? headsOfFid(g, E, f.fid) : NaN; },
    // town jobs and the firm's class's occupied floor in units of the firm at the snapshot: twin differences read as "per direct job" and "per foot it held"
    jobsPerDirect: (g, city, E) => { const f = largestFirm(g, E); return f ? g.econ.jobs / Math.max(1, f.heads) : NaN; },
    occPerFloor: (g, city, E) => { const f = largestFirm(g, E); return f ? (g.econ.occupied?.[f.use] ?? NaN) / Math.max(1, f.sf) : NaN; },
  },
  land(c, t) {
    const P = "demand-employer-leaves.";
    const h0 = c[1].probe[P + "heads"], h1 = t[1].probe[P + "heads"];
    const dOcc = t[1].probe[P + "occPerFloor"] - c[1].probe[P + "occPerFloor"];
    const dJob = Math.min(...[1, 2].map((r) => t[r].probe[P + "jobsPerDirect"] - c[r].probe[P + "jobsPerDirect"]));
    // Gated on what was injected: the firm off the rolls, and its earners let go
    // (town jobs are the register's earners, read a month late, so +1 or +2).
    // The occupied floor is reported, not gated: how fast its suites re-let is a response.
    const ok = h0 > 0 && h1 === 0 && dJob <= -0.5;
    return { ok, msg: `the firm's heads ${Math.round(h0)} (control) vs ${Math.round(h1)} (shocked) at +1 month; town jobs ${dJob.toFixed(2)} per direct job by +2 months; its class's occupied floor ${dOcc.toFixed(2)}× its floor at +1 month${ok ? "" : " — the closure did not take"}` };
  },
  expect: [
    { obs: "probe.demand-employer-leaves.occPerFloor", unit: "pp", win: "impact", sign: -1, lo: -150, hi: -50, tiny: 10, label: "the class's occupied floor, per foot the firm held (×100)", want: "about −100 (its floor comes empty), −50 to −150", trace: "do the suites re-let at once (streetRolls.ts new firms, `form`)?" },
    { obs: "probe.demand-employer-leaves.jobsPerDirect", unit: "pp", win: "impact", sign: -1, lo: -250, hi: -150, tiny: 10, label: "town jobs lost per direct job (×100)", want: "−150 to −250: the direct job and 0.5-1.5 more (Moretti 2010)", trace: "is the industry hired back at once (economy.ts `staff`, the off-map sample `off`)?" },
    { obs: "vac.office", unit: "pp", win: "impact", sign: +1, lo: 0.2, hi: 3, tiny: 0.1, label: "office vacancy", want: "up by about the firm's floor (seed 11: ~0.9pp of stock)" },
    { obs: "pop", unit: "rel", win: "impact", sign: -1, lo: -0.03, hi: -0.001, tiny: 0.0005, label: "population", want: "some laid-off households leave town", trace: "households.ts moves (a job loss as a reason to leave)" },
    { obs: "vac.multifamily", unit: "pp", win: "impact", sign: +1, lo: 0.05, hi: 2, tiny: 0.05, label: "apartment vacancy", want: "rises over 1-2 years as leavers' flats come empty" },
    { obs: "vac.retail", unit: "pp", win: "mid", sign: +1, lo: 0.05, hi: 3, tiny: 0.05, label: "shop vacancy, years 3-8", want: "follows with a lag (less pay spent in town)" },
  ],
  charts: [
    { title: "town jobs", obs: "jobs" },
    { title: "office vacancy, %", obs: "vac.office", scale: 100 },
    { title: "apartment vacancy, %", obs: "vac.multifamily", scale: 100 },
  ],
};

// ---------------------------------------------------------------- 2b. +30% population over 2 years
// The arrivals swan's hook. households.ts lands `econ.bsMigPull` (a share of
// the register's people a month) as renter households across the water
// looking for work, and `econ.bsArrivals.island` of them with a taste for an
// island flat. blackswans.ts `tickArrivals` REWRITES both every month, at the
// end of the month (after the register has read them), from `econ.arrivals`
// (0 when no swan is live) — so a value written before the month is read that
// month and replaced after it. The injector therefore adds its wave on top of
// whatever the swan tick left, every month for 24 months: the snapshot's own
// live arrivals swan (seed 11: 0.3%/month, 13 months left) keeps running
// underneath, as it does in the control, and `econ.arrivals` is not touched,
// so the natural swans' draws stay the control's.
const WAVE_M = 24, WAVE = 0.30;
const WAVE_X = Math.pow(1 + WAVE, 1 / WAVE_M) - 1;   // a month, compounding to +30% over two years
const ARRIVALS_CORE = 0.5;                          // blackswans.ts ARRIVALS_CORE: the swan's newcomers who want an island flat

const arrivals = {
  id: "demand-arrivals-30", group: "demand", title: "+30% population over 2 years",
  what: `An arrivals wave: ${(100 * WAVE_X).toFixed(2)}% of the register's people a month for ${WAVE_M} months (compounding to +30%), through the arrivals swan's own channel (blackswans.ts \`bsMigPull\`/\`bsArrivals\`, landed by households.ts as renter households across the water looking for work, half of them wanting an island flat). Added on top of the swan tick's value each month, because the tick rewrites it at every month's end.`,
  sources: "Mariel 1980 (+7% of Miami's labour force in months; Card 1990) and the 1990s aliyah (+12% of Israel's population in ~4 years; Friedberg 2001): rents up first (Israel: real rents roughly +10-20% in 1990-92), then home prices, then a building response 1-3 years on; unemployment up briefly, then employment catches up.",
  inject(g, city, i, ctx, E) {
    if (i >= WAVE_M) return;
    const e = g.econ;
    const was = e.bsMigPull ?? 0;
    e.bsMigPull = was + WAVE_X;
    // the island share applies to the swan's part of the wave (households.ts: island × arrivals.monthly / wave): all of it, ours and the live swan's
    e.bsArrivals = { monthly: (e.bsArrivals?.monthly ?? 0) + WAVE_X, island: e.bsArrivals?.island ?? ARRIVALS_CORE };
    if (i === 0) ctx.notes.push(`+${(100 * WAVE_X).toFixed(3)}% of people a month for ${WAVE_M} months on top of the swan's ${(100 * was).toFixed(3)}% (pop ${Math.round(e.population ?? 0).toLocaleString("en-US")})`);
  },
  probes: {
    arrived: (g) => g.econ.eco?.arrived ?? NaN,
  },
  land(c, t) {
    // econ.population is last month's register (market.ts reads `econ.eco`
    // before the register's month), so the first month's arrivals show at +2.
    const a1 = t[1].probe["demand-arrivals-30.arrived"] / Math.max(1e-9, c[1].probe["demand-arrivals-30.arrived"]);
    const r2 = t[2].pop / c[2].pop;
    const ok = a1 > 1.5 && r2 >= 1 + 0.6 * WAVE_X;
    return { ok, msg: `households arriving ×${a1.toFixed(1)} at +1 month; population ×${r2.toFixed(4)} at +2 (it reads a month late; one month's wave is ×${(1 + WAVE_X).toFixed(4)})` };
  },
  hold(c, t) {
    const r24 = t[WAVE_M].pop / c[WAVE_M].pop, r60 = t[60].pop / c[60].pop;
    return { ok: r24 >= 1.2, msg: `population ×${r24.toFixed(3)} at +2 years (the wave summed; +30% injected), ×${r60.toFixed(3)} at +5 years` };
  },
  expect: [
    { obs: "pop", unit: "rel", win: "impact", sign: +1, lo: 0.12, hi: 0.35, label: "population", want: "ramps to about +30% (years 0-3 mean ~+20%)" },
    { obs: "vac.multifamily", unit: "pp", win: "impact", sign: -1, lo: -15, hi: -1, label: "apartment vacancy", want: "falls first" },
    { obs: "eff.multifamily", unit: "rel", win: "impact", sign: +1, lo: 0.05, hi: 0.15, label: "apartment effective rent", want: "+5 to +15% real over 2-3 years", trace: "flat rents (streetRolls.ts flats, landlords' guest cards)" },
    { obs: "homePsf", unit: "rel", win: "mid", sign: +1, lo: 0.03, hi: 0.3, label: "home prices, years 3-8", want: "follow the rents up" },
    { obs: "starts.multifamily", unit: "rel", win: "impact", sign: +1, lo: 0.1, hi: 5, tiny: 0.1, label: "apartment starts", want: "rise 1-3 years on", trace: "builders' pro formas (dev.ts developerLook)" },
    { obs: "u", unit: "pp", win: "impact", sign: +1, lo: 0.2, hi: 6, tiny: 0.1, label: "unemployment", want: "up briefly (newcomers looking for work)" },
    { obs: "jobs", unit: "rel", win: "mid", sign: +1, lo: 0.05, hi: 0.35, label: "jobs, years 3-8", want: "firms expand toward the bigger town" },
  ],
  charts: [
    { title: "population", obs: "pop" },
    { title: "apartment vacancy, %", obs: "vac.multifamily", scale: 100 },
    { title: "apartment effective rent index", obs: "eff.multifamily" },
  ],
};

// ---------------------------------------------------------------- 2c. remote work
// THE FEET A WORKER TAKES is read in one place (streetRolls.ts `lvlNow`): the
// class's level `econ.spaceLvl[k]` over its level at the opening
// `econ.spaceLvl0[k]`. Every firm's need is its heads × that ratio
// (`firmNeed`), and it acts only where a firm sizes a lease: a renewal
// (`renewInPlace` / `shop` with `need`), a move, a firm growing out mid-lease,
// a new firm's first lease (want × lvlNow). A sitting lease keeps its feet to
// its end; the floor a firm holds beyond its need goes on the sublet market
// (market.ts). `spaceLvl` is rewritten every month by market.ts (the swans'
// level, 1.0 with SWANS_OFF), so the injector cannot hold a write there;
// `spaceLvl0` is set once and never rewritten, so dividing it by 0.7 at the
// shock makes the ratio 0.7 for good. (market.ts SF_PER_JOB is a module
// constant read by heads arithmetic — tenantHeads, the city's size — as well
// as by need, so changing it would also change every firm's head count; the
// level is the remote-work channel the engine itself names.)
const REMOTE_CUT = 0.30;
const officeNeedPerSf = (g, E) => {
  const e = g.econ, l = e.spaceLvl?.office, l0 = e.spaceLvl0?.office;
  const lvl = l === undefined ? 1 : Math.max(0.2, l / Math.max(1e-6, l0 ?? l));
  let need = 0, sf = 0;
  for (const r of Object.values(e.streetRolls ?? {})) for (const t of r.t) {
    if ((t.use ?? "office") !== "office" || !(t.sf > 0)) continue;
    need += (t.hcRef ?? t.sf) * (t.staff ?? 1) / Math.max(0.2, t.staffSign ?? 1) * lvl;   // streetRolls.ts firmHc × lvlNow
    sf += t.sf;
  }
  return sf > 0 ? need / sf : NaN;
};
const remote = {
  id: "demand-remote-office-30", group: "demand", title: "Remote work: office space per worker −30%",
  what: "Every office firm's need per head falls 30%, through the engine's own remote-work level (streetRolls.ts `lvlNow`: `econ.spaceLvl` over `econ.spaceLvl0`, the opening's level, divided by 0.7 at the shock). It acts where a firm sizes a lease — renewals, moves, new firms' first leases — and existing leases run to their end; what a sitting firm holds beyond its need is the sublet market's. Held for good (the opening's level is never rewritten).",
  sources: "US office 2020-24 (Moody's/CBRE): vacancy ~12% → 19-20% as leases rolled (5-10 year terms), values −30 to −40% (Green Street CPPI office); conversions and teardowns where they pencil.",
  inject(g, city, i, ctx, E) {
    if (i !== 0) return;
    const e = g.econ;
    const l0 = (e.spaceLvl0 ??= {}).office ?? e.spaceLvl?.office ?? 1;
    e.spaceLvl0.office = l0 / (1 - REMOTE_CUT);
    if (e.spaceLvl?.office === undefined) (e.spaceLvl ??= {}).office = l0;    // lvlNow reads 1 without a level; market.ts writes it every month anyway
    ctx.notes.push(`office spaceLvl0 ${l0.toFixed(3)} → ${e.spaceLvl0.office.toFixed(3)}: need per head ×${(1 - REMOTE_CUT).toFixed(2)}`);
  },
  probes: {
    lvl: (g) => { const e = g.econ; return at(g, [0, 1, 60]) ? (e.spaceLvl?.office ?? 1) / (e.spaceLvl0?.office ?? 1) : NaN; },
    needPerSf: (g, city, E) => (at(g, [0, 1, 12, 60]) ? officeNeedPerSf(g, E) : NaN),
  },
  land(c, t) {
    const P = "demand-remote-office-30.";
    const l = t[1].probe[P + "lvl"] / c[1].probe[P + "lvl"], n = t[1].probe[P + "needPerSf"] / c[1].probe[P + "needPerSf"];
    const occ = t[1].occupied.office / c[1].occupied.office;
    const ok = Math.abs(l - 0.7) < 0.01 && Math.abs(n - 0.7) < 0.03 && occ >= 0.98;
    return { ok, msg: `feet a head ×${l.toFixed(3)}, office firms' need over the feet they hold ×${n.toFixed(3)}, occupied office ×${occ.toFixed(3)} at +1 month (leases run to term)` };
  },
  hold(c, t) {
    const P = "demand-remote-office-30.";
    const l = t[60].probe[P + "lvl"] / c[60].probe[P + "lvl"], n = t[60].probe[P + "needPerSf"] / c[60].probe[P + "needPerSf"];
    return { ok: Math.abs(l - 0.7) < 0.01, msg: `feet a head ×${l.toFixed(3)} at +5 years; need over held feet ×${n.toFixed(3)} (rises toward 1 as leases roll to the new need)` };
  },
  expect: [
    { obs: "vac.office", unit: "pp", win: "impact", sign: +1, lo: 0.5, hi: 8, tiny: 0.2, label: "office vacancy, years 0-3", want: "rises gradually as leases roll (not overnight): +0.5 to +8pp", trace: "the sublet market (market.ts `sublet`): is held-but-unneeded space counted vacant at once?" },
    { obs: "vac.office", unit: "pp", win: "mid", sign: +1, lo: 4, hi: 20, label: "office vacancy, years 3-8", want: "+4 to +20pp as most leases have rolled (US 2020-24: ~+7-8pp, part-rolled)" },
    { obs: "eff.office", unit: "rel", win: "mid", sign: -1, lo: -0.5, hi: -0.1, label: "office effective rent, years 3-8", want: "falls 10-50%" },
    { obs: "val.office", unit: "rel", win: "mid", sign: -1, lo: -0.45, hi: -0.2, label: "office values, years 3-8", want: "−20 to −45% (US 2022-24: −30 to −40%)" },
    { obs: "starts.office", unit: "rel", win: "mid", sign: -1, lo: -1, hi: -0.5, tiny: 0.1, label: "office starts, years 3-8", want: "near zero" },
    { obs: "stock.office", unit: "rel", win: "late", sign: -1, lo: -0.3, hi: -0.01, tiny: 0.005, label: "office stock, years 8-15", want: "conversions and teardowns where they pencil", trace: "conversions (rivals.ts tickRivalConversions) and the teardown desk" },
  ],
  charts: [
    { title: "office vacancy, %", obs: "vac.office", scale: 100 },
    { title: "office effective rent index", obs: "eff.office" },
    { title: "office stock, sf", obs: "stock.office" },
  ],
};

// ---------------------------------------------------------------- 2d. e-commerce
// THE ONLINE SHARE is one state, `econ.online` (market.ts ONLINE): each month
// tickEcon moves it 1/60th of the way to its target (technology and a shop's
// rent against a shed's), sets the shops' secular floor index from it, and
// economy.ts `spendVector` then moves that share of every retail industry's
// household dollars to warehousing (IND_ONLINE) the same month. A one-off
// write would decay back over five years, so the injector keeps a shadow of
// the unshocked share: from each month's step it recovers the engine's own
// target, steps the shadow toward it as market.ts would, and sets the share
// to the shadow plus a fifth of the in-store remainder. The target is the
// engine's (it reads the shocked twin's rents), so the shock is "20% more of
// the in-store spending than the engine's own e-commerce would have moved".
const ONLINE_CUT = 0.20;
const shopSales = (g, E) => {
  const x = g.economy?.last?.x;
  if (!x) return NaN;
  let v = 0;
  for (const id of E.RETAIL_IDS) v += x[E.INDUSTRY_INDEX[id]] ?? 0;
  return v;
};
const online = {
  id: "demand-online-20", group: "demand", title: "E-commerce: 20% of shop spending moves online",
  what: "Households' in-store share of retail spending falls by a fifth: the town's online share (market.ts `econ.online`, read by economy.ts `spendVector`, which moves that share of every shop industry's household dollars to warehousing, IND_ONLINE) is set to the unshocked share plus 20% of the in-store remainder, and held there every month against the engine's own drift (a shadow of the unshocked share is stepped toward the engine's target, recovered from each month's step).",
  sources: "US 2010s retail: e-commerce from ~4% to ~11% of retail sales (Census); store closures 2017-20 ran ~9-10k a year; mall vacancy rose ~3-4pp (Moody's REIS) and stayed up where space did not convert; shop rents fell in weak centres.",
  inject(g, city, i, ctx, E) {
    const e = g.econ, o = e.online ?? 0.02;
    let base;
    if (i === 0) base = o;
    else {
      // last month: the engine stepped our shocked `sh` to o = sh + (T - sh)/60, so T = sh + 60(o - sh)
      const { base: b0, sh } = ctx.online;
      const T = sh + 60 * (o - sh);
      base = b0 + (T - b0) / 60;
    }
    const sh = base + ONLINE_CUT * (1 - base);
    e.online = sh;
    ctx.online = { base, sh };
    if (i === 0) ctx.notes.push(`online share ${(100 * base).toFixed(1)}% → ${(100 * sh).toFixed(1)}% of shop sales (in-store ${(100 * (1 - base)).toFixed(1)}% → ${(100 * (1 - sh)).toFixed(1)}%)`);
  },
  probes: {
    online: (g) => g.econ.online ?? NaN,
    shopSales: (g, city, E) => shopSales(g, E),
  },
  land(c, t) {
    const P = "demand-online-20.";
    const st = (1 - t[1].probe[P + "online"]) / (1 - c[1].probe[P + "online"]);
    const ss = t[1].probe[P + "shopSales"] / c[1].probe[P + "shopSales"];
    const ok = st >= 0.78 && st <= 0.83 && ss < 0.95;
    return { ok, msg: `in-store share ×${st.toFixed(3)}, shop industries' sales ×${ss.toFixed(3)} at +1 month` };
  },
  hold(c, t) {
    const P = "demand-online-20.";
    const st = (1 - t[60].probe[P + "online"]) / (1 - c[60].probe[P + "online"]);
    return { ok: st >= 0.75 && st <= 0.85, msg: `in-store share ×${st.toFixed(3)} at +5 years` };
  },
  expect: [
    { obs: "probe.demand-online-20.shopSales", unit: "rel", win: "impact", sign: -1, lo: -0.3, hi: -0.1, label: "shop sales (the shop industries' output)", want: "fall 10-30% (a fifth of the household part)" },
    { obs: "vac.retail", unit: "pp", win: "impact", sign: +1, lo: 1, hi: 15, label: "shop vacancy, years 0-3", want: "rises as marginal shops close", trace: "shop firms' books (tenantBooks.ts) and exits (streetRolls.ts)" },
    { obs: "vac.retail", unit: "pp", win: "late", sign: +1, lo: 0.5, hi: 15, label: "shop vacancy, years 8-15", want: "stays up until shops convert" },
    { obs: "eff.retail", unit: "rel", win: "impact", sign: -1, lo: -0.3, hi: -0.03, label: "shop effective rent", want: "falls 3-30%" },
    { obs: "stock.retail", unit: "rel", win: "late", sign: -1, lo: -0.3, hi: -0.01, tiny: 0.005, label: "shop stock, years 8-15", want: "conversions where they pencil" },
  ],
  charts: [
    { title: "shop vacancy, %", obs: "vac.retail", scale: 100 },
    { title: "shop effective rent index", obs: "eff.retail" },
    { title: "shop industries' sales", obs: "probe.demand-online-20.shopSales" },
  ],
};

export const SHOCKS = [employer, arrivals, remote, online];
