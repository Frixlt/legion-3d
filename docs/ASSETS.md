# Third-party assets

Everything else in the repository is original (procedural geometry, textures and sounds made in code). Each asset
below is **CC0 / public domain**; the licence was checked on the source page when it was downloaded (2026-10).
Other modules may add rows; keep one row per source file or per pack.

## Sounds

Files live in `src/audio/sounds/*.ogg` (Opus, 48 kHz, mono one-shots / stereo beds) and ship inside the bundle as
`src/audio/bank.gen.ts` (the content script runs in the page's MAIN world and cannot read packaged files). Both are
produced by `src/audio/tools/prepare-sounds.mjs` from the downloads: filtered (no rumble, softened highs), trimmed,
faded and level-normalised. Procedural sounds made in code (no file): the chat-bubble pop and the room tone
(`src/audio/dsp.ts`).

| file(s) in src/audio/sounds | used for | source | licence | author |
|---|---|---|---|---|
| `step_cobble_0…5` | footsteps on the street | Fantozzi's Footsteps (Grass/Sand & Stone) — `Fantozzi-Stone{L,R}{1,2,3}.flac` — https://opengameart.org/content/fantozzis-footsteps-grasssand-stone (from https://freesound.org/people/Fantozzi/packs/10338/, CC0) | CC0 | Fantozzi |
| `step_soft_0…5` | footsteps in the tent (soft ground) | same pack, `Fantozzi-Sand{L,R}{1,2,3}.flac` | CC0 | Fantozzi |
| `step_wood_0…4` | footsteps on shop floors | Kenney Impact Sounds — `footstep_wood_000…004.ogg` — https://kenney.nl/assets/impact-sounds | CC0 | Kenney (kenney.nl) |
| `land_0…2` | soft landing layer | Kenney Impact Sounds — `impactSoft_medium_000…002.ogg` | CC0 | Kenney |
| `tick_0…2` | crosshair target tick (very quiet) | Kenney Impact Sounds — `impactWood_light_000…002.ogg` | CC0 | Kenney |
| `pick_0…4` | pickaxe on stone (mine) | Kenney Impact Sounds — `impactMining_000…004.ogg` | CC0 | Kenney |
| `step_dirt_0…5` | footsteps in the mine | Kenney RPG Audio — `footstep00/01/02/03/06/09.ogg` — https://kenney.nl/assets/rpg-audio | CC0 | Kenney |
| `cloth_0…3` | jump take-off, menu close, tent flap | Kenney RPG Audio — `cloth1…4.ogg` | CC0 | Kenney |
| `door_open_0…1`, `door_close_0…2` | shop doors | Kenney RPG Audio — `doorOpen_1/2.ogg`, `doorClose_1…3.ogg` | CC0 | Kenney |
| `coins_0…1` | purchase confirmed | Kenney RPG Audio — `handleCoins.ogg`, `handleCoins2.ogg` | CC0 | Kenney |
| `paper_0…2` | menu open | Kenney RPG Audio — `bookFlip1…3.ogg` | CC0 | Kenney |
| `creak_0…2` | rare wooden creak (street / shops), mine entrance | Kenney RPG Audio — `creak1…3.ogg` | CC0 | Kenney |
| `rock_break_0…2` | a stone breaks (mine) | 75 CC0 breaking / falling / hit sfx — `bfh1_rock_breaking_01…03.ogg` — https://opengameart.org/content/75-cc0-breaking-falling-hit-sfx | CC0 | rubberduck |
| `meow_0`, `meow_1` | a far-away cat, very rare | Cat Purr & Meow — `cat_softmew.wav`, `cat_mewpurr.wav` — https://opengameart.org/content/cat-purr-meow | CC0 | Kerzoven |
| `whoosh_0…2`, `poof_0…1`, `shimmer_0…1`, `chime_0`, `groan_0…1` | «Драки с котиками»: swing whoosh, zombie / orb poof, spell shimmer, holy chime, cute zombie groan | original, synthesised by `src/audio/tools/gen-combat-sfx.mjs` (filtered noise, sine partials, a formant-filtered buzz) | CC0 (original) | Legion 3D |
| `bonk_0…2` | «Драки с котиками»: a soft comic hit (cushion thump + a synthesised falling "bonk") | Kenney Impact Sounds — `impactSoft_heavy_000…002.ogg`, layered in `gen-combat-sfx.mjs` | CC0 | Kenney + Legion 3D |
| `twang_0…1` | bow release | Kenney Interface Sounds — `pluck_001.ogg`, `pluck_002.ogg` — https://kenney.nl/assets/interface-sounds | CC0 | Kenney |
| `thunk_0…2` | an arrow sticks into wood / the ground | Kenney Impact Sounds — `impactPlank_medium_000…002.ogg` | CC0 | Kenney |
| `bed_crickets` | street bed: crickets | Crickets Ambient Noise - loopable — `crickets-oneloop.mp3` — https://opengameart.org/content/crickets-ambient-noise-loopable | CC0 | Wolfgang_ |
| `bed_wind` | street bed: light wind | wind1 — `wind1.wav` — https://opengameart.org/content/wind1 | CC0 | Luke.RUSTLTD |
| `bed_crowd` | street bed: far murmur of the fair (low-passed, layered with itself so no words are heard) | Crowd Shouting/Speaking Ambience — `crowd_shouting_0.ogg` — https://opengameart.org/content/crowd-shoutingspeaking-ambience | CC0 | StarNinjas |
| `bed_fire` | forge hearth | Fireplace Sound loop — `fire.wav` — https://opengameart.org/content/fireplace-sound-loop | CC0 | PagDev |
| `bed_cave` | mine bed: drips, room tone | Dripping water loop — `atmosbasement.mp3_.flac` — https://opengameart.org/content/dripping-water-loop | CC0 | Independent.nu |

Rebuild after changing the list: download the sources into `.local/sound/` (layout in the script header), then
`SND_SRC=.local/sound node src/audio/tools/gen-combat-sfx.mjs` (writes `gen/*.wav`) and
`SND_SRC=.local/sound node src/audio/tools/prepare-sounds.mjs`. The bow draw reuses `creak_2`, an arrow hitting a cat
reuses `land_0…2` (pitched up).
