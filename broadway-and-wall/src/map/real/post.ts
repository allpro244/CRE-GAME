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
 *  - BLOOM. Bright surfaces (sunlit stone, lit windows after dark) bleed a
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
precision highp float;
uniform sampler2D tFrame;
uniform vec2 uTexel;       // 1 / frame size, in uv
uniform float uTilt;       // blur radius at the frame's edges, in px (0: none)
uniform float uFocus;      // the sharp band's centre, 0 (bottom) .. 1 (top)
uniform float uBand;       // the sharp band's half-height, in uv
uniform float uBloom;      // bloom strength (0: none)
uniform float uGrade;      // grade strength (0: none)
uniform float uNight;      // 0 day .. 1 night: less warmth, more glow
varying vec2 vUv;

vec3 tap(vec2 uv) { return texture2D(tFrame, clamp(uv, uTexel, 1.0 - uTexel)).rgb; }

// a 12-tap disc, weighted toward the middle
const vec2 D[12] = vec2[12](
  vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
  vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
  vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));

void main() {
  vec3 c = tap(vUv);

  // tilt-shift: blur grows smoothly past the band's edge
  float off = max(0.0, abs(vUv.y - uFocus) - uBand);
  float r = uTilt * smoothstep(0.0, 0.32, off);
  if (r > 0.35) {
    vec3 acc = c; float w = 1.0;
    for (int i = 0; i < 12; i++) { acc += tap(vUv + D[i] * r * uTexel); w += 1.0; }
    c = acc / w;
  }

  // bloom: the bright part of a wide neighbourhood, added back softly
  if (uBloom > 0.0) {
    vec3 b = vec3(0.0);
    for (int i = 0; i < 12; i++) {
      vec3 s = tap(vUv + D[i] * 7.0 * uTexel);
      b += max(s - vec3(0.72 - 0.3 * uNight), 0.0);
    }
    c += b / 12.0 * uBloom * (1.0 + 1.6 * uNight);
  }

  if (uGrade > 0.0) {
    vec3 g = c;
    float l = dot(g, vec3(0.2126, 0.7152, 0.0722));
    // saturation
    g = mix(vec3(l), g, 1.0 + 0.14 * uGrade);
    // warm highlights, a little blue in the shadows (less warmth at night)
    vec3 warm = vec3(1.045, 1.0, 0.93), cool = vec3(0.95, 0.985, 1.05);
    g *= mix(cool, mix(warm, vec3(1.0), uNight * 0.7), smoothstep(0.15, 0.75, l));
    // a gentle S-curve about the middle grey
    g = mix(g, g * g * (3.0 - 2.0 * g), 0.22 * uGrade);
    c = mix(c, g, uGrade);
  }

  // vignette
  vec2 q = vUv - 0.5;
  c *= 1.0 - 0.22 * uGrade * smoothstep(0.32, 0.95, dot(q, q) * 2.2);

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export class PostFX {
  private tex: THREE.FramebufferTexture | null = null;
  private size = new THREE.Vector2();
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly mat: THREE.ShaderMaterial;
  level: PostLevel = "full";
  /** ?post=off in the address turns the pass off whatever the setting (before/after review shots) */
  private readonly forcedOff = typeof location !== "undefined" && new URLSearchParams(location.search).get("post") === "off";

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        tFrame: { value: null }, uTexel: { value: new THREE.Vector2() },
        uTilt: { value: 0 }, uFocus: { value: 0.45 }, uBand: { value: 0.12 },
        uBloom: { value: 0 }, uGrade: { value: 1 }, uNight: { value: 0 },
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
   * camera's distance to its focus in metres, night 0..1.
   */
  apply(renderer: THREE.WebGLRenderer, pitch: number, distM: number, night: number) {
    if (this.level === "off" || this.forcedOff) return;
    renderer.getDrawingBufferSize(this.size);
    const w = Math.floor(this.size.x), h = Math.floor(this.size.y);
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
    u.uTilt.value = full ? 9 * (h / 1000) * steep * close : 0;
    u.uFocus.value = 0.42 + 0.06 * (1 - steep);
    u.uBand.value = 0.1 + 0.08 * (1 - close);
    u.uBloom.value = full ? 0.55 : 0;
    u.uGrade.value = 1;
    u.uNight.value = night;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, this.cam);
    renderer.autoClear = auto;
  }

  dispose() { this.tex?.dispose(); this.mat.dispose(); }
}
