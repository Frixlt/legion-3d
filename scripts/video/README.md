# Review video — deterministic frame capture

Renders the ≈75 s review video of the extension (1920×1080, 60 fps, H.264) from the offline demo
(`dist-dev/game.html`: fake site, bots with made-up names) and the model gallery (`dist-dev/showcase.html`).
Nothing is recorded in real time: every frame advances a virtual clock by exactly 1/60 s and is then captured, so
the result is smooth however slow the machine renders (software WebGL takes seconds per frame — that's fine).

```bash
npm run build                                   # dist-dev/ (game.html, showcase.html)
export CHROMIUM=/usr/bin/google-chrome
node scripts/video/render.mjs                   # the whole cut → video/legion-3d-review.mp4
node scripts/video/render.mjs --segments=fair,gear --name=wip      # some segments only
node scripts/video/render.mjs --test            # the 6 s test segment → video/test.mp4
node scripts/video/render.mjs --segments=mine --w=960 --h=540 --at=1,4,7   # stills → video/probe/mine-<t>.jpg
```

Options: `--workers=N` (parallel Chrome processes, default 3) · `--chunk=S` split every segment into S-second
pieces so all workers stay busy (each piece fast-forwards to its start with rendering off) · `--w/--h` · `--frames=N`
(first N frames of each segment) · `--format=png` (default jpeg `--jq=95`) · `--fresh` (delete old frames) ·
`--encoder=h264_nvenc` · `--no-assemble` / `--assemble-only` (no browser) · `--bots=20` · `--gpu` (ANGLE d3d11
instead of SwiftShader, for a Windows machine with a GPU) · `--profile=<dir>` (ONE persistent Chrome for the whole run,
workers are its pages — see «Windows» below) · `--at=t1,t2` stills · `--eval="js"` (with `--at`: log an expression).

Output (git-ignored `video/`): `frames/<segment>/NNNNN.jpg`, `<name>.mp4`, `<name>.results.json`, `bundle/director.js`.
**Resume:** run the same command again — existing frames are kept, a segment continues at its first missing frame.

## How it works
| file | role |
|---|---|
| `page/vtime.ts` | injected before any page script: replaces `requestAnimationFrame`, `performance.now`, `Date`, `setTimeout/setInterval`, `Math.random` (seeded); `__vt.step(ms)` = timers → director hooks → rAF callbacks (one game frame) → CSS animations/transitions advanced by the same `ms` (Web Animations API, incl. shadow roots) |
| `page/director.ts` | segment lifecycle (`init` → async `setup` → `go`), calls `segment.frame(G, t)` before every game frame; `fast(true)` turns `renderer.render` into a no-op for fast-forwarding |
| `page/kit.ts` | Catmull-Rom splines + eased travel, player steering through the real input stick (walk animation, collisions and jumps stay real), camera keys (Hermite, angle-aware), A* `planPath` over the walk space (props, room walls), overlay cards/captions (1920-px layout scaled to the viewport), a drawn cursor that glides to UI elements and clicks them |
| `page/demo.ts` | camera-ready demo: hero «Пушок», bots «Мурка», «Барсик»…, fixed quality 3 (governor locked, scale 1); shop stock from `test/fixtures/stock.json`, the offline `FakeMine` for the 3D mine; records every interactable so shots can aim at goods/stones |
| `shots.ts` | **the timeline** — one `Segment` per shot: `setup(G)` (pose, park bots, enter a room) and `frame(G, t)` (pure function of segment time) |
| `render.mjs` | builds the bundle, runs Chrome per segment/chunk, captures `Page.captureScreenshot` (3D canvas + DOM UI), joins segments with `xfade` crossfades via ffmpeg (libx264 `-preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart`) |
| `../../dev/showcase.ts` | the gallery scene: every item model of the `itemModels` registry on tiered stands, a line-up of character variants, the street prop kit — camera path exposed as `__showcase.pose(t)` |

Segments render independently (a fresh page each) and are joined with short crossfades, so they can run in parallel.
A segment whose feature is missing (`requires()` returns a reason, or `setup` throws — e.g. the shop room did not
open) is skipped with `status.txt` = `skip:…`/`error:…` and left out of the cut.

## Shot list (`shots.ts`)
| # | id | s | what |
|---|---|---|---|
| 1 | `fair` | 20.5 | fade in, title card «Legion 3D»; FP stroll along the night fair (lamps, garlands, look-around) → turn to the forge («[E] Войти: Кузня») → V to TP over the shoulder, walk past chatting cats (bubbles), down the stairs, **jump over a bench** |
| 2 | `showcase` | 13 | gallery: «Оружие», «Щиты и доспехи», «Шапки и шлемы», «Амулеты, еда и зелья», «Облик котиков», then crane over «Улица» (prop kit) |
| 3 | `gear` | 10.8 | Снаряжение: camera flies out of the eyes into an orbit; cursor picks «Мышка на палочке» → Надеть, then «Колпак кота-колдуна»; menu closes, camera dives back |
| 4 | `map` | 9 | map → pin «Лавка» → «Идти сюда», the hero auto-walks there in TP |
| 5 | `shop` | 11 | inside the 3D shop: walk between shelves, aim at goods (highlight + «[E] Купить…» card) |
| 6 | `mine` | 10 | the 3D mine: walk to a front stone (A* route), dig it (E), the stone breaks |
| 7 | `expedition` | 6.5 | expedition HUD card («Бой · Волчья стая», what to type in the stream chat) |
| 8 | `end` | 6 | end card «Legion 3D · расширение для Chrome» + key hints over a slow drift |
| – | `test` | 6 | test only (`--test`): FP walk + look, switch to TP |

Edit a shot: change its keys in `shots.ts`, check with stills (`--at=… --w=960 --h=540`, seconds per still), then
render that segment again with `--fresh --segments=<id>`.

## Determinism
Everything a frame shows is a function of the frame number: virtual time, seeded `Math.random`, director poses from
segment time, no real input. Fast-forward (resume, `--chunk`) runs exactly the same frame callbacks with only
`renderer.render` disabled. Remaining sources of drift are asynchronous loads that finish in real time (fonts,
image decodes) — the boot waits for `document.fonts` and the segment preroll (90 frames) absorbs the rest.

Measured: a segment rendered in one piece and the same segment rendered in 1-s chunks (3 browsers, each
fast-forwarding to its chunk) differ in ≤ 60 scattered pixels per 960×540 frame (JPEG/rasteriser noise) — chunk
seams are invisible. Rendering gets its own `Math.random` stream (seeded per frame) so fast-forwarding never shifts
the simulation's random sequence; at `init` and again after `setup` the RNG is reseeded, every interval re-phased,
the bots re-placed and the chat log reset (the boot and a room's loading take a machine-dependent number of frames).

## Timing (1920×1080, quality 3 + post, 60 fps; the cut ≈ 87 s of segments = 5 200 frames)
| machine | per frame | whole cut |
|---|---|---|
| GPU (RTX-class, ANGLE D3D11, `--gpu --profile=… --workers=3`) | ≈100 ms per worker, 3 pages in one Chrome ≈ 33 ms | ≈ 3–4 min + ≈ 1 min ffmpeg |
| SwiftShader, 16 cores, 4 workers (`--chunk=2 --workers=4`) | ≈ 20 s per worker ≈ 5 s effective | ≈ 7–8 h |

## Windows (GPU box)
Chrome must run in the interactive session (a scheduled task with `/IT`; processes started over SSH get no WebGL),
headless. Always pass `--profile=<fixed dir>`: on Windows Chrome probes the OS password once per *fresh* profile
(`LogonUser` with an empty password), which the Security log counts as a failed logon — Playwright's default throwaway
profiles therefore cost one failed logon per launch and can trigger the account lockout policy. With a persistent
profile and one Chrome per run the probe happens once. Copy only `dist-dev/{game,showcase}.*`,
`scripts/video/render.mjs` and `video/bundle/director.js` (built with `node scripts/video/build.mjs`); run
`render.mjs --gpu --no-build --profile=…`; `playwright-core` must be resolvable from the folder.
