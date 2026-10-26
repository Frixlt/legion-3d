# Performance review — integrated offline demo (`dist-dev/game.html`)

2026-10-26, engine agent. The target is **≤ 150k triangles and ≤ 120 draw calls at quality 2 with 25 avatars in view**, and a steady 60 fps on an integrated GPU.

## How it was measured
- `.local/perf/profile.mjs <q> 1 out.json shot.png` (env `PAGE=` picks the page). It loads the demo with 24 bots and puts all of them **in front of the camera, 6–9 m away** (TP camera; this is the worst case for the crowd budget). It then renders **each top-level scene child alone** to get exact calls and triangles per module (`renderer.info`, so frustum culling is included), and times every render with `readPixels` (swiftshader, 1280×720, pixel ratio forced to 1).
- `.local/perf/eval.mjs <file.js>` runs any probe: `meshes.js` gives triangles per mesh, `exp.js` does what-if toggles, `tpfp.js` compares TP and FP, `crowd.js` gives the LOD per avatar.
- "after" = `src/content/game.ts` with `docs/reviews/perf-game.ts.patch` applied (it uses the new engine `CrowdLod`). It is bundled outside the repo by `.local/perf/build-patched.mjs`, so the repo files were not touched.
- Swiftshader ms are noisy (host load average ~47 on 16 cores) and are good only as ratios. Calls and triangles are exact.

## Numbers (q2, 24 bots in view)

| | draw calls | triangles | world | avatars (24) | me | labels | swiftshader ms/frame |
|---|---|---|---|---|---|---|---|
| 18:22 first look (old props) | 201 | 592k | 100 / 404k | 72 / 176k | 3 / 12.8k | 26 | 5467 (other load) |
| current world, original game.ts | 175 | 263k | 86 / 73k | 72 / 177k | 3 / 12.8k | 14 | 2166 |
| **current world + engine CrowdLod (patch)** | **134** | **116k** ✅ | 86 / 73k | **34 / 30k** | 3 / 12.8k | 11 | **1327 (−39%)** |
| q0, original game.ts | 175 | 262k | 84 / 73k | 72 / 176k | 3 | 16 | 1853 |
| **q0 + CrowdLod** | **83** | **84k** | 73 / 68k | 2–12 / 4k | 3 | 2 | 1290 |

Triangles meet the target at q2 (116k ≤ 150k). **Draw calls do not yet (134 > 120). What is left is the world (86 calls).** Fix W1 and W2 below bring it to about 95.

Where swiftshader time goes at q2 after the patch: the world takes about 80% (fragment work: MeshStandard + normal and roughness maps + 4 point lights + hemi + dir), avatars 15% (skinning), labels 3%. In `exp.js`, half resolution cut the frame by about 35%, and hiding all avatars (before the patch) cut it by 75%. Both pixels and vertices matter.

## Engine changes (done, src/engine)
1. **`budget.ts` — `CrowdLod` + `CROWD` presets** (exported from `src/engine`). It ranks the avatars that are in the frustum by distance, nearest first. It applies per-quality caps: `maxDrawn`, the LOD0 radius and count, the LOD1 radius and count, plus `labelMax` and `labelFar` for nameplates, with LOD hysteresis. Off-screen avatars return LOD −1, so they are hidden and not animated. No allocations per frame: typed arrays and one in-place `Float64Array.sort` on packed keys. q2 budget: 28 drawn, LOD0 ≤ 3 within 6 m, LOD1 ≤ 8 within 13 m, the rest LOD2, labels for the nearest 14 within 20 m. Tests: `test/engine-budget.test.ts`.
2. **Dynamic resolution at fixed levels too.** `AutoGovernor.locked` makes the governor scale only the resolution (floor `fixedMinScale` 0.6–0.75). Before, a level the user picked never adapted.
3. **Pixel-ratio cap at q2 1.5 → 1.25** (−31% pixels on a DPR 1.5 laptop).
4. **Shadow-map ceiling per level** (`shadowMapSize` 512/512/1024/2048). The engine clamps every casting light. It re-checks when top-level scene children change and costs O(1) per frame otherwise.
5. **Stats cover every pass**: `info.autoReset = false` with a manual reset per frame, so shadow and post passes are counted. `engine.debug()` now adds `logicMs` (frame callbacks), `submitMs` (render CPU), `shadows` and `post`.
6. **Post-processing (`post.ts`, q ≥ 2 only, created lazily)**: RenderPass into a half-float target (MSAA ×4 when the context has antialias), then UnrealBloomPass at **quarter res** (threshold 1.0, strength 0.3: only lamps, windows and glows bloom), then OutputPass with the **warm grade and vignette folded into its shader**, so there is no extra full-screen pass. It follows dynamic resolution (`setSize(w, h, effectivePixelRatio)`). It is off at q0/q1. To switch it off: `engine.setPost(false)` (stored in `localStorage['l3d.post']`). To tune it: `engine.setPost({ bloom, threshold, radius, vignette, warm })`. Cost: about 12 small draw calls, plus 2 full-res fill passes.

## Fixes for other modules (by priority)

### P1 — src/content/game.ts (leader) → `docs/reviews/perf-game.ts.patch`
- **Crowd budget** (game.ts:172-189 in the original): replace `MAX_DRAWN` and the fixed LOD distances (`d2<144 → 0, <900 → 1`) with `CrowdLod`. The old code capped in Map order, not nearest-first, put everyone within 12 m at LOD0 (7k triangles, 3 calls each), and counted avatars behind the camera. **Saves −147k triangles and −38 calls at q2 (measured).** The patch also places the other avatars *after* `rig.update`, so the frustum test uses this frame's camera.
- **`sync()` JSON.stringify per walker per 'walkers' event** (game.ts:79-89): check object identity first (`a.app !== w.app`) and stringify only when the object was replaced. The same applies to `store.me.app`.
- **`focus = { id, title, icon }` allocated every frame** near a door (game.ts:216): point at the door record (`focus = d`).
- Leaks (not in the patch, no `Game.dispose` exists): `window 'l3d:settings'` (line 51), `'l3d:menu'` (line 111), `store.on('walkers' / 'layout')` and the canvas `mousedown` are never removed. That is fine while `startGame` runs once per page, as main.ts does now. Add `Game.dispose()` if re-entry is ever needed.

### P1 — src/world (world agent) — the remaining 86 calls
- **W1. Bake the static placeholder props into the static `Batch`** (index.ts:210 `inst.build(...)` → `k.b.add(...)` per instance). Each prop kind × material is its own InstancedMesh. The city is only 55 m wide (5500 px × 0.01), so their bounding spheres span the city and they are never culled. **Saves about 20 calls** (`world:props` 25 → about 5: the kit hero kinds and garlands). Memory: about 31k triangles merged, negligible.
- **W2. Wider static chunks** (index.ts:114 `new Batch(14)` → `new Batch(30)`, or one chunk at q ≤ 1). With a 55 m city and a camera in the middle, 14 m chunks cull almost nothing but multiply calls by the number of materials: `world:static` makes 57 calls for 17 materials. **Saves about 20–25 calls.** Also fold rare materials into common ones: `glass` → `metal` with a vertex tint, `dark` → `flat` with a black vertex colour, `leaf` → `flat`.
- **W3. Lighter materials at q ≤ 1** (index.ts:62 `std()`): drop `normalMap` and `roughnessMap` (or use MeshLambert at q0). Normal mapping is a large share of the per-pixel cost on an iGPU, and point lights are already off at q ≤ 1. `setQuality` can swap materials: keep two material sets and reassign `mesh.material` in `statics`.
- **W4. Shadows at q3**: `sun.position` follows the camera every frame (index.ts:310). Snap it to shadow texels (`Math.round(x / texel) * texel`) to stop shadow swimming. The engine now clamps the 2048 map to the level's ceiling.
- W5. `Batch.add` turns every piece into non-indexed geometry (`toNonIndexed`, batch.ts:30), about 3× the vertices to shade. Keeping it indexed, with `mergeGeometries` of indexed geometry, cuts vertex work. Swiftshader is very sensitive to this; real GPUs less so.

### P2 — src/avatar (avatar agent)
- **A1. A real mid LOD**: LOD1 is the full 3.5k-triangle body without the outline. geom.ts:227 already has a detail factor ("0.5 = the LOD1 mid mesh"); ship LOD1 at about 1.2k triangles. **Saves about 18k triangles at q2** (8 × 2.3k).
- **A2. Outline hull from the mid mesh** (avatar.ts:126 `new SkinnedMesh(m.geo, outlineMat…)` duplicates the full body). Use the LOD1 geometry for the inverted hull: −2.3k triangles per LOD0 avatar, and the ink line looks the same.
- **A3. First person**: avatar.ts:179 keeps the body drawn with `hidden()` material in FP. That is 1–2 calls plus skinning for about 6–12k triangles of invisible mesh. Use `mesh.visible = false` in FP unless shadows are on (pass `castShadow` only).
- **A4. Labels are one sprite, texture and material each** (labels.ts:98-100, 156-158), so 1 draw call per plate and per bubble. The engine budget now caps plates (q2: nearest 14 within 20 m). The real fix is one atlas canvas (e.g. 2048×1024, 256×64 slots) and one InstancedMesh billboard with per-instance UV and opacity: **11–26 calls → 1–2.** Also expose `setPlateFar(m)` so the budget can drive `PLATE_FAR` (labels.ts:10) directly instead of game.ts moving anchors to y = −999.

### P3 — src/ui
- hud.ts:203 `const key = ft ? ft.id + '|' + ft.title : ''` builds a string every frame while a door is focused. With the game.ts patch `focus` is the stable door object, so compare `ft !== this.lastFt`.
- hud.ts:173 `if (yaw !== this.lastYaw || px === px)` is always true when the position is known, so the compass loop runs every frame. Its DOM writes are guarded (cheap), but it could run only when yaw or position changed by more than ε.

### src/net/site.ts → `docs/reviews/perf-site.ts.patch`
- site.ts:192 called `JSON.stringify` twice per walker update. Now it is once, and the result is cached on the sim (`lookKey`).
- site.ts:178 built a `mapLike` object and 3 closures per move message. Now there is one per layout.
- site.ts:218 `[store.me, ...sims.values()]` spread on chatDel is replaced by two loops.
- site.ts:243 / 320: every `me` SSE event replaced `store.me.app` and emitted `'walkers'`. With the original game.ts that meant a JSON compare of all walkers, and an avatar rebuild whenever the key differed. Now `setMeApp` replaces it only when the look really changed.
- `tick()` per frame is fine except `M.stepAlong` returning a new object per walker per frame. That is site code; leave it.

## Why TP costs more than FP (q0, original game.ts; `.local/perf/tpfp.js`, two runs each)
| | calls | triangles | world | me avatar | other avatars | labels | camera rig CPU |
|---|---|---|---|---|---|---|---|
| FP | 84–86 | 87–98k | 74 / 68k | 1 / 6k (hidden-material body) | 3–6 / 8–19k | 0–1 | 14–28 µs |
| TP | 110–111 | 129k | 84 / 73k | 3 / 12.9k | **17 / 43k** | 6–7 | 130–145 µs |

- The extra cost is the **crowd at LOD0**. The TP camera sits 3.2 m behind and 0.7 m higher, so it sees the walkers near the player, and the original rule puts everyone within 12 m at LOD0 (body + outline + face) even at q0. `CrowdLod` fixes this: q0 has no LOD0 and at most 3 LOD1. Then come the player's own avatar (+2 calls, +6.9k triangles) and about 10 more world chunks in the frustum.
- **Not the cause:** camera collision raycasts take 0.13 ms of CPU per frame (one coarse `world:colliders` mesh plus the layout boxes). Shadows are off at q0. Labels cost 6 ms of swiftshader time. Hiding all glow and star points saved nothing measurable (the `noFx` toggle).
- Swiftshader ms for the same pose ranged from 638 to 1294 between runs (host load), so the single 154 ms/frame you saw is within noise. The triangle and call counts above are exact.

## Post-processing check
q2, FP, the same pose: post off 87 calls, post on 100 calls (+13: bloom mips and composite, output pass). Triangles unchanged (87.5k). Live fps in swiftshader was 43.7 with post off and 46.3 with it on, which is within noise. Screenshots: `.local/perf/post-on.png` (first tuning, bloom too strong; defaults have since been lowered to strength 0.3 and threshold 1.0), `post-on2.png` (after) and `post-off.png`.

## Integrated-GPU estimate
Swiftshader per-frame cost at q2 went from 2166 to 1327 ms (−39%), and the avatar share from 464 to 200 ms. Taking the frame cost as proportional to swiftshader ms and the old state as about 40–45 fps on a UHD 620-class iGPU at 1080p, DPR 1 (where the 1.5 cap does not bind), after the patch it is about 60 fps. At DPR 1.5 the 1.25 cap removes another 31% of pixels. This is an estimate, not a measurement on a real iGPU. With bloom on (q2), add about 1.5–2 ms on an iGPU (quarter-res mips plus 2 full-res passes). If an iGPU misses 60, dynamic resolution absorbs it, and auto mode steps down to q1, where post is off.
