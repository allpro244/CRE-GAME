// THE PLACEBO: the noise floor every other verdict is read against.
//
// The twins are the same town on the same seed, and the engine is
// deterministic, so a shock of nothing leaves them identical forever. A shock
// of almost nothing need not: the property-insurance premium raised a tenth
// of a per cent (an owner's bill moves by cents a foot) can flip a threshold
// somewhere — a lease that signs a month later, a print that closes in the
// other twin — and from there the two towns are two draws of the same
// economy. Whatever this row shows is what a shock's table shows with no
// economics in it at all.
//
// Measured from the run-1 snapshots (lockstep twins, 36 months): one part in
// a million never diverged in a year on seed 11; a tenth of a per cent did,
// and by month 15 the twins' retail sample (`val`) stood 24% apart, the
// industrial sample 22% apart by month 6 and the lot panel 23-35% apart in
// year 3, while seed 22 never diverged at all and seed 33 drifted a few per
// cent. The floor is real, large and seed-dependent: an effect inside this
// row's band, on that seed, is not a finding.
const CLASSES = ["office", "retail", "industrial", "multifamily"];
const EPS = 1e-3;
const placebo = {
  id: "placebo-noise", group: "placebo", title: "Placebo: a shock of nothing (the noise floor)",
  what: `The property-insurance market's price \`opexIdx.ins\` raised by ${EPS} (premium ×1.001) at the snapshot and left alone: no owner, tenant or lender could notice it. It exists to measure how far two twins drift apart from a flipped threshold alone.`,
  sources: "Deterministic chaos in an agent economy: twins diverge from any perturbation once one discrete decision differs (econaudit's lesson). Nothing in the record should move.",
  inject(g, city, i, ctx) {
    if (i !== 0) return;
    if (!g.econ.opexIdx) { ctx.notes.push("no opexIdx in the snapshot: not injected"); return; }
    g.econ.opexIdx.ins += EPS;
    ctx.notes.push(`opexIdx.ins +${EPS}`);
  },
  land: () => ({ ok: true, msg: `premium ×${(1 + EPS).toFixed(6)}` }),
  expect: [
    // the labour rows the labour fixes are read against (#570)
    { obs: "pop", unit: "rel", win: "impact", sign: 0, hi: 0.002, label: "population", want: "nothing" },
    { obs: "jobs", unit: "rel", win: "impact", sign: 0, hi: 0.002, label: "jobs", want: "nothing" },
    { obs: "u", unit: "pp", win: "impact", sign: 0, hi: 0.1, label: "unemployment", want: "nothing" },
    { obs: "vac.multifamily", unit: "pp", win: "impact", sign: 0, hi: 0.1, label: "apartment vacancy", want: "nothing" },
    { obs: "jobs", unit: "rel", win: "mid", sign: 0, hi: 0.002, label: "jobs, years 3-8", want: "nothing" },
    ...CLASSES.map((k) => ({ obs: `val.${k}`, unit: "rel", win: "impact", sign: 0, hi: 0.02, label: `${k} values, market read (val)`, want: "nothing: any move is the noise floor" })),
    ...CLASSES.map((k) => ({ obs: `inc.${k}`, unit: "rel", win: "year1", sign: 0, hi: 0.02, label: `${k} values, cap read held (inc), first year`, want: "nothing: any move is the noise floor" })),
    ...CLASSES.map((k) => ({ obs: `inc.${k}`, unit: "rel", win: "impact", sign: 0, hi: 0.02, label: `${k} values, cap read held (inc)`, want: "nothing: any move is the noise floor" })),
    { obs: "lots", unit: "rel", win: "year1", sign: 0, hi: 0.02, label: "land, lot panel, first year", want: "nothing" },
    { obs: "lots", unit: "rel", win: "impact", sign: 0, hi: 0.02, label: "land, lot panel", want: "nothing" },
    { obs: "land", unit: "rel", win: "impact", sign: 0, hi: 0.02, label: "land value (yearly index)", want: "nothing" },
    { obs: "listings", unit: "rel", win: "impact", sign: 0, hi: 0.02, label: "listings", want: "nothing" },
  ],
  charts: [
    { title: "population", obs: "pop" },
    { title: "office values, sample (market read)", obs: "val.office" },
    { title: "office values, sample (cap read held)", obs: "inc.office" },
  ],
};

// ANOTHER SHOCK OF NOTHING, through other doors (REAL_ECONOMY_PLAN 0.3).
// One placebo is one path to divergence; the floor is the spread over several.
// Neither draws from the engine's RNG, neither moves money through the books
// (they are perturbations of a state, not payments), and no actor could act
// on it: a bank's capital moved by one part in ten thousand. (A third, one
// tenant's cash +$100, never diverged in 180 months on seeds 11/22/33: that
// cash reaches no decision, so it measured nothing and was dropped.)
const quiet = (id, title, what, poke) => ({
  id, group: "placebo", title, what, sources: placebo.sources,
  inject(g, city, i, ctx) { if (i === 0) ctx.notes.push(poke(g)); },
  land: () => ({ ok: true, msg: "perturbed" }),
  expect: placebo.expect,
});
const placeboLender = quiet("placebo-lender", "Placebo: a bank's capital +$1,000",
  "The largest desk's capital raised by $1,000 at the snapshot (one part in ten thousand of a town lender's capital) and left alone.",
  (g) => {
    const l = [...(g.lenders ?? [])].sort((a, b) => (b.capital ?? 0) - (a.capital ?? 0) || (a.name < b.name ? -1 : 1))[0];
    if (!l) return "no lender: not injected";
    l.capital += 1000;
    return `${l.name} capital +$1,000`;
  });
export const SHOCKS = [placebo, placeboLender];
