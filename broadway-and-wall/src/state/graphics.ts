// THE GRAPHICS SETTINGS of the Unreal game (Settings > Graphics): four presets
// and every option they set, which the player can change one by one. Unreal
// applies them (BWGame.cpp BWApplyGraphics) from the option string this file
// writes; the presets here are the same four the engine knows
// (BWGraphicsPreset), so -Quality=x on the command line and the page agree.
//
// Measured on the metro city at 1080p, RTX 2080, editor build (packaged runs
// faster): Low 68 fps, Medium 63, High 36, Ultra 17. The render resolution,
// the lighting quality and the cloud shadows are the big levers.

export type GfxPreset = "low" | "medium" | "high" | "ultra" | "max";

export interface GfxOptions {
  /** render resolution, % of the screen, upscaled back to it */
  res: number;
  /** the upscaler: DLSS where the card has it (auto), or Unreal's own TSR */
  up: "auto" | "tsr";
  /** global illumination: Lumen (bounced light) or none */
  gi: "lumen" | "off";
  /** lighting and reflection quality, 1 low .. 4 cinematic */
  giq: number;
  reflections: "lumen" | "ssr" | "off";
  /** shadows, 0 low .. 4 cinematic */
  shadow: number;
  /** view distance (how far small things are drawn), 0 .. 4 */
  view: number;
  textures: number;
  effects: number;
  post: number;
  /** clouds: 1 drawn without their shadows on the city, 2 full */
  clouds: number;
  /** the street's life: 0 off, 1 light (near the camera), 2 full, 3 walkers drawn twice as far */
  life: number;
  /** frame cap, 0 = none */
  fps: number;
  vsync: boolean;
  blur: boolean;
}

export const GFX_PRESETS: Record<GfxPreset, GfxOptions> = {
  low: { res: 50, up: "auto", gi: "lumen", giq: 2, reflections: "ssr", shadow: 1, view: 1, textures: 2, effects: 1, post: 1, clouds: 1, life: 1, fps: 0, vsync: false, blur: false },
  medium: { res: 67, up: "auto", gi: "lumen", giq: 2, reflections: "lumen", shadow: 2, view: 2, textures: 3, effects: 2, post: 2, clouds: 1, life: 2, fps: 0, vsync: false, blur: false },
  high: { res: 100, up: "auto", gi: "lumen", giq: 3, reflections: "lumen", shadow: 3, view: 3, textures: 3, effects: 3, post: 3, clouds: 2, life: 2, fps: 0, vsync: false, blur: false },
  ultra: { res: 100, up: "auto", gi: "lumen", giq: 4, reflections: "lumen", shadow: 4, view: 4, textures: 3, effects: 3, post: 3, clouds: 2, life: 2, fps: 0, vsync: false, blur: false },
  // every group at Cinematic, and the far crowd (owner, Oct 2026: an RTX 5070 Ti)
  max: { res: 100, up: "auto", gi: "lumen", giq: 4, reflections: "lumen", shadow: 4, view: 4, textures: 4, effects: 4, post: 4, clouds: 2, life: 3, fps: 0, vsync: false, blur: false },
};

/** The option string Unreal reads ("res=67;gi=lumen;..."). */
export function gfxString(o: GfxOptions): string {
  return [
    `res=${o.res}`, `up=${o.up}`, `gi=${o.gi}`, `giq=${o.giq}`, `refl=${o.reflections}`, `shadow=${o.shadow}`,
    `view=${o.view}`, `tex=${o.textures}`, `fx=${o.effects}`, `post=${o.post}`, `clouds=${o.clouds}`,
    `life=${o.life}`, `fps=${o.fps}`, `vsync=${o.vsync ? 1 : 0}`, `blur=${o.blur ? 1 : 0}`,
  ].join(";");
}

/** Which preset these options are exactly, or null when the player has changed something. */
export function presetOf(o: GfxOptions): GfxPreset | null {
  for (const k of Object.keys(GFX_PRESETS) as GfxPreset[]) if (gfxString(GFX_PRESETS[k]) === gfxString(o)) return k;
  return null;
}

/** Read the saved options (or the preset matching the old single dial). */
export function loadGfx(fallback: GfxPreset): GfxOptions {
  try {
    const raw = localStorage.getItem("bw:gfx");
    if (raw) return { ...GFX_PRESETS[fallback], ...JSON.parse(raw) };
  } catch { /* private mode, or a bad value */ }
  return { ...GFX_PRESETS[fallback] };
}

export function saveGfx(o: GfxOptions): void {
  try { localStorage.setItem("bw:gfx", JSON.stringify(o)); } catch { /* private mode */ }
}
