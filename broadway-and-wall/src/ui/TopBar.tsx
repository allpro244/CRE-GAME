import { useEffect, useRef, useState } from "react";
import { headlineEpithet } from "@/engine/firm";
import { useStore, derivedNetWorth, derivedQuarterCF } from "@/state/store";
import { monthLabel } from "@/engine/types";
import { currentCity, currentSeed, listCities, switchCity, type CityInfo } from "@/state/city";
import { usd, pct } from "./format";

export default function TopBar() {
  const [armNewRun, setArmNewRun] = useState(false);
  const fps = useStore((s) => s.fps);
  const manifest = useStore((s) => s.manifest);
  const game = useStore((s) => s.game);
  const lens = useStore((s) => s.lens);
  const setLens = useStore((s) => s.setLens);
  const advance = useStore((s) => s.advance);
  const advanceYear = useStore((s) => s.advanceYear);
  const advanceUntil = useStore((s) => s.advanceUntil);
  const page = useStore((s) => s.page);
  const setPage = useStore((s) => s.setPage);
  const nw = derivedNetWorth();
  const cf = derivedQuarterCF();
  const dealsCount = game ? game.lois.length + Object.values(game.holdings).filter((h) => h.sale?.offer).length : 0;
  // What happened THIS MONTH that was not routine — the badge is the reason to
  // look, not a count of everything ever written.
  const unread = game ? game.news.filter((n) => n.q === game.month && (n.kind === "warn" || n.kind === "event")).length : 0;

  // The islands that ship. This used to be a live switch between campaigns for
  // the whole run; it is now the choice you make when a run begins, and the
  // one you make again when you end one. See the two menus below.
  const [cities, setCities] = useState<CityInfo[]>([]);
  const [cityOpen, setCityOpen] = useState(false);
  const cityRef = useRef<HTMLDivElement>(null);
  const newRunRef = useRef<HTMLDivElement>(null);

  /* THE BAR PUBLISHES ITS OWN HEIGHT.
     Everything that hangs below it — the parcel panel, the page overlays, the
     deed stamp — was positioned from a constant of 60px, and the bar has not
     been 60px tall since the firm's name went under the title: it measures 91
     at 1600px and taller still when the controls wrap to a second row at
     narrow widths. While the bar faded to transparent the overlap was
     invisible; now that it is an opaque plate, it clips the panel's address
     off the top of the card.
     Fixed by measuring rather than by choosing a bigger constant, because the
     wrap means there is no constant that is right at every width. */
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const apply = () =>
      document.documentElement.style.setProperty("--topbar-h", `${Math.round(el.getBoundingClientRect().height)}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { void listCities().then(setCities); }, []);
  useEffect(() => {
    if (!cityOpen) return;
    const close = (e: MouseEvent) => {
      if (cityRef.current && !cityRef.current.contains(e.target as Node)) setCityOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [cityOpen]);
  // The armed New-city menu disarms the same way, so a click anywhere else is
  // never one click away from erasing a campaign.
  useEffect(() => {
    if (!armNewRun) return;
    const close = (e: MouseEvent) => {
      if (newRunRef.current && !newRunRef.current.contains(e.target as Node)) setArmNewRun(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [armNewRun]);

  return (
    <div className="topbar" ref={barRef}>
      <div className="brand">
        <span className="brand-name">Broadway &amp; Wall</span>
        {/* WHO THE CITY THINKS YOU ARE. Every rival firm has a name and a
            characterisation; the player was the string "You". This is the
            headline epithet — the most quotable true thing about the firm,
            recomputed every quarter from state the player could have looked
            up themselves. It costs nothing to read and nothing to maintain. */}
        {game?.firm && (
          <span className="firm-id" title={(game.firm.epithets ?? []).map((e) => e.text).join(" · ") || "The town has not formed a view yet."}>
            <span className="firm-name">{game.firm.name}</span>
            {(() => {
              const e = headlineEpithet(game);
              if (!e) return null;
              const yrs = Math.floor((game.month - e.sinceM) / 12);
              return <span className="firm-epithet">{e.text}{yrs >= 8 ? ` — ${yrs} years now` : ""}</span>;
            })()}
          </span>
        )}
        {/* YOU DO NOT GET TO CHANGE TOWNS MID-CAMPAIGN.
            The picker used to be live for the whole run, and every island kept
            its own autosave, so a bad decade in one town was two clicks away
            from a fresh start in another and the town you were "playing" was
            never a commitment. A city you are stuck with is the premise of the
            game: the submarket you misread is the submarket you have to trade
            your way out of.
            The choice does not disappear, it moves to where it belongs — the
            start of a run. See the New city button, which already asks twice
            before erasing anything. */}
        {cities.length > 1 && !game ? (
          <div className="city-pick" ref={cityRef}>
            <button
              className="brand-sub city-pick-btn"
              title={`Choose an island. Once a game starts this is fixed for its life — changing towns means starting over.\nThis town was built from seed ${currentSeed()}.`}
              onClick={() => setCityOpen((v) => !v)}
            >
              {manifest?.city ?? currentCity()} ▾
            </button>
            {cityOpen && (
              <div className="city-menu">
                {cities.map((c) => (
                  <button
                    key={c.id}
                    className={"city-item" + (c.id === currentCity() ? " city-item-on" : "")}
                    onClick={() => { if (c.id !== currentCity()) switchCity(c.id); else setCityOpen(false); }}
                  >
                    <span className="city-item-name">{c.name}</span>
                    <span className="city-item-tag">{c.tagline}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : game ? (
          <span
            className="brand-sub city-locked"
            title={`You are playing ${manifest?.city ?? currentCity()}, built from seed ${game.citySeed ?? currentSeed()}. `
              + `A campaign belongs to its town — to play a different one, start a new game.`}
          >
            {manifest?.city ?? currentCity()}
          </span>
        ) : (
          <span className="brand-sub">
            {manifest?.city ?? (manifest?.district === "MN" ? "Manhattan" : "Lower Manhattan · CD 1")}
          </span>
        )}
        {manifest?.source === "synthetic" && (
          <span className="badge badge-warn" title="Generated stand-in data — run `pnpm pipeline` on an open network to fetch real PLUTO data.">
            SYNTHETIC DEV DATA
          </span>
        )}
      </div>

      {game && (
        <div className="topbar-game">
          {/* THE READOUTS ARE THE ONLY THING ALLOWED TO SHRINK.
              This row was one flat nowrap flex line — eight readouts, six nav
              buttons, three lenses and three advance buttons — inside a bar
              laid out with space-between. Once the contents exceeded the
              window the row simply overflowed its box and the advance buttons
              came to rest ON TOP of Saves, Settings and New city. The media
              queries hid readouts one at a time to buy room, which is a guess
              about how much room is needed rather than a guarantee.
              Boxing the numbers separately makes it structural: the numbers
              can shrink and clip because every one of them is also on a page,
              and the CONTROLS cannot, because a button you cannot reach is not
              a control. */}
          <div className="topbar-stats">
          <Stat label={monthLabel(game.month)} value={`Yr ${Math.floor(game.month / 12) + 1}`} wide />
          <Stat label="Cash" value={usd(game.cash)} bad={game.cash < 0} />
          <Stat label="Net worth" value={usd(nw)} drop={2} />
          <Stat label="CF / mo" value={usd(cf)} bad={cf < 0} drop={2} />
          <Stat
            label="Base rate"
            value={pct(game.econ.indexRate)}
            drop={3}
            title="The benchmark every loan in town prices off. Your floating loans reprice to it monthly (through the cap strike, if you bought one), and any new quote — mortgage, construction loan, credit line — is this rate plus the lender's spread."
          />
          {(game.loc?.balance ?? 0) > 0 && <Stat label="Line drawn" value={usd(game.loc.balance)} bad />}
          <Stat label="Market" value={game.econ.phase} drop={3} />
          <Stat
            drop={3}
            label="Vacant lots"
            value={String(Math.max(0, game.totalLots - game.builtAtStart - Object.keys(game.built).length))}
            title={`Empty lots left in ${manifest?.city ?? "town"}. Every one is a site someone can build on — as they run out, land gets scarce and prices climb. ${game.totalLots ? Math.round((100 * (game.builtAtStart + Object.keys(game.built).length)) / game.totalLots) : 0}% of the city is built.`}
          />
          </div>
          <span className="topbar-sep" />
          <button className={"nav-btn" + (page === "portfolio" ? " nav-on" : "")} onClick={() => setPage(page === "portfolio" ? "none" : "portfolio")}>
            Portfolio
          </button>
          <button className={"nav-btn" + (page === "deals" ? " nav-on" : "")} onClick={() => setPage(page === "deals" ? "none" : "deals")}>
            Deals{dealsCount > 0 ? ` · ${dealsCount}` : ""}
          </button>
          <button className={"nav-btn" + (page === "research" ? " nav-on" : "")} onClick={() => setPage(page === "research" ? "none" : "research")}>
            Research
          </button>
          {(() => {
            // The badge counts what wants an answer, not what you own — a book
            // of performing notes is not a to-do list and must not look like one.
            const live = (game.noteOffers?.length ?? 0)
              + (game.notes ?? []).filter((n) => n.perf === "nonperforming" && n.filedM === undefined).length;
            const held = game.notes?.length ?? 0;
            if (!live && !held) return null;
            return (
              <button className={"nav-btn" + (page === "notes" ? " nav-on" : "")} onClick={() => setPage(page === "notes" ? "none" : "notes")}>
                Notes{live > 0 ? ` · ${live}` : ""}
              </button>
            );
          })()}
          <button className={"nav-btn" + (page === "market" ? " nav-on" : "")} onClick={() => setPage(page === "market" ? "none" : "market")}>
            Marketplace
          </button>
          <button className={"nav-btn" + (page === "economy" ? " nav-on" : "")} onClick={() => setPage(page === "economy" ? "none" : "economy")}>
            Economy
          </button>
          <button className={"nav-btn" + (page === "leasing" ? " nav-on" : "")} onClick={() => setPage(page === "leasing" ? "none" : "leasing")}>
            Leasing
          </button>
          <button className={"nav-btn" + (page === "books" ? " nav-on" : "")} onClick={() => setPage(page === "books" ? "none" : "books")}>
            Books
          </button>
          {/* THE TAPE HAD NOWHERE TO LIVE. Every headline this economy writes
              was rendered into a 260px scroll box at the BOTTOM of the Books
              page, under the ledger — which is the same as not having a news
              page, and the owner asked where it was. It is a top-level
              destination now, for the same reason Saves was promoted out of
              that page: reading the news is not an accounting task. */}
          <button className={"nav-btn" + (page === "news" ? " nav-on" : "")} onClick={() => setPage(page === "news" ? "none" : "news")}>
            News{unread > 0 ? ` · ${unread}` : ""}
          </button>
          <span className="topbar-sep" />
          <button
            className={"lens-btn" + (lens === "land" ? " lens-on" : "")}
            onClick={() => setLens(lens === "land" ? "none" : "land")}
            title="Land value lens — shade every lot by current land $/sf"
          >
            ◧ Land
          </button>
          <button
            className={"lens-btn" + (lens === "demand" ? " lens-on lens-on-teal" : "")}
            onClick={() => setLens(lens === "demand" ? "none" : "demand")}
            title="Demand lens — transit + employment gravity, the why behind the rents"
          >
            ◨ Demand
          </button>
          <button
            className={"lens-btn" + (lens === "owners" ? " lens-on lens-on-teal" : "")}
            onClick={() => setLens(lens === "owners" ? "none" : "owners")}
            title="Owners lens — every building the other firms hold, one colour per firm. Yours stay gold."
          >
            ◫ Owners
          </button>
          <button className="advance-btn" onClick={advance} disabled={!!game.gameOver} title="One month (Space)">
            Advance ▸
          </button>
          <button className="advance-btn advance-fast" onClick={advanceYear} disabled={!!game.gameOver} title="A year, stopping if something needs you (Y)">
            Yr ▸▸
          </button>
          <button className="advance-btn advance-fast" onClick={advanceUntil} disabled={!!game.gameOver} title="Skip to the next thing that needs a decision, up to 3 years (N)">
            ⏭
          </button>
        </div>
      )}

      <div className="topbar-right">
        {/* SAVES, WHERE SOMEBODY CAN FIND THEM. The whole save/load panel was
            built and then rendered only at the bottom of the Books page, under
            the ledger — which is the same as not having one. It is a top-level
            control now, because loading a game is not an accounting task. */}
        <button
          className={"lens-btn" + (page === "saves" ? " lens-on" : "")}
          title="Save this run under a name, or load one back"
          onClick={() => setPage(page === "saves" ? "none" : "saves")}
        >
          ⛁ Saves
        </button>
        <button
          className={"lens-btn" + (page === "settings" ? " lens-on" : "")}
          title="Settings — pop-up cards, broker calls, the auction card"
          onClick={() => setPage(page === "settings" ? "none" : "settings")}
        >
          ⚙ Settings
        </button>
        {/* No window.confirm here. Browsers that suppress dialogs (an iframe,
            or "prevent this page from creating dialogs" ticked once) make
            confirm() return false silently and forever — the button reads as
            dead. A two-click arm-then-fire needs nothing from the browser. */}
        {/* THE ISLAND IS CHOSEN HERE, because this is the only moment choosing
            it is a decision rather than an escape hatch. Arming the button
            offers the other towns alongside "yes, this one again" — the same
            two-click safety as before, with the choice the top-left picker
            used to hand out mid-campaign. */}
        <div className="city-pick" ref={newRunRef}>
          <button
            className={"lens-btn" + (armNewRun ? " lens-on" : "")}
            title="Start over. A brand new town — every block re-cut, every lot line new, every building somewhere else — and a chance to pick a different island. No holdings, $6M cash."
            onClick={() => {
              if (!armNewRun) { setArmNewRun(true); setTimeout(() => setArmNewRun(false), 8000); return; }
              setArmNewRun(false);
              useStore.getState().newRun();
            }}
          >
            {armNewRun ? "Erase this game?" : "↺ New city"}
          </button>
          {armNewRun && cities.length > 1 && (
            <div className="city-menu city-menu-right">
              <div className="city-menu-head">or start over somewhere else</div>
              {cities.filter((c) => c.id !== currentCity()).map((c) => (
                <button
                  key={c.id}
                  className="city-item"
                  onClick={() => { setArmNewRun(false); useStore.getState().newRun(c.id); }}
                >
                  <span className="city-item-name">{c.name}</span>
                  <span className="city-item-tag">{c.tagline}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <span className={"stat mono " + (fps >= 55 ? "fps-good" : fps >= 30 ? "fps-ok" : "fps-bad")}>
          {fps} fps
        </span>
      </div>
    </div>
  );
}

// `drop` ranks a readout's expendability when the bar runs out of width: 3
// goes first, then 2, and anything unranked never goes. Every one of these
// numbers is also on a page — Books, the Economy — so losing one costs a
// glance, not information. The controls are not rankable: they stay.
function Stat({ label, value, bad, wide, title, drop }: { label: string; value: string; bad?: boolean; wide?: boolean; title?: string; drop?: 2 | 3 }) {
  return (
    <div className={"tstat" + (wide ? " tstat-wide" : "") + (drop ? ` tstat-d${drop}` : "")} title={title}>
      <span className="tstat-label">{label}</span>
      {value && <span className={"tstat-value mono" + (bad ? " neg" : "")}>{value}</span>}
    </div>
  );
}
