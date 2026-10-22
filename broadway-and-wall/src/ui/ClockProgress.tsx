/**
 * THE CLOCK IS TURNING. A month is closed in the sim worker and takes over a
 * second on a big city (1.3–1.8 s on a 2012 save), a year five or six. The
 * click returns at once, so for that second nothing on screen said anything
 * was happening — a month that is working read as a game that was stuck.
 *
 * This is a thin bar under the time controls while a month (or a year, or a
 * skip) is out. It fills against how long the last months actually took, so
 * it moves at the speed of this city, and it never claims to be done: it
 * stops short and goes when the new month lands.
 *
 * The store's clock calls are wrapped here, from the UI, so nothing in the
 * engine or the store changes: a call goes out, the bar starts; it comes
 * back (or `advancing` drops, for the year and the skip), the bar goes.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { useStore } from "@/state/store";
import { monthLabel } from "@/engine/types";

type Run = { t0: number; m0: number; cap: number };
let run: Run | null = null;
let depth = 0;
// Milliseconds per month, learned from the months this session has closed.
let perMonth = 1000;
let learned = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => subs.delete(f); };

function begin(cap: number) {
  if (run) return;
  run = { t0: performance.now(), m0: useStore.getState().game?.month ?? 0, cap };
  emit();
}
function end() {
  if (!run) return;
  const months = (useStore.getState().game?.month ?? run.m0) - run.m0;
  if (months > 0) {
    const ms = (performance.now() - run.t0) / months;
    // a light average: one slow month (a load, a year-end) does not set the pace
    perMonth = learned ? perMonth * 0.6 + ms * 0.4 : ms;
    learned = true;
  }
  run = null;
  emit();
}

type Wrapped = { __clock?: true };
function install() {
  const st = useStore.getState();
  if ((st.advance as Wrapped).__clock) return;
  const advance = st.advance;
  const advanceYear = st.advanceYear;
  const advanceUntil = st.advanceUntil;
  const a = (opts?: { quiet?: boolean }) => {
    depth++;
    begin(1);
    return advance(opts).finally(() => { if (--depth === 0 && !useStore.getState().advancing) end(); });
  };
  (a as Wrapped).__clock = true;
  useStore.setState({
    advance: a,
    advanceYear: () => { if (!useStore.getState().advancing) begin(12); advanceYear(); },
    advanceUntil: () => { if (!useStore.getState().advancing) begin(36); advanceUntil(); },
  });
  // The year and the skip report back through `advancing`, or refuse at
  // once without setting it (a card waiting, the game over).
  let was = useStore.getState().advancing;
  useStore.subscribe((s) => {
    if (was && !s.advancing && depth === 0) end();
    was = s.advancing;
  });
}

export default function ClockProgress() {
  useEffect(install, []);
  const live = useSyncExternalStore(subscribe, () => run);
  // Shown only once the month has been out a moment, so a quick month (an
  // early city) or Play's steady ticking does not flash a bar.
  const [shown, setShown] = useState<Run | null>(null);
  useEffect(() => {
    if (!live) { setShown(null); return; }
    // A year or skip that never started (refused at once) never sets
    // `advancing`; clear it on the next check rather than leave a bar up.
    const t = window.setTimeout(() => {
      if (live.cap > 1 && !useStore.getState().advancing) { if (run === live) end(); return; }
      setShown(live);
    }, 250);
    return () => clearTimeout(t);
  }, [live]);
  if (!shown) return null;
  const m = shown.m0 + 1;
  const what = shown.cap === 1 ? `Closing ${monthLabel(m)}`
    : shown.cap === 12 ? "Running up to a year" : "Running up to three years";
  // Fill to most of the bar over the expected time (less the delay it waited).
  const ms = Math.max(300, perMonth * shown.cap - 250);
  return (
    <div className="clock-progress" role="progressbar" aria-label={what} aria-busy="true" title={`${what}…`}>
      <div className="clock-progress-fill" style={{ animationDuration: `${Math.round(ms)}ms` }} />
    </div>
  );
}
