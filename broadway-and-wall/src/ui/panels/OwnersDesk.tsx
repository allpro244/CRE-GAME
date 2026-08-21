import { Fragment, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useStore } from "@/state/store";
import { resolveRec } from "@/engine/value";
import { allOwners } from "@/engine/ownership";
import type { OwnerView } from "@/engine/ownership";
import { usd, sf } from "@/ui/format";
import { useLabel, Row, STYLE_WORD } from "@/ui/panels/shared";

/**
 * THE REGISTER OF DEEDS — everybody who owns anything in this town, on one
 * page, with their accounts open.
 *
 * There were two of these and they were different in kind. `The street` listed
 * the operating firms: balance sheets, leverage, dry powder, what they own.
 * `Landlords` listed the private holders: a name, a note, and where you stood
 * with them. Between them they owned the city, and the difference between the
 * two pages was not a difference between the two kinds of owner — it was a
 * difference in what had been implemented. Click a tower held by Kestrel
 * Capital and you got a balance sheet; click the identical tower next door and
 * you got a sentence about a family.
 *
 * That is not how anybody in this business sees a market. The two brothers who
 * own eleven buildings and no office are not less legible than a fund; they are
 * more, because the whole street knows what they paid and who wrote the paper.
 * So there is one register now, sorted by the size of the book, and the
 * question it answers is the one that was previously unanswerable without
 * reading two tables and doing the arithmetic yourself: WHO ACTUALLY OWNS THIS
 * CITY. Most of the time the answer is a name that has never bid on anything.
 *
 * The firm/holder distinction did not disappear — it became a column, which is
 * what it always was. An operator works the tape and can fail; a holder owns.
 * Both of them now hand you the same two statements.
 */
export function Owners() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const focus = useStore((s) => s.focus);
  const [open, setOpen] = useState<string | null>(null);
  const [only, setOnly] = useState<"all" | "firms" | "private">("all");

  const rows = useMemo(() => {
    return allOwners(game, parcels).map((o) => {
      let area = 0;
      for (const b of o.book) area += resolveRec(parcels, game, b)?.bldgArea ?? 0;
      return { o, sf: area };
    });
  }, [game, parcels]);

  const shown = rows.filter((r) => only === "all" || (only === "firms" ? r.o.operator : !r.o.operator));
  const totAssets = rows.reduce((a, r) => a + r.o.sheet.assets, 0);
  const top10 = rows.slice(0, 10).reduce((a, r) => a + r.o.sheet.assets, 0);
  const firms = rows.filter((r) => r.o.operator).length;

  return (
    <div>
      <div className="hint">
        {rows.length} owners hold {usd(totAssets)} of property between them — {firms} of them are operating
        firms that bid against you, and the other {rows.length - firms} are private holders who mostly do not.
        The ten biggest own {totAssets > 0 ? ((top10 / totAssets) * 100).toFixed(0) : 0}% of it. Every name
        here opens: what they own, what they owe on it, and what it earns them in a year.
      </div>
      <div className="row-btns" style={{ marginBottom: 8 }}>
        {([["all", "Everyone"], ["firms", "Operating firms"], ["private", "Private holders"]] as const).map(([k, label]) => (
          <button key={k} className={"btn" + (only === k ? " btn-on" : "")} onClick={() => setOnly(k)}>{label}</button>
        ))}
      </div>
      <div className="scroll-x">
        <table className="tbl">
          <thead>
            <tr>
              <th>Owner</th><th>What they are</th><th className="num">Deeds</th><th className="num">Square feet</th>
              <th className="num">Gross assets</th><th className="num">Debt</th><th className="num">Net worth</th>
              <th className="num">Yield</th><th className="num">Cash flow / yr</th><th>Where you stand</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ o, sf: area }) => {
              const isOpen = open === o.id;
              const dead = o.failedM !== undefined;
              return (
                <Fragment key={o.id}>
                  <tr className={dead ? "dim" : ""} style={{ cursor: "pointer" }} title={o.note}
                    onClick={() => setOpen(isOpen ? null : o.id)}>
                    <td>{isOpen ? "▾ " : "▸ "}{o.name}</td>
                    <td className="dim">
                      {dead
                        ? "in receivership"
                        : o.operator
                          ? o.style ? STYLE_WORD[o.style] ?? o.style : "operator"
                          : `${o.kind} · holder`}
                    </td>
                    <td className="num">{o.book.length}</td>
                    <td className="num">{area > 0 ? sf(area) : "—"}</td>
                    <td className="num">{usd(o.sheet.assets)}</td>
                    <td className={"num" + (o.sheet.debt > 0 ? " dim" : "")}>{o.sheet.debt > 0 ? usd(o.sheet.debt) : "clear"}</td>
                    <td className={"num" + (o.sheet.equity < 0 ? " neg" : "")}>{usd(o.sheet.equity)}</td>
                    <td className="num">{o.sheet.assets > 0 ? `${((o.income.noi / o.sheet.assets) * 100).toFixed(1)}%` : "—"}</td>
                    <td className={"num" + (o.income.net < 0 ? " neg" : "")}>{usd(o.income.net)}</td>
                    <td className={o.cold ? "neg" : o.rel.deals > 0 ? "" : "dim"}>{o.standing}</td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={10} style={{ background: "rgba(43,37,26,0.035)" }}>
                        <OwnerStatement o={o} onFocus={(b) => focus(b, true)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="hint">
        An offer somebody finds insulting is not filed against the building — it is filed against THEM, and
        they own the other four. That is what the last column is for, and it is true of a fund and a family
        alike.
      </div>
    </div>
  );
}

/**
 * ONE OWNER'S ACCOUNTS, in the shape the player's own Books page uses.
 *
 * Shared by the register and by the street table's drawer on purpose: a
 * competitor whose statement is laid out differently from yours is a
 * competitor you cannot read at a glance, and three expressions of "what is
 * this firm worth" is how a table comes to disagree with the row it expands
 * into — the fault the street table already had to fix once.
 */
export function OwnerStatement({ o, onFocus, extra, extraLate }: {
  o: OwnerView;
  onFocus?: (bbl: string) => void;
  /** Rows only one caller has, above the accounts — a firm's principal and its pace. */
  extra?: ReactNode;
  /** ...and below them: what a firm has in the ground, and what it has taken out. */
  extraLate?: ReactNode;
}) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const i = o.income;
  if (o.publicOwner) {
    return <div className="hint">{o.note}</div>;
  }
  return (
    <>
      {o.note && <div className="hint" style={{ marginBottom: 6 }}>{o.note}</div>}
      {extra}
      <div className="page-section" style={{ marginTop: 4 }}>Balance sheet</div>
      <div className="grid" style={{ margin: "6px 0" }}>
        <Row k="Gross assets" v={usd(o.sheet.assets)}
          title="Their book, marked at the same appraisal your own parcel cards show." />
        <Row k="Debt" v={o.sheet.debt > 0 ? usd(o.sheet.debt) : "owned free and clear"} bad={o.sheet.ltv > 0.8} />
        <Row k="Cash" v={usd(o.sheet.cash)}
          title={o.operator
            ? "Dry powder. A firm sitting on cash is a firm that will outbid you."
            : "Working capital — a few months of net income. A private holder is not bidding on anything."} />
        <Row k="Net worth" v={usd(o.sheet.equity)} strong bad={o.sheet.equity < 0} />
        <Row k="Leverage" v={o.sheet.assets > 0 ? `${(o.sheet.ltv * 100).toFixed(0)}% LTV` : o.sheet.debt > 0 ? "no assets" : "—"}
          bad={o.sheet.ltv > 0.8} />
      </div>
      {/* THE PART NOBODY COULD SEE BEFORE. What a book earns is what decides
          whether its owner is a seller — and for nine buildings in ten in this
          city there was no answer to it anywhere in the game. */}
      <div className="page-section">Income statement · a year at today's marks</div>
      <div className="grid" style={{ margin: "6px 0" }}>
        <Row k="Net operating income" v={usd(i.noi)}
          title="Rent collected, less operating costs, management and property tax." />
        <Row k="Leasing" v={"−⁠" + usd(i.leasing)} title="Commissions and fit-out on space that turns over." />
        <Row k="Capital plan" v={"−⁠" + usd(i.capex)} title="Roofs, plant, make-ready — the reserve that stops a building sliding." />
        <Row k="Overhead" v={"−⁠" + usd(i.ga)}
          title={o.operator ? "An office: asset management, accounting, audit, legal." : "Bookkeeping, filings and whatever lawyers this kind of owner needs."} />
        <Row k="Interest" v={"−⁠" + usd(i.interest)} />
        <Row k="Amortisation" v={"−⁠" + usd(i.amort)} title="Principal repaid — cash out of the door that is not a cost." />
        <Row k="Cash flow after debt" v={usd(i.net)} strong bad={i.net < 0} />
        <Row k="Yield on assets" v={o.sheet.assets > 0 ? `${((i.noi / o.sheet.assets) * 100).toFixed(2)}%` : "—"} />
      </div>
      {extraLate}
      <div className="page-section" style={{ marginTop: 4 }}>What they own · {o.book.length}</div>
      {o.book.length === 0 && <div className="hint">Nothing. All cash, looking.</div>}
      {/* EVERY DEED, not the first sixty — you cannot see what somebody is
          quietly assembling from a list that stops early. Sorted by value,
          because that is how a book is read. */}
      <div className="mini-list">
        {o.book.map((b) => {
          const rec = resolveRec(parcels, game, b);
          return rec ? { b, rec } : null;
        }).filter(Boolean).sort((a, b2) => (b2!.rec.bldgArea ?? 0) - (a!.rec.bldgArea ?? 0)).map((row) => (
          <button key={row!.b} className="neighbor"
            onClick={(ev) => { ev.stopPropagation(); onFocus?.(row!.b); }}>
            <span className="neighbor-addr">{row!.rec.address}</span>
            <span className="neighbor-meta">
              {row!.rec.class === "land" || !(row!.rec.bldgArea > 0)
                ? "vacant land"
                : `${useLabel(row!.rec)} · ${sf(row!.rec.bldgArea)}`}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
