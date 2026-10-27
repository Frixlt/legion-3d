# src/events — seasonal events

A holiday = one file here (a `SeasonalEvent`) + one line in `EVENTS` (`index.ts`). The host feature
`src/features/seasonal.ts` does the rest: it picks the event, builds the context, sets it up and disposes it.

```ts
// src/events/newyear.ts
import { inWindow, windowDistance } from './calendar';
import type { SeasonalEvent } from './types';
const NEW_YEAR: SeasonalEvent = {
  id: 'newyear', title: 'Новый год',
  active: (d) => inWindow(d, [12, 20], [1, 10]),            // local time, the window may wrap the year
  distance: (d) => windowDistance(d, [12, 20], [1, 10]),     // used by «Всегда» to pick the nearest window
  setup(ctx) { /* add to ctx.group, hook ctx.onFrame / ctx.onQuality … */ return () => { /* undo everything */ }; },
};
export default NEW_YEAR;   // then: `import newyear from './newyear'; export const EVENTS = [halloween, newyear]`
```

## Which event runs
`pickEvent(EVENTS, now, mode, forced)` (`calendar.ts`):
- setting **«События → Праздничное оформление»** (`l3d.event.mode`): `auto` (default: only inside the date window),
  `on` («Всегда»: the open window, else the nearest one), `off`;
- dev override `?event=<id>` (`?event=off` = none) — honoured only in dev builds (`__DEV__`), never in the extension;
- re-evaluated on `l3d:settings`, when the city world is rebuilt, and once a minute (midnight rolls the window).
The first time an event starts on a given day in `auto` mode a toast says so.

## Contract of `setup(ctx: EventContext)`
- everything you add goes under `ctx.group` (a sibling of the world root, hidden inside rooms) — or is reverted in the
  returned disposer; **dispose must leave the scene exactly as before** (test/events-halloween.test.ts checks scene,
  hooks, garland bulbs, sky, moon, fog colour, geometries);
- `ctx.onFrame(dt, t)` / `ctx.onQuality(q)` return unsubscribers (the host also releases them);
- respect the quality level (q0–1 fewer/cheaper), no per-frame allocations, ≤ 15 draw calls, ≤ 0.5 ms/frame at q2;
- place things with the city's own functions: `ctx.world.groundAt(px)`, `ctx.world.solidTop(px)`, `ctx.layout.free(px)`,
  `ctx.world.interactables()` (door boxes: keep ≥ 0.6 m away). Decals ≥ 6 mm above their surface.

## Halloween (`halloween/`)
| file | what |
|---|---|
| `index.ts` | the event: world hooks (re-colour garland bulbs orange/purple/lime, violet sky, bigger warm moon — all reverted), meshes, per-frame animation, quality budget |
| `placement.ts` | pure placement on a 0.125 m raster of the city: pumpkin clusters hug walls / door sides / stair ends / the ledge strip, ≥ 0.6 m from doors, flat open ground only; fog patches; ghost spots |
| `geo.ts` | pumpkin (6 ribs, dimpled, stalk), bat (flap in the vertex shader), ghost cat, quads |
| `tex.ts` | CPU-rasterised DataTextures: carved jack-o'-lantern faces (emission map), soft fog, cobweb, glow — no canvas, no assets |

Draw calls at q2: pumpkins, jack-o'-lanterns, light pools, contact shadows, hanging strings, halos, bats, ghosts, fog,
cobwebs = 10–11 (no real lights, no shadow casters). Counts per quality: `HALLOWEEN_BUDGET`.
Dev page: `dist-dev/events.html?event=halloween&q=2` (buttons switch the event / quality while it runs); in the game
`dist-dev/game.html?event=halloween` (`__l3dGame.seasonal.active()`).
