import { useEffect } from "react";
import { useStore } from "@/state/store";

/**
 * THE DESK HAS A VOICE — quietly. Every sound here is synthesised on the spot
 * (no files ship), plays only on a moment the player earned or needs to hear
 * (a milestone, a delivery, a sale, a year closing, an error), and never on
 * the month tick itself. Off in Settings; the preference lives in
 * localStorage, not the save.
 */
const KEY = "bw:sound";
export function soundOn(): boolean {
  try { return localStorage.getItem(KEY) !== "off"; } catch { return false; }
}
export function setSoundOn(v: boolean) {
  try { localStorage.setItem(KEY, v ? "on" : "off"); } catch { /* private mode */ }
}

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) { try { ctx = new AC(); } catch { return null; } }
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}

/** One soft bell partial: sine with a quick attack and an exponential tail. */
function note(a: AudioContext, freq: number, at: number, dur: number, gain: number, type: OscillatorType = "sine") {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime + at);
  g.gain.setValueAtTime(0.0001, a.currentTime + at);
  g.gain.exponentialRampToValueAtTime(gain, a.currentTime + at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + at + dur);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + at);
  o.stop(a.currentTime + at + dur + 0.05);
}

export type Cue = "milestone" | "delivery" | "sale" | "year" | "error" | "pause";
const VOL = 0.06;
export function play(cue: Cue) {
  if (!soundOn()) return;
  const a = audio();
  if (!a) return;
  switch (cue) {
    case "milestone": // a rising major arpeggio
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(a, f, i * 0.09, 0.9, VOL));
      break;
    case "delivery": // a two-bell ring with an octave shimmer
      note(a, 392, 0, 1.6, VOL * 1.1); note(a, 784, 0.01, 1.2, VOL * 0.4);
      note(a, 523.25, 0.22, 1.6, VOL); note(a, 1046.5, 0.23, 1.0, VOL * 0.35);
      break;
    case "sale": // the till: two bright pings
      note(a, 1318.5, 0, 0.35, VOL * 0.9, "triangle"); note(a, 1760, 0.11, 0.6, VOL * 0.9, "triangle");
      break;
    case "year": // a soft settled chord
      [261.63, 329.63, 392].forEach((f) => note(a, f, 0, 1.4, VOL * 0.55));
      break;
    case "pause":
      note(a, 440, 0, 0.25, VOL * 0.6); note(a, 330, 0.12, 0.35, VOL * 0.6);
      break;
    case "error":
      note(a, 164.8, 0, 0.3, VOL * 0.9, "triangle");
      break;
  }
}

/** Listens to the store and rings on the moments above. Renders nothing. */
export default function Sounds() {
  useEffect(() => useStore.subscribe((s, p) => {
    if (s.milestoneFlash && s.milestoneFlash !== p.milestoneFlash) play("milestone");
    else if (s.deliveryCeremony && s.deliveryCeremony !== p.deliveryCeremony && !s.deliveryCeremony.rival) play("delivery");
    else if (s.exitCard && s.exitCard !== p.exitCard) play("sale");
    else if (s.yearReviewY !== null && s.yearReviewY !== p.yearReviewY) play("year");
    else if (p.autoplay && !s.autoplay && s.toast?.text.startsWith("Paused")) play("pause");
    else if (s.toast && s.toast !== p.toast && s.toast.kind === "err") play("error");
  }), []);
  return null;
}
