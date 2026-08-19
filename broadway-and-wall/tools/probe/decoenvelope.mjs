// DOES THE 1916 GEOMETRY DO WHAT ITS COMMENTS SAY IT DOES?
//
// The five deco families in `citygen/massing.mjs` make three claims that a diff
// cannot check and a screenshot can only suggest. Each one is measured here
// against the four families that make the OPPOSITE claim, because a number with
// no control is a number nobody can read:
//
//   OFF-CENTRE. A 1916 setback comes off the sides that face a street and not
//     off the centroid, so a tier's centroid must MOVE relative to the plate's.
//     Controls: `cake`, `taper`, `step` and `base` are uniform centroid shrinks
//     and read 0.000 by construction. If a deco family ever reads 0.000 it has
//     become one of them.
//   ON-PIER. Every setback lands on a whole 2.4 m window bay, so the piers above
//     stand on the piers below. Per axis the grid is set out from ONE edge — a
//     plate whose own width is not a whole number of bays can only put one of
//     its two edges on the grid, and the short bay at the far party wall is what
//     real buildings do too — so the claim under test is one edge per axis.
//     Controls read 2-4%, which is chance at this tolerance.
//   A FLOOR WIDE ENOUGH TO BE A FLOOR. No volume taller than two storeys may be
//     under eleven metres across, measured by rotating calipers rather than off
//     the frame axes, because a CORNER cut spends width on the diagonal where
//     the frame cannot see it. The controls are the reason this column exists:
//     the generator has never enforced `MIN_PLATE_W` and `cake` puts 496 sub-11 m
//     habitable volumes into 1,152 builds.
//
// Two more columns, because no single number covers a silhouette — the same
// lesson `tools/probe/playerslate.js` records about off-centre versus aspect:
//   TOPCOV is the top volume's share of the plate. It is what separates a tower
//     on a QUARTER (0.162) from `base`, which is a tower on a half (0.400) and
//     would not have been permitted.
//   ASPECTCHG is how much the plan's proportion changes on the way up. It is the
//     only column that sees `telescope` (0.436 against `taper`'s 0.031), whose
//     whole move is symmetrical and therefore invisible to off-centre.
//
//   node tools/probe/decoenvelope.mjs
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const R = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { massingStack } = await import(join(R, "src/citygen/massing.mjs"));
const { longestEdgeAngle, extentAlong, centroid, polygonArea } = await import(join(R, "src/citygen/geom.mjs"));
const h01=(a,b)=>{let h=(a*0x9e3779b1)^(b*0x85ebca6b);h=Math.imul(h^(h>>>15),0x2c1b3c6d);h^=h>>>12;return ((h>>>0)%100000)/100000;};
// narrowest support width. 24 directions rather than the exact edge-normal
// answer, because this is the INDEPENDENT check on `narrowestSpan` and a copy of
// the function under test is not a check on it.
const minW=(r)=>{
  let m=1e9;
  for(let i=0;i<24;i++){const a=i*Math.PI/24;const e=extentAlong(r,a);m=Math.min(m,e.span);}
  return m;
};
const FAMS=["zigzag","telescope","quarter","ferriss","crest","cake","taper","step","base"];
const rows={};
for(const fam of FAMS) rows[fam]={n:0,off:[],bay:[],bad:0,narrow:[],tiers:[],topcov:[],asp:[]};
// a spread of plates: square, slab, big, small
const plates=[];
for(const [w,d] of [[16,20],[14,34],[22,26],[30,44],[46,52],[18,18],[12,40],[26,20]])
  plates.push([[0,0],[w,0],[w,d],[0,d]]);
for(const fam of FAMS){
  for(let pi=0;pi<plates.length;pi++){
    const ring=plates[pi];
    for(const hM of [24,32,44,60,84,120]){
      for(let k=0;k<24;k++){
        const r=massingStack({ring,lotRing:null,hM,year:1930,klass:"office",u:(n)=>h01(pi*7919+hM*104729+k*31,n),families:[fam]});
        if(!r) continue;
        const R=rows[fam]; R.n++; R.tiers.push(r.tiers.length);
        const th=longestEdgeAngle(ring);
        const P={u:extentAlong(ring,th),v:extentAlong(ring,th+Math.PI/2)};
        const c0=centroid(ring), W=Math.sqrt(Math.abs(polygonArea([ring])));
        {const tt=r.tiers.reduce((a,b)=>b.top>a.top?b:a);
         R.topcov.push(Math.abs(polygonArea([tt.ring]))/Math.abs(polygonArea([ring])));}
        for(const t of r.tiers.slice(1)){
          const c=centroid(t.ring);
          R.off.push(Math.hypot(c[0]-c0[0],c[1]-c0[1])/W);
          const tu=extentAlong(t.ring,th), tv=extentAlong(t.ring,th+Math.PI/2);
          // Per axis, take the edge the grid was set out FROM: a plate whose own
          // width is not a whole number of bays can only put one of its two
          // edges on the grid, and the short bay at the far party wall is what
          // real buildings do too. So the claim under test is "the setback the
          // grid was set out from lands on a pier", once per axis.
          for(const pair of [[tu.lo-P.u.lo,P.u.hi-tu.hi],[tv.lo-P.v.lo,P.v.hi-tv.hi]]){
            const d=pair.filter(x=>x>0.05);
            if(!d.length) continue;
            const rem=Math.min(...d.map(x=>Math.abs(x/2.4-Math.round(x/2.4))));
            R.bay.push(rem<0.02?1:0);
          }
          const hh=t.top-t.base;
        {const tu2=extentAlong(t.ring,th),tv2=extentAlong(t.ring,th+Math.PI/2);
         R.asp.push(Math.abs((tu2.span/Math.max(0.1,tv2.span))/(P.u.span/Math.max(0.1,P.v.span))-1));}
          if(hh>2*3.9){ const w=minW(t.ring); R.narrow.push(w); if(w<11) R.bad++; }
        }
      }
    }
  }
}
const q=(a,p)=>{const s=[...a].filter(Number.isFinite).sort((x,y)=>x-y);return s.length?s[Math.floor(p*(s.length-1))]:NaN;};
console.log("family      builds  tiers  offcentre(p50/p90)  on-pier setbacks  minW p05  sub-11m  topcov p50/p95  aspectchg p50");
for(const fam of FAMS){const R=rows[fam];
  const onp = R.bay.length ? (100*R.bay.reduce((a,b)=>a+b,0)/R.bay.length).toFixed(0)+"%" : "n/a";
  console.log(`${fam.padEnd(11)}${String(R.n).padStart(6)}${q(R.tiers,.5).toFixed(0).padStart(6)}  ${q(R.off,.5).toFixed(3)} / ${q(R.off,.9).toFixed(3)}       ${onp.padStart(5)}  ${(R.narrow.length?q(R.narrow,.05).toFixed(1):" n/a ")}    ${String(R.bad).padStart(4)}   ${q(R.topcov,.5).toFixed(3)} / ${q(R.topcov,.95).toFixed(3)}    ${q(R.asp,.5).toFixed(3)}`);
}
