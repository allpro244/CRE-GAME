import { readFileSync, readdirSync } from "fs";
const C = ["office","retail","industrial","multifamily"]; const mean = a => a.reduce((x,y)=>x+y,0)/a.length;
for (const dir of process.argv.slice(2)) { const out = [];
 for (const f of readdirSync(dir).filter(f => /^seed-\d+\.json$/.test(f)).sort()) {
  const y = JSON.parse(readFileSync(`${dir}/${f}`,"utf8")).yr;
  const prop = y.map(x => mean(C.map(k => Math.log(x.rentR[k]/x.cap[k])))), land = y.map(x => Math.log(x.landR));
  const d5 = a => a.map((x,i)=> i>=5 && i%5===0 ? x-a[i-5] : NaN).filter(Number.isFinite);
  const a = d5(land), b = d5(prop); const ma = mean(a), mb = mean(b); let s=0,sa=0,sb=0; for (let i=0;i<a.length;i++){s+=(a[i]-ma)*(b[i]-mb);sa+=(a[i]-ma)**2;sb+=(b[i]-mb)**2;}
  out.push(`${f.match(/\d+/)[0]}:${(s/Math.sqrt(sa*sb)).toFixed(2)}`); }
 console.log(dir.split("/").pop().padEnd(10), out.join(" ")); }
