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
import { CLOUD, CLOUD_BASE } from "../clouds";

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
    const dbgAll = typeof location !== "undefined" ? new URLSearchParams(location.search).get("gpudbg") : null;
    if (dbgAll === "seagrass" && (U.seaShore || F.includes("gGrassH"))) {
      // review: the sea red-green by its shore field, the grass magenta, both opaque
      if (U.seaShore) {
        const box = U.seaBox.value as THREE.Vector4;
        const sf = T.texture(U.seaShore.value, T.positionWorld.xy.sub(T.uniform(box).xy).mul(T.uniform(box).zw));
        mm.colorNode = T.vec4(sf.r, sf.g, 0.2, 1); mm.opacityNode = T.float(1); mm.transparent = false;
      } else mm.colorNode = F.includes("vStripe") ? T.vec4(1, 1, 0, 1) : F.includes("straw through the green") ? T.vec4(0, 1, 1, 1) : T.vec4(1, 0, 1, 1);
      note("dbg:seagrass");
    } else if (U.uWallLum && !(mm.map && mm.roughnessMap && mm.emissiveMap)) note("facade:no-maps(stock)");
    else if (U.uWallLum) { facade(mm, s, U); note("facade:paint+foot+far+panes+reveal+rooms"); }
    else if (U.seaShore) { sea(mm, s, U); note("sea:bottom+shore"); }
    else if (F.includes("diffuseColor.a *= vColor.r")) {
      mm.vertexColors = false;
      mm.opacityNode = T.vertexColor().r.mul(T.materialOpacity);
      note("contact");
    } else if (F.includes("vTail")) {
      mm.emissiveNode = T.attribute("lamp", "float").mul(T.attribute("aBrake", "float")).mul(T.vec3(0.9 * 1.3, 0.03 * 1.3, 0.02 * 1.3));
      note("vehicle:brakes");
    } else if (U.uGait) { gait(mm, s, U); note("gait:legs+arms"); }
    else if (F.includes("gGrassH")) { grass(mm, s, U, F); note("grass:sward+stripes+leaves"); }
    else if (V.includes("leafWind")) { sway(mm, s, U); note("sway:crowns"); }
    else note("unknown-patch");
  }
  // the clouds' shade on the sun's direct light, through the sun's shadow term
  // (classic: the same field on reflectedLight.direct*, the catcher's mask)
  if (!mm.isMeshBasicMaterial) {
    const k = pr?.uniforms.seaShore ? 0.3 : 1.0;
    mm.receivedShadowNode = T.Fn(([sh]: N[]) => sh.mul(cloudSunlight(s, k)));
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
  // EVERY INPUT READ OFF THE MESH'S OWN MATERIAL. All 250-odd facades build
  // the same node graph, so three compiles them to ONE program (as classic
  // does) — and a texture or uniform node holding a value would then be the
  // first material's for every wall in town. Material references resolve per
  // object: the family's own numbers ride on the material as bw* properties.
  Object.assign(m, {
    bwWallLum: U.uWallLum.value, bwTrimLum: U.uTrimLum.value, bwAccLum: U.uAccLum.value,
    bwWin: U.uWin.value, bwSeed: U.uSeed.value, bwGlassy: U.uGlassy.value,
    bwBay: U.uBay.value, bwReveal: U.uReveal.value, bwGlassP: U.uGlassP.value,
  });
  // through the MESH (object.material), not the material being built: the
  // shadow pass builds this graph against its own depth material, where a
  // material reference finds no maps and the whole frame's commands fail
  const R = (k: string, t: string) => T.reference("material." + k, t);
  const wallLum = R("bwWallLum", "float"), trimLum = R("bwTrimLum", "float"), accLum = R("bwAccLum", "float");
  const uWin = R("bwWin", "vec4"), uSeed = R("bwSeed", "vec2"), uGlassy = R("bwGlassy", "float");
  const uBay = R("bwBay", "vec2"), uReveal = R("bwReveal", "float"), uGlassP = R("bwGlassP", "vec4");
  const uColor = R("color", "color");
  const tex = (k: string) => R(k, "texture").context({ getUV: () => uvT });
  // one node per texture (each texture() is a sampler, and a WebGL 2 device
  // guarantees 16); the stock emissive read goes too: it is always 0 here
  const mapT = tex("map"), mskT = tex("emissiveMap");
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
  const wallNode = T.Fn(() => {
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
  })().toVar("bwWall");
  // roughness: far calm, then the panes' own variety (classic roughnessmap_fragment + WINDOW_VARIATION)
  const roughN = T.Fn(() => {
    const r = orm.g.mul(T.materialRoughness).toVar();
    r.assign(T.mix(r, T.max(r, 0.5), farK));
    const varied = T.clamp(r.add(wh2.sub(0.5).mul(T.max(T.mix(0.14, 0.01, uGlassy), uGlassP.z.mul(2.0)))), 0.02, 1.0);
    return T.mix(r, T.mix(varied, 0.85, winShade), winM);
  })().toVar("bwRough");
  m.roughnessNode = roughN;
  // GLASS_FRAG: a coated lite reflects its coat's share face-on and nearly all
  // at a grazing angle (Fresnel), tinted by the coat; behind it, dark rooms or
  // a spandrel's back-pan; the sun's diffuse mostly gone. Classic rewrote the
  // light sums; here the stock reflection is switched off on the glass
  // (metalness 0, albedo down to the 15% classic kept of the direct diffuse)
  // and the coated reflection and the body are added as emission, which goes
  // through the same tone curve.
  const gK = T.select(uGlassP.x.greaterThan(0.0), T.smoothstep(0.3, 0.45, winM), T.float(0));
  m.colorNode = T.vec4(T.mix(wallNode.rgb, wallNode.rgb.mul(0.15), gK), wallNode.a);
  m.emissiveNode = T.Fn(() => {
    const gN = T.normalize(T.normalWorld);
    const gV = T.normalize(T.cameraPosition.sub(T.positionWorld));
    const nv = T.clamp(T.dot(gN, gV), 0.0, 1.0);
    const F = uGlassP.x.add(T.float(1).sub(uGlassP.x).mul(T.pow(T.float(1).sub(nv), 5.0)));
    const gR = T.reflect(gV.negate(), gN).toVar();
    const L = glassEnv(s).pmrem(gR, roughN).toVar();
    // no probe yet (Medium, or before the first capture): a far skyline at the horizon
    const az = T.atan(gR.y, gR.x);
    const sk = T.float(0.03).add(T.pow(sNoise(T.vec2(az.mul(14.0), 3.7)), 2.0).mul(0.11)).add(T.step(0.82, sNoise(T.vec2(az.mul(41.0), 9.1))).mul(0.05));
    const bld = T.smoothstep(sk.add(0.004), sk.sub(0.004), gR.z).mul(T.smoothstep(-0.25, -0.02, gR.z));
    const bc = T.mix(T.vec3(0.62, 0.66, 0.72), T.vec3(0.78, 0.8, 0.82), sNoise(T.vec2(az.mul(60.0), 1.0)));
    L.assign(T.mix(L, bc.mul(1.25), bld.mul(T.float(1).sub(glassEnv(s).probe))));
    // the clouds, up the reflected ray at the cloud base
    const cu = cloudUniforms(s);
    const gP = T.positionWorld;
    const tt = T.float(CLOUD_BASE).sub(gP.z).div(T.max(gR.z, 0.02));
    const q = gP.xy.add(gR.xy.mul(tt));
    const e = T.float(0.5).add(T.float(0.5).sub(cu.cover).mul(0.36));
    const cl = T.smoothstep(e.sub(0.05), e.add(0.09), cloudField(q, cu.off)).mul(T.float(1).sub(T.smoothstep(5000.0, 16000.0, tt))).mul(T.smoothstep(0.02, 0.14, gR.z)).mul(T.step(0.0001, cu.k));
    const lit = T.dot(T.normalize(gR.xy.add(1e-4)), T.normalize(cu.sun.xy.add(1e-4))).mul(0.5).add(0.5);
    const cc = T.mix(T.vec3(1.25, 1.3, 1.38), T.vec3(2.0, 1.96, 1.88), lit);
    L.assign(T.mix(L, cc, cl.mul(T.clamp(T.float(1).sub(roughN.mul(2.0)), 0.0, 1.0))));
    const dc = wallNode.rgb;
    const tn = dc.div(T.max(T.max(dc.r, T.max(dc.g, dc.b)), 0.02));
    const coat = T.mix(T.vec3(1.0), tn, uGlassP.w);
    const vis = T.smoothstep(0.6, 0.9, winM);
    const body = T.mix(dc.mul(0.05), tn.mul(0.035), vis);
    return L.mul(coat).mul(F).add(body.mul(T.float(1).sub(F))).mul(gK);
  })();
  // review switch: ?gpudbg=mask|paint|orm|map shows one input of the wall instead of the wall
  const dbg = typeof location !== "undefined" ? new URLSearchParams(location.search).get("gpudbg") : null;
  if (dbg === "mask") m.colorNode = T.vec4(mskT.rgb, 1);
  else if (dbg === "paint") m.colorNode = T.vec4(T.attribute("paint", "vec4").rgb.mul(T.attribute("paint", "vec4").a), 1);
  else if (dbg === "orm") m.colorNode = T.vec4(orm.rgb, 1);
  else if (dbg === "map") m.colorNode = T.vec4(mapT.rgb, 1);
  m.metalnessNode = orm.b.mul(T.materialMetalness).mul(T.float(1).sub(farK.mul(0.6))).mul(T.float(1).sub(winShade.mul(winM))).mul(T.float(1).sub(gK));
  void s;
}

/** RealCity seaMaterial: the bottom seen through the water and the clear edge at the shore (surf and wind not yet). */
function sea(m: N, s: Shared, U: Record<string, { value: N }>) {
  const shore = U.seaShore.value as THREE.Texture, box = U.seaBox.value as THREE.Vector4, rip = U.seaRipple.value as THREE.Texture;
  const winter = live(s, U.seaWinter, 0), t = live(s, U.seaTime, 0);
  const uBox = T.uniform(box);
  const w = T.positionWorld.xy;
  const sf = T.texture(shore, w.sub(uBox.xy).mul(uBox.zw));
  const seaDs = sf.r.mul(sf.r).mul(400.0).sub(6.0);
  const seaD = T.max(seaDs, 0.0);
  const seaHard = sf.g;
  const camD = T.length(T.positionView);
  const near = T.float(1).sub(T.smoothstep(700.0, 2400.0, camD));
  const mott = fbm(w.mul(0.0045));
  const shelf = T.clamp(seaD.add(mott.sub(0.5).mul(120.0)).div(300.0), 0.0, 1.0);
  const cSand = T.mix(T.vec3(0.30, 0.56, 0.50), T.vec3(0.26, 0.36, 0.37), winter);
  const cShelf = T.mix(T.vec3(0.07, 0.33, 0.40), T.vec3(0.09, 0.22, 0.26), winter);
  const cDeep = T.mix(T.vec3(0.022, 0.12, 0.22), T.vec3(0.03, 0.085, 0.14), winter);
  // SURF AND FOAM (classic seaMaterial): swell lines steepening and breaking
  // in the surf zone, whitecaps in the gusts, the swash running up the beach,
  // lace left behind, a churn on the hard edges
  const soft = T.float(1).sub(seaHard);
  const foam = T.Fn(() => {
    const ph = seaD.mul(0.15).add(t.mul(0.85)).add(sNoise(w.mul(0.008)).mul(7.0));
    const crest = T.pow(T.sin(ph).mul(0.5).add(0.5), 7.0);
    const zone = T.float(1).sub(T.smoothstep(4.0, 46.0, seaD));
    const breakup = fbm(w.mul(0.09).add(T.vec2(t.mul(0.04), t.mul(-0.03))));
    const surf = crest.mul(zone).mul(T.smoothstep(0.3, 0.55, breakup.add(zone.mul(0.3)))).mul(soft);
    const gustF = T.smoothstep(0.45, 0.8, fbm(w.mul(0.0055).add(T.vec2(t.mul(0.011), t.mul(0.004)))));
    const caps = T.smoothstep(0.9, 0.98, sNoise(w.mul(T.vec2(0.42, 0.16)).add(T.vec2(t.mul(0.5), t.mul(0.05)))))
      .mul(T.smoothstep(0.55, 0.8, sNoise(w.mul(0.05).sub(T.vec2(t.mul(0.2), 0.0))))).mul(gustF).mul(near).mul(T.smoothstep(60.0, 160.0, seaD));
    const reach = T.float(2.2).add(T.sin(t.mul(0.85).add(sNoise(w.mul(0.015)).mul(6.28))).mul(0.5).add(0.5).mul(1.8));
    const swash = T.float(1).sub(T.smoothstep(reach.mul(0.35), reach, seaD));
    const lace = T.smoothstep(0.5, 0.72, fbm(w.mul(0.3).add(T.vec2(t.mul(0.11), t.mul(-0.08))))).mul(T.float(1).sub(T.smoothstep(2.0, 18.0, seaD))).mul(soft).mul(near);
    const churn = seaHard.mul(T.float(1).sub(T.smoothstep(0.4, 2.2, seaD))).mul(T.smoothstep(0.35, 0.65, sNoise(w.mul(0.5).add(T.vec2(t.mul(0.4), t.mul(0.25))))));
    const f = T.max(T.max(surf, swash.mul(T.mix(0.6, 1.0, soft))), T.max(T.max(lace.mul(0.75), churn), caps.mul(0.55))).toVar();
    f.mulAssign(T.smoothstep(0.15, 0.55, fbm(w.mul(0.22).add(T.vec2(t.mul(0.12), 0.0))).add(f.mul(0.35))));
    return T.clamp(f, 0.0, 1.0);
  })().toVar("seaFoam");
  m.colorNode = T.Fn(() => {
    const wc = T.mix(cSand, cShelf, T.smoothstep(0.0, 0.16, shelf)).toVar();
    wc.assign(T.mix(wc, cDeep, T.smoothstep(0.1, 0.85, shelf)));
    wc.mulAssign(T.float(0.9).add(fbm(w.mul(0.02).add(3.0)).mul(0.2)));
    return T.vec4(T.mix(wc, T.vec3(0.9, 0.93, 0.94), foam), 1.0);
  })();
  const wet = T.smoothstep(0.0, 0.9, seaDs);
  const body = T.mix(0.72, 0.97, T.smoothstep(0.0, 30.0, seaD));
  m.opacityNode = wet.mul(T.max(body, foam.mul(0.95)));
  m.roughnessNode = T.mix(T.materialRoughness, 0.85, foam);
  // A PLANAR REFLECTION (Max): the harbour mirrors the city, the towers and
  // the sky above them, rippled by the same normal, through the Fresnel of
  // water; the probe (one point's view) stays underneath for the far water.
  // Rendered untoned like a probe, so the tone curve is applied once. Works on
  // both backends (screen-space reflections do not compile on WebGL 2).
  const refl = T.reflector({ resolutionScale: 0.5 });
  refl.target.position.z = 0.02;
  s.addToScene(refl.target);
  const base = refl.reflector as N;
  const ub = base.updateBefore.bind(base);
  base.updateBefore = (f: N) => {
    if (s.uReflOn.value < 0.5) return;
    const was = s.uTone.value;
    s.uTone.value = 0;
    ub(f);
    s.uTone.value = was;
  };
  m.emissiveNode = T.Fn(() => {
    const nW = T.normalize(T.vec3(0, 0, 1));
    const v = T.normalize(T.cameraPosition.sub(T.positionWorld));
    const fr = T.float(0.02).add(T.pow(T.float(1).sub(T.clamp(T.dot(nW, v), 0, 1)), 5.0).mul(0.98));
    // the ripples bend the mirror: offset the lookup by the normal's tilt, in screen space
    const r = refl.sample(T.screenUV.add(T.normalView.xy.mul(0.025))).rgb;
    return r.mul(fr).mul(T.float(1).sub(foam)).mul(s.uReflOn).mul(0.85);
  })();
  // RIPPLES: three ripple scales crossing at different bearings and speeds,
  // gusts sliding downwind, calmer in the lee and smoothing out with distance
  m.normalNode = T.Fn(() => {
    const detail = T.float(1).sub(T.smoothstep(500.0, 2600.0, camD));
    const r = (uv: N) => T.texture(rip, uv).xy.mul(2.0).sub(1.0);
    const n1 = r(w.div(29.0).add(T.vec2(t.mul(0.017), t.mul(0.004))));
    const w2 = T.vec2(w.x.mul(0.8).add(w.y.mul(0.6)), w.x.mul(-0.6).add(w.y.mul(0.8)));
    const n2 = r(w2.div(11.0).add(T.vec2(t.mul(-0.031), t.mul(0.038))));
    const w3 = T.vec2(w.x.mul(0.28).add(w.y.mul(-0.96)), w.x.mul(0.96).add(w.y.mul(0.28)));
    const n3 = r(w3.div(91.0).add(T.vec2(t.mul(0.005), t.mul(-0.003))));
    const gust = T.smoothstep(0.32, 0.72, fbm(w.mul(0.0055).add(T.vec2(t.mul(0.011), t.mul(0.004)))));
    const g = n3.mul(0.8).add(n1.mul(0.6).add(n2.mul(0.45).mul(detail)).mul(T.float(0.45).add(gust))).toVar();
    g.mulAssign(T.mix(0.3, 1.0, T.smoothstep(0.0, 30.0, seaD)));
    g.mulAssign(T.mix(0.4, 1.0, detail));
    g.mulAssign(T.float(1).sub(foam.mul(0.8)));
    // a world (z-up) normal, into the camera's view space
    const nw = T.normalize(T.vec3(g.mul(0.5), 1.0));
    return T.normalize(T.cameraViewMatrix.mul(T.vec4(nw, 0.0)).xyz);
  })();
}

/** parks.ts grassMaterial: the sward's broad hue, soil and wear, clover, clumps and grain, straw, bare earth, mower's stripes, fallen leaves, snow. */
function grass(m: N, s: Shared, U: Record<string, { value: N }>, F: string) {
  const turf = F.includes("vStripe"), rough = F.includes("straw through the green");
  const HUE = rough ? 1.2 : turf ? 0.75 : 1.0, CLUMP = rough ? 0.42 : turf ? 0.16 : 0.22, GRAIN = rough ? 0.34 : turf ? 0.2 : 0.26;
  const BARE = rough ? 0.75 : turf ? 0.18 : 0.4, STRAW = rough ? 0.42 : 0.0;
  const snow = live(s, U.uSnow, 0), leaves = live(s, U.uLeaves, 0);
  const gH = T.Fn(([p]: N[]) => { const q = T.fract(T.vec3(p.x, p.y, p.x).mul(0.1031)).toVar(); q.addAssign(T.dot(q, q.yzx.add(33.33))); return T.fract(q.x.add(q.y).mul(q.z)); });
  const gN = T.Fn(([p]: N[]) => { const i = T.floor(p), f0 = T.fract(p); const f = f0.mul(f0).mul(T.vec2(3.0).sub(f0.mul(2.0)));
    return T.mix(T.mix(gH(i), gH(i.add(T.vec2(1, 0))), f.x), T.mix(gH(i.add(T.vec2(0, 1))), gH(i.add(T.vec2(1, 1))), f.x), f.y); });
  const rot = (p: N) => T.vec2(p.x.mul(0.8).add(p.y.mul(0.6)), p.x.mul(-0.6).add(p.y.mul(0.8)));
  const gF = (p0: N) => { let p = p0; let a = gN(p).mul(0.57); p = rot(p).mul(2.03).add(17.1); a = a.add(gN(p).mul(0.29));
    p = rot(p).mul(2.01).add(5.3); return a.add(gN(p).mul(0.14)); };
  if (turf && U.uWet) {
    const wetT = U.uWet.value as THREE.Texture, wetBox = U.uWetBox.value as THREE.Vector4;
    const ub = T.uniform(wetBox.clone());
    s.sync.push(() => ub.value.copy(U.uWetBox.value));
    // a creek through the park: the turf is cut away where the wet mask is white
    m.maskNode = T.texture(wetT, T.positionWorld.xy.sub(ub.xy).div(ub.zw)).r.lessThanEqual(0.5);
  }
  m.colorNode = T.Fn(() => {
    const p = T.positionWorld.xy;
    const c = T.materialColor.rgb.toVar();
    const live0 = T.float(1).sub(snow);
    const px = T.max(T.length(T.fwidth(p)), 1e-4);
    const fC = T.float(1).sub(T.smoothstep(0.35, 0.9, px.div(1.4)));
    const fG = T.float(1).sub(T.smoothstep(0.35, 0.9, px.div(0.33)));
    const broad = gF(p.div(36.0).add(3.7));
    const dry = T.smoothstep(0.36, 0.78, broad);
    c.mulAssign(T.mix(T.vec3(1.0), T.mix(T.vec3(0.82, 0.98, 1.0), T.vec3(1.13, 1.06, 0.8), dry), live0.mul(HUE)));
    const mid = gF(p.div(6.5).add(11.3));
    c.mulAssign(T.float(1).add(mid.sub(0.5).mul(0.36).mul(live0)));
    const clov = T.smoothstep(0.58, 0.74, gN(p.div(2.4).add(41.0))).mul(fC);
    c.mulAssign(T.mix(T.vec3(1.0), T.vec3(0.8, 0.9, 0.86), clov.mul(0.7).mul(live0)));
    const cl = gN(p.div(1.4).add(7.0)), gr = gN(p.div(0.33)).mul(0.6).add(gN(p.div(0.17).add(3.0)).mul(0.4));
    c.mulAssign(T.float(1).add(cl.sub(0.5).mul(CLUMP).mul(fC).add(gr.sub(0.5).mul(GRAIN * 2).mul(fG)).mul(live0)));
    if (rough) {
      const straw = T.smoothstep(0.4, 0.75, gF(p.div(3.1).add(23.0)).mul(0.7).add(gr.mul(0.3).mul(fG)));
      c.assign(T.mix(c, T.vec3(0.42, 0.36, 0.2).mul(T.float(0.8).add(cl.mul(0.4))), straw.mul(STRAW).mul(live0)));
      const seed = T.step(0.93, gH(T.floor(p.div(0.25)))).mul(fG);
      c.assign(T.mix(c, T.vec3(0.6, 0.55, 0.38), seed.mul(0.5).mul(live0)));
    }
    const bare = T.smoothstep(0.66, 0.8, gF(p.div(4.2).add(57.0)).mul(0.75).add(mid.mul(0.25))).mul(BARE);
    c.assign(T.mix(c, T.vec3(0.2, 0.15, 0.09).mul(T.float(0.85).add(gr.mul(0.3))), bare.mul(0.55).mul(live0)));
    if (turf) {
      const st = T.smoothstep(-0.25, 0.25, T.sin(T.attribute("stripe", "float").mul(3.14159265 / 4.0)));
      c.mulAssign(T.mix(1.0, T.mix(0.92, 1.06, st), T.float(1).sub(bare).mul(live0)));
    }
    if (!rough) {
      const lf = gH(T.floor(p.mul(5.0))), drift = gN(p.div(9.0));
      const k = gH(T.floor(p.mul(5.0)).add(7.0));
      const leafC = T.select(k.lessThan(0.4), T.vec3(0.62, 0.32, 0.1), T.select(k.lessThan(0.75), T.vec3(0.7, 0.5, 0.14), T.vec3(0.42, 0.22, 0.1)));
      const on = leaves.greaterThan(0.0).and(lf.lessThan(leaves.mul(T.float(0.15).add(drift.mul(0.6))).mul(live0)));
      c.assign(T.select(on, leafC, c));
    }
    return T.vec4(c, 1.0);
  })();
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

/** What the glass reflects: the probe of the skyline once one is taken (High+), else the painted sky. One node, shared by every facade program. */
const glassEnvs = new WeakMap<Shared, { pmrem: (dir: N, rough: N) => N; probe: N }>();
function glassEnv(s: Shared): { pmrem: (dir: N, rough: N) => N; probe: N } {
  let g = glassEnvs.get(s);
  if (!g) {
    const probe = T.uniform(0);
    s.sync.push(() => { probe.value = s.glassEnv.probe ? 1 : 0; });
    g = {
      probe,
      // the node keeps its own texture: kept current by the sync (the probe replaces the painted sky)
      pmrem: (dir: N, rough: N) => {
        const n = T.pmremTexture(s.glassEnv.value, dir, rough);
        s.sync.push(() => { if (s.glassEnv.value && n.value !== s.glassEnv.value) n.value = s.glassEnv.value; });
        return n;
      },
    };
    glassEnvs.set(s, g);
  }
  return g;
}
function cloudUniforms(s: Shared) {
  let u = cloudUs.get(s);
  if (!u) {
    u = { sun: live(s, CLOUD.cloudSun), eye: live(s, CLOUD.cloudEye), off: live(s, CLOUD.cloudOff), cover: live(s, CLOUD.cloudCover), k: live(s, CLOUD.cloudK) };
    cloudUs.set(s, u);
  }
  return u;
}
function cloudField(q: N, off: N): N {
  const p = q.div(420.0).add(off);
  return sNoise(p).mul(0.5).add(sNoise(p.mul(2.07).add(T.vec2(5.2, 1.3))).mul(0.25))
    .add(sNoise(p.mul(4.3).add(T.vec2(1.7, 9.2))).mul(0.15)).add(sNoise(p.mul(9.1).add(T.vec2(3.3, 7.7))).mul(0.1));
}

/** clouds.ts cloudSunlight, the share of the sun a point gets past the cloud field. */
const cloudUs = new WeakMap<Shared, { sun: N; eye: N; off: N; cover: N; k: N }>();
function cloudSunlight(s: Shared, k: number): N {
  let u = cloudUs.get(s);
  if (!u) {
    u = { sun: live(s, CLOUD.cloudSun), eye: live(s, CLOUD.cloudEye), off: live(s, CLOUD.cloudOff), cover: live(s, CLOUD.cloudCover), k: live(s, CLOUD.cloudK) };
    cloudUs.set(s, u);
  }
  const wp = T.positionWorld;
  const q = wp.xy.add(u.sun.xy.div(T.max(u.sun.z, 0.25)).mul(T.float(CLOUD_BASE).sub(wp.z)));
  const p = q.div(420.0).add(u.off);
  const field = sNoise(p).mul(0.5).add(sNoise(p.mul(2.07).add(T.vec2(5.2, 1.3))).mul(0.25))
    .add(sNoise(p.mul(4.3).add(T.vec2(1.7, 9.2))).mul(0.15)).add(sNoise(p.mul(9.1).add(T.vec2(3.3, 7.7))).mul(0.1));
  const e = T.float(0.5).add(T.float(0.5).sub(u.cover).mul(0.36));
  const far = T.float(1).sub(T.smoothstep(2000.0, 7000.0, T.length(wp.sub(u.eye))));
  return T.float(1).sub(u.k.mul(k).mul(far).mul(T.smoothstep(e.sub(0.045), e.add(0.06), field)));
}

/** RealCity addSway: a street tree's crown leans downwind with the square of its height above the fork, in two slow periods. */
function sway(m: N, s: Shared, U: Record<string, { value: N }>) {
  const lt = live(s, U.leafT, 0), lw = live(s, U.leafWind);
  // classic phases each tree by where it stands; here by its instance (the instance matrix is not a node input)
  const ph = T.fract(T.sin(T.float(T.instanceIndex).mul(12.9898)).mul(43758.5453)).mul(6.2832);
  const hz = T.max(T.positionGeometry.z.sub(2.8), 0.0);
  const k = T.float(0.55).add(T.sin(lt.mul(1.05).add(ph)).mul(0.35)).add(T.sin(lt.mul(3.1).add(ph.mul(1.7))).mul(0.2));
  // after instancing positionLocal is the city's frame: a world push
  m.positionNode = T.positionLocal.add(T.vec3(lw.mul(k.mul(hz).mul(hz).mul(0.0055)), 0.0));
}

/** RealCity's walking gait: legs swing from the hip and arms from the shoulder, opposite, two steps a second. */
function gait(m: N, s: Shared, U: Record<string, { value: N }>) {
  const g = live(s, U.uGait, 0);
  const ph = g.mul(6.2).add(T.fract(T.sin(T.float(T.instanceIndex).mul(78.233)).mul(43758.5453)).mul(6.2832));
  const p = T.positionGeometry;
  const sw = T.sin(ph), side = T.sign(p.y);
  const leg = T.abs(p.y).lessThan(0.2).and(p.z.lessThan(0.9));
  const arm = T.abs(p.y).greaterThan(0.2).and(p.z.greaterThan(0.8)).and(p.z.lessThan(1.5));
  const dx = T.select(leg, T.float(0.9).sub(p.z).mul(sw).mul(side).mul(0.42), T.select(arm, T.float(1.46).sub(p.z).mul(sw).mul(side).mul(-0.45), T.float(0)));
  // in the figure's own frame, before the instance turns it to its heading:
  // positionNode runs after instancing, so this hooks the position setup itself
  // (the renderer copies own properties onto the node twin, this one included)
  m.setupPosition = function (this: N, builder: N) {
    T.positionLocal.assign(T.positionLocal.add(T.vec3(dx, 0, 0)));
    return (THREE.NodeMaterial.prototype as N).setupPosition.call(this, builder);
  };
}
