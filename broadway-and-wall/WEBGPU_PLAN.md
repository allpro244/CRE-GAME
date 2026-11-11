# WEBGPU PLAN — the city on its own renderer

Owner-approved track (2026-11), on branch `webgpu-renderer`, behind
**Settings → Display → Renderer: Classic (WebGL) / WebGPU (beta)**
(`store.cityRenderer`, localStorage `bw:renderer`; default Classic).
`?renderer=webgpu|classic` in the address overrides the setting for review
shots, `?gpu=webgl2` forces the WebGPU renderer onto its WebGL 2 backend.
`?host=unreal` does not use MapView and is untouched.

## Why

WebGPU on its own does not make the city prettier. What blocks proper effects
today is that the city draws INTO MapLibre's WebGL canvas as a custom layer:
there is no render target, so the finishing pass (`real/post.ts`) copies the
framebuffer back and guesses its ambient occlusion from a second render of
distances. Giving the city its own renderer and targets is what unlocks real
GTAO, screen-space reflections, temporal anti-aliasing and bloom; WebGPU is
what makes the extra passes and more instances affordable.

## Architecture (as built)

```
MapLibre canvas (WebGL)          overlay canvas (WebGPURenderer)
 ground, streets, parcels,  ──►  plane at street level, colour = MapLibre's
 labels (under the 3D layer)      frame (screenUV), depth written
 custom layer render(matrix) ──►  RealCityLayer.render: same camera maths,
                                  same scene, same per-frame updates, then
                                  GpuBackend.render(): scene pass (MRT colour
                                  + normals + metal/rough + float depth)
                                  → GTAO → (SSR, Max) → grade/tilt/bloom → FXAA
```

- **One layer, two renderers.** `RealCityLayer` (`real/RealCity.ts`) still
  builds the whole scene and answers every call MapView makes; `layer.gpu`
  (set before `addLayer`) only swaps who draws it. Classic runs exactly the
  code it ran before — every change on the classic path is a guarded branch
  that is not taken (`if (this.gpuB)`), and the WebGPU code is a separate
  chunk (`real/gpu/*`, dynamically imported), never loaded in Classic.
- **Its own canvas, in sync.** `GpuBackend` (`real/gpu/GpuCity.ts`) lays a
  canvas over MapLibre's (same CSS box, same drawing-buffer size and pixel
  ratio, `pointer-events: none`). MapLibre still calls the custom layer's
  `render()` with its matrix every frame; the city is drawn there, in the same
  task, from the same matrix (converted to WebGPU's 0..1 depth range), so the
  two cannot drift a frame apart.
- **MapLibre is the ground.** Its frame is copied into a texture each frame
  (`copyExternalImageToTexture` under WebGPU) and drawn on a plane 25 cm under
  street level in the city's scene. The city stands on it, the shadow catcher,
  the contact shades and the haze sheet fall on it, GTAO sees it, and the
  finishing pass grades the whole picture as one frame, as classic's did.
  MapView keeps the 3D layer last in the style on the beta, so everything
  MapLibre draws (the selected lot's outline included) is in that copy; the
  outline then lies on the ground under the buildings rather than over them.
- **A real view space for the passes.** RealCity's camera stands at the eye
  unrotated and lets MapLibre's matrix do the turning. Screen-space passes
  (GTAO, SSR) assume a camera looking down its own -Z, so the backend splits
  the same matrix into the camera's rotation and the rest as the projection
  (`orientCamera`; the transform is identical), converts the depth range for
  WebGPU, and hands RealCity its camera back afterwards (picking unprojects
  through it).
- **Picking is unchanged.** It never used the GPU: `pickAt` walks a ray
  down a CPU height grid, and MapLibre keeps every pointer event.
- **Tone mapping per material, as classic.** WebGLRenderer tone-maps each lit
  material and leaves raw shaders (MapLibre's ground, the haze sheet) alone,
  then fog/haze is mixed in display space. The ports attach an `outputNode`
  doing exactly that (ACES at the classic exposure, then haze), and a uniform
  turns the curve off while a reflection probe is taken (classic's render
  targets were not tone-mapped). The pipeline then only encodes sRGB.
- **The classic shaders are ported without touching them.** Each
  `onBeforeCompile` patch is recognised by running it on a probe shader (the
  uniforms it adds, the code it splices) and its uniforms are read off that
  call (`real/gpu/ports.ts`). RealCity keeps one material and one set of
  numbers per surface.
- **One program for every wall, as classic.** All ~250 facade materials build
  the same node graph, so three compiles them once. That only works if every
  per-family input is read *through the mesh* (`reference("material.bwWin")`,
  `reference("material.map", "texture")`): a value node would be the first
  family's for every wall in town (the first cut drew the whole city in one
  elevation), and a plain material reference breaks in the shadow pass, which
  builds the colour graph on its own depth material — under WebGPU an invalid
  pipeline voids the whole frame's command buffer, not just one draw.
- **Quality tiers** (same ladder as Classic; the setting rebuilds the graph):
  Low and Medium draw the scene with 4x MSAA (Medium adds the grade); High
  adds GTAO on float depth and swaps MSAA for FXAA; Max adds screen-space
  reflections (glass, harbour, wet streets reflect what is on screen) on the
  WebGPU backend — three r185's SSR shader does not compile on its WebGL 2
  fallback. Diorama/Classic look drives the same grade uniforms as classic.
- **Review switches**: `?renderer=webgpu|classic`, `?gpu=webgl2` (force the
  fallback backend), `?gpu=offscreen` (render to a target and copy to a 2D
  canvas — see Testing), `?gtao=off`, `?ssr=off`, `?post=off`,
  `?gpudbg=mask|paint|orm|map` (one facade input instead of the wall);
  `window.__gpu`, `__gpuStats` (backend, draw calls, CPU ms), `__gpuPorts`
  (which classic patches were met and how each was handled).
  `tools/gputest/*.html` check a port against the classic renderer in seconds.

## Inventory of custom shaders (counted 2026-11-11)

`grep onBeforeCompile|ShaderMaterial` over `src/map/real/`: 9 GLSL patches on
stock materials, 2 raw `ShaderMaterial`s in RealCity, 2 in `post.ts`
(`SchemeViewer.tsx` has its own renderer and is out of scope).

| # | Shader | Where | What it does | Port order | Status |
|---|---|---|---|---|---|
| 1 | facade (PAINT, foot AO, farK, WINDOW_VARIATION, REVEAL, rooms, GLASS, oil-canning) | `buildFamily` | every wall in town | 1 | paint, foot shade, far calm, pane variety (blinds, curtains, roughness), reveal jamb/sill/head, room behind the glass: **ported**; coated-glass Fresnel + clouds in the reflection, oil-canning: not yet (glass towers read a little bluer/brighter) |
| 2 | haze + cloud shade | `addHaze` (all materials) | aerial perspective, cloud shadows on direct light | 1 | haze: **ported** (outputNode); cloud shade: not yet |
| 3 | sky dome | `skyEnvironment` (ShaderMaterial) | what glass and water reflect | 1 | **ported** (node material) |
| 4 | haze sheet | `hazeFor` (ShaderMaterial) | haze over MapLibre's ground | 1 | **ported** |
| 5 | contact shade | `contactMat` | soft dark under every building | 1 | **ported** |
| 6 | sea | `seaMaterial` | bottom colour, shore clarity, surf, foam, ripples | 2 | bottom + shore clarity: **ported**; surf/foam/ripple normals: not yet |
| 7 | grass (lawn/turf/rough) | `parks.ts grassMaterial` | procedural sward, stripes, leaves, creek cut | 3 | not yet (stock colour × tone) |
| 8 | vehicles | `vehicleMat` | brake lights | 4 | **ported** (emissiveNode) |
| 9 | walkers' gait | `buildStreetLife` | legs and arms swing | 5 | not yet (walkers glide) |
| 10 | tree sway | `addSway` | crowns ripple in the wind | 5 | not yet (trees still) |
| 11 | finishing pass | `post.ts` (2 ShaderMaterials) | AO, tilt-shift, bloom, clarity, grade, vignette | 1 | **rebuilt** on RenderPipeline: grade/tilt/bloom/clarity/vignette line for line; AO is GTAO; + FXAA (High/Max), SSR (Max) |

## Measurements

Same save (Jan 2004, a 48-month mid-game), same cameras, same container:
headless Chromium on SwiftShader — a CPU rasteriser — at 1600x900, so
absolute milliseconds mean little; compare ratios and draw calls.
"Frame" is a forced repaint, MapLibre plus city plus finishing pass.

| view | renderer | frame (software) | draw calls | triangles | picks (7 pixels) |
|---|---|---|---|---|---|
| district (z16.2, 55°) | Classic | 10.8 s | 449 | 7.06 M | — |
| district | WebGPU renderer, WebGL 2 backend | 5.7 s | 452 | 7.06 M | identical |
| street (z17.6, 62°) | Classic | 10.5 s | 436 | 7.06 M | — |
| street | WebGPU renderer, WebGL 2 backend | 8.5 s | 439 | 7.06 M | identical |

- Draw calls are the same scene (+3: the ground plane, the post quad, the
  FXAA pass); no instancing work has been done yet.
- CPU time to submit the city frame on the beta: 20-50 ms on this CPU
  (`__gpuStats.ms`); the classic number is not separable from MapLibre's.
- The beta is faster here mainly because classic's AO renders the whole city
  a second time (a distance pass) and copies the framebuffer back; GTAO reads
  the depth the frame already wrote.
- Build-to-ready on the beta: 130-210 s here vs classic's ~220 s (the facades
  compile to one shared program).
- The WebGPU backend itself could not be timed: see Testing.

## Testing in this container

Headless Chromium here exposes WebGPU (a SwiftShader adapter), and three's
WebGPURenderer starts on it, but **the device is lost the moment a WebGPU
canvas presents** — reproduced with a 20-line raw WebGPU page (no three):
offscreen rendering survives, presenting does not. So:

- the WebGL 2 backend (`?gpu=webgl2`) is what every parity shot, measurement
  and the game session were taken on;
- the WebGPU backend was exercised with `?gpu=offscreen`: the city builds,
  every shader (facades, sea, GTAO, grade) compiles to WGSL and draws the
  opening view correctly; after the camera moves the container's GPU process
  stops servicing MapLibre's WebGL context, so later frames could not be
  checked here. That is a property of this sandbox, not of Chrome on a GPU.

## Risks

- **The selected lot's outline is under the buildings** on the beta (it is
  part of MapLibre's frame). On a vacant lot it shows; on a built one the
  building's own selection glow does the job. Drawing it in the scene is a
  small follow-up.
- **TRAA is not in yet.** three's TRAANode jitters the camera with
  `setViewOffset`, which recomputes the projection and would discard
  MapLibre's matrix; it needs the jitter applied to our own matrix. FXAA
  stands in on High/Max.
- **The ground copy is one full-frame texture upload per frame.** Under WebGPU
  it is a GPU-to-GPU copy; under the WebGL 2 fallback it is `texImage2D` of a
  canvas, also GPU-side in Chrome. Measure on the owner's machine.
- **TSL is young.** three r185's node system moves between releases; pin the
  version and re-test on every three bump.
- **SwiftShader is not a GPU.** Nothing here proves frame rate; the owner's
  RTX 5070 Ti in Chrome/Edge is the real test (checklist below).
- **Unported patches show stock surfaces** (still trees, gliding walkers,
  plain lawns) until ported; nothing is invisible or black.

## Phases

1. **Spike** (done): own canvas, camera sync, MapLibre ground, picking,
   WebGPU + WebGL 2 backends, setting, measurements.
   **Parity so far**: side by side with Classic the city is the same city —
   same elevations, paint, rooms, shadows, haze, grade, tilt-shift. Left: the
   coated-glass reflection, cloud shade, sea surf/ripples, grass detail, tree
   sway and walking gait; the beta's shade side is a touch lighter (GTAO is
   gentler than classic's crease AO).
2. **Parity**: port the rest of the facade shader (window variation, reveals,
   rooms, glass), cloud shade, sea surf and ripples, grass, sway, gait; draw
   the selected lot outline in-scene; side-by-side shots until Classic and
   WebGPU are hard to tell apart.
3. **New effects** (each on the quality ladder): GTAO (High/Max), TRAA in place
   of MSAA (Max), SSR on glass and water (Max), bloom via BloomNode, soft
   shadows (PCSS/VSM) — Low stays as cheap as today.
4. **Throughput**: per-building merged meshes → batched/instanced draws
   (BatchedMesh), compute-driven crowds and traffic, so more people and cars
   cost nothing on the CPU.

## What the owner's GPU must verify

- Settings → Display → Renderer → WebGPU (beta): the console prints
  `[bw] city renderer: WebGPU`.
- Pan, zoom, rotate, tilt quickly: the city must not slide against the
  streets, even for one frame.
- Hover and click buildings: the hover card and the selection match the
  building under the pointer.
- Frame counter (Settings → Display) on High and Max, Classic vs WebGPU, same
  view.
