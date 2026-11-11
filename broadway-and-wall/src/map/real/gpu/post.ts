/**
 * THE FINISHING PASS, ON A REAL PIPELINE (WebGPU beta). The classic pass
 * (../post.ts) had to copy MapLibre's framebuffer back into a texture and
 * guess ambient occlusion from a second render of distances. Here the city
 * renders into its own targets — colour, normals and depth together — so:
 *
 *  - AMBIENT OCCLUSION is three's GTAO on the real depth and normals (High).
 *  - the GRADE, TILT-SHIFT, BLOOM, CLARITY and VIGNETTE are the classic
 *    shader's, line for line in TSL, with the same strengths per quality
 *    level and look (PostFX.level / toy), so the two renderers agree.
 *
 * Display space throughout, as classic: the materials tone-map themselves
 * (ports.ts) and this pass works on the sRGB-encoded frame.
 */
import * as THREE from "three/webgpu";
import * as TSL from "three/tsl";
import { ao } from "three/examples/jsm/tsl/display/GTAONode.js";
import { ssr } from "three/examples/jsm/tsl/display/SSRNode.js";
import { fxaa } from "three/examples/jsm/tsl/display/FXAANode.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const T = TSL as N;

type PostLike = { level: "off" | "grade" | "full"; toy: number; liveAO: boolean };

export interface PostUniforms {
  update(p: PostLike, pitch: number, distM: number, h: number): void;
  /** The level the graph was built for: a change rebuilds it (GTAO is only in the High graph). */
  level: string;
}

// the classic pass's 12-tap disc
const DISC: [number, number][] = [
  [-0.326, -0.406], [-0.840, -0.074], [-0.696, 0.457], [-0.203, 0.621], [0.962, -0.195], [0.473, -0.480],
  [0.519, 0.767], [0.185, -0.893], [0.507, 0.064], [0.896, 0.412], [-0.322, -0.933], [-0.792, -0.598],
];

const AO_OFF = typeof location !== "undefined" && new URLSearchParams(location.search).get("gtao") === "off";

const Q = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
const SSR_OFF = Q.get("ssr") === "off";

/**
 * The graph per tier (the level key is "off" | "grade" | "full" | "max"):
 *  - Low / Medium: the scene with 4x MSAA, then the grade (Medium) or nothing.
 *  - High: GTAO on the real depth and normals, FXAA in place of MSAA (MSAA
 *    and the normal/depth read-back do not mix cheaply), the classic grade.
 *  - Max: High plus SCREEN-SPACE REFLECTIONS — the glass, the harbour and the
 *    wet streets mirror what is actually on screen around them (the probe
 *    still gives them the sky and the far skyline).
 */
export function buildPost(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, level: string): { pipeline: THREE.RenderPipeline; u: PostUniforms } {
  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  const hi = level === "full" || level === "max";
  const withAO = hi && !AO_OFF;
  // SSR on WebGPU only: three r185's SSR shader does not compile for its WebGL 2 fallback
  const withSSR = level === "max" && !SSR_OFF && (renderer.backend as N).isWebGPUBackend === true;
  const scenePass = T.pass(scene, camera, { samples: hi ? 0 : 4 });
  if (hi) scenePass.setMRT(T.mrt({ output: T.output, normal: T.packNormalToRGB(T.normalView), metalrough: T.vec2(T.metalness, T.roughness) }));
  // a float depth buffer: the map's perspective spans metres to kilometres, and
  // 24-bit depth bands flat roofs into stripes once GTAO reads it back
  if (hi) (scenePass as N).renderTarget.depthTexture.type = THREE.FloatType;
  let col = scenePass.getTextureNode("output");
  if (withSSR) {
    const nTex = scenePass.getTextureNode("normal");
    const mr = scenePass.getTextureNode("metalrough");
    const ssrPass = ssr(col, scenePass.getTextureNode("depth"), T.sample((uv: N) => T.unpackRGBToNormal(nTex.sample(uv))), {
      metalnessNode: mr.r, roughnessNode: mr.g, camera, reflectNonMetals: true,
    } as never) as N;
    // metres: reflections reach a few blocks; a wall is a couple of metres thick
    ssrPass.maxDistance.value = 600;
    ssrPass.thickness.value = 3;
    ssrPass.resolutionScale = 0.5;
    // the frame here is display-referred (the materials tone-map themselves): no HDR to clamp
    ssrPass.maxLuminance.value = 1.2;
    col = T.convertToTexture(T.blendColor(col, ssrPass));
  }
  let aoTex: N = null;
  const depthTex = scenePass.getTextureNode("depth");
  const projInv = T.uniform((camera as THREE.PerspectiveCamera).projectionMatrixInverse);
  if (withAO) {
    const nTex = scenePass.getTextureNode("normal");
    const normal = T.sample((uv: N) => T.unpackRGBToNormal(nTex.sample(uv)));
    const aoPass = ao(scenePass.getTextureNode("depth"), normal, camera);
    (aoPass as N).resolutionScale = 1;
    (aoPass as N).radius.value = 6;
    (aoPass as N).distanceExponent.value = 1.5;
    (aoPass as N).thickness.value = 2;
    aoTex = (aoPass as N).getTextureNode();
  }
  const u = {
    texel: T.uniform(new THREE.Vector2(1 / 1920, 1 / 1080)),
    tilt: T.uniform(0), focus: T.uniform(0.45), band: T.uniform(0.12),
    bloom: T.uniform(0), grade: T.uniform(1), toy: T.uniform(1), clarity: T.uniform(0),
    ao: T.uniform(0), on: T.uniform(1),
  };
  const uvN = T.screenUV;
  const tap = (uv: N) => T.sRGBTransferOETF(col.sample(T.clamp(uv, u.texel, T.vec2(1).sub(u.texel))).rgb);
  const out = T.Fn(() => {
    const c = tap(uvN).toVar();
    // tilt-shift: blur grows smoothly past the band's edge
    const off = T.max(0.0, T.abs(T.float(1).sub(uvN.y).sub(u.focus)).sub(u.band));
    const r = u.tilt.mul(T.smoothstep(0.0, 0.42, off));
    let acc: N = c;
    for (const [x, y] of DISC) acc = acc.add(tap(uvN.add(T.vec2(x, y).mul(r).mul(u.texel))));
    c.assign(T.select(r.greaterThan(0.35), acc.div(13.0), c));
    // after the blur, so a blurred band and a sharp one take the same shade
    if (aoTex) {
      // GTAO's horizon search finds false creases on flat ground at a grazing
      // angle far off (the whole far ground greyed, with a hard edge where the
      // depth ran out); the occlusion is a near-field cue anyway, as classic's
      // was: full to ~1.2 km, gone by ~3 km
      const vp = T.getViewPosition(uvN, depthTex.sample(uvN).r, projInv);
      const fade = T.float(1).sub(T.smoothstep(1200.0, 3000.0, T.length(vp)));
      c.mulAssign(T.mix(T.float(1), aoTex.sample(uvN).r, u.ao.mul(fade)));
    }

    // bloom and clarity from a wider ring of the same taps
    let b: N = T.vec3(0), m: N = T.vec3(0);
    for (const [x, y] of DISC) {
      const s = tap(uvN.add(T.vec2(x, y).mul(7.0).mul(u.texel)));
      b = b.add(T.max(s.sub(T.vec3(0.9)), 0.0));
      m = m.add(s);
    }
    m = m.div(12.0);
    const sharp = T.float(1).sub(T.smoothstep(0.35, 1.5, r));
    const dtl = T.clamp(c.sub(m), -0.12, 0.12);
    c.addAssign(dtl.mul(u.clarity).mul(sharp));
    c.addAssign(b.div(12.0).mul(u.bloom));
    // the grade
    const g = c.toVar();
    const l = T.dot(g, T.vec3(0.2126, 0.7152, 0.0722));
    g.assign(T.mix(T.vec3(l), g, T.float(1).add(T.float(0.22).add(u.toy.mul(0.26)).mul(u.grade))));
    const warm = T.mix(T.vec3(1.035, 1.0, 0.95), T.vec3(1.05, 1.0, 0.93), u.toy);
    const cool = T.mix(T.vec3(0.95, 0.99, 1.06), T.vec3(0.9, 0.97, 1.12), u.toy);
    g.mulAssign(T.mix(cool, warm, T.smoothstep(0.15, 0.75, l)));
    g.addAssign(T.vec3(0.035, 0.05, 0.085).mul(u.toy).mul(T.float(1).sub(T.smoothstep(0.0, 0.55, l))));
    g.assign(T.mix(g, g.mul(g).mul(T.vec3(3.0).sub(g.mul(2.0))), T.float(0.34).sub(u.toy.mul(0.16)).mul(u.grade)));
    c.assign(T.mix(c, g, u.grade));
    // vignette
    const q = uvN.sub(0.5);
    c.mulAssign(T.float(1).sub(T.float(0.16).add(u.toy.mul(0.06)).mul(u.grade).mul(T.smoothstep(0.4, 1.0, T.dot(q, q).mul(2.2)))));
    return T.vec4(T.clamp(c, 0.0, 1.0), 1.0);
  });
  pipeline.outputNode = hi ? fxaa(out()) : out();
  const forcedOff = typeof location !== "undefined" && new URLSearchParams(location.search).get("post") === "off";
  return {
    pipeline,
    u: {
      level,
      update(p: PostLike, pitch: number, distM: number, h: number) {
        const lv = forcedOff ? "off" : p.level;
        const full = lv === "full", any = lv !== "off";
        const steep = Math.min(1, Math.max(0, (pitch - 0.35) / 0.6));
        const close = Math.min(1, Math.max(0, (2600 - distM) / 2000));
        const toy = p.toy;
        u.texel.value.set(1 / Math.max(2, renderer.domElement.width), 1 / Math.max(2, renderer.domElement.height));
        u.tilt.value = full ? (4.5 + 2.5 * toy) * (h / 1000) * steep * Math.max(close, 0.6 * toy) : 0;
        u.focus.value = 0.44 + 0.06 * (1 - steep);
        u.band.value = (0.2 + 0.08 * (1 - close)) * (1 - 0.25 * toy);
        u.toy.value = any ? toy : 0;
        u.bloom.value = full ? 0.35 : 0;
        u.clarity.value = full ? 0.55 - 0.2 * toy : 0;
        u.grade.value = any ? 1 : 0;
        u.ao.value = full ? 0.65 + 0.2 * toy : 0;
      },
    },
  };
}
