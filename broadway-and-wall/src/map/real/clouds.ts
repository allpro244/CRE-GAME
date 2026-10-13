/**
 * THE CLOUDS (SKYLINE_LOOK_PLAN round 30). One field of fair-weather cumulus
 * over the town and the shade it drops on roofs, streets and water: every lit
 * material and the shadow catcher read it through RealCity's air hook. Kept
 * in its own module so anything else that shows the sky can read the same
 * field (a cloud drawn overhead must be the one whose shadow is crossing the
 * street).
 *
 * The field is cells of ~420 m at a 1,400 m base, drifting at ~8 m/s. A
 * surface is shaded where its line to the sun meets a cell; the sun's direct
 * light is what a cloud takes away, the sky fill is left alone. Shape
 * parameters set by eye on the reference shots; nothing here is read by the
 * engine.
 */
import * as THREE from "three";

/** Cloud base above the ground, metres. */
export const CLOUD_BASE = 1400;

export const CLOUD = {
  cloudSun: { value: new THREE.Vector3(0.45, -0.55, 0.7).normalize() },
  // the eye in world metres: three uploads cameraPosition only to some
  // material kinds (not the shadow catcher), so the field carries its own
  cloudEye: { value: new THREE.Vector3() },
  cloudOff: { value: new THREE.Vector2(0, 0) },
  cloudCover: { value: 0.25 },  // share of the ground in a cloud's shade
  cloudK: { value: 0.5 },       // how much of the sun a cloud takes
};

export const CLOUD_GLSL = `
uniform vec3 cloudSun, cloudEye;
uniform vec2 cloudOff;
uniform float cloudCover, cloudK;
float cHash(vec2 p) { p = 50.0 * fract(p * 0.3183099 + vec2(0.71, 0.113)); return fract(p.x * p.y * (p.x + p.y)); }
float cNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(cHash(i), cHash(i + vec2(1.0, 0.0)), u.x), mix(cHash(i + vec2(0.0, 1.0)), cHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// the field at a point of the cloud base: clusters of cells with scalloped,
// billowed edges
float cloudField(vec2 q) {
  vec2 p = q / 420.0 + cloudOff;
  return 0.5 * cNoise(p) + 0.25 * cNoise(p * 2.07 + vec2(5.2, 1.3)) + 0.15 * cNoise(p * 4.3 + vec2(1.7, 9.2)) + 0.1 * cNoise(p * 9.1 + vec2(3.3, 7.7));
}
// the sum bunches round 0.5 (sd ~0.1): the threshold that puts a share
// cloudCover of the base in cloud, fitted to the field's measured quantiles
float cloudEdge() { return 0.5 + (0.5 - cloudCover) * 0.36; }
float cloudSunlight(vec3 wp, float k) {
  if (cloudK <= 0.0) return 1.0;
  vec2 q = wp.xy + cloudSun.xy / max(cloudSun.z, 0.25) * (${CLOUD_BASE.toFixed(1)} - wp.z);
  float e = cloudEdge();
  // far off, the air between hides a cloud's shade as it hides everything
  // else: gone by ~7 km, so the horizon is haze and not grey smears
  float far = 1.0 - smoothstep(2000.0, 7000.0, length(wp - cloudEye));
  // a broad penumbra: a cumulus has no hard edge and the sun is a disc
  return 1.0 - cloudK * k * far * smoothstep(e - 0.045, e + 0.06, cloudField(q));
}`;
