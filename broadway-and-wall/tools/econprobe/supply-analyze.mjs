import { readFileSync } from "node:fs";
const runs = (process.argv.length>2?process.argv.slice(2):["q0.json","q1.json"]).flatMap((f) => JSON.parse(readFileSync(f, "utf8")));
const K = ["office", "retail", "multifamily", "industrial"];
const pct = (x) => (100 * x).toFixed(2) + "%", f = (x, d = 2) => Number.isFinite(x) ? x.toFixed(d) : "—";
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
for (const r of runs) {
  const R = r.rows, a = R[11], b = R.at(-1), yrs = (b.m - a.m) / 12;
  console.log(`\n### seed ${r.seed}`);
  console.log(`local CPI ${pct(Math.pow(b.cpi / a.cpi, 1 / yrs) - 1)}/yr vs national price level ${pct(Math.pow(b.natP / a.natP, 1 / yrs) - 1)}/yr · local/national level at y50 ${f((b.cpi / a.cpi) / (b.natP / a.natP))}`);
  console.log(`mean local u ${pct(mean(R.map((x) => x.unemp)))} vs national ${pct(mean(R.map((x) => x.nUnemp)))} · mean local inflExp ${pct(mean(R.map((x) => x.inflExp)))} nat inflExp ${pct(mean(R.map((x) => x.natInflExp)))} · nominal wage ${pct(Math.pow(b.wage / a.wage, 1 / yrs) - 1)}/yr natWage ${pct(Math.pow(b.natWage / a.natWage, 1 / yrs) - 1)}/yr`);
  console.log(`crewUtil mean ${f(mean(R.map((x) => x.crewUtil)))} (<1 in ${pct(R.filter((x) => x.crewUtil < 1).length / R.length)} of months) · cityJobs mean ${f(mean(R.map((x) => x.cityJobs)), 1)} · demolished total ${b.demolished}`);
  for (const k of K) {
    const atF = R.filter((x) => x[k].vac <= x[k].fric + 0.003);
    const pz = R.filter((x) => (x[k].pencil ?? 1) <= 0).length;
    const zs = R.filter((x) => !(x[k].starts > 0));
    const zsPinned = atF.filter((x) => !(x[k].starts > 0));
    console.log(`${k.padEnd(12)} at-friction ${pct(atF.length / R.length)} · sitePencil=0 ${pct(pz / R.length)} · zero-start ${pct(zs.length / R.length)} · zero-start WHILE at friction ${pct(zsPinned.length / Math.max(1, atF.length))} · structTight mean when pinned ${f(mean(atF.map((x) => x[k].st ?? 0)), 3)} · pencil mean ${f(mean(R.map((x) => x[k].pencil ?? 0)), 3)}`);
  }
  const Y = R.filter((x) => x.landAll !== undefined);
  for (const yi of [0, 10, 20, 30, 40, Y.length - 1]) { const y = Y[yi]; console.log(`  yr ${String(yi + 1).padStart(2)} land med all $${f(y.landAll, 0)} vacant $${f(y.landVac, 0)} (real all ${f(y.landAll / y.cpi, 0)}) · vacant lots ${y.nVacant} · rebuilt-on-old ${y.rebuilt} of ${y.nB} · cost ${f(y.cost)} cpi ${f(y.cpi)}`); }
}
