/**
 * THE WEBGPU BETA (WEBGPU_PLAN.md). The same city RealCityLayer builds, drawn
 * by its own renderer instead of inside MapLibre's WebGL context.
 *
 * - **Its own canvas.** A canvas laid over MapLibre's, the same size and pixel
 *   ratio, deaf to the pointer (MapLibre keeps every mouse event, so panning,
 *   picking and the hover card are untouched). MapLibre still calls the layer's
 *   render() with its camera every frame; the city is drawn there, in the same
 *   task, so the two never drift a frame apart.
 * - **The map is the ground.** MapLibre's finished frame (its fills, streets,
 *   parcels and labels, everything under the 3D layer) is copied into a
 *   texture each frame and laid on a plane at street level in the city's own
 *   scene, so the city stands on it, shadows and haze fall on it, and the
 *   finishing pass treats the whole picture, ground included, as one frame.
 * - **three's WebGPURenderer**, which runs on WebGL 2 where the browser has no
 *   WebGPU (?gpu=webgl2 forces that, for comparison). Every material RealCity
 *   makes is a stock one; the renderer turns each into its node twin. What the
 *   classic renderer patched in GLSL (onBeforeCompile) is ported here to TSL,
 *   material by material (`dressMat`), read off the classic material itself so
 *   RealCity needs no second copy of any number.
 *
 * Looks only; nothing here is read by the engine.
 */
import * as THREE from "three/webgpu";
import * as TSL from "three/tsl";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type maplibregl from "maplibre-gl";
import { buildPost, type PostUniforms } from "./post";
import { portMaterial } from "./ports";

// TSL's typings fight every generic helper; the node graph is built loosely
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const T = TSL as N;

type HazeU = { hazeCol: { value: THREE.Color }; hazeNear: { value: number }; hazeFar: { value: number }; hazeCap: { value: number } };
type PostLike = { level: "off" | "grade" | "full"; toy: number; liveAO: boolean };

/** The kind of frame each material writes: lit (tone-mapped and hazed), raw (the ground, the haze sheet), or a shadow catcher. */
export interface Shared {
  /** 1 on the frame, 0 while a reflection probe is taken (classic: render targets are not tone-mapped). */
  uTone: N;
  uExposure: N;
  uHazeCol: N;
  uHazeNear: N;
  uHazeFar: N;
  uHazeCap: N;
  /** Classic uniforms the ports follow, copied over each frame. */
  sync: (() => void)[];
}

export class GpuBackend {
  readonly renderer: THREE.WebGPURenderer;
  readonly canvas: HTMLCanvasElement;
  readonly backendName: "webgpu" | "webgl2";
  private readonly map: maplibregl.Map;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly sun: THREE.DirectionalLight;
  private readonly mapTex: THREE.CanvasTexture;
  private readonly ground: THREE.Mesh;
  private pipeline: THREE.RenderPipeline | null = null;
  private post: PostUniforms | null = null;
  readonly shared: Shared;
  /** Review switches (window.__gpu.debug): hold a uniform at a value regardless of the city. */
  debug: Record<string, number> = {};
  private readonly dressed = new WeakSet<THREE.Material>();
  /** Frame timing for the review tools (window.__gpuStats). */
  readonly stats = { frames: 0, ms: 0, calls: 0, triangles: 0, backend: "" };

  private constructor(map: maplibregl.Map, scene: THREE.Scene, camera: THREE.PerspectiveCamera, sun: THREE.DirectionalLight, canvas: HTMLCanvasElement, renderer: THREE.WebGPURenderer) {
    this.map = map; this.scene = scene; this.camera = camera; this.sun = sun;
    this.canvas = canvas; this.renderer = renderer;
    const isGpu = (renderer.backend as N).isWebGPUBackend === true;
    this.backendName = isGpu ? "webgpu" : "webgl2";
    this.stats.backend = this.backendName;
    this.shared = {
      uTone: T.uniform(1),
      uExposure: T.uniform(0.82),
      uHazeCol: T.uniform(new THREE.Vector3(0.742, 0.818, 0.9)),
      uHazeNear: T.uniform(300),
      uHazeFar: T.uniform(4000),
      uHazeCap: T.uniform(0.5),
      sync: [],
    };
    // MapLibre's frame, the ground under the city (see the header)
    this.mapTex = new THREE.CanvasTexture(map.getCanvas());
    this.mapTex.colorSpace = THREE.SRGBColorSpace;
    this.mapTex.flipY = false;
    this.mapTex.generateMipmaps = false;
    this.mapTex.minFilter = this.mapTex.magFilter = THREE.LinearFilter;
    const gm = new THREE.MeshBasicNodeMaterial();
    gm.colorNode = T.texture(this.mapTex, T.screenUV);
    gm.depthWrite = true;
    gm.userData.gpuRaw = true;
    gm.outputNode = T.output;
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(80000, 80000), gm);
    this.ground.position.z = -0.25;
    this.ground.renderOrder = -10;
    this.ground.frustumCulled = false;
    this.ground.name = "gpu-ground";
    this.dressed.add(gm);
    scene.add(this.ground);
    // the sun's shadow is redrawn only when RealCity asks (renderer.shadowMap.needsUpdate)
    sun.shadow.autoUpdate = false;
    sun.shadow.needsUpdate = true;
    const sm = renderer.shadowMap as N;
    sm.enabled = true;
    sm.type = THREE.PCFShadowMap;
    Object.defineProperty(sm, "needsUpdate", { configurable: true, get: () => false, set: (v: boolean) => { if (v) this.shadowNeedsUpdate(); } });
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    (window as unknown as { __gpuStats?: unknown; __gpu?: unknown }).__gpuStats = this.stats;
    (window as unknown as { __gpu?: unknown }).__gpu = this;
    // the node library, for review probes run from the console
    Object.assign(window, { __gpuTSL: TSL, __gpuTHREE: THREE });
  }

  static async create(map: maplibregl.Map, scene: THREE.Scene, camera: THREE.PerspectiveCamera, sun: THREE.DirectionalLight): Promise<GpuBackend> {
    const forceWebGL = new URLSearchParams(location.search).get("gpu") === "webgl2" || !("gpu" in navigator);
    const canvas = document.createElement("canvas");
    canvas.className = "bw-gpu-city";
    Object.assign(canvas.style, { position: "absolute", left: "0", top: "0", width: "100%", height: "100%", pointerEvents: "none" });
    map.getCanvas().after(canvas);
    const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, alpha: false, forceWebGL });
    await renderer.init();
    const b = new GpuBackend(map, scene, camera, sun, canvas, renderer);
    camera.coordinateSystem = renderer.coordinateSystem;
    b.fit();
    console.info(`[bw] city renderer: ${b.backendName === "webgpu" ? "WebGPU" : "WebGL 2 (WebGPU unavailable or forced off)"}`);
    return b;
  }

  /** The canvas follows MapLibre's: the same CSS box and the same drawing-buffer size. */
  private fit(): boolean {
    const mc = this.map.getCanvas();
    const pr = this.map.getPixelRatio();
    if (this.canvas.width === mc.width && this.canvas.height === mc.height && this.renderer.getPixelRatio() === pr) return false;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(mc.width / pr, mc.height / pr, false);
    return true;
  }

  shadowNeedsUpdate() { this.sun.shadow.needsUpdate = true; }

  /** The neutral light box matte surfaces take their ambient light from (RealCity's scene.environment). */
  roomEnvironment(): THREE.Texture {
    const pm = new THREE.PMREMGenerator(this.renderer);
    const t = pm.fromScene(new RoomEnvironment(), 0.03).texture;
    pm.dispose();
    return t;
  }

  /** RealCity's skyEnvironment, with its dome as a node material (the classic one is GLSL). */
  skyScene(): THREE.Scene {
    const sc = new THREE.Scene();
    const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
    m.colorNode = T.Fn(() => {
      const d = T.normalize(T.positionLocal);
      const z = d.z;
      const zenith = T.vec3(0.16, 0.34, 0.66), horizon = T.vec3(0.86, 0.88, 0.86), city = T.vec3(0.42, 0.42, 0.42), groundC = T.vec3(0.24, 0.23, 0.22);
      const up = T.mix(horizon, zenith, T.pow(T.clamp(z, 0, 1), 0.55));
      const dn = T.mix(city, groundC, T.clamp(z.negate().mul(3), 0, 1));
      const c = T.select(z.greaterThan(0), up, dn).toVar();
      c.assign(T.mix(c, city.mul(1.15), T.smoothstep(0.08, 0.0, T.abs(z.sub(0.02))).mul(0.6)));
      return c.mul(1.6);
    })();
    m.userData.gpuRaw = true;
    this.dressed.add(m);
    sc.add(new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), m));
    const sm = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(14, 12, 9) });
    sm.userData.gpuRaw = true;
    this.dressed.add(sm);
    const sun = new THREE.Mesh(new THREE.SphereGeometry(4, 12, 8), sm);
    sun.position.set(0.45, -0.55, 0.7).normalize().multiplyScalar(90);
    sc.add(sun);
    return sc;
  }

  skyEnvironment(): THREE.Texture {
    const pm = new THREE.PMREMGenerator(this.renderer);
    const t = pm.fromScene(this.skyScene(), 0.02).texture;
    pm.dispose();
    return t;
  }

  /** A reflection probe of the city (RealCity.captureReflections): untoned, as classic's render target was. */
  probe(scene: THREE.Scene, size: number, at: THREE.Vector3): { texture: THREE.Texture } {
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.shared.uTone.value = 0;
    const wasG = this.ground.visible;
    this.ground.visible = false;
    for (const o of scene.children) for (const m of matsOf(o)) if (!this.dressed.has(m)) this.dressMat(m);
    scene.traverse((o) => { for (const m of matsOf(o)) if (!this.dressed.has(m)) this.dressMat(m); });
    const rt = pm.fromScene(scene, 0.015, 2, 7000, { size, position: at });
    this.ground.visible = wasG;
    this.shared.uTone.value = 1;
    pm.dispose();
    return rt;
  }

  /** The aerial-perspective veil over MapLibre's ground (classic: a GLSL ShaderMaterial). */
  hazeSheetMaterial(HAZE: HazeU): THREE.Material {
    void HAZE;
    const s = this.shared;
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
    m.colorNode = T.vec3(s.uHazeCol.x, s.uHazeCol.y, s.uHazeCol.z).pow(2.2);
    m.opacityNode = T.smoothstep(s.uHazeNear, s.uHazeFar, T.length(T.positionView)).mul(s.uHazeCap);
    m.userData.gpuRaw = true;
    m.outputNode = T.output;
    this.dressed.add(m);
    return m;
  }

  /**
   * Every frame (from RealCity.hazeFor): the haze and exposure follow the view,
   * and any material not yet seen gets its port (tone, haze, and the classic
   * shader's own work, ports.ts).
   */
  dress(HAZE: HazeU) {
    const s = this.shared;
    s.uHazeCol.value.set(HAZE.hazeCol.value.r, HAZE.hazeCol.value.g, HAZE.hazeCol.value.b);
    s.uHazeNear.value = HAZE.hazeNear.value;
    s.uHazeFar.value = HAZE.hazeFar.value;
    s.uHazeCap.value = HAZE.hazeCap.value;
    s.uExposure.value = this.renderer.toneMappingExposure;
    for (const f of s.sync) f();
    for (const k in this.debug) if ((s as N)[k]?.value !== undefined) (s as N)[k].value = this.debug[k];
    this.scene.traverse((o) => { for (const m of matsOf(o)) if (!this.dressed.has(m)) this.dressMat(m); });
  }

  private dressMat(m: THREE.Material) {
    this.dressed.add(m);
    if (m.userData.gpuRaw) return;
    portMaterial(m, this.shared, this.renderer);
  }

  /** Draw the frame: MapLibre's ground into the scene, the scene through the finishing pass, onto our canvas. */
  render(postFx: PostLike, pitch: number, distM: number, hide: (THREE.Object3D | null)[]) {
    void hide;
    const t0 = performance.now();
    if (this.fit()) this.pipeline = null;
    // MapLibre's camera, in WebGPU's clip space (depth 0..1, not -1..1)
    if (this.backendName === "webgpu") {
      const p = this.camera.projectionMatrix;
      p.premultiply(GL_TO_GPU);
      this.camera.projectionMatrixInverse.copy(p).invert();
    }
    this.mapTex.needsUpdate = true;
    if (this.pipeline && this.post && this.post.level !== postFx.level) { this.pipeline.dispose(); this.pipeline = null; }
    if (!this.pipeline) {
      const built = buildPost(this.renderer, this.scene, this.camera, postFx.level);
      this.pipeline = built.pipeline;
      this.post = built.u;
    }
    this.post!.update(postFx, pitch, distM, this.canvas.height);
    const info = this.renderer.info as N;
    this.pipeline.render();
    this.stats.frames++;
    this.stats.ms = performance.now() - t0;
    this.stats.calls = info.render?.drawCalls ?? info.render?.calls ?? 0;
    this.stats.triangles = info.render?.triangles ?? 0;
  }

  dispose() {
    this.scene.remove(this.ground);
    this.mapTex.dispose();
    this.pipeline?.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

/** WebGL's clip-space depth (-1..1) to WebGPU's (0..1). */
const GL_TO_GPU = new THREE.Matrix4().set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

function matsOf(o: THREE.Object3D): THREE.Material[] {
  const mm = (o as THREE.Mesh).material;
  if (!mm) return [];
  return Array.isArray(mm) ? mm : [mm];
}
