// THE MODEL ON THE DESK. While you design a building on the Build desk, this
// is the building — not a sketch of it. The 3D city builds it with the same
// code that will draw it on the map the day it delivers (RealCityLayer.
// schemeModel → buildItem): the elevation, the paint, the style's shape, the
// crown, the roof plant, the shopfronts, standing on its own lot among its
// real neighbours (as plain massing, for scale) under the month's sun. It
// re-draws on every change to the design or the dials. Drag to turn it,
// scroll to zoom; it turns slowly on its own until you take hold of it.
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { activeCity, skyEnvironment, type SchemeModel } from "@/map/real/RealCity";
import { useStore, type DesignPreview } from "@/state/store";
import { START_YEAR } from "@/engine/types";

const FLOOR_M = 3.55;   // the storey the map draws player stock at (MapView)

interface View { az: number; el: number; dist: number; spin: boolean }

export default function SchemeViewer({ height = 300 }: { height?: number }) {
  const p = useStore((s) => s.designPreview);
  const month = useStore((s) => s.game?.month ?? 0);
  const box = useRef<HTMLDivElement | null>(null);
  const rig = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
    sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; skyEnv: THREE.Texture;
    world: THREE.Group; model: SchemeModel | null; mats: Map<THREE.Material, THREE.Material>;
    view: View; target: THREE.Vector3; dirty: boolean; raf: number;
  } | null>(null);
  const [status, setStatus] = useState<"ok" | "nomap" | "nolot" | "nogl">("ok");
  const [spin, setSpin] = useState(true);
  const [built, setBuilt] = useState<{ h: number } | null>(null);

  // the renderer, once
  useEffect(() => {
    // a canvas of its own per mount: a context given up on unmount cannot be
    // had back from the same canvas, and React may mount this twice
    const host = box.current;
    if (!host) return;
    const el = document.createElement("canvas");
    Object.assign(el.style, { display: "block", width: "100%", height: "100%", borderRadius: "8px", cursor: "grab", touchAction: "none" });
    host.appendChild(el);
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ canvas: el, antialias: true }); } catch { setStatus("nogl"); el.remove(); return; }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // the map's own grade: ACES at the same exposure, so the colours match
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.82;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xc9d6e2);
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.03).texture;
    scene.environmentIntensity = 0.5;
    const skyEnv = pm.fromScene(skyEnvironment(), 0.02).texture;
    pm.dispose();
    const camera = new THREE.PerspectiveCamera(32, 1, 1, 6000);
    camera.up.set(0, 0, 1);
    const sun = new THREE.DirectionalLight(0xffffff, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.4;
    const hemi = new THREE.HemisphereLight(0xdfe8f2, 0x8a8170, 1);
    scene.add(sun, sun.target, hemi);
    const world = new THREE.Group();
    scene.add(world);
    const r: NonNullable<typeof rig.current> = {
      renderer, scene, camera, sun, hemi, skyEnv, world, model: null, mats: new Map(),
      view: { az: -0.9, el: 0.42, dist: 120, spin: true }, target: new THREE.Vector3(), dirty: true, raf: 0,
    };
    rig.current = r;
    let last = performance.now();
    const frame = (t: number) => {
      r.raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (t - last) / 1000); last = t;
      if (r.view.spin) { r.view.az += dt * 0.25; r.dirty = true; }
      if (!r.dirty) return;
      r.dirty = false;
      const w = el.clientWidth, h = el.clientHeight;
      if (w && h && (el.width !== Math.round(w * renderer.getPixelRatio()) || el.height !== Math.round(h * renderer.getPixelRatio()))) {
        renderer.setSize(w, h, false);
        camera.aspect = w / h; camera.updateProjectionMatrix();
      }
      const { az, el: e, dist } = r.view;
      camera.position.set(r.target.x + Math.cos(az) * Math.cos(e) * dist, r.target.y + Math.sin(az) * Math.cos(e) * dist, r.target.z + Math.sin(e) * dist);
      camera.lookAt(r.target);
      renderer.render(scene, camera);
    };
    r.raf = requestAnimationFrame(frame);
    // turn it by hand: drag to orbit, scroll to zoom
    let drag: { x: number; y: number } | null = null;
    const down = (ev: PointerEvent) => { drag = { x: ev.clientX, y: ev.clientY }; el.setPointerCapture(ev.pointerId); r.view.spin = false; setSpin(false); };
    const move = (ev: PointerEvent) => {
      if (!drag) return;
      r.view.az -= (ev.clientX - drag.x) * 0.008;
      r.view.el = Math.max(0.03, Math.min(1.45, r.view.el + (ev.clientY - drag.y) * 0.006));
      drag = { x: ev.clientX, y: ev.clientY }; r.dirty = true;
    };
    const up = () => { drag = null; };
    const wheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const H = r.model?.height ?? 30;
      r.view.dist = Math.max(Math.max(18, H * 0.5), Math.min(Math.max(400, H * 6), r.view.dist * Math.exp(ev.deltaY * 0.0012)));
      r.dirty = true;
    };
    el.addEventListener("pointerdown", down); el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", wheel, { passive: false });
    const ro = new ResizeObserver(() => { r.dirty = true; });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(r.raf); ro.disconnect();
      el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", wheel);
      clearWorld(r.world);
      for (const m of r.mats.values()) m.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      el.remove();
      rig.current = null;
    };
  }, []);

  // the building, on every change of design, dials or month
  const sig = p ? JSON.stringify(p) + ":" + month : "";
  useEffect(() => {
    const r = rig.current;
    if (!r) return;
    if (!p) { clearWorld(r.world); r.model = null; setBuilt(null); r.dirty = true; return; }
    const id = window.setTimeout(() => {
      const city = activeCity;
      if (!city) { setStatus("nomap"); return; }
      const m = city.schemeModel(itemOf(p, month));
      if (!m) { setStatus("nolot"); return; }
      setStatus("ok");
      const first = !r.model;
      clearWorld(r.world);
      r.model = m;
      // materials are the map's own; only the ones that reflect the map's sky
      // need this renderer's copy of it
      m.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const src = mesh.material as THREE.Material & { envMap?: THREE.Texture | null };
        if (!src.envMap) return;
        let c = r.mats.get(src);
        if (!c) {
          c = src.clone();
          c.onBeforeCompile = src.onBeforeCompile;
          c.customProgramCacheKey = src.customProgramCacheKey;
          (c as THREE.MeshStandardMaterial).envMap = r.skyEnv;
          r.mats.set(src, c);
        }
        mesh.material = c;
      });
      r.world.add(m.group);
      r.world.add(ground(m));
      // the month's light, as the city has it
      r.sun.color.copy(m.sun.color); r.sun.intensity = m.sun.intensity;
      const span = Math.max(80, m.height * 1.3, ...m.lot.map(([x, y]) => Math.hypot(x, y) * 2.5));
      r.sun.position.copy(m.sun.dir).multiplyScalar(span * 3); r.sun.target.position.set(0, 0, 0);
      const sc = r.sun.shadow.camera;
      sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.near = 1; sc.far = span * 8;
      sc.updateProjectionMatrix();
      r.hemi.color.copy(m.sky.sky); r.hemi.groundColor.copy(m.sky.ground); r.hemi.intensity = m.sky.intensity;
      r.target.set(0, 0, m.height * 0.42);
      if (first) r.view.dist = Math.max(55, m.height * 2.1 + span * 0.6);
      setBuilt({ h: m.height });
      r.dirty = true;
    }, 120);
    return () => window.clearTimeout(id);
  }, [sig]);   // eslint-disable-line react-hooks/exhaustive-deps

  const go = (v: Partial<View>) => {
    const r = rig.current; if (!r) return;
    Object.assign(r.view, v); r.dirty = true;
    if (v.spin !== undefined) setSpin(v.spin);
  };
  const H = built?.h ?? 0;
  const year = p?.year ?? START_YEAR + Math.floor(month / 12);
  return (
    <div className="scheme-viewer" style={{ position: "relative", marginBottom: 8 }}>
      <div ref={box} className="scheme-viewer-canvas" style={{ width: "100%", height, borderRadius: 8, background: "#c9d6e2" }} />
      {status !== "ok" && (
        <div className="hint" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 16 }}>
          {status === "nomap" ? "The 3D model needs the city map to be showing." : status === "nolot" ? "No lot outline to stand the model on." : "3D is not available in this browser."}
        </div>
      )}
      <div style={{ position: "absolute", left: 8, top: 6, fontSize: 11, color: "#1e2a33", textShadow: "0 0 3px rgba(255,255,255,0.9)" }}>
        {p ? `${p.floors} floors · ${Math.round(H || p.floors * FLOOR_M)} m · delivers ${year}` : "Choose a use and floors to see the building"}
      </div>
      <div className="btn-row" style={{ position: "absolute", right: 6, bottom: 6, gap: 4 }}>
        <button type="button" className={"btn btn-sm" + (spin ? " btn-on" : "")} title="Turntable" onClick={() => go({ spin: !spin })}>{spin ? "■" : "▶"}</button>
        <button type="button" className="btn btn-sm" title="From the street" onClick={() => go({ el: 0.06 })}>Street</button>
        <button type="button" className="btn btn-sm" title="From above" onClick={() => go({ el: 1.1 })}>Aerial</button>
        <button type="button" className="btn btn-sm" title="Back to the framed view" onClick={() => go({ el: 0.42, az: -0.9 })}>Reset</button>
      </div>
    </div>
  );
}

/** The desk's preview as the item the map draws at delivery (MapView builds the same). */
function itemOf(p: DesignPreview, month: number) {
  return {
    bbl: p.bbl, cls: p.cls ?? p.use, heightM: p.floors * FLOOR_M, floors: p.floors, construction: false,
    cov: p.cov, year: p.year ?? START_YEAR + Math.floor(month / 12), design: p.design, shops: p.shops,
  };
}

/** The lot in paving on a field of asphalt, and the neighbours as white massing, as an architect's model shows a site. */
function ground(m: SchemeModel): THREE.Group {
  const g = new THREE.Group();
  const road = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: 0x6b6d70, roughness: 0.95 }));
  road.receiveShadow = true;
  g.add(road);
  if (m.lot.length >= 3) {
    const lot = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(m.lot.map(([x, y]) => new THREE.Vector2(x, y)))),
      new THREE.MeshStandardMaterial({ color: 0xc8c3b6, roughness: 0.9 }));
    lot.position.z = 0.05; lot.receiveShadow = true;
    g.add(lot);
  }
  const mass = new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.9 });
  for (const n of m.neighbours) {
    if (n.ring.length < 3 || !(n.h > 0)) continue;
    const geo = new THREE.ExtrudeGeometry(new THREE.Shape(n.ring.map(([x, y]) => new THREE.Vector2(x, y))), { depth: n.h, bevelEnabled: false });
    const mesh = new THREE.Mesh(geo, mass);
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
  }
  g.userData.ownsMaterials = true;
  return g;
}

/** Take the last model down: its own geometry goes, the map's materials and shared prop geometry stay. */
function clearWorld(world: THREE.Group) {
  for (const c of [...world.children]) {
    world.remove(c);
    const own = c.userData.ownsMaterials === true;
    c.traverse((o) => {
      const mesh = o as THREE.Mesh & { isInstancedMesh?: boolean };
      if (!mesh.isMesh) return;
      if (mesh.isInstancedMesh) (mesh as unknown as THREE.InstancedMesh).dispose();
      else mesh.geometry.dispose();
      if (own) (mesh.material as THREE.Material).dispose();
    });
  }
}
