/**
 * THE CLASSIC SHADERS, PORTED (WebGPU beta). RealCity patches stock materials
 * in GLSL with onBeforeCompile, which WebGPURenderer never calls. Each patch is
 * recognised here by what it does to a probe shader (the uniforms it adds and
 * the code it splices in), its uniforms are read off that same call, and the
 * equivalent is attached to the material as TSL nodes — so RealCity keeps one
 * material, one set of numbers, and the classic path is untouched.
 *
 * Port status (WEBGPU_PLAN.md keeps the list): see PORTED below.
 */
import * as THREE from "three/webgpu";
import * as TSL from "three/tsl";
import type { Shared } from "./GpuCity";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const T = TSL as N;

/** Which classic patches were met and how each was handled, for the review tools (window.__gpuPorts). */
export const PORTED: Record<string, number> = {};
const note = (k: string) => { PORTED[k] = (PORTED[k] ?? 0) + 1; };
if (typeof window !== "undefined") (window as unknown as { __gpuPorts?: unknown }).__gpuPorts = PORTED;

const PROBE_V = "#include <common>\n#include <begin_vertex>\n#include <project_vertex>\n#include <worldpos_vertex>\n";
const PROBE_F = ["common", "color_fragment", "emissivemap_fragment", "lights_fragment_end", "roughnessmap_fragment", "metalnessmap_fragment", "normal_fragment_maps", "fog_fragment"].map((k) => `#include <${k}>`).join("\n");

type Probe = { uniforms: Record<string, { value: N }>; vertexShader: string; fragmentShader: string };

/** Run a material's GLSL patch on a probe shader, to see what it adds. */
function probeOf(m: THREE.Material, renderer: N): Probe | null {
  if (m.onBeforeCompile === THREE.Material.prototype.onBeforeCompile) return null;
  const sh: Probe = { uniforms: {}, vertexShader: PROBE_V, fragmentShader: PROBE_F };
  try { m.onBeforeCompile(sh as never, renderer); } catch { return null; }
  return sh;
}

/** A classic `{ value }` uniform as a TSL uniform that follows it every frame. */
function live(s: Shared, obj: { value: N } | undefined, fallback: N = 0): N {
  if (!obj) return T.uniform(fallback);
  if (obj.value && (obj.value as THREE.Texture).isTexture) return T.texture(obj.value);
  const u = T.uniform(obj.value?.clone ? obj.value.clone() : obj.value);
  s.sync.push(() => { if (u.value?.copy) u.value.copy(obj.value); else u.value = obj.value; });
  return u;
}

export function portMaterial(m: THREE.Material, s: Shared, renderer: N) {
  const mm = m as N;
  if ((m as THREE.ShaderMaterial).isShaderMaterial) {
    // a raw GLSL material has no node twin: it would draw nothing (or an error)
    note("unported:ShaderMaterial:" + (m.name || m.type));
    return;
  }
  const pr = probeOf(m, renderer);
  if (pr) {
    const U = pr.uniforms, F = pr.fragmentShader, V = pr.vertexShader;
    if (U.uWallLum) { facade(mm, s, U); note("facade:paint+foot"); }
    else if (U.seaShore) { sea(mm, s, U); note("sea:bottom+shore"); }
    else if (F.includes("diffuseColor.a *= vColor.r")) {
      mm.vertexColors = false;
      mm.opacityNode = T.vertexColor().r.mul(T.materialOpacity);
      note("contact");
    } else if (F.includes("vTail")) {
      mm.emissiveNode = T.attribute("lamp", "float").mul(T.attribute("aBrake", "float")).mul(T.vec3(0.9 * 1.3, 0.03 * 1.3, 0.02 * 1.3));
      note("vehicle:brakes");
    } else if (U.uGait) { note("gait:unported(still walkers)"); }
    else if (F.includes("gGrassH")) { note("grass:unported(stock colour)"); }
    else if (V.includes("leafWind")) { note("sway:unported(still trees)"); }
    else note("unknown-patch");
  }
  // the tone curve and the aerial perspective, after everything else (classic: tonemapping, colorspace, then fog)
  if (mm.isShadowMaterial) {
    mm.outputNode = T.vec4(T.output.rgb, T.output.a.mul(T.float(1).sub(hazeK(s))));
  } else if (m.toneMapped !== false) {
    mm.outputNode = toneHaze(s);
  }
  m.needsUpdate = true;
}

const hazeK = (s: Shared) => T.smoothstep(s.uHazeNear, s.uHazeFar, T.length(T.positionView)).mul(s.uHazeCap);

function toneHaze(s: Shared): N {
  return T.Fn(() => {
    const c = T.output;
    const lin = c.rgb;
    const toned = T.acesFilmicToneMapping(lin, s.uExposure);
    const hz = hazeK(s);
    // on the frame, classic mixed the haze in display space after the tone curve; in a probe, linear
    const disp = T.sRGBTransferEOTF(T.mix(T.sRGBTransferOETF(toned), s.uHazeCol, hz));
    const probe = T.mix(lin, s.uHazeCol, hz);
    return T.vec4(T.mix(probe, disp, s.uTone), c.a);
  })();
}

/** RealCity buildFamily: the paint scheme (PAINT_FRAG) and the street's shade at the foot of the wall. */
function facade(m: N, s: Shared, U: Record<string, { value: N }>) {
  const map = m.map as THREE.Texture, rough = m.roughnessMap as THREE.Texture, msk = m.emissiveMap as THREE.Texture;
  // the tile holds two bays by two floors (repeat 0.5)
  const uvT = T.uv().mul(0.5);
  // uniforms, not constants: every facade then compiles to the same shader (classic shares one program too)
  const wallLum = T.uniform(U.uWallLum.value), trimLum = T.uniform(U.uTrimLum.value), accLum = T.uniform(U.uAccLum.value);
  m.colorNode = T.Fn(() => {
    const base = T.texture(map, uvT).toVar();
    base.rgb.mulAssign(T.uniform(m.color));
    const mskT = T.texture(msk, uvT);
    const paneP = T.texture(rough, uvT).r;
    const paint = T.attribute("paint", "vec4"), trimc = T.attribute("trimc", "vec3"), accent = T.attribute("accent", "vec3");
    const lumA = T.dot(base.rgb, T.vec3(0.2126, 0.7152, 0.0722));
    const c = base.rgb.toVar();
    const wallP = T.float(1).sub(paneP).mul(T.float(1).sub(mskT.g)).mul(T.float(1).sub(mskT.b)).mul(paint.a);
    c.assign(T.mix(c, paint.rgb.mul(T.clamp(lumA.div(wallLum), 0.55, 1.5)), wallP));
    const trimP = mskT.g.mul(T.float(1).sub(paneP)).mul(T.step(0.0, trimc.r));
    c.assign(T.mix(c, trimc.mul(T.clamp(T.float(0.75).add(lumA.mul(0.5).div(T.max(trimLum, 0.02))), 0.85, 1.15)), trimP));
    const accP = mskT.b.mul(T.step(0.0, accent.r));
    c.assign(T.mix(c, accent.mul(T.clamp(T.float(0.75).add(lumA.mul(0.5).div(T.max(accLum, 0.02))), 0.8, 1.2)), accP));
    // the street darkens the foot of every wall, up as far as the street's own canyon (aoh)
    const gz = T.positionGeometry.z, aoh = T.attribute("aoh", "float");
    const foot = T.mix(0.6, 1.0, T.smoothstep(0.0, T.max(aoh, 1.0), gz)).mul(T.mix(0.82, 1.0, T.smoothstep(0.0, 1.2, gz)));
    return T.vec4(c.mul(foot), base.a);
  })();
  // far away, calm down: the relief fades and the glass roughens with distance (classic farK)
  const farK = T.smoothstep(320.0, 1300.0, T.length(T.positionView));
  const rTex = T.texture(rough, uvT);
  m.roughnessNode = T.Fn(() => {
    const r = rTex.g.mul(T.materialRoughness).toVar();
    return T.mix(r, T.max(r, 0.5), farK);
  })();
  m.metalnessNode = rTex.b.mul(T.materialMetalness).mul(T.float(1).sub(farK.mul(0.6)));
  void s;
}

/** RealCity seaMaterial: the bottom seen through the water and the clear edge at the shore (surf and wind not yet). */
function sea(m: N, s: Shared, U: Record<string, { value: N }>) {
  const shore = U.seaShore.value as THREE.Texture, box = U.seaBox.value as THREE.Vector4;
  const winter = live(s, U.seaWinter, 0);
  const uBox = T.uniform(box);
  const w = T.positionWorld.xy;
  const sf = T.texture(shore, w.sub(uBox.xy).mul(uBox.zw));
  const seaDs = sf.r.mul(sf.r).mul(400.0).sub(6.0);
  const seaD = T.max(seaDs, 0.0);
  const mott = fbm(w.mul(0.0045));
  const shelf = T.clamp(seaD.add(mott.sub(0.5).mul(120.0)).div(300.0), 0.0, 1.0);
  const cSand = T.mix(T.vec3(0.30, 0.56, 0.50), T.vec3(0.26, 0.36, 0.37), winter);
  const cShelf = T.mix(T.vec3(0.07, 0.33, 0.40), T.vec3(0.09, 0.22, 0.26), winter);
  const cDeep = T.mix(T.vec3(0.022, 0.12, 0.22), T.vec3(0.03, 0.085, 0.14), winter);
  m.colorNode = T.Fn(() => {
    const wc = T.mix(cSand, cShelf, T.smoothstep(0.0, 0.16, shelf)).toVar();
    wc.assign(T.mix(wc, cDeep, T.smoothstep(0.1, 0.85, shelf)));
    wc.mulAssign(T.float(0.9).add(fbm(w.mul(0.02).add(3.0)).mul(0.2)));
    return T.vec4(wc, 1.0);
  })();
  m.opacityNode = T.smoothstep(0.0, 0.9, seaDs).mul(T.mix(0.72, 0.97, T.smoothstep(0.0, 30.0, seaD)));
}

// the classic sHash / sNoise / sFbm
const sHash = T.Fn(([p0]: N[]) => {
  const p = T.fract(p0.mul(0.3183099).add(T.vec2(0.71, 0.113))).mul(50.0);
  return T.fract(p.x.mul(p.y).mul(p.x.add(p.y)));
});
const sNoise = T.Fn(([p]: N[]) => {
  const i = T.floor(p), f = T.fract(p);
  const u = f.mul(f).mul(T.vec2(3.0).sub(f.mul(2.0)));
  return T.mix(T.mix(sHash(i), sHash(i.add(T.vec2(1, 0))), u.x), T.mix(sHash(i.add(T.vec2(0, 1))), sHash(i.add(T.vec2(1, 1))), u.x), u.y);
});
function fbm(p0: N): N {
  let p = p0, a = 0.5, sum: N = T.float(0);
  for (let i = 0; i < 4; i++) {
    sum = sum.add(sNoise(p).mul(a));
    p = T.vec2(p.x.mul(1.6).add(p.y.mul(-1.2)), p.x.mul(1.2).add(p.y.mul(1.6))).add(T.vec2(1.7, 9.2));
    a *= 0.5;
  }
  return sum;
}
