// THE SITE FINDER (MDGA phase 6).
//
// A developer's first question is "where can I build that pays?", and the game
// had the answer in every vacant lot's land read — the builder's residual
// (margin included) against what the dirt costs — and showed it one lot at a
// time, after you had already clicked the lot. This puts the same numbers in
// one ranked list: the lots on the tape a builder can pay the ask for, and the
// ripe lots nobody has listed yet, whose owners are worth a call. Nothing here
// is a second model: it is `landRead`, the number the land market prices off.
import { useMemo } from "react";
import { useStore } from "@/state/store";
import { landRead, resolveRec } from "@/engine/value";
import { usd, sf } from "@/ui/format";

type Row = { bbl: string; address: string; lotSf: number; price: number; pay: number; ratio: number; scheme: string };

export function SiteFinder() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const month = game.month;
  const { listed, ripe, vacant, pencilAtMarket } = useMemo(() => {
    const asks = new Map(game.listings.map((l) => [l.bbl, l.ask] as const));
    const listed: Row[] = [], ripe: Row[] = [];
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
      const sc = read.scheme;
      const scheme = sc ? `${sc.use} · ${sc.floors} fl` : "—";
      const ask = asks.get(bbl);
      if (ask !== undefined) {
        listed.push({ bbl, address: rec.address, lotSf: rec.lotArea, price: ask, pay, ratio: ask > 0 ? pay / ask : 0, scheme });
      } else if (pay > 0 && read.winner === "builder" && !game.approaches[bbl]) {
        ripe.push({ bbl, address: rec.address, lotSf: rec.lotArea, price: market, pay, ratio: market > 0 ? pay / market : 0, scheme });
      }
    }
    listed.sort((a, b) => b.ratio - a.ratio);
    ripe.sort((a, b) => b.pay - a.pay);
    return { listed, ripe: ripe.slice(0, 6), vacant, pencilAtMarket };
    // the land read is monthly; the tape changes with listings
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, game.listings, game.holdings, game.approaches, parcels]);

  const go = (bbl: string) => {
    const st = useStore.getState();
    st.setPage("none");
    st.select(bbl);
  };
  const ratioCell = (r: number) => (
    <td className={"num" + (r >= 1 ? " pos" : r < 0.8 ? " dim" : "")}>{r > 0 ? r.toFixed(2) + "×" : "—"}</td>
  );
  const table = (rows: Row[], priceLabel: string) => (
    <table className="tbl">
      <thead>
        <tr>
          <th>Lot</th><th className="num">Lot sf</th><th className="num">{priceLabel}</th>
          <th className="num" title="What a builder can pay for this dirt and still earn the developer margin — the land residual">Builder can pay</th>
          <th className="num" title="Builder can pay over the price. At or above 1.0× a scheme clears the hurdle at this price.">Pays</th>
          <th>Best scheme</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.bbl} onClick={() => go(r.bbl)} style={{ cursor: "pointer" }}>
            <td>{r.address}</td>
            <td className="num">{sf(r.lotSf)}</td>
            <td className="num">{usd(r.price)}</td>
            <td className="num">{r.pay > 0 ? usd(r.pay) : "—"}</td>
            {ratioCell(r.ratio)}
            <td className="dim">{r.scheme}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="page-section" style={{ marginTop: 14 }}>
      <div className="page-section-head">
        Sites · {pencilAtMarket} of {vacant} vacant lots pencil at today's land price
      </div>
      <div className="hint" style={{ marginBottom: 6 }}>
        A lot pencils when a builder can pay more for the dirt than it costs and still earn the developer margin.
        The Sites map lens shows the same thing for every lot in town.
      </div>
      {(() => {
        // only lots a builder can use; the rest of the dirt is on the tape below
        const useful = listed.filter((r) => r.pay > 0);
        if (useful.length) return table(useful.slice(0, 8), "Ask");
        return (
          <div className="dim">
            {listed.length
              ? `${listed.length} vacant lot${listed.length === 1 ? " is" : "s are"} on the tape and no builder can pay for any of them at today's rents — wait for a ripe one, or call the owners below.`
              : "No vacant land on the tape this month."}
          </div>
        );
      })()}
      {ripe.length > 0 && (
        <>
          <div className="page-section" style={{ marginTop: 10 }}>Ripe, not listed — worth a call to the owner</div>
          {table(ripe, "Market price")}
        </>
      )}
    </div>
  );
}
