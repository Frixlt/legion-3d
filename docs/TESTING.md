# Testing

Three levels, from fast to real: unit tests (Node), the offline demo (the whole game in a browser with fake
site data), and the live end-to-end run against play.multidonate.ru with a real account.

All commands run from the repository root. On Node 18 the pinned versions are vitest 2.1.9 and playwright 1.48.2.

```bash
npm ci
npm run build        # dist/ = the extension, dist-dev/ = dev pages (every dev/*.ts → dist-dev/*.js, dev/*.html copied)
npm run typecheck    # tsc --noEmit
```

## 1. Unit tests

```bash
npm test                              # vitest run, all of test/*.test.ts
npx vitest run test/store.test.ts     # one file
```

They need no browser and no network. Fixtures are sanitized copies of real site data in `test/fixtures/`
(`fair-map.json`, `me.json`, `city-session.json`). What is covered:

| file | what |
|---|---|
| `store.test.ts` | reactive store: batching of events, chat de-duplication / order / cap, walkers |
| `bridge.test.ts` | the document_start tee: EventSource named events and watched fetch() JSON reach `__L3D_BUS`, the page still gets its own data |
| `world`, `avatar`, `engine*`, `props`, `quest`, `ui-money` | the modules' own logic (layout → geometry, appearance mapping, camera and quality maths…) |

## 2. Offline demo

`dist-dev/game.html` runs the complete game (`src/content/game.ts`) on a fake `SiteSession` built from the
fixtures (`dev/game.ts`): 24 bots walk and chat, equip/unequip work locally, nothing talks to the site.
This is the place to test anything that would change the account (buying, equipping, chat).

```bash
npm run build
npx http-server dist-dev   # or open dist-dev/game.html directly from disk
```

Each module also has its own page: `dist-dev/{world,avatar,engine,ui,props}.html`.

Headless screenshots (software WebGL — slow; 5–15 fps is normal there):

```bash
node scripts/shot.mjs dist-dev/world.html .local/shots/world.png --wait=6000
```

In the dev build `window.__l3dGame` exposes `{engine, world, store, rig, player, site, ui, qhud, meAv, vm, labels}`
for scripted checks (e.g. `__l3dGame.player.teleport(x, y)`, `__l3dGame.engine.stats()`).

## 3. Live end-to-end (real site)

Needs a Netscape-format `cookies.txt` exported from a browser where you are logged in to the site (the `lsid`
cookie). **Never commit it, never paste its content anywhere.** The scripts read it from the path in `L3D_COOKIES`
and never print cookie values.

The scripts load the page in headless Chromium and inject `dist/bridge.js` at document_start and `dist/game.js`
after load, exactly like the extension's two MAIN-world content scripts.

```bash
npm run build
# quick smoke: boot, walk, camera, menus, screenshots
L3D_COOKIES=~/cookies.txt node e2e/run.mjs https://play.multidonate.ru/c/<channel>/
# scenario runner (see the steps format at the top of the file)
L3D_COOKIES=~/cookies.txt node e2e/live.mjs https://play.multidonate.ru/c/<channel>/ --steps=my-steps.json
# logged-out path (no cookies): the splash must offer «Войти через Twitch»
node e2e/live.mjs https://play.multidonate.ru/c/<channel>/
```

Screenshots and logs go to `e2e/.artifacts/` (git-ignored).

`e2e/live.mjs` steps are a JSON array of objects, run in order:

| step | does |
|---|---|
| `{"wait": ms}` | sleep |
| `{"frames": n}` | wait until the game rendered n more frames (use this, not fixed waits, on slow machines) |
| `{"walk": "KeyW", "px": 200, "max": 15000}` | hold a key until the player moved `px` (or `max` ms) |
| `{"key": "KeyW", "ms": 2000}` / `{"press": "KeyE"}` | hold / press a key |
| `{"click": "css selector"}` | click a page element (e.g. `.cy-room [data-cyexit]`, the interior's «Выйти») |
| `{"eval": "js", "label": "…"}` | evaluate in the page, print the JSON result |
| `{"shot": "name"}` | screenshot (pauses the engine while capturing; leaves it alone when an overlay or classic mode paused it) |
| `{"stats": 1}` / `{"watch": ms, "every": ms}` | game stats (fps, draw calls, walkers, our vs the site's hero position, overlay, JS heap) and the `go` request rate, once / periodically |

**Safety net.** `e2e/live.mjs` aborts every non-GET request to `/api/` except the presence and movement calls the
site's own city client makes (`/api/city/enter|go|ping|leave|state`) and prints `[BLOCKED]`. So a scenario can
walk, enter buildings, open the mine and switch modes, but can never buy, sell, equip, chat or otherwise act for
the account. Test those actions in the offline demo. (Opening the mine therefore shows the mine screen with an
error inside: its `/api/mine/enter` is blocked. That is enough to test the overlay handling.)

The final lines of every run are a compact summary: `final` (stats), `net` (POST counts per endpoint, `go` total /
last 10 s / smallest gap, blocked requests, any `go` answered with `ok:false` such as «быстро/часто»), `errors`.

What a live run should show (checklist used for releases):

- boot: splash → game, `errors 0`; header, tabs and the 2D city are not visible; `#l3d-host` is `z-index:100`.
- doors: teleport next to a door (`__l3dGame.store.layout.buildings[i].door`), press `E`: the site's interior
  (`.cy-room`) or the mine (`.mn`) is shown and the game is hidden and paused; «Выйти» / `Esc` brings the game back.
- moving: `siteMe` follows `me`; `go` ≤ ~3/s, `notOk` empty.
- F8 several times: classic mode shows the normal 2D city with other players; walking there moves the 3D hero
  after F8; switching to another tab in classic and back with F8 re-enters the city with others hidden.
- `{"watch": 120000}`: heap stays flat (± a few MB), walkers come and go, chat messages arrive.

Note: headless Chromium renders WebGL on the CPU (SwiftShader), so its fps says nothing about real performance and
the first frames may stall for seconds while shaders compile. Measure performance in a normal browser with the
in-game overlay (F3).
