// Groundwork's sound: a handful of tiny synthesized cues, no audio files, no network.
// Everything is built from oscillators at very low gain — the game should feel like a
// quiet office where money occasionally makes a noise, not a casino.

let ctx: AudioContext | null = null;
let muted = (() => {
  try { return localStorage.getItem('groundwork:mute') === '1'; } catch { return false; }
})();

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = (window as any).AudioContext ?? (window as any).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) { try { ctx = new AC(); } catch { return null; } }
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq: number, dur: number, opts?: { type?: OscillatorType; gain?: number; at?: number; slide?: number }) {
  const c = ac();
  if (!c || muted) return;
  const t0 = c.currentTime + (opts?.at ?? 0);
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = opts?.type ?? 'sine';
  o.frequency.setValueAtTime(freq, t0);
  if (opts?.slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + opts.slide), t0 + dur);
  const peak = opts?.gain ?? 0.04;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

export const SFX = {
  // the month turns: a soft desk-clock tick
  tick() { tone(1250, 0.045, { type: 'triangle', gain: 0.025 }); },
  // a deal closes / money lands: two quick rising notes — restrained cha-ching
  close() { tone(660, 0.09, { type: 'triangle', gain: 0.045 }); tone(990, 0.14, { type: 'triangle', gain: 0.045, at: 0.07 }); },
  // a lease signs: the stamp comes down
  sign() { tone(220, 0.07, { type: 'square', gain: 0.03 }); tone(440, 0.05, { type: 'triangle', gain: 0.025, at: 0.04 }); },
  // bad news: a low, short thud — the phone call you didn't want
  bad() { tone(150, 0.16, { type: 'sawtooth', gain: 0.03, slide: -60 }); },
  // a market event / something needs your eyes: a single neutral ding
  event() { tone(880, 0.12, { type: 'sine', gain: 0.035 }); },
  // a rival move: two falling notes — somebody else's win
  rival() { tone(520, 0.09, { type: 'triangle', gain: 0.04 }); tone(390, 0.13, { type: 'triangle', gain: 0.04, at: 0.08 }); },
};

export function isMuted(): boolean { return muted; }
export function toggleMute(): boolean {
  muted = !muted;
  try { localStorage.setItem('groundwork:mute', muted ? '1' : '0'); } catch { /* private mode */ }
  return muted;
}
