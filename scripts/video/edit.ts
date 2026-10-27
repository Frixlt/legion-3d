/**
 * The EDIT trailer's SOURCE shots (render.mjs --cut=edit → video/frames-edit/<id>/): short full-frame takes of every
 * feature, rendered with the same deterministic capture as the other cuts (virtual time, seeded RNG, real input).
 * The trailer itself — beat grid, cuts, grids, punch-ins, whip pans, freeze frames, captions, flashes, music + game
 * sound — is composed afterwards from video/edit/timeline.json (scripts/video/edit-cut.mjs → edit-compose.mjs);
 * nothing here knows about the music.
 *
 * A source captures only its window `win` (output seconds; the rest is fast-forwarded with rendering off), and may
 * carry `rate` keys: a REAL slow-motion (game time runs slower than output time, every frame is a fresh frame), used
 * for «!идея бум» and the ragdolls. Captions / cards of reused promo + gameplay segments are hidden (the trailer has
 * its own), the game HUD stays: prompts, bubbles, cards are part of the show.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { type G, type V2, keyed, pxToM, placeM, yawTo, wrap, el, smooth } from './page/kit';
import { park, say, clearAround, bot, inters, hitCentre } from './page/demo';
import { type Segment, SEGMENTS as PROMO, walker, cam, mode, until, aimTo } from './shots';
import { GAMEPLAY, key, click, makeTimeline, relock, startSound, qsDeep } from './gameplay';

const E = -Math.PI / 2;   // yaw facing east (+x); 0 = north (−z), π = south (+z, towards the canal)
const S = Math.PI;

/* ------------------------------------------------------------------ helpers */
/** The trailer has its own captions: hide the cards / captions / black of the reused segments (the cursor stays). */
function hideCards(): void {
  if (document.getElementById('edit-css')) return;
  const s = document.createElement('style'); s.id = 'edit-css';
  s.textContent = '#video-layer .card,#video-layer .cap,#video-layer .black{display:none!important}';
  document.head.appendChild(s);
}
/** The expedition HUD's controls hint («мышь — осмотреться · … dev: FakeQuest») lives in a shadow root: hide it. */
function hideHint(): void {
  for (const e of document.querySelectorAll('*')) {
    const r = (e as HTMLElement).shadowRoot; if (!r || r.getElementById('edit-hint')) continue;
    const s = document.createElement('style'); s.id = 'edit-hint'; s.textContent = '.hint{display:none!important}'; r.appendChild(s);
  }
}
/** Change the own cat's class + weapon (the crowd feature rebuilds the avatar + view model; combat reads the kind). */
function hero(G: G, role: string, w: string, extra: Record<string, string> = {}): void {
  const me = G.store.me; if (!me) return;
  me.app = { ...me.app, role, gear: { ...(me.app.gear || {}), w, wr: 'epic', ...extra } };
  G.store.emit('walkers');
}
/** Seasonal decoration for this take («Праздничное оформление: Всегда» + «Какое событие»). */
function season(G: G, id: string | 'off'): void {
  try { localStorage.setItem('l3d.event.mode', id === 'off' ? 'off' : 'on'); if (id !== 'off') localStorage.setItem('l3d.event.pick', id); } catch { /* */ }
  window.dispatchEvent(new CustomEvent('l3d:settings', { detail: { key: 'l3d.event.pick' } }));
  G.ctx.dev?.seasonal?.refresh?.();
}
/** Metres of a bot (its walker position). */
const botM = (G: G, i: number): V2 => { const b = bot(G, i); return b ? pxToM([b.x, b.y]) : [0, 0]; };
/** yaw from the hero's feet to a point (metres). */
const yawFromMe = (G: G, p: V2) => { const f = G.ctx.feet; return yawTo([f.x, f.z], p); };
/** Common start of a new take: sound like a first click, pointer grabbed (emulated lock). */
async function start(G: G, lock = true): Promise<void> {
  hideCards();
  if (!(await startSound(G))) console.warn('[director] sound did not start');
  if (lock) click(G);
}
/** A reused segment as an edit source: new id, a capture window, the cards hidden, the sound started. */
function reuse(src: Segment | undefined, id: string, win: [number, number], title: string): Segment | null {
  if (!src) return null;
  return {
    ...src, id, cut: 'edit', win, title: `${title} (from «${src.id}»)`, narr: [],
    async setup(G) {
      hideCards();
      if (G.g) season(G, 'off');
      await src.setup(G);
      // promo segments never start the sound: a first «click» like a player's (no canvas click — their own choreography)
      if (G.g && src.cut !== 'gameplay') await startSound(G);
    },
  };
}
const P = (id: string) => PROMO.find((s) => s.id === id);
const GP = (id: string) => GAMEPLAY.find((s) => s.id === id);

/** Room fighters of the open room (shopkeepers, miners). */
function fighters(G: G): any[] { const L: any[] = []; G.g.rooms.scene?.combat?.fighters?.((f: any) => L.push(f)); return L; }

/* ================================================================== new takes */
// 1. emote wheel → dance (TP, cats around)
const T_DANCE = makeTimeline();
const DANCE: Segment = {
  id: 'e-dance', cut: 'edit', dur: 4.6, win: [0, 4.6], title: 'Emote wheel (Z): the wheel opens, pointer to «Танец», release → the cat dances (TP)',
  async setup(G) {
    T_DANCE.reset(); season(G, 'off');
    mode(G, 'tp'); G.ctx.applyCamera?.(true);
    placeM(G, pxToM([1850, 1000]), E);
    clearAround(G, 1850, 1000, 3);
    park(G, 0, 1720, 960, -1.2); park(G, 1, 1730, 1040, -1.9); park(G, 2, 1990, 975, 1.4);
    cam(G, -E + 0.3, -0.12);
    await start(G);
  },
  frame(G, t) {
    const D = G.ctx.dev?.emotes;
    cam(G, keyed([[0, -E + 0.35], [4.6, -E - 0.3]], t, true), keyed([[0, -0.14], [4.6, -0.1]], t));
    if (!D) return;
    T_DANCE.once('open', t >= 0.15, () => D.open());
    // the «Танец» slot (index 1 of 8, clockwise from the top): point up-right
    T_DANCE.once('pt', t >= 0.5, () => D.point(0.7, -0.7));
    T_DANCE.once('rel', t >= 1.05, () => { D.release(); if (D.current !== 'dance') D.play('dance'); });
    T_DANCE.once('cat', t >= 2.2, () => say(G, 0, 'танцуют все! 💃'));
  },
};

// 2. chat moods + confetti: a group of cats reacting
const T_MOOD = makeTimeline();
const MOODS: Segment = {
  id: 'e-moods', cut: 'edit', dur: 4.2, win: [0, 4.2], title: 'Chat mood bubbles («ура!», «хаха», «?», «😹») over a group of cats + a confetti burst',
  async setup(G) {
    T_MOOD.reset(); season(G, 'off');
    mode(G, 'tp'); G.ctx.applyCamera?.(true);
    placeM(G, pxToM([2600, 1010]), S);
    clearAround(G, 2600, 1010, 4);
    park(G, 0, 2480, 1000, -1.4); park(G, 1, 2470, 1050, -1.9); park(G, 2, 2400, 1020, -1.6); park(G, 3, 2500, 960, -0.9);
    cam(G, -E, -0.12);
    await start(G);
  },
  frame(G, t) {
    cam(G, keyed([[0, -E + 0.2], [4.2, -E - 0.15]], t, true), keyed([[0, -0.1], [4.2, -0.13]], t));
    T_MOOD.once('a', t >= 0.2, () => say(G, 0, 'ура!!!'));
    T_MOOD.once('b', t >= 0.7, () => say(G, 1, 'хахаха 😹'));
    T_MOOD.once('c', t >= 1.2, () => say(G, 2, '???'));
    T_MOOD.once('d', t >= 1.7, () => say(G, 3, 'мур 💕'));
    T_MOOD.once('cf', t >= 2.3, () => G.ctx.dev?.confetti?.burst?.('edit-moods'));
  },
};

// 3. bench + constellations: sit down, look up at the sky
const T_BENCH = makeTimeline();
const BENCH: Segment = {
  id: 'e-bench', cut: 'edit', dur: 5.0, win: [0, 5.0], title: 'Bench: the cat sits down (TP), the camera tilts up to a cat constellation',
  async setup(G) {
    T_BENCH.reset(); season(G, 'off');
    mode(G, 'tp'); G.ctx.applyCamera?.(true);
    placeM(G, pxToM([3300, 1335]), 0);
    clearAround(G, 3300, 1300, 3);
    cam(G, 0.3, -0.08);
    await start(G, false);
  },
  frame(G, t) {
    T_BENCH.once('sit', t >= 0.1, () => { try { G.ctx.dev?.bench?.sit?.(2); } catch { /* */ } });
    const pl = G.ctx.dev?.stars?.placed?.() || [];
    void pl;
    cam(G, keyed([[0, 0.25], [2.0, 0.1], [5.0, -0.1]], t, true), keyed([[0, -0.1], [1.8, -0.06], [4.0, 0.55], [5.0, 0.6]], t));
  },
};

// 4. paw prints: a short TP run, the camera low behind the cat looking at the trail
const T_PAWS = makeTimeline();
let pawWalk: ReturnType<typeof walker> | null = null;
const PAWS: Segment = {
  id: 'e-paws', cut: 'edit', dur: 3.6, win: [0, 3.6], title: 'Paw prints behind the running cat (TP, low camera)',
  async setup(G) {
    T_PAWS.reset(); season(G, 'off');
    mode(G, 'tp'); G.ctx.applyCamera?.(true);
    placeM(G, pxToM([1700, 1010]), E);
    clearAround(G, 1900, 1010, 4);
    pawWalk = walker([[1700, 1010], [2050, 1005]], 1.6, 0.6);
    cam(G, -E + 0.35, -0.3);
    await start(G);
    try { G.ctx.dev?.paws?.lay?.(9, E); } catch { /* */ }
  },
  frame(G, t) {
    const yaw = keyed([[0, -E + 0.4], [3.6, -E + 0.2]], t, true);
    cam(G, yaw, keyed([[0, -0.32], [3.6, -0.36]], t));
    pawWalk!.drive(G, t, yaw, 0.1);
  },
};

// 5. mage flight: over the lower street and the canal, up to the roofs
const T_FLY = makeTimeline();
let flyWalk: ReturnType<typeof walker> | null = null;
const FLIGHT: Segment = {
  id: 'e-flight', cut: 'edit', dur: 6.5, win: [0, 6.5], title: 'Mage flight: Space twice → take-off, Space held → up, fly north over the street towards the roofs (TP)',
  requires: (G) => (G.ctx.dev?.flight ? null : 'no flight feature (__l3dGame.flight)'),
  async setup(G) {
    T_FLY.reset(); season(G, 'off');
    hero(G, 'mage', 'staff');
    const F = G.ctx.dev.flight; F.force = true;
    mode(G, 'tp'); G.ctx.applyCamera?.(true);
    placeM(G, pxToM([2460, 1470]), 0);
    clearAround(G, 2460, 1400, 3);
    flyWalk = walker([[2460, 1470], [2470, 1300], [2500, 1120], [2540, 960]], 2.6, 0.8);
    cam(G, 0.5, -0.05);
    await start(G);
  },
  frame(G, t) {
    relock(G);
    const S1 = T_FLY;
    S1.tap('Space', t, 0.25, 0.1, 'a');
    S1.tap('Space', t, 0.55, 2.4, 'b');           // second press in the air → take off, held → climb
    S1.tap('Space', t, 4.0, 1.1, 'c');            // more height before the roofs
    const yaw = keyed([[0, 0.55], [1.5, 0.75], [4.0, 0.35], [6.5, 0.15]], t, true);
    cam(G, yaw, keyed([[0, -0.05], [1.4, -0.12], [3.5, -0.2], [6.5, -0.26]], t));
    flyWalk!.drive(G, t, yaw, 1.0);
  },
};

// 6. photo mode (F9)
const T_PH = makeTimeline();
const PHOTO: Segment = {
  id: 'e-photo', cut: 'edit', dur: 3.4, win: [0, 3.4], title: 'Photo mode: F9 → free camera + the panel (filters, pose)',
  requires: (G) => (typeof G.ctx.dev?.photo === 'function' ? null : 'no photo mode'),
  async setup(G) {
    T_PH.reset(); season(G, 'off');
    mode(G, 'tp'); G.ctx.applyCamera?.(true);
    placeM(G, pxToM([4300, 1010]), 0.4);
    park(G, 0, 4380, 1050, -0.9); park(G, 1, 4220, 1060, 0.9);
    cam(G, 0.4, -0.1);
    await start(G);
  },
  frame(G, t) {
    T_PH.tap('F9', t, 0.3);
    cam(G, keyed([[0, 0.4], [3.4, 0.1]], t, true), -0.1);
  },
};

// 7–9. seasons: Halloween / New Year with a snowball / April hats / summer lanterns + paper boats on the canal
const T_HW = makeTimeline();
const HALLOWEEN: Segment = {
  id: 'e-halloween', cut: 'edit', dur: 3.4, win: [0, 3.4], title: 'Halloween decoration (forced «Всегда» + «Хэллоуин»), slow TP pan on the fair',
  async setup(G) {
    T_HW.reset(); season(G, 'halloween');
    mode(G, 'tp'); G.ctx.applyCamera?.(true);
    placeM(G, pxToM([2250, 1010]), E);
    park(G, 0, 2380, 1040, 1.0); park(G, 1, 2150, 980, -1.0);
    cam(G, E + 0.5, -0.06);
    await start(G, false);
  },
  frame(G, t) { cam(G, keyed([[0, E + 0.55], [3.4, E - 0.1]], t, true), keyed([[0, -0.04], [3.4, 0.02]], t)); },
};
const T_NY = makeTimeline();
const NEWYEAR: Segment = {
  id: 'e-newyear', cut: 'edit', dur: 3.8, win: [0, 3.8], title: 'New Year: snow, the fir tree; G throws a snowball at a cat (it hits)',
  async setup(G) {
    T_NY.reset(); season(G, 'newyear');
    mode(G, 'tp'); G.ctx.applyCamera?.(true);
    placeM(G, pxToM([3400, 1010]), E);
    clearAround(G, 3500, 1010, 4);
    park(G, 0, 3610, 1010, Math.PI / 2);
    await start(G);
    cam(G, yawFromMe(G, botM(G, 0)) + 0.35, -0.08);
  },
  frame(G, t) {
    relock(G);
    const a = yawFromMe(G, botM(G, 0));
    cam(G, keyed([[0, a + 0.4], [0.7, a + 0.06], [3.8, a + 0.12]], t, true), keyed([[0, -0.08], [0.7, 0.04], [3.8, 0.02]], t));
    T_NY.tap('KeyG', t, 0.9);
    T_NY.tap('KeyG', t, 2.3, 0.1, 'b');
    T_NY.once('ow', t >= 1.6, () => say(G, 0, 'ай! холодно! ❄'));
  },
};
const T_AP = makeTimeline();
const APRIL: Segment = {
  id: 'e-april', cut: 'edit', dur: 3.0, win: [0, 3.0], title: 'April 1: party hats on every cat (forced event), a group of cats',
  async setup(G) {
    T_AP.reset(); season(G, 'aprilfools');
    mode(G, 'tp'); G.ctx.applyCamera?.(true);
    placeM(G, pxToM([2600, 1010]), S);
    clearAround(G, 2600, 1010, 4);
    park(G, 0, 2480, 1000, -1.4); park(G, 1, 2470, 1050, -1.9); park(G, 2, 2400, 1020, -1.6); park(G, 3, 2500, 960, -0.9);
    cam(G, -E, -0.12);
    await start(G, false);
  },
  frame(G, t) { cam(G, keyed([[0, -E - 0.25], [3.0, -E + 0.2]], t, true), -0.12); },
};
const T_SU = makeTimeline();
const SUMMER: Segment = {
  id: 'e-summer', cut: 'edit', dur: 4.0, win: [0, 4.0], title: 'Summer lanterns on the canal + paper boats (forced «Летние фонарики»), TP pan over the water',
  async setup(G) {
    T_SU.reset(); season(G, 'summer');
    mode(G, 'tp'); G.ctx.applyCamera?.(true);
    placeM(G, pxToM([2330, 1470]), S);
    clearAround(G, 2330, 1470, 3);
    cam(G, S + 0.6, -0.18);
    await start(G, false);
  },
  frame(G, t) { cam(G, keyed([[0, S + 0.7], [4.0, S - 0.3]], t, true), keyed([[0, -0.2], [4.0, -0.14]], t)); },
};

// 10. combat on the street: slash (ragdolls + crowd cheering), smash, orb, zombies, holy
function fightSeg(id: string, role: string, w: string, dur: number, title: string, hits: number[], opt: { fp?: boolean; rate?: [number, number][]; hold?: number; lines?: [number, number, string][] } = {}): Segment {
  const T = makeTimeline();
  const AT: V2 = [4280, 1020];
  return {
    id, cut: 'edit', dur, win: [0, dur], title, rate: opt.rate,
    requires: (G) => (G.ctx.dev?.combat ? null : 'no combat'),
    async setup(G) {
      T.reset(); season(G, 'off');
      hero(G, role, w);
      mode(G, opt.fp ? 'fp' : 'tp'); G.ctx.applyCamera?.(true);
      placeM(G, pxToM(AT), E);
      clearAround(G, 4350, 1020, 5);
      // a target right in front, two more behind it, an audience to the side (they cheer on a hit)
      park(G, 0, 4400, 1018, Math.PI / 2); park(G, 1, 4460, 995, 1.2); park(G, 2, 4470, 1045, 2.0);
      park(G, 3, 4360, 960, 2.8); park(G, 4, 4300, 955, 3.0); park(G, 5, 4420, 950, -2.8);
      await until(() => G.ctx.dev.combat.kind() !== 'slap' || w === '', 3000);
      console.log('[director]', id, 'attack kind', G.ctx.dev.combat.kind());
      await start(G);
    },
    frame(G, t) {
      relock(G);
      const a = yawFromMe(G, botM(G, 0));
      cam(G, keyed([[0, a + (opt.fp ? 0.05 : 0.95)], [dur, a + (opt.fp ? -0.05 : 1.15)]], t, true), keyed([[0, opt.fp ? -0.06 : -0.14], [dur, opt.fp ? -0.04 : -0.12]], t));
      hits.forEach((h, k) => {
        T.once('d' + k, t >= h, () => click(G, 'down'));
        T.once('u' + k, t >= h + (opt.hold ?? 0.12), () => click(G, 'up'));
      });
      (opt.lines || []).forEach(([at, i, s], k) => T.once('l' + k, t >= at, () => say(G, i, s)));
    },
  };
}
const SLASH = fightSeg('e-slash', 'legionary', 'gladius', 3.6, 'Slash (gladius): two swings at a cat → ragdolls, the crowd cheers', [0.5, 1.3], { lines: [[2.2, 3, 'ахах, бонк! 😹']] });
const SMASH = fightSeg('e-smash', 'legionary', 'hammer', 3.0, 'Smash (hammer) in first person → a cat flies', [0.4], { fp: true });
const ORB = fightSeg('e-orb', 'mage', 'staff', 3.0, 'Mage orb (staff): an orb flies, the cats tumble', [0.4], {});
const ZOMBIES = fightSeg('e-zombies', 'necromancer', 'skullstaff', 4.6, 'Necromancer: zombie cats rise («Мозги… Рыыыбки!») and chase the others', [0.3], {});
const HOLY = fightSeg('e-holy', 'priest', 'censer', 3.0, 'Priest (censer): a holy light wave knocks the cats down', [0.4], {});

// 11. «!идея бум»: typed into the chat, the bomb's fuse, BOOM in real slow motion, cats flying, the hero laughs
const T_BOOM = makeTimeline();
const BOOM_LINE = '!идея бум';
// output seconds: typing 0–1.6, Enter 1.7 (game s), fuse 0.6 s → bang at game 2.3 ≈ output 2.45; slow-mo 0.25× from
// output 2.3 to 5.6 (= game 2.26–3.09), back to 1× at 6.2
const BOOM_RATE: [number, number][] = [[0, 1], [2.2, 1], [2.3, 0.25], [5.6, 0.25], [6.2, 1]];
const BOOM: Segment = {
  id: 'e-boom', cut: 'edit', dur: 7.6, win: [0, 7.6], rate: BOOM_RATE,
  title: '«!идея бум»: typed into the chat (swallowed, never sent) → fuse → BOOM in slow motion (0.25×), every cat within 15 m flies',
  requires: (G) => (G.ctx.dev?.boom ? null : 'no boom'),
  async setup(G) {
    T_BOOM.reset(); season(G, 'off');
    hero(G, 'legionary', 'gladius');
    mode(G, 'tp'); G.ctx.applyCamera?.(true);
    placeM(G, pxToM([4280, 1010]), S);
    clearAround(G, 4280, 1010, 6);
    const ring: [number, number][] = [[4360, 1040], [4200, 1045], [4400, 990], [4160, 990], [4320, 975], [4240, 970], [4440, 1030], [4130, 1030]];
    ring.forEach(([x, y], i) => park(G, i, x, y, yawTo(pxToM([x, y]), pxToM([4280, 1010]))));
    cam(G, 0.35, -0.16);
    await start(G);
  },
  frame(G, t) {
    // t = GAME time here (rate keys): the choreography stays physical, the output is slow
    relock(G);
    cam(G, keyed([[0, 0.3], [1.6, 0.2], [2.4, 0.25], [6, 0.45]], t, true), keyed([[0, -0.16], [2.4, -0.2], [6, -0.14]], t));
    T_BOOM.tap('Enter', t, 0.15);
    const inp = t >= 0.3 && t < 1.7 ? (qsDeep('.chat label.in input') as HTMLInputElement | null) : null;
    if (inp) {
      const n = Math.min(BOOM_LINE.length, Math.floor((t - 0.35) / 1.0 * BOOM_LINE.length));
      const want = [...BOOM_LINE].slice(0, Math.max(0, n)).join('');
      if (inp.value !== want) { inp.value = want; inp.dispatchEvent(new Event('input', { bubbles: true })); }
    }
    T_BOOM.once('send', t >= 1.7, () => {
      const i = qsDeep('.chat label.in input') as HTMLInputElement | null;
      if (i) { i.value = BOOM_LINE; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })); }
      T_BOOM.mark('sent', t);
      // fallback: the dev trigger (same show) if the chat field was not there
      T_BOOM.once('fb', !i, () => G.ctx.dev.boom.trigger?.());
    });
  },
};

// 12. inside «Лавка»: hit the shopkeeper («Эй! Тут магазин!»), then arrows into the shelf
function roomFight(id: string, role: string, w: string, dur: number, title: string, aimAt: 'npc' | 'shelf', hits: number[], hold = 0.12, fp = false): Segment {
  const T = makeTimeline();
  let target: (() => [number, number, number] | null) | null = null;
  let npc: any = null;
  return {
    id, cut: 'edit', dur, win: [0, dur], title,
    requires: (G) => (G.ctx.dev?.combat ? null : 'no combat'),
    async setup(G) {
      T.reset(); season(G, 'off');
      hero(G, role, w);
      mode(G, fp ? 'fp' : 'tp'); G.ctx.applyCamera?.(true);
      placeM(G, pxToM([4775, 1000]), 0);
      await G.g.rooms.enter('shop');
      if (!(await until(() => G.g.rooms.current === 'shop' && !G.g.rooms.busy, 15000))) throw new Error('shop room did not open');
      const sp = G.g.rooms.scene.spawn;
      npc = fighters(G).find((f) => f.kind === 'npc') || fighters(G)[0];
      if (aimAt === 'npc' && npc) {
        const p = npc.av.root.position, dx = sp.x - p.x, dz = sp.z - p.z, L = Math.hypot(dx, dz) || 1;
        placeM(G, [p.x + dx / L * 3.0, p.z + dz / L * 3.0]);
        target = () => { const q = npc.av.root.position; return [q.x, q.y + 0.7, q.z]; };
      } else {
        // the nearest good on a shelf at chest height: shoot next to it (arrows stick in the shelf)
        const goods = [...inters.values()].filter((i) => /^room:good:/.test(i.id) && hitCentre(i)).map((i) => hitCentre(i)!).filter((c) => c[1] > 0.8 && c[1] < 1.8);
        goods.sort((a, b) => Math.hypot(a[0] - sp.x, a[2] - sp.z) - Math.hypot(b[0] - sp.x, b[2] - sp.z));
        const c = goods[0] || [sp.x, 1.2, sp.z - 3];
        const dx = sp.x - c[0], dz = sp.z - c[2], L = Math.hypot(dx, dz) || 1;
        placeM(G, [c[0] + dx / L * (fp ? 2.1 : 3.0), c[2] + dz / L * (fp ? 2.1 : 3.0)]);
        target = () => [c[0] + 0.2, c[1] + 1.0, c[2]];   // the shelf board / wall above the goods (a good keeps LMB)
      }
      await start(G);
    },
    frame(G, t) {
      relock(G);
      const p = target?.();
      if (p) {
        const f = G.ctx.feet, yaw = yawTo([f.x, f.z], [p[0], p[2]]), pa = fp ? aimTo(G, p)[1] : -0.1;
        cam(G, keyed([[0, yaw + 0.45], [0.5, yaw + 0.02], [dur, yaw + 0.06]], t, true), keyed([[0, pa - 0.05], [0.5, pa], [dur, pa]], t));
      }
      hits.forEach((h, k) => {
        T.once('d' + k, t >= h, () => click(G, 'down'));
        T.once('u' + k, t >= h + hold, () => click(G, 'up'));
      });
      // the orb flies over the counter and may miss the keeper: when it would have arrived, the hit lands for sure
      // (the same CombatSystem.hit a landed orb calls — ragdoll, the room's grumble line «Эй! Тут магазин!»…)
      if (aimAt === 'npc' && npc) T.once('sure', t >= hits[0] + 0.3, () => {
        const sys = G.ctx.dev.combat, r = npc.av.root.position, f = G.ctx.feet;
        if (sys.ragdolls.has(npc.id)) return;
        const dx = r.x - f.x, dz = r.z - f.z, L = Math.hypot(dx, dz) || 1;
        // towards the camera and up: she sails over her own counter
        try { sys.hit(npc.id, npc.av, -dx / L * 3.2, 5.6, -dz / L * 3.2, r.x, r.y + 0.8, r.z, 0.06); } catch (e) { console.warn('[director] hit', e); }
      });
    },
  };
}
const SHOPFIGHT = roomFight('e-shopfight', 'mage', 'staff', 3.8, 'Inside «Лавка»: an orb at the shopkeeper → ragdoll + «Эй! Тут магазин!»', 'npc', [0.7]);
const ARROWS = roomFight('e-arrows', 'archer', 'bow', 3.6, 'Inside «Лавка»: three arrows into the shelf above the goods (they stick)', 'shelf', [0.7, 1.6, 2.5], 0.55, true);

// 13. expedition 3D (dev/expedition.html with the FakeQuest): a wolf battle and the boss arena platforms
function expSeg(id: string, at: number, dur: number, title: string, yaw0: number, yaw1: number): Segment {
  return {
    id, cut: 'edit', dur, win: [0, dur], title, page: `expedition?at=${at}&speed=1&nodbg=1&q=3`,
    requires: (G) => (G.sc?.view ? null : 'no expedition page'),
    setup(G) { hideCards(); try { G.sc.look(yaw0, 0.1, 1); } catch { /* */ } },
    frame(G, t) { hideHint(); try { G.sc.look(yaw0 + (yaw1 - yaw0) * smooth(t / dur), 0.1, 1); } catch { /* */ } },
  };
}
const EXP_BATTLE = expSeg('e-exp-battle', 56, 4.0, 'Expedition 3D: the wolf-pack battle (party hit stage), slow orbit', -0.35, 0.25);
const EXP_BOSS = expSeg('e-exp-boss', 196, 4.0, 'Expedition 3D: the boss «Гнилозуб» and the arena platforms', 0.3, -0.3);

/* ================================================================== reused takes (windows of the other cuts) */
const REUSED = [
  reuse(P('fair'), 'e-fair-fp', [1.2, 6.2], 'FP stroll at the night fair'),
  reuse(P('fair'), 'e-fair-jump', [15.6, 19.6], 'TP: jump over a bench'),
  reuse(P('gear'), 'e-gear', [1.0, 5.2], 'Gear: orbit camera, equip a weapon'),
  reuse(P('map'), 'e-map', [2.2, 7.2], 'Map: pin «Лавка» → «Идти сюда», auto-walk'),
  reuse(P('shop'), 'e-shop', [3.6, 8.6], '3D shop: aim at goods, outline + «[E] Купить…» card'),
  reuse(P('mine'), 'e-mine', [3.5, 9.5], '3D mine: dig, the stone breaks'),
  reuse(P('showcase'), 'e-showcase', [0.5, 6.5], 'Showcase: item models on stands'),
].filter(Boolean) as Segment[];

export const EDIT: Segment[] = [
  ...REUSED,
  DANCE, MOODS, BENCH, PAWS, FLIGHT, PHOTO,
  HALLOWEEN, NEWYEAR, APRIL, SUMMER,
  SLASH, SMASH, ORB, ZOMBIES, HOLY, BOOM, SHOPFIGHT, ARROWS,
  EXP_BATTLE, EXP_BOSS,
];
void el; void wrap; void key;
