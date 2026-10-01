/** Light / dark / follow the system. Stored per viewer; applied as
 *  `data-theme` on <html>, which the token sheet (ui/system/tokens.css) reads. */
export type ThemePref = "light" | "dark" | "system";
const KEY = "bw:theme";

export function themePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch { /* storage blocked */ }
  return "light";
}

export function applyTheme(p: ThemePref = themePref()): void {
  const root = document.documentElement;
  if (p === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", p);
}

export function setThemePref(p: ThemePref): void {
  try { localStorage.setItem(KEY, p); } catch { /* storage blocked */ }
  applyTheme(p);
}
