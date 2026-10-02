import { useEffect, useState } from "react";
import { useStore } from "@/state/store";
import { monthLabel } from "@/engine/types";
import type { GameState } from "@/engine/types";
import { usd } from "@/ui/format";
import { soundOn, setSoundOn, play } from "@/ui/Sounds";
import { pendingTerm, glossId, glossaryEntries } from "@/ui/Glossary";
import { Row } from "@/ui/panels/shared";
import { JevSettings } from "@/ui/panels/JevPanel";
import { themePref, setThemePref, type ThemePref } from "@/ui/theme";
import { CLOCK_OPTIONS, describeSetup } from "@/engine/setup";

export function PrimerPage() {
  const game = useStore((s) => s.game)!;
  const cap = game.econ.capRate.office;
  // A round, legible example building priced off the market the player is
  // actually in, so every number on this page reconciles with the tape.
  const noi = 1_000_000;
  const value = Math.round(noi / (cap / 100));
  return (
    <div className="primer-prose">
      <div className="hint">
        If you have never bought a building, this page is the whole vocabulary. Everything else in the game
        assumes it. It takes about two minutes and the numbers in it are today's, from your own market.
      </div>

      <div className="page-section">1 · NOI — what the building earns</div>
      <div className="hint">
        <b>Net operating income</b> is the rent the building collects in a year, minus what it costs to run —
        taxes, insurance, repairs, management, the lights in the lobby. It does <b>not</b> subtract the mortgage.
        That is the whole trick of the number: NOI describes the <i>building</i>, so two buyers with different
        loans can look at the same one and agree on what it earns. Your mortgage is your problem, not the
        building's.
        <br /><br />
        A building letting {usd(1_400_000)} of rent a year that costs {usd(400_000)} to run has an NOI
        of <b>{usd(noi)}</b>.
      </div>

      <div className="page-section">2 · Cap rate — the yield you buy it at</div>
      <div className="hint">
        The <b>capitalisation rate</b> is one year's NOI divided by the price. Nothing more.
        <br /><br />
        <span className="mono">cap rate = NOI ÷ price</span>
        <br /><br />
        Buy that {usd(noi)} building for {usd(value)} and you are buying a{" "}
        <b>{cap.toFixed(2)}% cap</b> — the yield your money earns in year one if nothing changes.
        Office in this city trades at about {cap.toFixed(2)}% today, and you can watch that move on the Economy
        page.
        <br /><br />
        <b>A LOW cap rate means an EXPENSIVE building.</b> That is the part everybody gets backwards at first.
        Paying less for the same income is a higher yield, so cheap buildings have high cap rates. When you hear
        that "cap rates compressed", prices went up.
        <br /><br />
        Cap rates are high where the income is risky — an old building, a weak street, one tenant with three
        years left — and low where it is safe. So the cap rate you are quoted is the market telling you what it
        thinks of your building, in one number.
      </div>

      <div className="page-section">3 · Appraisal — somebody's opinion of the price</div>
      <div className="hint">
        An <b>appraisal</b> is a professional estimate of what a building would sell for. Mostly it is the sum
        above run backwards: take the NOI, pick the cap rate the market is paying for buildings like this one,
        and divide.
        <br /><br />
        <span className="mono">value = NOI ÷ cap rate</span>
        <br /><br />
        It is an <b>opinion, not a price</b>. The price is what somebody actually pays, and the two differ all
        the time. The game shows you an appraisal on every building and an ask next to it; the gap between them
        is most of what there is to read. Lenders care because they lend against the appraisal, so it decides
        how much you can borrow.
      </div>

      <div className="page-section">The two traps</div>
      <div className="hint">
        <b>A high cap rate is not a bargain.</b> It is a warning that somebody else looked and passed. Find out
        what they saw — the roll, the lease expiries, the condition — before you decide you are cleverer.
        <br /><br />
        <b>Debt cuts both ways.</b> Borrowing at 6% to buy a 8% yield makes money, and the same loan against a
        building whose tenants leave will take the building. That is what most of the failures in this game are.
      </div>

      <div className="page-section">The words you will meet next</div>
      <div className="grid">
        <Row k="Occupancy" v="How much of the building is let. The rest earns nothing and still costs you." />
        <Row k="Rent roll" v="The list of who is in the building, what they pay, and when they can leave." />
        <Row k="LTV" v="Loan to value — the share of the price the lender put up." />
        <Row k="DSCR" v="NOI divided by the loan payments. Under 1.0 the building cannot pay its own mortgage." />
        <Row k="Yield on cost" v="NOI ÷ what it cost you to build it. The developer's version of a cap rate." />
        <Row k="Lease-up" v="The months between opening an empty building and filling it. Nobody's favourite." />
      </div>
      <div className="hint">
        That is the vocabulary. Everything else the game will teach you by charging you for it.
      </div>
      <PrimerGlossary />
    </div>
  );
}

/**
 * EVERY UNDERLINED WORD, IN ONE PLACE. A dotted word anywhere in the game
 * opens the Primer; it used to open it at the top, a page away from the word.
 * It now lands here, on the entry, lit for a moment.
 */
function PrimerGlossary() {
  const [lit, setLit] = useState<string | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const go = () => {
      const k = pendingTerm.key;
      if (!k) return;
      pendingTerm.key = null;
      const el = document.getElementById(glossId(k));
      if (!el) return;
      el.scrollIntoView({ block: "center" });
      setLit(glossId(k));
      if (t) clearTimeout(t);
      t = setTimeout(() => setLit(null), 2200);
    };
    go();
    window.addEventListener("bw:gloss", go);
    return () => { window.removeEventListener("bw:gloss", go); if (t) clearTimeout(t); };
  }, []);
  return (
    <>
      <div className="page-section">Glossary — every underlined word</div>
      <div className="gloss-list">
        {glossaryEntries().map((e) => (
          <div key={e.key} id={glossId(e.key)} className={"gloss-entry" + (lit === glossId(e.key) ? " gloss-lit" : "")}>
            <span className="gloss-key">{e.key}</span>
            <span className="gloss-def">{e.def}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * One setting: the switch on the left, what it does on the right, on every
 * row. It was declared inside SettingsPage, so each render made a new
 * component type and React remounted the row — the button lost keyboard focus
 * the moment you pressed it — and .modal-actions wrapped the long rows so the
 * switch sat above its label on some rows and beside it on others.
 */
function Toggle({ on, set, label, detail, more }: { on: boolean; set: (v: boolean) => void; label: string; detail: string; more?: string }) {
  return (
    <div className="deal setting-row">
      <button className={"btn" + (on ? " btn-buy" : "")} style={{ minWidth: 64 }} aria-pressed={on} aria-label={`${label}: ${on ? "on" : "off"}`} onClick={() => set(!on)}>
        {on ? "On" : "Off"}
      </button>
      <div className="setting-text">
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div className="hint" style={{ margin: 0 }}>{detail}</div>
        {/* A ONE-LINE ANSWER, THEN THE FINE PRINT. Two of these ran to ninety
            words each; the switch should say what it does before it says
            everything it touches. */}
        {more && (
          <details className="setting-more">
            <summary>More</summary>
            <div className="hint" style={{ margin: "4px 0 0" }}>{more}</div>
          </details>
        )}
      </div>
    </div>
  );
}

function ThemePicker() {
  const [pref, setPref] = useState<ThemePref>(themePref());
  const opts: [ThemePref, string][] = [["light", "Light"], ["dark", "Dark"], ["system", "Match system"]];
  return (
    <div className="setting-row">
      <div className="setting-text">
        <div style={{ fontWeight: 600 }}>Appearance</div>
        <div className="hint" style={{ padding: 0 }}>The desks and cards; the city keeps its own light.</div>
      </div>
      <div className="seg" role="radiogroup" aria-label="Appearance">
        {opts.map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={pref === v}
            className={"seg-btn" + (pref === v ? " on" : "")}
            onClick={() => { setThemePref(v); setPref(v); }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SettingsPage() {
  const game = useStore((s) => s.game)!;
  const popupsOff = useStore((s) => s.popupsOff);
  const [sound, setSound] = useState(soundOn());
  const setPopupsOff = useStore((s) => s.setPopupsOff);
  const alertsOff = useStore((s) => s.alertsOff);
  const setAlertsOff = useStore((s) => s.setAlertsOff);
  const fpsOn = useStore((s) => s.fpsOn);
  const setFpsOn = useStore((s) => s.setFpsOn);
  const preferFps = useStore((s) => s.preferFps);
  const setPreferFps = useStore((s) => s.setPreferFps);
  const flip = (patch: Partial<GameState>) => {
    const st = useStore.getState();
    useStore.setState({ game: { ...st.game!, ...patch } });
  };
  return (
    <div>
      <ThemePicker />
      <Toggle
        on={sound}
        set={(v) => { setSoundOn(v); setSound(v); if (v) play("milestone"); }}
        label="Sounds"
        detail="A soft bell on a milestone, a delivery, a sale and a year closing; a low note on an error. Synthesised, quiet, never on the monthly tick."
      />
      <div className="page-section">Interruptions</div>
      {/* THE CLOCK, as chosen on the setup page — editable here for the life
          of the campaign. See stopRule in engine/sim.ts. */}
      <div className="setting-row">
        <div className="setting-text">
          <div style={{ fontWeight: 600 }}>What stops Yr / Skip / Play</div>
          <div className="hint" style={{ padding: 0 }}>{CLOCK_OPTIONS.find((c) => c.id === (game.clockStops ?? "decisions"))?.note}</div>
        </div>
        <div className="seg" role="radiogroup" aria-label="What stops the clock">
          {CLOCK_OPTIONS.map((c) => {
            const on = (game.clockStops ?? "decisions") === c.id;
            return (
              <button key={c.id} type="button" role="radio" aria-checked={on} title={c.note}
                className={"seg-btn" + (on ? " on" : "")}
                onClick={() => flip({ clockStops: c.id === "decisions" ? undefined : c.id })}>{c.label}</button>
            );
          })}
        </div>
      </div>
      <Toggle
        on={game.brokerStops !== "never"}
        set={(v) => flip({ brokerStops: v ? undefined : "never" })}
        label="Broker first looks stop the clock"
        detail="On, Yr / Skip / Play stop when a broker's private window on a building is about to lapse — only for buildings you could fund at a typical 65% loan. Off, they wait on the Marketplace, marked FIRST LOOK."
      />
      <Toggle
        on={!popupsOff}
        set={(v) => setPopupsOff(!v)}
        label="Pop-up cards"
        detail="Letters, offers, bid lists and the auction take the screen when they arrive. Off, they wait on Deals — nothing is lost but the interruption."
        more={"Covers letters of intent, quiet offers and marketed bid lists on buildings you are selling, portfolio indications and the auction card. "
          + "Off, they wait on Deals (watch the badge) and on the property desk — not on Portfolio, which only shows that a deed is listed. "
          + "Turn this off to simulate long stretches. Bank failures, level events, books taken back, portfolio indications and bid lists also raise "
          + "stop-everything cards on the switch below."}
      />
      <Toggle
        on={!alertsOff}
        set={(v) => setAlertsOff(!v)}
        label="Stop-everything cards"
        detail="Bank failures, economy-wide events, books taken back and bids on your sales take the screen. Off, you read them on News instead."
        more={"The full list: a bank failing, a level event in the wider economy, a book of buildings taken back at once, "
          + "an institution indicating on a portfolio you put in the market, and bids landing on a marketed sale. "
          + "Each is written into the news feed the moment it fires, so turning this off loses the interruption and not the event. "
          + "A lender taking a rival's whole book puts the package on Marketplace under Books for sale. "
          + "With both switches off a sale or portfolio bid still stops Year/Skip and badges Deals, but will not take the screen — "
          + "and a quiet offer lapses in two months, a bid list in fourteen, a portfolio indication in three, if you never open the desk."}
      />
      <Toggle
        on={!game.brokersOff}
        set={(v) => flip({ brokersOff: !v })}
        label="Brokers ring you"
        detail="Off-market deals arrive by phone a few times a year once the street knows your name. Off, the phones stay silent entirely — nothing arrives, on any page."
      />
      <Toggle
        on={!game.auctionQuiet}
        set={(v) => flip({ auctionQuiet: !v })}
        label="The July auction card"
        detail="The county docket comes up as a card when it is published each July. Off, the auction still runs on the same day with the same lots — you read it on Marketplace instead."
      />
      {/* the two renderer switches were filed under Interruptions */}
      <div className="page-section">Display</div>
      <Toggle
        on={fpsOn}
        set={setFpsOn}
        label="Frame counter"
        detail="A frames-per-second readout in the top bar. It is an instrument for looking at the renderer, not part of the game, and it is off unless you want it."
      />
      <Toggle
        on={preferFps}
        set={setPreferFps}
        label="Prefer smoother frames"
        detail="For machines without a discrete GPU: trades a little sharpness for a steadier frame rate. The sim is unchanged."
        more={"Off by default — a fast machine keeps native sharpness and the full photograph. On, it spends less fill rate on pixel density and "
          + "multisampling so the map stays nearer sixty frames. Facades, occupancy and weather are unchanged either way."}
      />
      <div className="hint">
        Pop-up cards is a preference of this browser and applies to every campaign. The broker and auction
        switches are decisions of this firm and travel with the save.
      </div>
      <div className="page-section" style={{ marginTop: 18 }}>Jev</div>
      <JevSettings />
      <div className="page-section" style={{ marginTop: 18 }}>Keyboard</div>
      <div className="grid">
        <Row k="Space" v="Advance one month" />
        <Row k="G" v="Play / pause — the clock runs a month a second and pauses when something needs you" />
        <Row k="Y" v="Advance up to one year, stopping when a decision arrives" />
        <Row k="N" v="Skip to the next decision, up to three years" />
        <Row k="M" v="Map only — hide firm pages, keep the skyline" />
        <Row k="P" v="Photo frame — hide all chrome for a clean skyline still" />
        <Row k="Escape" v="Close the open page (or exit photo frame)" />
        <Row k="1 – 9" v="Open a desk: Portfolio, Market, Deals, Leasing, Debt, Books, Research, Economy, News" />
        <Row k="⌘K / Ctrl K" v="Search every building, desk and firm" />
        <Row k="?" v="Every key on one card, from anywhere" />
      </div>
      <div className="hint">
        Time shortcuts are disabled while a blocking decision card is on screen; answer or dismiss the card first.
      </div>
    </div>
  );
}

export function SavesPage() {
  const devGrant = useStore((s) => s.devGrant);
  const game = useStore((s) => s.game);
  return (
    <div>
      <SaveSlots />
      <div className="page-section" style={{ marginTop: 22 }}>
        <div className="page-section-head">Testing</div>
        <div className="hint">
          Not part of the game. It books nothing and proves nothing — it just puts money on the
          table so you can try things without playing your way to them first.
        </div>
        <div className="btn-row" style={{ marginTop: 8 }}>
          {/* a test lever, not the page's primary action */}
          <button className="btn btn-sm" onClick={devGrant}>+ $100M testing capital</button>
          {game && <span className="hint" style={{ margin: "auto 0" }}>cash today: {usd(game.cash)}</span>}
        </div>
      </div>
    </div>
  );
}

// Named saves are deliberate snapshots; the live campaign is also protected by
// a debounced idle autosave that stays out of this list.
export function SaveSlots() {
  const slots = useStore((s) => s.slots);
  const thisRun = useStore((s) => s.game);
  const { saveTo, loadFrom, dropSave, refreshSlots } = useStore.getState();
  const [name, setName] = useState("");
  // The named save with a deletion pending — window.confirm here had the same
  // browser-chrome problem as demolition, and the same silent-false failure.
  const [killSlot, setKillSlot] = useState<string | null>(null);
  useEffect(() => { void refreshSlots(); }, [refreshSlots]);
  return (
    <div className="page-section">
      <div className="page-section-head">Named saves</div>
      {thisRun?.setup && (
        <div className="hint" style={{ marginBottom: 6 }}>
          This campaign: {thisRun.setup.sandbox ? <span className="badge badge-warn">SANDBOX</span> : null}{" "}
          {describeSetup(thisRun.setup, thisRun.econ?.eraKey) || "the standard world"} · seed <span className="mono">{thisRun.citySeed ?? thisRun.seed}</span>
        </div>
      )}
      <div className="hint">
        Your live campaign autosaves after changes and Continue opens the newest state. Name a slot when you want
        a permanent snapshot you can return to without overwriting it.
      </div>
      <div className="btn-row" style={{ marginTop: 8 }}>
        <input
          className="ask-input mono"
          style={{ width: 200 }}
          placeholder="name this save"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) { void saveTo(name.trim()); setName(""); } }}
          aria-label="Name this save"
        />
        <button className="btn btn-buy" disabled={!name.trim()} onClick={() => { void saveTo(name.trim()); setName(""); }}>
          Save
        </button>
      </div>
      <div style={{ marginTop: 10 }}>
        {slots.map((m) => (
          <div key={m.slot} className="slot-row">
            <div>
              <div className="slot-name">{m.slot}</div>
              <div className="slot-meta mono">{monthLabel(m.month)} · {usd(m.cash)} cash · saved {new Date(m.savedAt).toLocaleDateString()}</div>
              {m.setup && <div className="slot-meta">{m.sandbox ? <span className="badge badge-warn">SANDBOX</span> : null} {m.setup}</div>}
            </div>
            <div className="btn-row" style={{ margin: 0 }}>
              <button className="btn btn-buy" onClick={() => void loadFrom(m.slot)}>Load</button>
              <button className="btn btn-sell" onClick={() => setKillSlot(m.slot)}>Delete</button>
            </div>
          </div>
        ))}
        {!slots.length && <div className="hint">No named saves yet.</div>}
        {(() => {
          const doomed = killSlot === null ? undefined : slots.find((s2) => s2.slot === killSlot);
          if (!doomed) return null;
          return (
            <div className="modal-backdrop">
              <div className="modal">
                <div className="modal-kicker">Delete a saved game</div>
                <div className="modal-title">{doomed.slot}</div>
                <div className="modal-sub">
                  {monthLabel(doomed.month)} · {usd(doomed.cash)} cash · saved {new Date(doomed.savedAt).toLocaleDateString()}.
                  Gone is gone — there is no bin to fish it back out of.
                </div>
                <div className="modal-actions">
                  <button className="btn btn-sell" onClick={() => { setKillSlot(null); void dropSave(doomed.slot); }}>Delete it</button>
                  <button className="btn" onClick={() => setKillSlot(null)}>Keep it</button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
