import { useStore } from "@/state/store";
import type { GameState } from "@/engine/types";

/**
 * Signature of everything a property desk needs for one BBL.
 *
 * Zustand notifies every `useStore(s => s.game)` subscriber on any mutation —
 * LOI counters, cash draws, news — so a docked parcel card and its child desks
 * used to re-render the whole file on every click in town. Components that call
 * `useHeldGame(bbl)` only re-render when THIS parcel's picture (or the city-wide
 * indices it prices off) actually moved.
 */
export function holdingDeskSig(g: GameState | null | undefined, bbl: string): string {
  if (!g || !bbl) return "";
  const h = g.holdings[bbl];
  const sale = h?.sale;
  const tenants = h?.tenants?.map((t) => `${t.sf}:${t.rentPsf}:${t.endM}:${t.credit}`).join(";") ?? "";
  const lois = g.lois
    .filter((l) => l.bbl === bbl)
    .map((l) => `${l.id}:${l.rentPsf}:${l.tiPsf}:${l.stage}:${l.expiresM}`)
    .join(",");
  const listing = g.listings.find((l) => l.bbl === bbl);
  const ap = g.approaches[bbl];
  const talk = g.talks?.[bbl];
  const dev = g.developments[bbl];
  const w = g.workouts?.[bbl];
  const gl = g.groundLeases?.[bbl];
  return [
    g.month,
    g.cash,
    g.econ.phase,
    g.econ.indexRate,
    g.econ.costIdx,
    g.econ.landIdx,
    g.econ.rentIdx?.office,
    g.econ.rentIdx?.retail,
    g.econ.rentIdx?.multifamily,
    g.econ.rentIdx?.industrial,
    g.econ.cycleDev,
    g.agent ? 1 : 0,
    g.loc?.balance ?? 0,
    g.facility?.balance ?? 0,
    // Assemble / neighbour gates — another deed in the book can unlock the desk
    // without touching this holding's own fields.
    Object.keys(g.holdings).length,
    (g.facility?.bbls ?? []).join(","),
    h ? 1 : 0,
    h?.condition,
    h?.condIdx,
    h?.boughtM,
    h?.costBasis,
    h?.loan?.balance,
    h?.loan?.ratePct,
    h?.loan?.maturityM,
    h?.renovatingUntilM,
    h?.broker ? 1 : 0,
    h?.leasingHold ? 1 : 0,
    h?.plan,
    h?.service,
    sale?.ask,
    sale?.offer?.price,
    sale?.offer?.expiresM,
    sale?.unsolicited ? 1 : 0,
    tenants,
    lois,
    listing?.ask ?? "",
    ap?.ask ?? "",
    ap?.q ?? "",
    // Purchase negotiation state. This was missing from the parcel signature,
    // so a seller's counter updated GameState without re-rendering the offer
    // desk. Moving the slider changed local React state and accidentally made
    // the counter appear, which is why the slider seemed required.
    talk?.theirPrice ?? "",
    talk?.yourPrice ?? "",
    talk?.round ?? "",
    talk?.final ? 1 : 0,
    talk?.agreed ? 1 : 0,
    talk?.agreedPrice ?? "",
    dev?.deliverM ?? "",
    dev?.startM ?? "",
    w?.stage ?? "",
    w?.cure ?? "",
    gl ? `${gl.endM}:${gl.rentYr}:${gl.review ?? "fixed"}:${gl.builtM ?? ""}:${gl.floors ?? ""}` : "",
    h?.groundOffer ? `${h.groundOffer.years}:${h.groundOffer.review ?? "fixed"}:${h.groundOffer.sinceM}` : "",
    g.merged?.[bbl] ?? "",
    g.built?.[bbl] ? 1 : 0,
    (h?.hist?.length ?? 0),
    h?.hist?.length ? h.hist[h.hist.length - 1]!.join(":") : "",
  ].join("|");
}

/** Subscribe to one parcel's desk inputs; read the live game during render. */
export function useHeldGame(bbl: string): GameState {
  useStore((s) => holdingDeskSig(s.game, bbl));
  return useStore.getState().game!;
}
