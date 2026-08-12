// PLAYTEST DRIVER (throwaway, research only)
//
// Runs a job list across CPU cores as child processes and writes one JSON file
// per job into a scratch directory. Child processes rather than worker threads
// because each run holds a full city and a century of history, and a crashed
// run should cost one job rather than the batch.
//
//   node tools/pt-drive.mjs <jobsfile.json> <outdir> [concurrency]
//
// jobsfile.json: [{ "script": "tools/pt-econ.mjs", "id": "...", "cfg": {...} }, ...]
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const jobs = JSON.parse(readFileSync(process.argv[2], "utf8"));
const OUT = process.argv[3];
const CONC = Number(process.argv[4] ?? 4);
mkdirSync(OUT, { recursive: true });

let next = 0, done = 0, failed = 0;
const t0 = Date.now();

function runOne(job) {
  return new Promise((resolve) => {
    const outFile = join(OUT, `${job.id}.json`);
    if (existsSync(outFile)) { // resume support: never redo finished work
      done++;
      console.log(`[skip] ${job.id}`);
      return resolve();
    }
    const ch = spawn("node", ["--max-old-space-size=2048", join(ROOT, job.script), JSON.stringify(job.cfg)], {
      cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "", err = "";
    ch.stdout.on("data", (d) => (out += d));
    ch.stderr.on("data", (d) => (err += d));
    ch.on("close", (code) => {
      const mins = ((Date.now() - t0) / 60000).toFixed(1);
      if (code === 0 && out.trim().startsWith("{")) {
        writeFileSync(outFile, out);
        done++;
        console.log(`[${done + failed}/${jobs.length} ${mins}m] ok   ${job.id}`);
      } else {
        failed++;
        writeFileSync(join(OUT, `${job.id}.ERR.txt`), `code=${code}\n${err}\n---STDOUT---\n${out.slice(0, 4000)}`);
        console.log(`[${done + failed}/${jobs.length} ${mins}m] FAIL ${job.id} code=${code} ${err.split("\n")[0]?.slice(0, 160)}`);
      }
      resolve();
    });
  });
}

async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++];
    await runOne(job);
  }
}

console.log(`driver: ${jobs.length} jobs, concurrency ${CONC} -> ${OUT}`);
await Promise.all(Array.from({ length: CONC }, () => worker()));
console.log(`\ndone=${done} failed=${failed} in ${((Date.now() - t0) / 60000).toFixed(1)}m`);
