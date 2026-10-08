// THE SITE FINDER (MDGA phase 6) — one list of the dirt that pencils.
//
// A developer's first question is "where can I build that pays?", and the game
// had the answer in every vacant lot's land read — the builder's residual
// (margin included) against what the dirt costs — and showed it one lot at a
// time, after you had already clicked the lot. This puts the same numbers in
// one ranked list, in two halves: the vacant lots on the tape, by how far the
// builder's residual clears the ask; and the lots nobody is marketing where a
// builder's residual sets the price (sitesThatPencil, the land broker's site
// list), cheapest first, with whose they are. It used to be two lists on the
// Market page, one of each half, built separately; the off-market half here is
// the engine's, which leaves out lots under construction, ground-leased,
// landmarked, civic or merged. Nothing here is a second model: it is
// `landRead`, the number the land market prices off.
import { useMemo, useState } from "react";
import { useStore } from "@/state/store";
import { landRead, resolveRec } from "@/engine/value";
import { sitesThatPencil } from "@/engine/buybox";
import { spendable } from "@/engine/credit";
import { ownerAt } from "@/engine/ownership";
import { usd, sf } from "@/ui/format";

type Row = { bbl: string; address: string; lotSf: number; price: number; pay: number; ratio: number; scheme: string; owner?: string };

const USE_LABEL: Record<string, string> = { office: "Office", retail: "Retail", multifamily: "Apartments", industrial: "Industrial" };
const schemeLabel = (use: string, floors: number) => `${USE_LABEL[use] ?? use} · ${floors} fl`;
const SHOW = 8;

export function SiteFinder() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const month = game.month;
  const [allOff, setAllOff] = useState(false);
  const { listed, offMarket, vacant, pencilAtMarket } = useMemo(() => {
    const asks = new Map(game.listings.map((l) => [l.bbl, l.ask] as const));
    const listed: Row[] = [];
    let vacant = 0, pencilAtMarket = 0;
    for (const bbl of Object.keys(parcels)) {
      if (game.holdings[bbl]) continue;
      const rec = resolveRec(parcels, game, bbl);
      if (!rec || rec.class !== "land" || !rec.lotArea) continue;
      vacant++;
      const read = landRead(rec, game.econ);
      const pay = Math.max(0, read.builder) * rec.lotArea;
      const market = read.psf * rec.lotArea;
      if (pay > 0 && pay >= market) pencilAtMarket++;
      const ask = asks.get(bbl);
      if (ask === undefined) continue;
      const sc = read.scheme;
      listed.push({ bbl, address: rec.address, lotSf: rec.lotArea, price: ask, pay, ratio: ask > 0 ? pay / ask : 0, scheme: sc ? schemeLabel(sc.use, sc.floors) : "—" });
    }
    listed.sort((a, b) => b.ratio - a.ratio);
    // the off-market half is the engine's site list; an owner you are already
    // talking to is on the deals desk, not here
    const offMarket: Row[] = sitesThatPencil(game, parcels, 999)
      .filter((p) => !game.approaches[p.bbl])
      .map((p) => {
        const pay = p.builderPsf * p.lotArea;
        return {
          bbl: p.bbl, address: p.address, lotSf: p.lotArea, price: p.value, pay, ratio: p.value > 0 ? pay / p.value : 0,
          scheme: schemeLabel(p.use, p.floors), owner: ownerAt(game, parcels, p.bbl)?.name ?? "—",
        };
      });
    return { listed, offMarket, vacant, pencilAtMarket };
    // the land read is monthly; the tape changes with listings
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, game.listings, game.holdings, game.approaches, parcels]);
  const purse = spendable(game, parcels).total;

  // open the lot's card, where it can be bought or its owner called
  const go = (bbl: string) => {
    const st = useStore.getState();
    st.focus(bbl);
    st.setPage("property");
  };
  const ratioCell = (r: number) => (
    <td className={"num" + (r >= 1 ? " pos" : r < 0.8 ? " dim" : "")}>{r > 0 ? r.toFixed(2) + "×" : "—"}</td>
  );
  const table = (rows: Row[], priceLabel: string, owners: boolean) => (
    <table className="tbl">
      <thead>
        <tr>
          <th>Lot</th><th className="num">Lot sf</th><th className="num">{priceLabel}</th>
          <th className="num" title="What a builder can pay for this dirt and still earn the developer margin — the land residual">Builder can pay</th>
          <th className="num" title="Builder can pay over the price. At or above 1.0× a scheme clears the hurdle at this price.">Pays</th>
          <th>Best scheme</th>
          {owners && <th>Owner</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.bbl} onClick={() => go(r.bbl)} style={{ cursor: "pointer" }}>
            <td>{r.address}</td>
            <td className="num">{sf(r.lotSf)}</td>
            {/* dimmed: the dirt plus a builder's carry is more than you can fund today */}
            <td className={"num" + (r.price * 1.4 > purse ? " dim" : "")}>{usd(r.price)}</td>
            <td className="num">{r.pay > 0 ? usd(r.pay) : "—"}</td>
            {ratioCell(r.ratio)}
            <td className="dim">{r.scheme}</td>
            {owners && <td className="dim">{r.owner}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );

  const useful = listed.filter((r) => r.pay > 0);
  const off = allOff ? offMarket : offMarket.slice(0, SHOW);
  return (
    <div className="page-section" style={{ marginTop: 14 }}>
      <div className="page-section-head">
        Sites · {pencilAtMarket} of {vacant} vacant lots pencil at today's land price
      </div>
      <div className="hint" style={{ marginBottom: 6 }}>
        A lot pencils when a builder can pay more for the dirt than it costs and still earn the developer margin.
        Click a lot to open its card. The Sites map lens shows the same thing for every lot in town.
      </div>

      <div className="page-section" style={{ marginTop: 6 }}>On the market</div>
      {useful.length
        ? table(useful.slice(0, SHOW), "Ask", false)
        : (
          <div className="dim">
            {listed.length
              ? `${listed.length} vacant lot${listed.length === 1 ? " is" : "s are"} on the tape and no builder can pay for any of them at today's rents — call an owner below.`
              : "No vacant land on the tape this month."}
          </div>
        )}

      <div className="page-section" style={{ marginTop: 10 }}>Off-market · worth a call to the owner</div>
      {offMarket.length === 0
        ? <div className="hint dim">No unlisted lot in town pencils for a builder at today's rents. That is most of the cycle, and it is when the next shortage starts.</div>
        : (
          <>
            {table(off, "Trades at", true)}
            {offMarket.length > SHOW && (
              <button type="button" className="btn btn-sm" style={{ marginTop: 4 }} onClick={() => setAllOff(!allOff)}>
                {allOff ? "Show fewer" : `Show all ${offMarket.length}`}
              </button>
            )}
            <div className="hint">Priced where a builder's residual sets it, so at that number a scheme clears its hurdle with the margin and no more. The owner names their own number when you call — most want more.</div>
          </>
        )}
    </div>
  );
}
