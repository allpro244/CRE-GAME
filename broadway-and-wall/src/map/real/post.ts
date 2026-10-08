/**
 * THE POST STAGE: AMBIENT OCCLUSION OVER THE FINISHED FRAME.
 *
 * Sky light does not reach into a crease. Where a wall meets the pavement,
 * where a parapet meets its roof, under a cornice, between two buildings a
 * few metres apart, the ambient falls away — and it is that falloff, more
 * than any texture, that tells the eye one surface stands on another rather
 * than floating over it. The wall shader already darkens the foot of every
 * wall by a street-width rule (vAoH); this is the general answer, measured
 * from the geometry actually on screen.
 *
 * The city is drawn straight into MapLibre's canvas, so there is no colour
 * buffer of ours to post-process. Instead the effect is a multiplier:
 *
 *   1. DEPTH. The scene is drawn again, depth only, at half resolution.
 *   2. OCCLUSION. For each pixel the eye-space position is rebuilt from that
 *      depth, a normal from its neighbours, and a dozen points in the
 *      hemisphere over it are tested against the depth buffer.
 *   3. COMPOSITE. A depth-aware blur of the occlusion is multiplied onto
 *      the frame already on screen (DstColor x ao), so the light and the
 *      grade the frame was drawn with are untouched everywhere that is open.
 *
 * Eye space here is the layer's own: the camera sits AT the eye with no
 * rotation (RealCityLayer.render), so a position rebuilt through the inverse
 * projection is world metres relative to the eye, z up, and the eye is the
 * origin. Distances in metres are real metres.
 *
 * Shape parameters, stated as such: the radius (1.6-6 m, growing with the
 * view distance so a crease reads at every zoom) and the strength are set by
 * eye against the reference views, not against any measurement. The fade
 * with distance follows the aerial haze, because the air that hazes a far
 * block fills its creases with the same light.
 */
import * as THREE from "three";

const SAMPLES = 12;

/** A hemisphere kernel, +z up, denser toward the centre. Fixed, so a frame never shimmers. */
function kernel(): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  let s = 917;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < SAMPLES; i++) {
    const v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, 0.15 + rnd() * 0.85).normalize();
    const t = i / SAMPLES;
    v.multiplyScalar(0.2 + 0.8 * t * t);
    out.push(v);
  }
  return out;
}

const FULL_VS = "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";

const AO_FS = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDepth;
uniform mat4 uProj, uProjInv;
uniform vec2 uTexel;
uniform vec3 uKernel[${SAMPLES}];
uniform float uRadius, uFadeNear, uFadeFar;

vec3 posAt(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}

void main() {
  float d = texture2D(tDepth, vUv).x;
  if (d >= 1.0) { gl_FragColor = vec4(1.0); return; }
  vec3 P = posAt(vUv);
  float dist = length(P);
  float fade = 1.0 - smoothstep(uFadeNear, uFadeFar, dist);
  if (fade <= 0.0) { gl_FragColor = vec4(1.0); return; }
  // the normal from the nearer neighbour on each axis, so an edge does not
  // smear a wall's normal into the roof behind it
  vec3 px = posAt(vUv + vec2(uTexel.x, 0.0)) - P, nx = P - posAt(vUv - vec2(uTexel.x, 0.0));
  vec3 py = posAt(vUv + vec2(0.0, uTexel.y)) - P, ny = P - posAt(vUv - vec2(0.0, uTexel.y));
  vec3 dx = dot(px, px) < dot(nx, nx) ? px : nx;
  vec3 dy = dot(py, py) < dot(ny, ny) ? py : ny;
  vec3 N = normalize(cross(dx, dy));
  if (dot(N, P) > 0.0) N = -N;
  // a per-pixel turn of the kernel about the normal, on a 4 x 4 tile the
  // composite's blur then averages away
  vec2 cell = mod(floor(gl_FragCoord.xy), 4.0);
  float ang = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
  vec3 rv = vec3(cos(ang), sin(ang), 0.0);
  vec3 T = normalize(rv - N * dot(rv, N));
  if (abs(dot(rv, N)) > 0.99) T = normalize(cross(N, vec3(0.0, 1.0, 0.0)));
  vec3 B = cross(N, T);
  mat3 TBN = mat3(T, B, N);
  float R = uRadius * (1.0 + dist * 0.0015);
  // ALCHEMY-STYLE: each sample finds the surface actually seen in its
  // direction (Q) and counts only how far that surface rises above this
  // pixel's own tangent plane. Flat ground cannot occlude itself, however
  // coarse the depth, which is what a plain in-front-of test got wrong:
  // half-resolution depth over a kilometre of street read as a field of tiny
  // occluders and darkened everything a little.
  float bias = 0.06 * R + 0.003 * dist;
  float occ = 0.0;
  for (int i = 0; i < ${SAMPLES}; i++) {
    vec3 S = P + TBN * uKernel[i] * R;
    vec4 c = uProj * vec4(S, 1.0);
    vec2 uv = c.xy / c.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) continue;
    vec3 v = posAt(uv) - P;
    float vv = dot(v, v);
    // a surface well beyond the radius (a tower across the street) is out of range
    float range = 1.0 - smoothstep(0.6 * R * R, 1.6 * R * R, vv);
    occ += max(0.0, dot(v, N) - bias) / (vv + 0.05 * R * R) * R * range;
  }
  float ao = clamp(1.0 - 1.6 * occ / float(${SAMPLES}) * fade, 0.0, 1.0);
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}
`;

const COMP_FS = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tAO, tDepth;
uniform vec2 uTexel;
uniform float uStrength;
float lin(float d) { return 1.0 / max(1.0 - d, 1e-6); }
void main() {
  float d0 = texture2D(tDepth, vUv).x;
  if (d0 >= 1.0) { gl_FragColor = vec4(1.0); return; }
  float l0 = lin(d0);
  float sum = 0.0, wsum = 0.0;
  for (int y = -2; y <= 1; y++) for (int x = -2; x <= 1; x++) {
    vec2 uv = vUv + (vec2(float(x), float(y)) + 0.5) * uTexel;
    float l = lin(texture2D(tDepth, uv).x);
    // depth-aware: a neighbour on another surface does not bleed across the edge
    // ground seen at a grazing angle changes depth fast from row to row; a
    // tight tolerance there threw away every vertical neighbour and left the
    // blur horizontal — streaks. Loose enough for a slope, still an edge stop.
    float w = 1.0 / (1e-3 + abs(l - l0) / l0 * 6.0);
    sum += texture2D(tAO, uv).x * w; wsum += w;
  }
  float ao = sum / wsum;
  ao = mix(1.0, ao, uStrength);
  gl_FragColor = vec4(vec3(ao), 1.0);
}
`;

export class CityPost {
  private depthRT: THREE.WebGLRenderTarget | null = null;
  private aoRT: THREE.WebGLRenderTarget | null = null;
  private depthMat = new THREE.MeshBasicMaterial({ colorWrite: false });
  private quadCam = new THREE.Camera();
  private aoMat: THREE.ShaderMaterial;
  private compMat: THREE.ShaderMaterial;
  private aoScene = new THREE.Scene();
  private compScene = new THREE.Scene();
  private failed = false;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.aoMat = new THREE.ShaderMaterial({
      vertexShader: FULL_VS, fragmentShader: AO_FS, depthTest: false, depthWrite: false,
      uniforms: {
        tDepth: { value: null }, uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() },
        uTexel: { value: new THREE.Vector2() }, uKernel: { value: kernel() },
        uRadius: { value: 3 }, uFadeNear: { value: 400 }, uFadeFar: { value: 2000 },
      },
    });
    this.compMat = new THREE.ShaderMaterial({
      vertexShader: FULL_VS, fragmentShader: COMP_FS, depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      uniforms: { tAO: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uStrength: { value: 0.85 } },
    });
    // the composite writes display values straight onto the frame: no tone map, no colour conversion
    this.compMat.toneMapped = false;
    this.aoMat.toneMapped = false;
    const tri = new THREE.BufferGeometry();
    tri.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    tri.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const a = new THREE.Mesh(tri, this.aoMat); a.frustumCulled = false; this.aoScene.add(a);
    const c = new THREE.Mesh(tri, this.compMat); c.frustumCulled = false; this.compScene.add(c);
  }

  private size(w: number, h: number) {
    const hw = Math.max(1, Math.ceil(w / 2)), hh = Math.max(1, Math.ceil(h / 2));
    if (this.depthRT && this.depthRT.width === hw && this.depthRT.height === hh) return;
    this.depthRT?.dispose(); this.aoRT?.dispose();
    const dt = new THREE.DepthTexture(hw, hh, THREE.FloatType);
    dt.minFilter = dt.magFilter = THREE.NearestFilter;
    this.depthRT = new THREE.WebGLRenderTarget(hw, hh, { depthTexture: dt, depthBuffer: true, type: THREE.UnsignedByteType });
    this.aoRT = new THREE.WebGLRenderTarget(hw, hh, { depthBuffer: false, type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  }

  /**
   * Multiply occlusion onto the frame just drawn. `hide` is what must not
   * stand in the depth pass (rain and snow, the haze sheet); `distM` is the
   * view distance, which sets the radius and the fade.
   */
  run(scene: THREE.Scene, camera: THREE.Camera, distM: number, hide: (THREE.Object3D | null)[]) {
    if (this.failed) return;
    const r = this.renderer, gl = r.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    // from the whole-island camera a crease is under a pixel: nothing to draw
    if (distM > 3200) return;
    try {
      this.size(W, H);
      const dRT = this.depthRT!, aRT = this.aoRT!;
      const was = hide.map((o) => o?.visible ?? false);
      hide.forEach((o) => { if (o) o.visible = false; });
      const bg = scene.background, ov = scene.overrideMaterial, sm = r.shadowMap.needsUpdate;
      scene.background = null; scene.overrideMaterial = this.depthMat; r.shadowMap.needsUpdate = false;
      r.setRenderTarget(dRT);
      r.setClearColor(0x000000, 0); r.clear(true, true, false);
      r.render(scene, camera);
      scene.overrideMaterial = ov; scene.background = bg; r.shadowMap.needsUpdate = sm;
      hide.forEach((o, i) => { if (o) o.visible = was[i]; });

      const u = this.aoMat.uniforms;
      u.tDepth.value = dRT.depthTexture;
      u.uProj.value.copy(camera.projectionMatrix);
      u.uProjInv.value.copy(camera.projectionMatrix).invert();
      u.uTexel.value.set(1 / dRT.width, 1 / dRT.height);
      u.uRadius.value = Math.max(1.6, Math.min(6, distM * 0.004));
      u.uFadeNear.value = distM * 0.6 + 150;
      u.uFadeFar.value = distM * 2.2 + 600;
      r.setRenderTarget(aRT);
      r.render(this.aoScene, this.quadCam);

      const cu = this.compMat.uniforms;
      cu.tAO.value = aRT.texture; cu.tDepth.value = dRT.depthTexture;
      cu.uTexel.value.set(1 / aRT.width, 1 / aRT.height);
      // fade the whole effect in from the island view, where it would be grain
      cu.uStrength.value = 0.85 * (1 - smoothstep(1800, 3200, distM));
      r.setRenderTarget(null);
      r.render(this.compScene, this.quadCam);
    } catch (e) {
      // a context that cannot do float depth textures keeps the frame it had
      this.failed = true;
      console.warn("city post stage off:", e);
      r.setRenderTarget(null);
    }
  }

  dispose() {
    this.depthRT?.dispose(); this.aoRT?.dispose();
    this.aoMat.dispose(); this.compMat.dispose(); this.depthMat.dispose();
  }
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
