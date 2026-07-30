// Ambient detail: one knob for everything atmospheric on the map — streetscape
// props, day/night, seasons, weather, motion. Off / Low / Medium / High, default
// Medium, persisted locally. Pure UI state: the simulation never reads it.

export type AmbientLevel = 0 | 1 | 2 | 3;
export const AMBIENT_LABELS: Record<AmbientLevel, string> = { 0: 'off', 1: 'low', 2: 'med', 3: 'high' };

const KEY = 'gw_ambient';
export function loadAmbient(): AmbientLevel {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return 2;
    const v = Number(raw);
    return (v === 0 || v === 1 || v === 2 || v === 3 ? v : 2) as AmbientLevel;
  } catch { return 2; }
}
export function saveAmbient(l: AmbientLevel) {
  try { localStorage.setItem(KEY, String(l)); } catch { /* private mode: session-only */ }
}

// The OS-level accessibility setting wins over everything: when the user asks for
// reduced motion, every ambient animation renders as its static final frame.
// (CSS animations are also killed globally in index.css under the same query.)
export function prefersReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
