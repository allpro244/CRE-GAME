/**
 * THE FINISHING PASS (SKYLINE_LOOK_PLAN.md, step 1). The city is drawn into
 * MapLibre's own canvas, so there is no render target to post-process: this
 * copies the finished frame (ground, water and city, before the lot outline
 * and the labels) into a texture and draws it back through one shader.
 *
 * What the shader does, in display space (the frame is already tone-mapped):
 *  - TILT-SHIFT. A band across the frame stays sharp; above and below it the
 *    image blurs, more the steeper and closer the camera looks down. A street
 *    view reads as a model on a table; the island view, nearly flat-on and
 *    far, stays sharp. The band sits a little below centre, where the focus
 *    point of a pitched map camera falls on the ground.
 *  - BLOOM. Bright surfaces (sunlit stone, glints on glass and water) bleed a
 *    soft glow, from a small blur of what is over a threshold.
 *  - GRADE. Warm highlights, a hint of blue in the shadows, a little more
 *    saturation and a gentle S-curve.
 *  - VIGNETTE. A light darkening toward the corners.
 *
 * Every strength is a shape parameter set by eye on the reference shots
 * (seed 4242). Looks only; nothing here is read by the engine.
 */
import * as THREE from "three";

export type PostLevel = "off" | "grade" | "full";

const FRAG = `
uniform sampler2D tFrame;
uniform vec2 uTexel;       // 1 / frame size, in uv
uniform float uTilt;       // blur radius at the frame's edges, in px (0: none)
uniform float uFocus;      // the sharp band's centre, 0 (bottom) .. 1 (top)
uniform float uBand;       // the sharp band's half-height, in uv
uniform float uBloom;      // bloom strength (0: none)
uniform float uGrade;      // grade strength (0: none)
uniform sampler2D tDist;   // distance to the eye, packed (aoPass); none when uAO is 0
uniform vec2 uDistTexel;
uniform float uAO;         // ambient-occlusion strength (0: none)
uniform float uAOView;     // 1: show the occlusion term alone (review)
varying vec2 vUv;

#include <packing>
float distAt(vec2 uv) { return unpackRGBAToDepth(texture2D(tDist, uv)) * 6000.0; }

vec3 tap(vec2 uv) { return texture2D(tFrame, clamp(uv, uTexel, 1.0 - uTexel)).rgb; }

// a 12-tap disc, weighted toward the middle (GLSL ES 1: no const arrays)
vec2 disc(int i) {
  if (i == 0) return vec2(-0.326, -0.406); if (i == 1) return vec2(-0.840, -0.074);
  if (i == 2) return vec2(-0.696, 0.457);  if (i == 3) return vec2(-0.203, 0.621);
  if (i == 4) return vec2(0.962, -0.195);  if (i == 5) return vec2(0.473, -0.480);
  if (i == 6) return vec2(0.519, 0.767);   if (i == 7) return vec2(0.185, -0.893);
  if (i == 8) return vec2(0.507, 0.064);   if (i == 9) return vec2(0.896, 0.412);
  if (i == 10) return vec2(-0.322, -0.933); return vec2(-0.792, -0.598);
}

void main() {
  vec3 c = tap(vUv);

  // AMBIENT OCCLUSION. Where a neighbour a few pixels off stands nearer the
  // eye than this pixel — a wall rising from the pavement, the far side of a
  // street canyon, a parapet over its roof — this pixel is in a crease and
  // gets less sky. The range check stops a tower in front of a far block
  // from darkening the whole block.
  if (uAO > 0.0) {
    float d0 = distAt(vUv);
    if (uAOView > 0.5 && d0 >= 5900.0) { gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0); return; }
    if (d0 < 5900.0) {
      // a crease is where the neighbours on BOTH sides of a pixel average
      // nearer than it (a wall rising from the pavement, a parapet over its
      // roof). A flat plane seen at a grazing angle has one side nearer and
      // the other farther by the same amount, so it never reads as one.
      float occ = 0.0;
      // in distance texels (full resolution): the same reach on screen as before
      float rad = clamp(8400.0 / d0, 6.0, 28.0);
      // all twelve pairs: six quantised the shade into six hard steps, the
      // stepped ring round every tree crown and kerb (a per-pixel turn of the
      // pattern hid the steps but left a grain on every flat plaza)
      for (int i = 0; i < 12; i++) {
        vec2 o = disc(i) * rad * uDistTexel;
        // BOTH sides nearer: a silhouette has one side far nearer and the
        // other level or behind, so the smaller of the two rejects it
        float cav = min(d0 - distAt(vUv + o), d0 - distAt(vUv - o));
        // a contact crease is shallow; a building's edge against the ground
        // far behind it is a big step, and must not draw a halo
        occ += smoothstep(0.001 * d0, 0.006 * d0, cav) * (1.0 - smoothstep(0.03 * d0, 0.06 * d0, cav));
      }
      c *= 1.0 - uAO * clamp(occ / 12.0, 0.0, 1.0);
      if (uAOView > 0.5) { gl_FragColor = vec4(vec3(1.0 - clamp(occ / 12.0, 0.0, 1.0)) * vec3(1.0, 0.9 + 0.1 * fract(d0 / 50.0), 1.0), 1.0); return; }
    }
  }

  // tilt-shift: blur grows smoothly past the band's edge
  float off = max(0.0, abs(vUv.y - uFocus) - uBand);
  float r = uTilt * smoothstep(0.0, 0.42, off);
  if (r > 0.35) {
    vec3 acc = c; float w = 1.0;
    for (int i = 0; i < 12; i++) { acc += tap(vUv + disc(i) * r * uTexel); w += 1.0; }
    c = acc / w;
  }

  // bloom: the bright part of a wide neighbourhood, added back softly
  if (uBloom > 0.0) {
    vec3 b = vec3(0.0);
    for (int i = 0; i < 12; i++) {
      vec3 s = tap(vUv + disc(i) * 7.0 * uTexel);
      b += max(s - vec3(0.9), 0.0);
    }
    c += b / 12.0 * uBloom;
  }

  if (uGrade > 0.0) {
    vec3 g = c;
    float l = dot(g, vec3(0.2126, 0.7152, 0.0722));
    // saturation
    g = mix(vec3(l), g, 1.0 + 0.22 * uGrade);
    // warm highlights, a little blue in the shadows
    vec3 warm = vec3(1.025, 1.0, 0.965), cool = vec3(0.96, 0.99, 1.04);
    g *= mix(cool, warm, smoothstep(0.15, 0.75, l));
    // a gentle S-curve about the middle grey
    g = mix(g, g * g * (3.0 - 2.0 * g), 0.34 * uGrade);
    c = mix(c, g, uGrade);
  }

  // vignette
  vec2 q = vUv - 0.5;
  c *= 1.0 - 0.16 * uGrade * smoothstep(0.4, 1.0, dot(q, q) * 2.2);

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

// the view-space position is interpolated and its length taken per pixel:
// a distance interpolated across a big triangle (the ground) is far too long
const DIST_VERT = `
varying vec3 vP;
void main() {
  #include <begin_vertex>
  #include <project_vertex>
  vP = mvPosition.xyz;
}`;
const DIST_FRAG = `
#include <packing>
varying vec3 vP;
void main() { gl_FragColor = packDepthToRGBA(clamp(length(vP) / 6000.0, 0.0, 0.9999)); }`;

export class PostFX {
  private tex: THREE.FramebufferTexture | null = null;
  private distRT: THREE.WebGLRenderTarget | null = null;
  private lastProj: number[] = [];
  private lastDist = 0;
  private readonly distMat = new THREE.ShaderMaterial({ vertexShader: DIST_VERT, fragmentShader: DIST_FRAG, side: THREE.DoubleSide });
  // the ground is MapLibre's, not ours: the distance pass stands its own
  // street-level plane under the city, or nothing would meet the pavement
  private readonly ground = (() => { const m = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), this.distMat); m.frustumCulled = false; return m; })();
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly mat: THREE.ShaderMaterial;
  level: PostLevel = "full";
  /** ?post=off in the address turns the pass off whatever the setting (before/after review shots) */
  private readonly aoView = typeof location !== "undefined" && new URLSearchParams(location.search).get("post") === "aoview";
  private readonly forcedOff = typeof location !== "undefined" && new URLSearchParams(location.search).get("post") === "off";

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tFrame: { value: null }, uTexel: { value: new THREE.Vector2() },
        uTilt: { value: 0 }, uFocus: { value: 0.45 }, uBand: { value: 0.12 },
        uBloom: { value: 0 }, uGrade: { value: 1 },
        tDist: { value: null }, uDistTexel: { value: new THREE.Vector2() }, uAO: { value: 0 }, uAOView: { value: 0 },
      },
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: FRAG,
      depthTest: false, depthWrite: false, toneMapped: false, transparent: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /**
   * Run the pass over what is on the canvas now. pitch in radians, distM the
   * camera's distance to its focus in metres.
   */
  apply(renderer: THREE.WebGLRenderer, pitch: number, distM: number, scene?: THREE.Scene, camera?: THREE.Camera, hide: (THREE.Object3D | null)[] = []) {
    if (this.level === "off" || this.forcedOff) return;
    // the distance pass for ambient occlusion, High only, at full resolution
    const ao = this.level === "full" && !!scene && !!camera;
    // the city does not move: while the camera holds still (the traffic keeps
    // repainting at ~30 fps) the last distance pass still stands, so it is
    // only redrawn when the view changes — or every half second, for the
    // cars and the odd rebuilt deed
    if (ao) {
      const e = (camera as THREE.Camera).projectionMatrix.elements;
      let same = !!this.distRT && this.lastProj.length === 16;
      for (let i = 0; same && i < 16; i++) if (Math.abs(e[i] - this.lastProj[i]) > 1e-9) same = false;
      const now = performance.now();
      if (!same || now - this.lastDist > 500) {
        this.distPass(renderer, scene!, camera!, hide);
        this.lastProj = Array.from(e);
        this.lastDist = now;
      }
    }
    // the canvas as it is now, not the size the renderer was made at (it shares MapLibre's canvas)
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    if (w < 2 || h < 2) return;
    if (!this.tex || this.tex.image.width !== w || this.tex.image.height !== h) {
      this.tex?.dispose();
      this.tex = new THREE.FramebufferTexture(w, h);
      this.tex.minFilter = this.tex.magFilter = THREE.LinearFilter;
      this.mat.uniforms.tFrame.value = this.tex;
      this.mat.uniforms.uTexel.value.set(1 / w, 1 / h);
    }
    renderer.copyFramebufferToTexture(this.tex);
    const full = this.level === "full";
    // the model look comes with a steep, close camera: none flat-on or far
    const steep = Math.min(1, Math.max(0, (pitch - 0.35) / 0.6));
    const close = Math.min(1, Math.max(0, (2600 - distM) / 2000));
    const u = this.mat.uniforms;
    // a gentle model look: the band covers the middle third, and only the
    // top of the frame (the far city) and the very bottom soften
    u.uTilt.value = full ? 4.5 * (h / 1000) * steep * close : 0;
    u.uFocus.value = 0.44 + 0.06 * (1 - steep);
    u.uBand.value = 0.2 + 0.08 * (1 - close);
    u.uBloom.value = full ? 0.35 : 0;
    u.uGrade.value = 1;
    u.uAO.value = ao ? 0.65 : 0;
    u.uAOView.value = this.aoView ? 1 : 0;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, this.cam);
    renderer.autoClear = auto;
  }

  /**
   * Distance to the eye of everything the city draws (see the AO block in
   * FRAG), at the frame's own resolution. It was half-size: every frame pixel
   * then read its distance from a 2x2 block, so along every silhouette the
   * colour and the distance belonged to different surfaces and the occlusion
   * drew a blocky ring round each tree crown and building edge.
   */
  private distPass(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, hide: (THREE.Object3D | null)[]) {
    const gl = renderer.getContext();
    const w = Math.max(2, gl.drawingBufferWidth), h = Math.max(2, gl.drawingBufferHeight);
    if (!this.distRT || this.distRT.width !== w || this.distRT.height !== h) {
      this.distRT?.dispose();
      this.distRT = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
      this.mat.uniforms.tDist.value = this.distRT.texture;
      this.mat.uniforms.uDistTexel.value.set(1 / w, 1 / h);
    }
    const was = hide.map((o) => o?.visible ?? false);
    hide.forEach((o) => { if (o) o.visible = false; });
    const prevOverride = scene.overrideMaterial, prevClear = renderer.getClearAlpha(), prevCol = renderer.getClearColor(new THREE.Color());
    const prevTarget = renderer.getRenderTarget(), prevShadow = renderer.shadowMap.enabled;
    scene.overrideMaterial = this.distMat;
    scene.add(this.ground);
    renderer.shadowMap.enabled = false;
    renderer.setRenderTarget(this.distRT);
    renderer.setClearColor(0xffffff, 1);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevCol, prevClear);
    renderer.shadowMap.enabled = prevShadow;
    scene.overrideMaterial = prevOverride;
    scene.remove(this.ground);
    hide.forEach((o, i) => { if (o) o.visible = was[i]; });
  }

  dispose() { this.tex?.dispose(); this.distRT?.dispose(); this.distMat.dispose(); this.mat.dispose(); }
}
