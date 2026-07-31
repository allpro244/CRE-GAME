import { useStore } from "@/state/store";
import { CLASS_COLOR, CLASS_LABEL } from "@/data/types";

const sf = (n: number) => n.toLocaleString() + " sf";
const usd = (n: number) =>
  n >= 1_000_000 ? "$" + (n / 1_000_000).toFixed(2) + "M" : "$" + Math.round(n).toLocaleString();

export default function ParcelPanel() {
  const parcels = useStore((s) => s.parcels);
  const adjacency = useStore((s) => s.adjacency);
  const selectedBBL = useStore((s) => s.selectedBBL);
  const select = useStore((s) => s.select);

  if (!selectedBBL || !parcels) return null;
  const rec = parcels[selectedBBL];
  if (!rec) return null;
  const neighbors = adjacency?.[selectedBBL] ?? [];
  const builtFar = rec.lotArea > 0 ? rec.bldgArea / rec.lotArea : 0;
  const farMax = Math.max(rec.farMaxComm, rec.farMaxRes);
  const imp = (field: string) => (rec.imputed.includes(field) ? "*" : "");

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <div className="panel-address">{rec.address}</div>
          <div className="panel-bbl mono">BBL {rec.bbl}</div>
        </div>
        <button className="panel-close" onClick={() => select(null)} aria-label="Close">×</button>
      </div>

      <div className="chip-row">
        <span className="chip" style={{ background: CLASS_COLOR[rec.class] }}>{CLASS_LABEL[rec.class]}</span>
        <span className="chip chip-zone mono">{rec.zoneDist}</span>
        <span className="chip chip-class mono">{rec.bldgClass}</span>
      </div>

      <div className="grid">
        <Row k="Lot area" v={sf(rec.lotArea) + imp("lotArea")} />
        <Row k="Building area" v={rec.bldgArea ? sf(rec.bldgArea) + imp("bldgArea") : "—"} />
        <Row k="Floors" v={rec.floors ? String(rec.floors) + imp("floors") : "—"} />
        <Row k="Year built" v={rec.yearBuilt ? String(rec.yearBuilt) + imp("yearBuilt") : "—"} />
        <Row k="FAR built / max" v={`${builtFar.toFixed(1)} / ${farMax.toFixed(1)}`} />
        {rec.unitsRes > 0 && <Row k="Residential units" v={String(rec.unitsRes)} />}
        <Row k="Assessed land" v={usd(rec.assessedLand) + imp("assessedLand")} />
        <Row k="Assessed total" v={usd(rec.assessedTotal) + imp("assessedTotal")} />
        <Row k="Land value" v={"$" + rec.landPsf.toLocaleString() + " /sf"} />
      </div>

      <div className="demand">
        <div className="demand-label">
          <span>Demand</span>
          <span className="mono">{rec.demandScore}</span>
        </div>
        <div className="demand-track">
          <div className="demand-fill" style={{ width: rec.demandScore + "%" }} />
        </div>
      </div>

      <div className="neighbors">
        <div className="neighbors-head">Adjoining lots · {neighbors.length}</div>
        <div className="neighbors-list">
          {neighbors.map((n) => {
            const nr = parcels[n];
            return (
              <button key={n} className="neighbor" onClick={() => select(n)}>
                <span className="neighbor-addr">{nr?.address ?? n}</span>
                <span className="neighbor-meta mono">
                  {nr ? `${nr.lotArea.toLocaleString()} sf · ${CLASS_LABEL[nr.class]}` : ""}
                </span>
              </button>
            );
          })}
          {neighbors.length === 0 && <div className="neighbor-none">No shared lot lines on record.</div>}
        </div>
      </div>

      {rec.imputed.length > 0 && (
        <div className="footnote">* imputed from building-class medians (missing or absurd in source)</div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <div className="k">{k}</div>
      <div className="v mono">{v}</div>
    </>
  );
}
