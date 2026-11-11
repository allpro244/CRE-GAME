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
    if (U.uWallLum && !(mm.map && mm.roughnessMap && mm.emissiveMap)) note("facade:no-maps(stock)");
    else if (U.uWallLum) { facade(mm, s, U); note("facade:paint+foot+far+panes+reveal+rooms"); }
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

/** RealCity buildFamily, the whole wall: paint (PAINT_FRAG), the street's shade at the foot, far calm (farK), the panes' variety (WINDOW_VARIATION), the reveal and the room behind the glass (REVEAL_FRAG). */
function facade(m: N, s: Shared, U: Record<string, { value: N }>) {
  // the tile holds two bays by two floors (repeat 0.5)
  const uvT = T.uv().mul(0.5);
  // EVERY INPUT READ OFF THE MATERIAL BEING DRAWN. All 250-odd facades build
  // the same node graph, so three compiles them to ONE program (as classic
  // does) — and a texture or uniform node holding a value would then be the
  // first material's for every wall in town. Material references resolve per
  // object: the family's own numbers ride on the material as bw* properties.
  Object.assign(m, {
    bwWallLum: U.uWallLum.value, bwTrimLum: U.uTrimLum.value, bwAccLum: U.uAccLum.value,
    bwWin: U.uWin.value, bwSeed: U.uSeed.value, bwGlassy: U.uGlassy.value,
    bwBay: U.uBay.value, bwReveal: U.uReveal.value, bwGlassP: U.uGlassP.value,
  });
  const R = (k: string, t: string) => T.materialReference(k, t);
  const wallLum = R("bwWallLum", "float"), trimLum = R("bwTrimLum", "float"), accLum = R("bwAccLum", "float");
  const uWin = R("bwWin", "vec4"), uSeed = R("bwSeed", "vec2"), uGlassy = R("bwGlassy", "float");
  const uBay = R("bwBay", "vec2"), uReveal = R("bwReveal", "float"), uGlassP = R("bwGlassP", "vec4");
  const uColor = R("color", "color");
  const tex = (k: string) => R(k, "texture").context({ getUV: () => uvT });
  // one node per texture (each texture() is a sampler, and a WebGL 2 device
  // guarantees 16); the stock emissive read goes too: it is always 0 here
  const mapT = tex("map"), mskT = tex("emissiveMap");
  m.emissiveNode = T.vec3(0);
  // the vertex colour is applied here, in classic's order (before the panes' blinds and curtains)
  m.vertexColors = false;
  const farK = T.smoothstep(320.0, 1300.0, T.length(T.positionView));
  const orm = tex("roughnessMap");
  const winM = orm.r;
  const bayC = T.uv();
  const cellC = T.floor(bayC);
  const wh1 = T.fract(T.sin(T.dot(cellC.add(uSeed), T.vec2(12.9898, 78.233))).mul(43758.5453));
  const wh2 = T.fract(wh1.mul(17.31).add(0.137));
  const fC = T.fract(bayC);
  const tW = T.clamp(fC.y.sub(T.float(1).sub(uWin.w)).div(T.max(uWin.w.sub(uWin.z), 0.01)), 0.0, 1.0);
  const xW = T.clamp(fC.x.sub(uWin.x).div(T.max(uWin.y.sub(uWin.x), 0.01)), 0.0, 1.0);
  const notGlassy = T.float(1).sub(uGlassy);
  const blindK = T.step(wh1, 0.3).mul(T.step(T.float(1).sub(tW), wh2.mul(0.7).add(0.2))).mul(notGlassy);
  const curtK = T.step(0.3, wh1).mul(T.step(wh1, 0.46)).mul(T.step(xW, wh2.mul(0.12).add(0.24)).add(T.step(T.float(0.76).sub(wh2.mul(0.12)), xW))).mul(notGlassy);
  const winShade = T.clamp(blindK.add(curtK), 0.0, 1.0);
  m.colorNode = T.Fn(() => {
    const base = T.vec4(mapT).toVar();
    base.rgb.mulAssign(uColor);
    const paneP = winM;
    const paint = T.attribute("paint", "vec4"), trimc = T.attribute("trimc", "vec3"), accent = T.attribute("accent", "vec3");
    const lumA = T.dot(base.rgb, T.vec3(0.2126, 0.7152, 0.0722));
    const c = base.rgb.toVar();
    const wallP = T.float(1).sub(paneP).mul(T.float(1).sub(mskT.g)).mul(T.float(1).sub(mskT.b)).mul(paint.a);
    c.assign(T.mix(c, paint.rgb.mul(T.clamp(lumA.div(wallLum), 0.55, 1.5)), wallP));
    const trimP = mskT.g.mul(T.float(1).sub(paneP)).mul(T.step(0.0, trimc.r));
    c.assign(T.mix(c, trimc.mul(T.clamp(T.float(0.75).add(lumA.mul(0.5).div(T.max(trimLum, 0.02))), 0.85, 1.15)), trimP));
    const accP = mskT.b.mul(T.step(0.0, accent.r));
    c.assign(T.mix(c, accent.mul(T.clamp(T.float(0.75).add(lumA.mul(0.5).div(T.max(accLum, 0.02))), 0.8, 1.2)), accP));
    c.mulAssign(T.vertexColor().rgb);
    // the street darkens the foot of every wall, up as far as the street's own canyon (aoh)
    const gz = T.positionGeometry.z, aoh = T.attribute("aoh", "float");
    c.mulAssign(T.mix(0.6, 1.0, T.smoothstep(0.0, T.max(aoh, 1.0), gz)).mul(T.mix(0.82, 1.0, T.smoothstep(0.0, 1.2, gz))));
    // WINDOW_VARIATION: a pane's own shade, blinds and curtains
    const blindCol = T.mix(T.vec3(0.74, 0.7, 0.62), T.vec3(0.58, 0.57, 0.55), wh2);
    const curtCol = T.mix(T.vec3(0.62, 0.5, 0.42), T.vec3(0.5, 0.52, 0.5), wh2);
    const paneCol = c.mul(T.float(1).add(wh2.sub(0.5).mul(T.mix(0.36, 0.03, uGlassy)))).toVar();
    paneCol.assign(T.mix(paneCol, blindCol.mul(0.42), blindK));
    paneCol.assign(T.mix(paneCol, curtCol.mul(0.4), curtK.mul(T.float(1).sub(blindK))));
    c.assign(T.mix(c, paneCol, winM.mul(T.float(1).sub(farK.mul(0.7)))));
    // REVEAL_FRAG: the jamb, sill and head inside the opening, then the room behind the pane
    // in the world's frame (up is +z); the backend's view space is a real camera's
    const rN = T.normalize(T.normalWorldGeometry);
    const rUp = T.vec3(0, 0, 1);
    const rT = T.normalize(T.cross(rUp, rN));
    const rV = T.normalize(T.cameraPosition.sub(T.positionWorld));
    const rn = T.max(T.dot(rV, rN), 0.15);
    const vu = T.dot(rV, rT).div(rn), vv = T.dot(rV, rUp).div(rn);
    const ww = T.max(uWin.y.sub(uWin.x).mul(uBay.x), 0.3), wh = T.max(uWin.w.sub(uWin.z).mul(uBay.y), 0.3);
    const dep = uReveal;
    const jamb = T.select(vu.greaterThan(0.0), T.step(xW, dep.mul(vu).div(ww)), T.step(T.float(1).sub(xW), dep.mul(vu.negate()).div(ww)));
    const sill = T.select(vv.greaterThan(0.0), T.step(tW, dep.mul(vv).div(wh)), T.float(0));
    const head = T.select(vv.lessThan(0.0), T.step(T.float(1).sub(tW), dep.mul(vv.negate()).div(wh)), T.float(0));
    const hasRev = T.step(0.001, uReveal);
    const rk = winM.mul(hasRev).mul(T.float(1).sub(farK));
    c.assign(T.mix(c, c.mul(0.45).add(0.05), jamb.mul(rk)));
    c.assign(T.mix(c, T.vec3(0.62, 0.6, 0.56), sill.mul(rk).mul(T.float(1).sub(jamb))));
    c.assign(T.mix(c, c.mul(0.5), head.mul(rk)));
    // a room behind the glass, the size of its bay and storey, 4 m deep
    const RW = uBay.x, RH = uBay.y, RD = T.float(4.0);
    const X0 = fC.x.sub(0.5).mul(RW), Y0 = fC.y.mul(RH);
    const dS = T.select(T.abs(vu).greaterThan(0.001), T.select(vu.greaterThan(0.0), X0.add(RW.mul(0.5)).div(vu), X0.sub(RW.mul(0.5)).div(vu)), T.float(1e3));
    const dF = T.select(vv.greaterThan(0.001), Y0.div(vv), T.float(1e3));
    const dC = T.select(vv.lessThan(-0.001), Y0.sub(RH).div(vv), T.float(1e3));
    const dm = T.min(T.min(RD, dS), T.min(dF, dC));
    const wallPc = T.mix(T.vec3(0.78, 0.72, 0.62), T.vec3(0.66, 0.7, 0.72), T.step(0.6, wh1));
    const room = wallPc.mul(0.62).toVar();
    room.assign(T.select(dm.equal(dS), wallPc.mul(0.42), room));
    room.assign(T.select(dm.equal(dF).and(dm.notEqual(dS)), T.mix(T.vec3(0.34, 0.24, 0.16), T.vec3(0.42, 0.4, 0.38), T.step(0.5, wh2)).mul(0.55), room));
    room.assign(T.select(dm.equal(dC).and(dm.notEqual(dS)).and(dm.notEqual(dF)), T.vec3(0.8, 0.79, 0.76).mul(0.5), room));
    room.mulAssign(T.mix(0.62, 0.32, T.clamp(dm.div(RD), 0.0, 1.0)).mul(T.float(0.8).add(wh2.mul(0.4))));
    const inK = winM.mul(hasRev).mul(T.float(1).sub(winShade)).mul(T.float(1).sub(jamb)).mul(T.float(1).sub(farK)).mul(0.8);
    c.assign(T.mix(c, room, inK));
    const sky = winM.mul(hasRev).mul(T.float(1).sub(winShade)).mul(T.float(1).sub(jamb)).mul(T.float(0.16).add(T.clamp(vv, 0.0, 1.0).mul(0.12)));
    c.assign(T.mix(c, T.vec3(0.52, 0.62, 0.72), sky));
    return T.vec4(c, base.a);
  })();
  // roughness: far calm, then the panes' own variety (classic roughnessmap_fragment + WINDOW_VARIATION)
  m.roughnessNode = T.Fn(() => {
    const r = orm.g.mul(T.materialRoughness).toVar();
    r.assign(T.mix(r, T.max(r, 0.5), farK));
    const varied = T.clamp(r.add(wh2.sub(0.5).mul(T.max(T.mix(0.14, 0.01, uGlassy), uGlassP.z.mul(2.0)))), 0.02, 1.0);
    return T.mix(r, T.mix(varied, 0.85, winShade), winM);
  })();
  // review switch: ?gpudbg=mask|paint|orm|map shows one input of the wall instead of the wall
  const dbg = typeof location !== "undefined" ? new URLSearchParams(location.search).get("gpudbg") : null;
  if (dbg === "mask") m.colorNode = T.vec4(mskT.rgb, 1);
  else if (dbg === "paint") m.colorNode = T.vec4(T.attribute("paint", "vec4").rgb.mul(T.attribute("paint", "vec4").a), 1);
  else if (dbg === "orm") m.colorNode = T.vec4(orm.rgb, 1);
  else if (dbg === "map") m.colorNode = T.vec4(mapT.rgb, 1);
  m.metalnessNode = orm.b.mul(T.materialMetalness).mul(T.float(1).sub(farK.mul(0.6))).mul(T.float(1).sub(winShade.mul(winM)));
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
