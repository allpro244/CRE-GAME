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
import { buildPost, PROVEN_ON_WEBGPU, UNPROVEN_OK, type PostUniforms } from "./post";
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
  /** 1 on Max/Extreme: the harbour mirrors the city in a planar reflection (ports.ts sea). */
  uReflOn: N;
  /** Objects a port needs in the scene (the reflector's plane). */
  addToScene: (o: THREE.Object3D) => void;
  /** What the glass reflects (RealCity: the skyline probe once taken, else the painted sky). */
  glassEnv: { value: THREE.Texture | null; probe: boolean };
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
  private readonly lastC = new THREE.Matrix4();
  private settle = 0;
  /** Review switches (window.__gpu.debug): hold a uniform at a value regardless of the city. */
  debug: Record<string, number> = {};
  private readonly dressed = new WeakSet<THREE.Material>();
  /**
   * REVIEW ONLY (?gpu=offscreen): draw into a render target and copy it to a
   * 2D canvas. Headless Chromium on SwiftShader loses its WebGPU device the
   * moment a WebGPU canvas presents, but renders offscreen fine — this is how
   * the WebGPU backend itself is screenshotted in CI-like containers.
   */
  private off: { rt: THREE.RenderTarget; view: HTMLCanvasElement; busy: boolean; again: boolean } | null = null;
  /** Frame timing for the review tools (window.__gpuStats). */
  readonly stats: { frames: number; ms: number; calls: number; triangles: number; backend: string; offscreenFrames?: number } = { frames: 0, ms: 0, calls: 0, triangles: 0, backend: "" };

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
      uReflOn: T.uniform(0),
      addToScene: (o: THREE.Object3D) => { scene.add(o); },
      glassEnv: { value: null, probe: false },
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
    if (new URLSearchParams(location.search).get("gpu") === "offscreen") {
      const view = document.createElement("canvas");
      Object.assign(view.style, { position: "absolute", left: "0", top: "0", width: "100%", height: "100%", pointerEvents: "none" });
      canvas.after(view);
      canvas.style.visibility = "hidden";
      b.off = { rt: new THREE.RenderTarget(2, 2), view, busy: false, again: false };
    }
    camera.coordinateSystem = renderer.coordinateSystem;
    b.patchCamera();
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
    // the map's frame changed size (a window resize, Max's 1.5x): the ground texture is reallocated
    this.mapTex.dispose();
    return true;
  }

  private renderOffscreen() {
    const o = this.off!, w = this.canvas.width, h = this.canvas.height;
    if (o.rt.width !== w || o.rt.height !== h) o.rt.setSize(w, h);
    this.renderer.setRenderTarget(o.rt);
    this.pipeline!.render();
    this.renderer.setRenderTarget(null);
    // a frame drawn while the last one is still being read back is shown by a repaint after it
    if (o.busy) { o.again = true; return; }
    o.busy = true;
    void (this.renderer.readRenderTargetPixelsAsync(o.rt, 0, 0, w, h) as Promise<Uint8Array>).then((px) => {
      o.busy = false;
      if (o.view.width !== w || o.view.height !== h) { o.view.width = w; o.view.height = h; }
      const g = o.view.getContext("2d")!;
      const img = g.createImageData(w, h);
      img.data.set(px.subarray(0, w * h * 4));
      // opaque: the frame is, whatever the passes leave in alpha
      for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
      g.putImageData(img, 0, 0);
      this.stats.offscreenFrames = (this.stats.offscreenFrames ?? 0) + 1;
      if (o.again) { o.again = false; this.map.triggerRepaint(); }
    }).catch(() => { o.busy = false; });
  }

  /**
   * TRAA JITTERS THE CAMERA through setViewOffset, which on a stock camera
   * recomputes the projection from fov and aspect — MapLibre's matrix would be
   * thrown away. On this camera the projection is whatever orientCamera set,
   * and a view offset is a sub-pixel shift of it in clip space.
   */
  private patchCamera() {
    const cam = this.camera as THREE.PerspectiveCamera & { _bwUnjittered?: THREE.Matrix4 };
    cam.updateProjectionMatrix = () => {};
    cam.setViewOffset = (fullW: number, fullH: number, x: number, y: number) => {
      cam._bwUnjittered = (cam._bwUnjittered ?? new THREE.Matrix4()).copy(cam.projectionMatrix);
      cam.projectionMatrix.premultiply(new THREE.Matrix4().makeTranslation((-2 * x) / fullW, (2 * y) / fullH, 0));
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    };
    cam.clearViewOffset = () => {
      if (!cam._bwUnjittered) return;
      cam.projectionMatrix.copy(cam._bwUnjittered);
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      cam._bwUnjittered = undefined;
    };
  }

  /**
   * THE LOT OUTLINE OVER THE CITY. Classic lets MapLibre draw the selected
   * deed (gold), its neighbours (teal) and the hovered lot (white) after the
   * 3D layer, so the outline crosses in front of the buildings; on the beta
   * that layer only reaches the ground copy, under them. So the same rings
   * are drawn here, last and without a depth test, as ribbons a constant
   * number of pixels wide (the widths and colours of MapView's bw-select-top).
   */
  private outline: THREE.Mesh | null = null;
  private readonly uOutlinePx = T.uniform(1);
  setOutlines(spec: { ring: [number, number][]; kind: "sel" | "nbr" | "hov" }[]) {
    if (this.outline) { this.scene.remove(this.outline); this.outline.geometry.dispose(); this.outline = null; }
    if (!spec.length) return;
    const pos: number[] = [], off: number[] = [], col: number[] = [], wid: number[] = [], idx: number[] = [];
    const COL = { sel: new THREE.Color("#f2c353"), nbr: new THREE.Color("#3fb3a8"), hov: new THREE.Color("#ffffff") };
    const A = { sel: 1, nbr: 0.9, hov: 0.8 };
    for (const { ring, kind } of spec) {
      const n = ring.length;
      if (n < 3) continue;
      const base = pos.length / 3;
      for (let i = 0; i < n; i++) {
        const p = ring[i], a = ring[(i + n - 1) % n], b = ring[(i + 1) % n];
        // the miter at this corner: the mean of the two edge normals, stretched to keep the width
        const e1 = [p[0] - a[0], p[1] - a[1]], e2 = [b[0] - p[0], b[1] - p[1]];
        const l1 = Math.hypot(e1[0], e1[1]) || 1, l2 = Math.hypot(e2[0], e2[1]) || 1;
        const n1 = [-e1[1] / l1, e1[0] / l1], n2 = [-e2[1] / l2, e2[0] / l2];
        let mx = n1[0] + n2[0], my = n1[1] + n2[1];
        const ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml;
        const k = Math.min(3, 1 / Math.max(0.2, mx * n2[0] + my * n2[1]));
        for (const sgn of [1, -1]) {
          pos.push(p[0], p[1], 0.4);
          off.push(mx * k * sgn, my * k * sgn);
          const c = COL[kind]; col.push(c.r, c.g, c.b, A[kind]);
          wid.push(kind === "sel" ? 1 : 0.5);
        }
      }
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, a0 = base + i * 2, a1 = a0 + 1, b0 = base + j * 2, b1 = b0 + 1;
        idx.push(a0, b0, a1, a1, b0, b1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("offset", new THREE.Float32BufferAttribute(off, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
    g.setAttribute("wid", new THREE.Float32BufferAttribute(wid, 1));
    g.setIndex(idx);
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    // half the line's width in metres at this view: the selected deed's full width, its neighbours' half
    m.positionNode = T.positionLocal.add(T.vec3(T.attribute("offset", "vec2").mul(T.attribute("wid", "float")).mul(this.uOutlinePx), 0));
    m.colorNode = T.vertexColor().rgb;
    m.opacityNode = T.attribute("color", "vec4").a;
    m.userData.gpuRaw = true;
    m.outputNode = T.output;
    this.dressed.add(m);
    this.outline = new THREE.Mesh(g, m);
    this.outline.renderOrder = 1e6;
    this.outline.frustumCulled = false;
    this.outline.name = "gpu-lot-outline";
    this.scene.add(this.outline);
  }

  setGlassEnv(t: THREE.Texture | null, probe: boolean) { this.shared.glassEnv.value = t; this.shared.glassEnv.probe = probe; }

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
    // ONE HAZE, IN DISPLAY SPACE (owner's RTX 5070 Ti: the far city went milky).
    // This sheet blended its haze in the linear frame, which lightens far more
    // than classic's blend in display space, and the materials hazed again on
    // top. The finishing pass now hazes the whole frame once, from depth, in
    // display space, exactly as classic's materials and sheet did; the sheet
    // stays in the scene (RealCity hides and shows it) but draws nothing.
    void s;
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, colorWrite: false });
    m.visible = false;
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
    this.orientCamera();
    if (this.outline) {
      // bw-select-top's width: 2.4 px at zoom 13 to 4 px at 16.5 (the selected deed), in metres at the focus
      const z = this.map.getZoom();
      const px = 2.4 + 1.6 * Math.min(1, Math.max(0, (z - 13) / 3.5));
      const mpp = (distM * Math.tan(0.32175)) / (0.5 * (this.canvas.clientHeight || 900));
      this.uOutlinePx.value = 0.5 * px * mpp;
    }
    this.mapTex.needsUpdate = true;
    const tier = postFx.level === "full" && postFx.liveAO ? "max" : postFx.level;
    // the planar reflection is unproven on real WebGPU (safety net, post.ts)
    this.shared.uReflOn.value = tier === "max" && !NO_REFL && (this.backendName !== "webgpu" || UNPROVEN_OK || PROVEN_ON_WEBGPU.has("reflector")) ? 1 : 0;
    if (this.pipeline && this.post && this.post.level !== tier) { this.pipeline.dispose(); this.pipeline = null; }
    if (!this.pipeline) {
      const built = buildPost(this.renderer, this.scene, this.camera, tier, this.shared);
      this.pipeline = built.pipeline;
      this.post = built.u;
    }
    this.post!.update(postFx, pitch, distM, this.canvas.height);
    const info = this.renderer.info as N;
    if (this.off) this.renderOffscreen();
    else this.pipeline.render();
    // TEMPORAL AA SETTLES OVER FRAMES. MapLibre paints on demand, so after the
    // camera stops a few more frames are asked for, until the history has
    // converged (the traffic keeps painting anyway when it runs)
    if (tier === "max") {
      const moved = !this.lastC.equals(_c);
      if (moved) { this.lastC.copy(_c); this.settle = 16; } else if (this.settle > 0) this.settle--;
      if (this.settle > 0) requestAnimationFrame(() => this.map.triggerRepaint());
    }
    // hand RealCity its camera back as it set it (its picking unprojects through it)
    this.camera.projectionMatrix.copy(_c);
    this.camera.projectionMatrixInverse.copy(_ci);
    this.camera.matrix.makeTranslation(_eye.x, _eye.y, _eye.z);
    this.camera.updateMatrixWorld(true);
    this.stats.frames++;
    this.stats.ms = performance.now() - t0;
    this.stats.calls = info.render?.drawCalls ?? info.render?.calls ?? 0;
    this.stats.triangles = info.render?.triangles ?? 0;
  }

  /**
   * A REAL VIEW SPACE. RealCity's camera stands at the eye unrotated and lets
   * MapLibre's matrix do all the turning, so its view space is the world's.
   * Screen-space passes (GTAO, and SSR to come) assume a camera looking down
   * its own -Z, so the same matrix is split here into a rotation (the camera's
   * orientation, read off the matrix itself) and what is left of it as the
   * projection: clip = C·T(-eye)·p = (C·R)·(Rᵀ·T(-eye))·p, exactly the same
   * transform. Then WebGPU's clip depth (0..1, not -1..1).
   */
  private orientCamera() {
    const cam = this.camera;
    const C = _c.copy(cam.projectionMatrix);
    const eye = _eye.setFromMatrixPosition(cam.matrix);
    const inv = _ci.copy(C).invert();
    const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(inv);
    const n0 = at(0, 0, -1), f0 = at(0, 0, 0.5), up = at(0, 0.5, 0.5);
    const fwd = f0.clone().sub(n0).normalize();
    const zAxis = fwd.clone().negate();
    const yAxis = up.sub(f0).projectOnPlane(fwd).normalize();
    const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
    const R = _r.makeBasis(xAxis, yAxis, zAxis);
    cam.matrix.copy(R).setPosition(eye);
    cam.matrixWorldNeedsUpdate = true;
    cam.updateMatrixWorld(true);
    cam.projectionMatrix.copy(C).multiply(R);
    if (this.backendName === "webgpu") cam.projectionMatrix.premultiply(GL_TO_GPU);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  }

  dispose() {
    this.scene.remove(this.ground);
    this.mapTex.dispose();
    this.pipeline?.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

const NO_REFL = typeof location !== "undefined" && new URLSearchParams(location.search).get("refl") === "off";
const _c = new THREE.Matrix4(), _ci = new THREE.Matrix4(), _r = new THREE.Matrix4(), _eye = new THREE.Vector3();
/** WebGL's clip-space depth (-1..1) to WebGPU's (0..1). */
const GL_TO_GPU = new THREE.Matrix4().set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

function matsOf(o: THREE.Object3D): THREE.Material[] {
  const mm = (o as THREE.Mesh).material;
  if (!mm) return [];
  return Array.isArray(mm) ? mm : [mm];
}
