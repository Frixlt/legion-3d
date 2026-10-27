# Review & gameplay videos — deterministic frame capture

Two cuts: the **promo** (review video, below; `video/frames/`, `legion-3d-review.mp4`) and the **gameplay** video
with the game's own sound (`--cut=gameplay`, see «Gameplay cut» further down; `video/frames-gameplay/`,
`legion-3d-gameplay.mp4`).

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
`render.mjs --gpu --no-build --profile=…`; `playwright-core` must be resolvable from the folder. The gameplay cut also
needs `scripts/video/{audio,narration}.mjs`, `video/bundle/audio.js` and ffmpeg/ffprobe on PATH (the sound is rendered
in the same persistent profile after the picture).

## Gameplay cut (`--cut=gameplay`, `gameplay.ts`)

≈ 92 s (≈ 81 s without `gp-fun`) of one evening of play at a player's pace, mostly first person, all through the game's own input path: the
movement stick, real key events (E use, F inspect, V camera, Space jump, L journal, Esc, F9, Enter), a canvas click
that grabs the pointer (pointer lock is emulated in headless, `vtime.ts` `cfg.lock`, so the crosshair, prompts and LMB
attacks behave as with a mouse) and a drawn cursor only while a card is open. Inside a segment everything after a room
change is timed from the frame the room opened (marks), so the shots follow the game, not a stopwatch.

| # | id | s | what |
|---|---|---|---|
| 1 | `gp-fair` | 37.6 | fade in, FP on the lower fair by the beds, look around, cats chat (bubbles) → walk → **V** to TP → **Space** over the bench at (4800, 1290) → up the stairs → **V** back to FP → the «Лавка» door outlined, prompt «[E] Войти: Лавка» → **E** → inside (the door swings shut behind) → walk to the shelves → **F** «Осмотреть» card (Килька) → **Esc** → aim at the next good (outline follows, tag lights up) → **E** «Купить «Целый лосось» за 48 мед.? Да / Нет» → cursor clicks **Да** (demo-only fake purchase: the offline site answers ok) → toast «Куплено…» + coins → a look at the next shelf → turn, walk to the exit, **E** → the door swings open, fade |
| 2 | `gp-walk` | 13.5 | out of «Лавка»: a few steps, **V** to TP, **Enter** → the line is typed into the chat → **Enter**: own bubble + chat line, a cat answers; run down the stairs westwards |
| 3 | `gp-mine` | 24.5 | fade in by the canal, walk to the mine portal (outline, «[E] Войти: ⛏ Шахта») → **E** → the 3D mine → walk between stones to the nearest reachable one → aim (outline + ring) → **E**: pickaxe swings, progress, the stone breaks, «+N осколков» → **L** journal → **L** closes → a look round the mine |
| 4 | `gp-fun` | 12 | *only if combat or photo mode exist*: TP, step up to a cat, **LMB** ×2 (melee weapon from the bag) → ragdolls; **F9** photo mode, **Enter** snapshot, **Esc** back |
| 5 | `gp-end` | 7 | end card «Legion 3D» + **github.com/ascorblack/legion-3d/releases/latest** + keys over a slow drift |

Halloween: the gameplay cut sets «Праздничное оформление» to «Всегда» (`l3d.event.mode=on`); with the seasonal
feature present the city is decorated, without it nothing changes. A segment whose `requires()` fails is skipped and
left out of the cut (`gp-fun` without combat and photo mode).

```bash
npm run build                                   # dist-dev/ + the bundles
export CHROMIUM=/usr/bin/google-chrome
node scripts/video/render.mjs --cut=gameplay    # → video/legion-3d-gameplay.mp4 (1920×1080, picture + game sound)
node scripts/video/render.mjs --cut=gameplay --dsf=1.3333 --name=legion-3d-gameplay-1440p   # 2560×1440
node scripts/video/render.mjs --cut=gameplay --gpu --profile=C:\l3d-chrome --workers=3     # Windows GPU box
node scripts/video/render.mjs --cut=gameplay --segments=gp-mine --w=960 --h=540 --at=4,9,14   # stills (+ marks in the log)
node scripts/video/render.mjs --cut=gameplay --audio-only --no-assemble                       # sound captures only (≈ 30 s/segment)
node scripts/video/audio.mjs --cut=gameplay     # re-master + re-mux the sound only (segment WAVs + video exist)
node scripts/video/narration.mjs --voice=<dir with slot-1.wav…>   # optional narrator → legion-3d-gameplay.voice.mp4
```

Outputs (`video/`): `frames-gameplay/<id>/NNNNN.jpg` + `audio.json` (capture) + `audio.wav` (segment soundtrack),
`legion-3d-gameplay.video.mp4` (picture only), `.raw.wav` (joined game sound before mastering), `.wav` (mastered),
`.mp4` (picture copied + AAC 256k), `.markers.json` (scenes, marks, every sound event and the narrator slots on the
final timeline), `.audio.json`.

## Sound (gameplay cut)

The picture is captured in virtual time, so the sound is not recorded but **rebuilt from a log**:

1. **Capture.** With `cfg.audio` (`vtime.ts`) the page's `new AudioContext()` becomes a never-rendered
   OfflineAudioContext whose `currentTime` is the virtual clock, and `window.__VT_AUDIO_LOG = []` turns on the hook in
   `src/audio/capture.ts`: the game's `SoundEngine` appends every voice it really starts (after cooldowns, distance
   culling, the voice limit, the variant pick and jitter: bank key, rate, gain, low-pass, bus, world position, panner
   falloff, HRTF), every named level ramp (master, buses, ambience duck, beds, space mix, wind gusts), bed start offsets,
   space / hearth changes and the listener pose (camera) every frame. The segment's setup starts the sound like the first
   click of a player and waits until every sample is decoded; its RNG and ambience timers are reset after setup, so a
   capture is reproducible. The game's own master is set to 100 % (`l3d.vol.master=1`) — the fixed video mix level.
2. **Audio pass.** `render.mjs` runs each segment once more with rendering off (`fast(true)`) — the simulation is the
   frame pass's, frame for frame (between two frames the page always gets a macrotask turn, so room loads settle on the
   same frame whether frames are rendered one by one or fast-forwarded) — and writes `audio.json` (+ marks, `t0` = the
   virtual time of frame 0).
3. **Render.** `audio.mjs` loads `video/bundle/audio.js` (the game's `src/audio` bank + engine) in headless Chrome and
   calls `SoundEngine.replay(log)` on an OfflineAudioContext at 48 kHz stereo: the same node chain, panners, reverb,
   limiter — no decisions of its own. It renders from the engine's creation (beds and ramps settled) and keeps exactly
   the segment's frames.
4. **Join + master** (video-audio rules): the segment WAVs are joined with the same crossfades as the picture, the whole
   mix gets ONE static gain to −16 LUFS integrated + a limiter; the true peak is measured on the ENCODED AAC and the
   ceiling lowered until ≤ −1 dBTP; the video stream is copied, never re-encoded.

**Narration** stays separate and optional: `.markers.json` → `narration.slots` (start, ≤ 6 s, suggested line,
checked not to sit within 0.6 s of the coins / stone break / door) — `narration.mjs` ducks the game sound by 4–6 dB
(`--duck=5`) under each clip and re-masters the sum.
