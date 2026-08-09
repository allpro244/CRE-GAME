import { useEffect, useRef, useState } from "react";
import { headlineEpithet } from "@/engine/firm";
import { useStore, derivedNetWorth, derivedQuarterCF } from "@/state/store";
import { monthLabel } from "@/engine/types";
import { currentCity, currentSeed } from "@/state/city";
import { usd, pct } from "./format";
import { liveBrokerCalls } from "./RightPanel";

export default function TopBar() {
  const [armNewRun, setArmNewRun] = useState(false);
  const fps = useStore((s) => s.fps);
  const fpsOn = useStore((s) => s.fpsOn);
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
  // OFF-MARKET FILES WAITING, AND HOW LONG THE NEAREST ONE HAS.
  //
  // These arrived as a full-screen card until this pass, which meant the player
  // could not miss one and did not need a badge. On a page they can, and the
  // engine drops an approach twelve months after it lands whether or not
  // anybody read it — so a list with no signal would turn a file with a clock
  // on it into free optionality, which is a difficulty dial wearing a UI
  // change's clothes. Counted the same way News counts: what wants an answer,
  // not what exists. The tooltip carries the soonest lapse, because "3" tells
  // you there is something and not whether it is urgent.
  const bcalls = game ? liveBrokerCalls(game) : [];
  const bcallSoon = bcalls.length ? Math.max(0, bcalls[0].lapseM - game!.month) : 0;

  // WHICH TOWN IS NOT ASKED HERE ANY MORE. The island, the size and the
  // build-out used to hang off the New-city button as a three-section
  // dropdown, which measured 973px tall at 1280x720 with its confirm button
  // 353px below the bottom of the window — fourteen options and no way to
  // reach the end of them. They live on the start screen now, which has a
  // scroller and a footer that cannot scroll away. See ui/StartMenu.tsx.
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
  // The armed New-city button disarms on a click anywhere else, so a campaign
  // is never one click away from being erased.
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
            start screen, which is where a run begins now. The New city button
            still asks twice before erasing anything and then goes back there. */}
        {game ? (
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
          <Stat label={monthLabel(game.month)} value={`Yr ${Math.floor(game.month / 12) + 1}`} wide w={152} />
          <Stat label="Cash" value={usd(game.cash)} bad={game.cash < 0} w={98} />
          <Stat label="Net worth" value={usd(nw)} drop={2} w={104} />
          {/* ANNUAL, BECAUSE EVERY OTHER NUMBER IN THIS BUSINESS IS. Cap rates,
              NOI, debt service coverage and every quote on every page are
              annual; a monthly cash flow in the header was the one figure the
              player had to mentally multiply before it could be compared with
              anything else on screen. */}
          <Stat label="CF / yr" value={usd(cf * 12)} bad={cf < 0} drop={2} w={98} />
          <Stat
            label="Base rate"
            value={pct(game.econ.indexRate)}
            drop={3}
            w={80}
            title="The benchmark every loan in town prices off. Your floating loans reprice to it monthly (through the cap strike, if you bought one), and any new quote — mortgage, construction loan, credit line — is this rate plus the lender's spread."
          />
          {(game.loc?.balance ?? 0) > 0 && <Stat label="Line drawn" value={usd(game.loc.balance)} bad w={98} />}
          <Stat label="Market" value={game.econ.phase} drop={3} w={84} />
          <Stat
            drop={3}
            w={92}
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
            Deals<Badge n={dealsCount} />
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
            // THE WHOLE DESK USED TO BE INVISIBLE UNTIL IT CAME TO YOU.
            //
            // `if (!live && !held) return null` hid an 804-line market — buying
            // paper off pressured desks, servicing it, restructuring, filing,
            // selling — behind the condition that the game had already offered
            // you some. A player who was never offered a note had no way to
            // learn the business exists, which is how it came to be reported as
            // a mechanic that needed building. It was built; it was unreachable.
            //
            // The badge still counts only what wants an answer, so a book of
            // performing notes does not nag. The button is simply always there,
            // the way Marketplace is there on a month when nothing is listed.
            void live; void held;
            return (
              <button className={"nav-btn" + (page === "notes" ? " nav-on" : "")} onClick={() => setPage(page === "notes" ? "none" : "notes")}>
                Notes<Badge n={live} />
              </button>
            );
          })()}
          <button
            className={"nav-btn" + (page === "market" ? " nav-on" : "")}
            title={bcalls.length
              ? `${bcalls.length} off-market file${bcalls.length === 1 ? "" : "s"} on the phone. The soonest lapses in `
                + `${bcallSoon} month${bcallSoon === 1 ? "" : "s"} — after that the broker's client has stopped listening.`
              : "Everything for sale in town, and anything a broker is shopping you off-market."}
            onClick={() => setPage(page === "market" ? "none" : "market")}
          >
            Marketplace{bcalls.length > 0 ? ` · ☎ ${bcalls.length}` : ""}
          </button>
          <button className={"nav-btn" + (page === "economy" ? " nav-on" : "")} onClick={() => setPage(page === "economy" ? "none" : "economy")}>
            Economy
          </button>
          <button className={"nav-btn" + (page === "leasing" ? " nav-on" : "")} onClick={() => setPage(page === "leasing" ? "none" : "leasing")}>
            Leasing
          </button>
          {/* WHAT THE FIRM OWES, IN ONE PLACE. Every debt number in the game
              existed on some building's record and nowhere in aggregate, so
              the weighted coupon, the fixed/floating split, the maturity wall
              and the portfolio coverage ratio were things a player could only
              get by opening thirty buildings and doing arithmetic. A red dot
              when a third of the book matures inside three years, because that
              is the number that ends firms. */}
          {(() => {
            const g = game;
            let bal = 0, wall = 0;
            for (const h of Object.values(g?.holdings ?? {})) {
              if (!h.loan) continue;
              bal += h.loan.balance;
              if (h.loan.maturityM - (g?.month ?? 0) <= 36) wall += h.loan.balance;
            }
            if (g?.facility) {
              bal += g.facility.balance;
              if (g.facility.maturityM - g.month <= 36) wall += g.facility.balance;
            }
            const hot = bal > 0 && wall / bal > 0.35;
            const swept = !!g?.facility?.breachedSince;
            return (
              <button
                className={"nav-btn" + (page === "debt" ? " nav-on" : "")}
                title={bal > 0
                  ? `${(bal / 1e6).toFixed(1)}M outstanding${hot ? ` — ${((wall / bal) * 100).toFixed(0)}% of it matures inside three years` : ""}`
                  : "Everything you own is owned outright."}
                onClick={() => setPage(page === "debt" ? "none" : "debt")}
              >
                Debt{swept ? " · ⚠" : hot ? " · !" : ""}
              </button>
            );
          })()}
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
            News<Badge n={unread} />
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
            className={"lens-btn" + (lens === "zoning" ? " lens-on" : "")}
            onClick={() => setLens(lens === "zoning" ? "none" : "zoning")}
            title="Zoning lens — how much of the allowed envelope is still unbuilt. Bright is room to build; dark is spent, and landmarked lots go black."
          >
            ◩ Zoning
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
        {/* THE ONE PAGE THAT ASSUMES YOU HAVE NEVER DONE THIS. Everything else
            in this game is written for somebody who already knows what a cap
            rate is. */}
        <button
          className={"lens-btn" + (page === "primer" ? " lens-on" : "")}
          title="New to commercial real estate? Cap rates, NOI and appraisals, in plain words"
          onClick={() => setPage(page === "primer" ? "none" : "primer")}
        >
          ? Primer
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
        {/* ONE BUTTON, ONE PROMISE. It used to open the three menus that chose
            the next town, which is how it grew taller than the window. It now
            does what its label says and nothing else: erase this campaign and
            go back to the start screen, where the next town is chosen with
            room to read the options. */}
        <div className="city-pick" ref={newRunRef}>
          <button
            className={"lens-btn" + (armNewRun ? " lens-on" : "")}
            title="End this campaign and go back to the start screen, where you pick the island, the size and how built up the town is. This town's autosave is erased. No holdings, the opening bankroll you choose, a brand new town."
            onClick={() => {
              if (!armNewRun) { setArmNewRun(true); setTimeout(() => setArmNewRun(false), 12000); return; }
              setArmNewRun(false);
              useStore.getState().newRun();
            }}
          >
            {armNewRun ? "Erase this game?" : "↺ New city"}
          </button>
        </div>
        {fpsOn && (
          <span className={"stat mono " + (fps >= 55 ? "fps-good" : fps >= 30 ? "fps-ok" : "fps-bad")}>
            {fps} fps
          </span>
        )}
      </div>
    </div>
  );
}

// `drop` ranks a readout's expendability when the bar runs out of width: 3
// goes first, then 2, and anything unranked never goes. Every one of these
// numbers is also on a page — Books, the Economy — so losing one costs a
// glance, not information. The controls are not rankable: they stay.
/**
 * A COUNT THAT DOES NOT MOVE THE BUTTON IT IS ON.
 *
 * `Deals` becoming `Deals · 3` becoming `Deals · 12` widens the button and
 * walks every control to its right along with it — and the deals count changes
 * on almost every Advance, which is exactly when the player's cursor is parked
 * over a button. The badge gets a fixed slot; the label never moves. It renders
 * the slot even at zero so appearing and disappearing costs nothing either.
 */
function Badge({ n }: { n: number }) {
  return <span className="nav-badge">{n > 0 ? `· ${n}` : ""}</span>;
}

/**
 * A READOUT THAT KEEPS ITS PLACE.
 *
 * Every stat in this bar was a content-sized flex box, so the whole row moved
 * whenever any value changed WIDTH — and the values change width constantly:
 * `$2.5M` becomes `$12.4M`, `May 2000` becomes `September 2043`, `peak` becomes
 * `recession`. Press Advance a few times and the nav buttons walk left and
 * right under the cursor, which is the reported bug and is worst for exactly
 * the player who presses Advance the most.
 *
 * The digits were already tabular so the glyphs lined up; what moved was the
 * CHARACTER COUNT, which no font setting fixes. So each readout reserves the
 * room its widest plausible value needs and grows inside its own box. `w` is
 * that reservation in pixels — wide enough for the longest month name, the
 * longest phase word, and a negative nine-figure number with a suffix.
 */
function Stat({ label, value, bad, wide, title, drop, w }: { label: string; value: string; bad?: boolean; wide?: boolean; title?: string; drop?: 2 | 3; w?: number }) {
  return (
    <div
      className={"tstat" + (wide ? " tstat-wide" : "") + (drop ? ` tstat-d${drop}` : "")}
      title={title}
      style={w ? { minWidth: w } : undefined}
    >
      <span className="tstat-label">{label}</span>
      {value && <span className={"tstat-value mono" + (bad ? " neg" : "")}>{value}</span>}
    </div>
  );
}
