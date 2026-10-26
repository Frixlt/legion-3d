# src/world/props — 3D prop kit (consumer: `world`)

Status: **usable**. 22 kinds, typechecked, tests in `test/props.test.ts`.
Demo: `npm run build` (or `sh .local/build-props.sh` if another dev page is broken) → `dist-dev/props.html`
(`?grid=1` one viewport per prop, `?grid=1&page=0..3` bigger, `?focus=<kind>`, `?tex=1` texture swatches, `?stats=1`).

```ts
import { PropKit, disposePropKit, lanternGlowSprite, PROP_KINDS, AWNINGS, PROP_COLORS,
         type PropKind, type PropTransform } from './props';
import { getTexture, setTexAnisotropy, disposeTextures, type TexKind } from './tex';

setTexAnisotropy(renderer.capabilities.getMaxAnisotropy());     // any time; updates cached textures too

// → THREE.Group 'props:<kind>' with one InstancedMesh per material part + 1 outline InstancedMesh
scene.add(PropKit.instanced('lamp', [{ x, y, z, rotY: 0, scale: 1 }, …]));
PropKit.instanced('stall', list, { variant: 2 });                  // awning pair AWNINGS[variant % 6], goods = variant % 3
PropKit.instanced('stall', list, { colors: ['#e0605a', '#f7e8d0'] });   // explicit stripe colours
PropKit.instanced('banner', list, { colors: [cloth, trim] });
PropKit.instanced('tree', list, { variant: 0|1|2 });               // 1 = darker leaves, 2 = pink blossoms
PropKit.instanced('crate', list, { outline: false, castShadow: false });

// parametric (each call = one Group of Meshes, geometry cached by its parameters)
PropKit.bridge(length = 4, width = 2, hump = BRIDGE_HUMP)  // span along Z, centred, deck ends at y=0, top at y=hump
PropKit.stairs(width = 1.6, height = 0.8, depth = 1.6)     // top edge at origin (y=0), steps descend along +Z to y=-height

// garlands: many spans in one call → cable Mesh + bulbs InstancedMesh (per-instance colours) + glow Points
PropKit.garland([[a, b, c], [d, e]], { sag: 0.12, spacing: 0.32, bulb: 0.045, colors?, glow: true })
PropKit.glows(points: Vector3[], { color?, colors?, size = 1.6 (m), intensity = 0.9 })  // additive Points, 1 draw call
lanternGlowSprite(color = '#ffcf6a', size = 1.4, opacity = 0.85)                         // one Sprite
PropKit.disposeObject(obj)        // free geometry of garland()/glows() results when you rebuild (kit geometry untouched)

PropKit.lampHeadOffset            // Vector3(0, 2.94, 0): lantern centre (scale 1) → glows / PointLights go here
PropKit.footprint(kind, opts?)    // { w, d, h } at scale 1, rotY 0 → colliders
PropKit.parts(kind, opts?)        // cached [{ geo, mat }] (shared — don't dispose) if you batch statically
PropKit.material(key)             // shared material: 'paint'|'wood'|'stone'|'metal'|'cloth'|'roof'|'glow'|'water'|'waterFx'|'outline'
propStats()                       // [{ kind, tris, parts }]
disposePropKit()                  // all kit geometries + materials + textures (calls disposeTextures())
```

Kinds (`PROP_KINDS`): lamp, bench, barrel, crate, chest, planter, fountain, well, statue, anvil, dummy, noticeBoard,
stall, cart, banner, tree, bush, fence (iron railing, 2 m along X), fenceWood (picket, 2 m along X), signpost,
stairs, bridge (defaults; use the parametric calls for real sizes).

Conventions: metres; origin = footprint centre on the ground (y=0); **front faces +Z**; rotY in radians.
Sized for ~1.35 m chibis: lamp 3.4 m (lantern at 2.94), bench 1.45 × 0.6, stall 2.5 × 1.7 × 2.5 m, fountain Ø2.5 m,
tree ~3.3 m, fence segment 2 m. Triangles: 370 (signpost) … 1.8k typical, stall ~3.4k, bridge ~4.6k (incl. no outline).
Draw calls: 1 per (kind, material part) + 1 outline, independent of instance count (lamp = metal + glow + outline = 3).

## Material approach (keep consistent in the world)
- **`MeshStandardMaterial`, vertex colours** (colours baked per sub-part from the CATS palette, see `PROP_COLORS`),
  roughness 0.78–0.9, metalness 0 (iron 0.35). Neutral (light grey) detail maps from `../tex` multiply the vertex
  colour: wood planks (`wood`), ashlar (`stone`), brushed iron (`metal`), woven canvas (`cloth`, DoubleSide),
  purple slate (`roof`) — each with a normal map; stone/metal/roof also roughness maps. UVs are box-projected in prop space.
- **Glow parts** (lantern glass, bulbs, stall lantern): `MeshBasicMaterial` vertex colours × 2.2 (`GLOW_GAIN`) — reads
  as a light source under AgX tone mapping without any real light; add `PropKit.glows()` halos + at most a few
  PointLights near the camera for actual light pools.
- **Ink outline**: inverted hull (BackSide, `#2b1d18`, 1.1–2.2 cm) as one extra InstancedMesh per kind — mirrors the
  site's thick dark outline. Turn off per call with `{ outline: false }` (e.g. on potato quality).
- Shadows: big props `castShadow` by default (lamp, stall, fountain, well, statue, cart, tree, banner, board, bridge,
  signpost); all non-FX parts `receiveShadow`.
- Lighting it was tuned under (dev/props.ts): `HemisphereLight('#aab2ff', '#5a3a44', 1.6)` + moon
  `DirectionalLight('#c8d0ff', 2.1)` + AgX exposure 1.15 + warm PointLights (`#ffb050`, 6, 7 m) at lamp heads.

## Textures (`../tex`)
`getTexture(kind, { colors?, neutral?, seed?, size?, bump? }) → { map, normalMap?, roughnessMap? }`, cached by key,
power-of-two ≤ 1024, mipmapped, RepeatWrapping, map = sRGB, normal/roughness = linear.
Kinds: `cobble` (≈2 m tile, 512), `brick`, `plaster`, `wood`, `roofTiles` (terracotta scallops), `slate` (purple),
`stone`, `canvas` (stripes of `colors[0]`/`colors[1]`), `metal`, `grass`, `soil`, `water` (map + wave normal map),
`glow` (radial alpha sprite), `rock` (natural angular facets + fractures, no courses — for flat-shaded boulders). `DEFAULTS[kind]` lists the colour slots. Set `.repeat` on the returned textures
yourself (they are shared: clone() if two meshes need different repeats, or prefer world-space UVs).
