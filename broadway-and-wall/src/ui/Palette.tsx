// THE COMMAND PALETTE (Cmd/Ctrl-K). Type three letters and be anywhere: any
// address, tenant, firm, lender, desk, lens or clock action. The hotkey that
// toggles `paletteOpen` lives in GamePanels; everything after the toggle
// lives here.
//
// The outer component subscribes to one boolean, so the index — every parcel
// in a town of up to six thousand lots — is built on the frame the palette
// opens and thrown away when it closes, never kept warm behind a surface
// that is almost always shut.
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, type Lens, type Page } from "@/state/store";
import type { GameState } from "@/engine/types";
import { CLASS_LABEL, type ParcelTable } from "@/data/types";
import { resolveRec } from "@/engine/value";
import { livingRivals } from "@/engine/rivals";
import "./palette.css";

type Kind = "clock" | "desk" | "lens" | "deed" | "tenant" | "firm" | "lender" | "lot";

interface Entry {
  id: string;
  kind: Kind;
  label: string;
  lower: string;
  sub?: string;
  subLower?: string;
  /** Right-aligned kind tag; the word is the category, color only seconds it. */
  tag: string;
  /** The three advance actions sit out while the clock is already running. */
  needsIdleClock?: boolean;
  run: () => void;
}

/** Ties break toward the things you can act on over the raw city. */
const KIND_ORDER: Record<Kind, number> = {
  clock: 0, desk: 1, lens: 2, deed: 3, tenant: 4, firm: 5, lender: 6, lot: 7,
};

const KIND_KICKER: Record<Kind, string> = {
  clock: "The clock",
  desk: "Desks",
  lens: "Lenses",
  deed: "Your book",
  tenant: "Tenants",
  firm: "Firms",
  lender: "Lenders",
  lot: "The city",
};

// The same words the top bar's nav uses for the same rooms. Kept by hand:
// the palette must read like the nav it stands in for, and importing the bar
// to borrow its copy would drag the whole vitals machine along.
const DESKS: readonly { id: Page; label: string; note: string }[] = [
  { id: "market", label: "Marketplace", note: "Listings, receiver books, auctions and off-market calls" },
  { id: "deals", label: "Deals", note: "LOIs, negotiations and contracts" },
  { id: "notes", label: "Notes", note: "Distressed paper — claims on buildings, not the deed" },
  { id: "portfolio", label: "Portfolio", note: "Holdings, income and concentration" },
  { id: "leasing", label: "Leasing", note: "Occupancy, expirations and mandate" },
  { id: "staff", label: "Staff", note: "People, capacity and judgment" },
  { id: "firm", label: "The Record", note: "Every deed, delivery, exit and refinancing since founding" },
  { id: "debt", label: "Debt", note: "Loans, line and the maturity wall" },
  { id: "books", label: "Books", note: "Cash movement and the ledger" },
  { id: "research", label: "Research", note: "Comps, submarkets and underwriting" },
  { id: "news", label: "News", note: "What the city wrote this month" },
  { id: "economy", label: "Economy", note: "Cycle, space markets and construction" },
  { id: "saves", label: "Saves", note: "Named snapshots; the live campaign autosaves" },
  { id: "settings", label: "Settings", note: "Pop-up cards, broker calls, the auction card" },
  { id: "primer", label: "Primer", note: "Cap rates, NOI and appraisals, in plain words" },
];

const LENSES: readonly { id: Lens; label: string; note: string }[] = [
  { id: "none", label: "Lens: clear", note: "Plain massing, no shading" },
  { id: "listings", label: "Lens: market", note: "Highlight everything for sale on the map" },
  { id: "land", label: "Lens: land value", note: "Shade every lot by current land $/sf" },
  { id: "demand", label: "Lens: demand", note: "Transit and employment gravity — the why behind the rents" },
  { id: "zoning", label: "Lens: zoning", note: "How much of the allowed envelope is still unbuilt" },
  { id: "owners", label: "Lens: owners", note: "Every building the other firms hold; yours stay gold" },
  { id: "leases", label: "Lens: leases", note: "Months to next expiry on buildings you own" },
];

const STYLE_WORD: Record<string, string> = {
  core: "institutional core",
  opportunistic: "opportunistic",
  developer: "developer",
  family: "family office",
  merchant: "merchant builder",
  pe: "private equity",
  reit: "listed REIT",
  vulture: "distressed specialist",
  owneruser: "owner-user",
  foreign: "offshore capital",
  slumlord: "slumlord",
};

const LENDER_WORD: Record<string, string> = {
  bank: "bank", life: "life insurer", conduit: "conduit", fund: "debt fund",
};

function mk(e: Omit<Entry, "lower" | "subLower">): Entry {
  return { ...e, lower: e.label.toLowerCase(), subLower: e.sub?.toLowerCase() };
}

// Same rule and the same words as the keyboard clock in GamePanels: an
// undismissed card on the desk outranks the calendar, however you reach for it.
function clockClear(): boolean {
  if (document.querySelector(".modal-backdrop")) {
    useStore.setState({
      toast: { text: "Answer or dismiss the card on your desk before advancing time.", kind: "err", at: Date.now() },
    });
    return false;
  }
  return true;
}

function buildIndex(game: GameState, parcels: ParcelTable): Entry[] {
  const st = () => useStore.getState();
  const out: Entry[] = [];

  // The clock first — the actions a player reaches for most, and the whole
  // of the empty-query screen's opening group.
  out.push(mk({
    id: "c:month", kind: "clock", label: "Advance a month", tag: "clock", needsIdleClock: true,
    sub: "One tick of the calendar (space)",
    run: () => { if (clockClear()) st().advance(); },
  }));
  out.push(mk({
    id: "c:year", kind: "clock", label: "Advance a year", tag: "clock", needsIdleClock: true,
    sub: "Twelve months, stopping early for anything that needs an answer (Y)",
    run: () => { if (clockClear()) st().advanceYear(); },
  }));
  out.push(mk({
    id: "c:skip", kind: "clock", label: "Skip to next decision", tag: "clock", needsIdleClock: true,
    sub: "Run the clock until something lands on your desk (N)",
    run: () => { if (clockClear()) st().advanceUntil(); },
  }));
  out.push(mk({
    id: "c:maponly", kind: "clock", label: "Map only", tag: "clock",
    sub: "Hide the desks and watch the skyline (M)",
    run: () => st().setMapOnly(!st().mapOnly),
  }));
  out.push(mk({
    id: "c:frame", kind: "clock", label: "Photo frame", tag: "clock",
    sub: "Hide all chrome for a clean skyline still (P)",
    run: () => st().setPhotoFrame(true),
  }));
  out.push(mk({
    id: "c:book", kind: "clock", label: "Show my book on the map", tag: "clock",
    sub: "Owners lens, your holdings lit, camera fitted to what you own",
    run: () => st().showBookOnMap(),
  }));

  for (const d of DESKS) {
    out.push(mk({
      id: `desk:${d.id}`, kind: "desk", label: d.label, sub: d.note, tag: "desk",
      run: () => st().setPage(d.id),
    }));
  }

  for (const l of LENSES) {
    out.push(mk({
      id: `lens:${l.id}`, kind: "lens", label: l.label, sub: l.note, tag: "lens",
      run: () => st().setLens(l.id),
    }));
  }

  // Deeds you hold, then the tenants inside them. resolveRec sees through
  // assemblages and ground-up work, so a merged site answers to the parent
  // address the rest of the game uses for it.
  for (const [bbl, h] of Object.entries(game.holdings)) {
    const rec = resolveRec(parcels, game, bbl);
    const address = rec?.address ?? bbl;
    out.push(mk({
      id: `d:${bbl}`, kind: "deed", label: address, tag: "yours",
      sub: rec ? `${rec.district} · ${CLASS_LABEL[rec.class]}` : undefined,
      run: () => st().focus(bbl, true),
    }));
    h.tenants.forEach((t, ti) => {
      out.push(mk({
        id: `t:${bbl}:${ti}`, kind: "tenant", label: t.name, sub: address, tag: "tenant",
        run: () => { st().focus(bbl); st().setPage("property"); },
      }));
    });
  }

  for (const r of livingRivals(game)) {
    const style = STYLE_WORD[r.style] ?? r.style;
    const held = r.bbls.length;
    const first = r.bbls[0];
    out.push(mk({
      id: `f:${r.id}`, kind: "firm", label: r.name, tag: "firm",
      sub: held ? `${style} · ${held} building${held === 1 ? "" : "s"}` : style,
      run: first ? () => st().focus(first, true) : () => st().setPage("research"),
    }));
  }

  for (const l of game.lenders ?? []) {
    const word = LENDER_WORD[l.kind] ?? l.kind;
    out.push(mk({
      id: `ln:${l.id}`, kind: "lender", label: l.name, tag: "lender",
      sub: l.failedM !== undefined ? `${word} — in receivership` : word,
      run: () => st().setPage("debt"),
    }));
  }

  // The whole city, flat. Deeds you hold already carry their address above,
  // and rank above the raw lot list by kind order.
  for (const bbl of Object.keys(parcels)) {
    if (game.holdings[bbl]) continue;
    const rec = parcels[bbl];
    out.push(mk({
      id: `p:${bbl}`, kind: "lot", label: rec.address, sub: rec.district, tag: "lot",
      run: () => st().focus(bbl, true),
    }));
  }

  return out;
}

// starts-with beats a word-boundary hit beats a bare substring; the sub line
// (district, building, style) is the weakest voice. No fuzz — a miss is a miss.
function rankOf(e: Entry, q: string): number {
  if (e.lower.startsWith(q)) return 4;
  if (e.lower.includes(" " + q)) return 3;
  if (e.lower.includes(q)) return 2;
  if (e.subLower && e.subLower.includes(q)) return 1;
  return 0;
}

const CAP = 12;

export default function Palette() {
  const open = useStore((s) => s.paletteOpen);
  if (!open) return null;
  return <PaletteBody />;
}

function PaletteBody() {
  const game = useStore((s) => s.game);
  const parcels = useStore((s) => s.parcels);
  const advancing = useStore((s) => s.advancing);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const entries = useMemo(
    () => (game && parcels ? buildIndex(game, parcels) : []),
    [game, parcels],
  );

  const q = query.trim().toLowerCase();
  const { list, total } = useMemo(() => {
    if (!q) {
      // The blank screen is the two lists worth memorising: the clock, then
      // every desk in the firm.
      const base = entries.filter((e) => e.kind === "clock" || e.kind === "desk");
      return { list: base, total: base.length };
    }
    const scored: { e: Entry; rank: number }[] = [];
    for (const e of entries) {
      const rank = rankOf(e, q);
      if (rank > 0) scored.push({ e, rank });
    }
    scored.sort((a, b) =>
      b.rank - a.rank
      || KIND_ORDER[a.e.kind] - KIND_ORDER[b.e.kind]
      || a.e.label.length - b.e.label.length
      || a.e.label.localeCompare(b.e.label));
    return { list: scored.slice(0, CAP).map((x) => x.e), total: scored.length };
  }, [entries, q]);

  // Rows render grouped under tiny kickers. Group order is order of first
  // appearance in the ranked list, so the strongest match's company leads and
  // the top hit is always the first row on screen.
  const grouped = useMemo(() => {
    const order: { kind: Kind; kicker: string; items: { e: Entry; i: number }[] }[] = [];
    const at = new Map<Kind, number>();
    for (const e of list) {
      let gi = at.get(e.kind);
      if (gi === undefined) {
        gi = order.length;
        at.set(e.kind, gi);
        order.push({ kind: e.kind, kicker: KIND_KICKER[e.kind], items: [] });
      }
      order[gi].items.push({ e, i: 0 });
    }
    let i = 0;
    for (const g of order) for (const it of g.items) it.i = i++;
    return order;
  }, [list]);
  const flat = useMemo(() => grouped.flatMap((g) => g.items.map((it) => it.e)), [grouped]);

  const selIdx = flat.length ? Math.min(sel, flat.length - 1) : -1;

  // The key handler reads through refs so the one window listener attaches
  // once and never goes stale against a fresh keystroke's results.
  const flatRef = useRef(flat); flatRef.current = flat;
  const selRef = useRef(selIdx); selRef.current = selIdx;
  const advRef = useRef(advancing); advRef.current = advancing;

  const runEntry = (en: Entry) => {
    if (en.needsIdleClock && advRef.current) return;
    useStore.getState().setPaletteOpen(false);
    en.run();
  };

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setSel(0); }, [q]);

  useEffect(() => {
    // ONE window listener, capture phase, stopping the keys it spends — the
    // global handler in GamePanels reads Escape as close-the-page and space
    // as advance-the-month, and must never see the palette's traffic.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault(); e.stopPropagation();
        useStore.getState().setPaletteOpen(false);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault(); e.stopPropagation();
        const rows = flatRef.current;
        if (!rows.length) return;
        const d = e.key === "ArrowDown" ? 1 : -1;
        setSel((s0) => {
          let i = Math.min(s0, rows.length - 1);
          // Wrap, skipping whatever the running clock has benched.
          for (let n = 0; n < rows.length; n++) {
            i = (i + d + rows.length) % rows.length;
            if (!(rows[i].needsIdleClock && advRef.current)) return i;
          }
          return s0;
        });
        return;
      }
      if (e.key === "Enter") {
        // An IME commit ends on Enter too; that keystroke belongs to the
        // composition, not to the selected row.
        if (e.isComposing) return;
        e.preventDefault(); e.stopPropagation();
        const rows = flatRef.current;
        const i = selRef.current;
        const en = i >= 0 ? rows[i] : undefined;
        if (!en || (en.needsIdleClock && advRef.current)) return;
        useStore.getState().setPaletteOpen(false);
        en.run();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    if (selIdx >= 0) document.getElementById(`palette-opt-${selIdx}`)?.scrollIntoView({ block: "nearest" });
  }, [selIdx]);

  if (!game || !parcels) return null;

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) useStore.getState().setPaletteOpen(false); }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-kicker">Go to</div>
        <input
          ref={inputRef}
          className="palette-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="An address, a tenant, a firm, a desk"
          aria-label="Search the city and the firm"
          role="combobox"
          aria-expanded={flat.length > 0}
          aria-controls="palette-list"
          aria-activedescendant={selIdx >= 0 ? `palette-opt-${selIdx}` : undefined}
          autoComplete="off"
          spellCheck={false}
        />
        {flat.length > 0 ? (
          // mousedown is swallowed so a click on a row never steals focus
          // from the search box; the click itself still runs the row.
          <div className="palette-list" id="palette-list" role="listbox" onMouseDown={(e) => e.preventDefault()}>
            {grouped.map((g) => (
              <div className="palette-group" key={g.kind}>
                <div className="palette-group-kicker" aria-hidden="true">{g.kicker}</div>
                {g.items.map(({ e: en, i }) => {
                  const dis = !!en.needsIdleClock && advancing;
                  return (
                    <button
                      type="button"
                      key={en.id}
                      id={`palette-opt-${i}`}
                      role="option"
                      aria-selected={i === selIdx}
                      aria-disabled={dis || undefined}
                      className={
                        "palette-row"
                        + (i === selIdx ? " palette-row-on" : "")
                        + (dis ? " palette-row-off" : "")
                      }
                      onClick={() => runEntry(en)}
                      onMouseEnter={() => setSel(i)}
                    >
                      <span className="palette-row-label">{en.label}</span>
                      <span className="palette-row-sub">{en.sub ?? ""}</span>
                      <span className={"palette-tag palette-tag-" + en.kind}>{en.tag}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <div className="hint palette-empty">
            Nothing in the city or the firm answers to “{query.trim()}”.
          </div>
        )}
        <div className="palette-foot" onMouseDown={(e) => e.preventDefault()}>
          <span className="palette-keys">
            <kbd>↑↓</kbd> move · <kbd>enter</kbd> go · <kbd>esc</kbd> close
          </span>
          {total > flat.length && (
            <span className="palette-count mono">{flat.length} of {total}</span>
          )}
        </div>
      </div>
    </div>
  );
}
