/**
 * The GAMEPLAY video (render.mjs --cut=gameplay → video/legion-3d-gameplay.mp4): one evening of play at a player's
 * pace, mostly first person, driven through the game's own input path — the movement stick, real key events
 * (E use, F inspect, V camera, Space jump, L journal, Esc, F9), a pointer lock (emulated in headless, vtime.ts) and a
 * drawn cursor only while a card is open. The game's own sound is captured from the same run (src/audio/capture.ts).
 *
 * Inside a segment the choreography after a room change is timed from the frame the room opened (`since(mark)`):
 * the room opens on a deterministic frame (its loading only awaits already-resolved promises), and the marks also
 * anchor the narrator slots (`narr`).
 *
 * Segments: gp-fair (fair → bench jump → «Лавка»: inspect, buy, leave) · gp-mine (portal → dig a stone → journal) ·
 * gp-fun (combat swing / photo mode — only when those features exist) · gp-end (install link).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { type G, type V2, keyed, pxToM, placeM, yawTo, wrap, el, env, smooth, black, cursor, type CursorKey, planPath, Spline, clamp, caption } from './page/kit';
import { park, say, enableMine, inters, hitCentre, clearAround } from './page/demo';
import { type Segment, FPS, walker, routed, cam, mode, uiOpacity, aimTo, until } from './shots';

/* ------------------------------------------------------------------ real input */
/** Dispatch a key event the way a keyboard would (bubbles from <body> to document and window). */
function key(type: 'keydown' | 'keyup', code: string): void {
  const k = code.startsWith('Key') ? code.slice(3).toLowerCase() : code === 'Space' ? ' ' : code;
  (document.body || document).dispatchEvent(new KeyboardEvent(type, { code, key: k, bubbles: true, cancelable: true, composed: true }));
}
/** A canvas click (mousedown + mouseup, LMB): grabs the pointer, or attacks / uses while it is held. */
function click(G: G, type: 'down' | 'up' | 'both' = 'both'): void {
  const c = G.g.engine.renderer.domElement as HTMLCanvasElement, r = c.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, button: 0, buttons: type === 'up' ? 0 : 1, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
  if (type !== 'up') { c.dispatchEvent(new PointerEvent('pointerdown', o)); c.dispatchEvent(new MouseEvent('mousedown', o)); }
  if (type !== 'down') { c.dispatchEvent(new PointerEvent('pointerup', o)); c.dispatchEvent(new MouseEvent('mouseup', o)); }
}

/** Per-segment one-shot triggers and timed key taps (deterministic: a pure function of the segment time). */
function makeTimeline() {
  const fired = new Set<string>();
  const once = (k: string, cond: boolean, fn: () => void) => { if (cond && !fired.has(k)) { fired.add(k); fn(); } };
  /** Press `code` at time `at` (seconds, any clock) and release it `hold` s later — like a finger on a key. */
  const tap = (code: string, t: number, at: number, hold = 0.1, tag = '') => {
    once(`dn:${code}:${at}${tag}`, t >= at, () => key('keydown', code));
    once(`up:${code}:${at}${tag}`, t >= at + hold, () => key('keyup', code));
  };
  /** Time since a mark was written in this segment (−1 before it). */
  const marks = new Map<string, number>();
  const mark = (name: string, t: number) => window.__director.frame >= 0 && once('mark:' + name, true, () => { marks.set(name, t); window.__director.mark(name); });
  const since = (name: string, t: number) => (marks.has(name) ? t - marks.get(name)! : -1);
  return { once, tap, mark, since, has: (n: string) => marks.has(n), reset: () => { fired.clear(); marks.clear(); } };
}

/** Keep the pointer grabbed like a player would: click back into the game when it is free and nothing is open. */
function relock(G: G): void {
  const inp = G.input, rooms = G.g.rooms;
  if (inp.locked || !inp.gameplay || G.ctx.state.menu || rooms.busy || rooms.stage || (inp.modals && inp.modals.length)) return;
  const ph = G.ctx.dev?.photo; if (typeof ph === 'function' && ph().active) return;
  click(G, 'down'); click(G, 'up');
}

/** Start the game's sound like the first click of a player would, wait until every sample is decoded. */
async function startSound(G: G): Promise<boolean> {
  window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  return until(() => { const e = G.ctx.dev?.sound as any; return !!e && e.bank.size >= 60; }, 120000);
}
/** Everything a gameplay segment does first: sound, the lock click, a clean chat log. */
async function common(G: G): Promise<void> {
  if (!(await startSound(G))) console.warn('[director] sound did not start (no capture for this segment)');
  click(G);   // grab the pointer (emulated lock)
}

/**
 * DEMO ONLY: the offline demo's purchase. «Да» posts /api/cityBuy exactly like the game; here the fake site answers
 * ok and takes the coins from the made-up hero (nothing ever reaches a server: dist-dev/game.html has no network).
 */
let buyPatched = false;
function fakeBuy(G: G): void {
  if (buyPatched) return; buyPatched = true;
  const A = G.ctx.actions, post0 = A.post.bind(A);
  A.post = async (p: string, b: any) => {
    if (p === '/api/cityBuy' || p === '/api/buymat') {
      const h = G.store.hero;
      if (h) G.store.setHero({ ...structuredClone(h), money: Math.max(0, (+h.money || 0) - (+b?.price || 0)) });
      return { ok: true, hero: G.store.hero };
    }
    return post0(p, b);
  };
}

/** World point (metres) of a building's door, `h` m above the ground at the walkable door point. */
function doorPoint(G: G, id: string, h = 1.15): [number, number, number] {
  const b = G.store.layout.buildings.find((x: any) => x.id === id);
  const hit = b.hit as number[];
  const zf = Math.min((hit[3] - 800) * 0.02, (b.door.y - 800) * 0.02) - 0.25;
  const y = G.g.world?.groundAt ? G.g.world.groundAt(b.door.x, b.door.y) : G.ctx.feet.y;
  return [b.door.x * 0.01, (Number.isFinite(y) ? y : G.ctx.feet.y) + h, zf];
}

/* ------------------------------------------------------------------ end card */
function installCard(t: number, a: number, b: number): void {
  const e = el('gp-end', 'card', `<h1>Legion 3D</h1><p>Ярмарка Легиона в 3D — расширение для Chrome</p>
    <p style="margin-top:34px;font:700 40px/1.2 'Golos Text',sans-serif;color:#ffe08a">github.com/ascorblack/legion-3d/releases/latest</p>
    <div class="keys"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> ходить</span><span><kbd>E</kbd> войти / купить / копать</span>
    <span><kbd>F</kbd> осмотреть</span><span><kbd>V</kbd> вид</span><span><kbd>F9</kbd> фото</span></div>`);
  e.style.opacity = String(env(t, a, b, 0.8, 0.01));
}
function chip(t: number, a: number, b: number): void {
  const e = el('gp-title', 'cap top', 'Legion 3D · как это играется');
  const o = env(t, a, b, 0.5, 0.6);
  e.style.opacity = String(o); e.style.transform = `translateX(-50%) translateY(${(1 - o) * -10}px)`;
}

/* ================================================================== 1. fair → Лавка */
const E = -Math.PI / 2;          // yaw facing east (+x)
const N = 0;                     // yaw facing north (−z, towards the street's buildings)
const T1 = makeTimeline();
let w1: ReturnType<typeof walker> | null = null;
let jumpDone = false;
// shop interior plan (computed when the room opens)
let shopIn: { w: ReturnType<typeof walker>; look: string; buy: string; exit: string; wOut: ReturnType<typeof walker> | null } | null = null;
const shopClicks = new Set<number>();
const W1_START = 4150, W1_DUR_SLACK = 0.4;
let w1End = 0;           // segment time when the street walk ends (the hero stands before the door)

const GP_FAIR: Segment = {
  id: 'gp-fair', cut: 'gameplay', dur: 37.6, xfade: 0.5,
  title: 'Spawn on the night fair (FP), cats chatting, V → TP, jump over a bench, up the stairs, V → FP, door outline of «Лавка», E → inside: F inspect, E buy → «Да», coins; leave through the door',
  narr: [
    { mark: 'go', off: 1.2, dur: 4.5, text: 'Вечер на ярмарке Легиона — а теперь прямо в 3D.' },
    { mark: 'shop-in', off: 0.9, dur: 3.6, text: 'Лавки — настоящие комнаты, товар на полках.' },
    { mark: 'bought', off: 2.2, dur: 4.5, text: 'Купил, монетки звякнули — всё как на сайте.' },
  ],
  async setup(G) {
    T1.reset(); jumpDone = false; shopIn = null; shopClicks.clear();
    mode(G, 'fp'); G.ctx.applyCamera?.(true);
    placeM(G, pxToM([W1_START, 1445]), E + 0.6);
    cam(G, E + 0.9, 0.05);
    // the street: east along the lower level, over the bench at (4800, 1290), up the stairs at x 4940–5120, back west
    // along the upper street to the door of «Лавка» (4775, 960)
    w1 = routed(G, [W1_START, 1445], [[4440, 1448], [4640, 1425], [4790, 1400], { to: [4796, 1205], direct: true }, [4930, 1170], [5035, 1135],
      { to: [5040, 1050], direct: true }, [4990, 1012], [4850, 1004], [4785, 1000]], 2.0, 1.0);
    // cats around: two chatting by the beds, one on the bench, others along the upper street
    clearAround(G, W1_START, 1445, 3.2);   // nobody standing in the camera at the start
    park(G, 0, 4270, 1360, -1.0); park(G, 1, 4365, 1320, 2.2);
    park(G, 2, 4700, 1255, 0.4); park(G, 3, 4930, 1260, -0.8);
    park(G, 4, 5120, 1000, 1.3); park(G, 5, 4600, 1010, -1.4); park(G, 6, 4470, 985, 2.9);
    park(G, 7, 4250, 1470, 0.2);
    fakeBuy(G);
    await common(G);
  },
  frame(G, t) {
    const S = T1, inShop = G.g.rooms.current === 'shop';
    S.mark('go', t);
    black(1 - smooth(t / 1.1));
    chip(t, 0.9, 4.2);
    relock(G);
    /* ---- street */
    if (!inShop && !S.has('shop-in')) {
      const WALK0 = 5.2;                                   // stand and look around first
      const wd = w1!.dur;
      w1End = WALK0 + wd + W1_DUR_SLACK;
      const u = t - WALK0;
      // where the walk is (for the camera and the V / jump keys)
      const head = w1!.heading(Math.max(0, u));
      const door = doorPoint(G, 'shop');
      const aD = aimTo(G, door);
      const tTP = WALK0 + 1.7, tFP = WALK0 + wd - 2.6, tAim = WALK0 + wd - 0.6;
      // look around while standing, then follow the walk; in TP keep a gentle side angle around the jump
      const yaw = t < WALK0 + 0.6
        ? keyed([[0, E + 0.9], [1.7, E + 0.3], [3.4, E + 1.3], [4.8, E + 0.6], [WALK0 + 0.6, head]], t, true)
        : t < tAim ? head + keyed([[WALK0 + 0.6, 0], [tTP, 0.15], [tTP + 1.5, 0.55], [tTP + 4.0, 0.5], [tFP - 0.5, 0.1], [tFP, 0]], t)
          : keyed([[tAim, head], [tAim + 0.9, aD[0]]], t, true);
      const pitch = t < WALK0 + 0.6 ? keyed([[0, 0.05], [1.6, 0.12], [3.2, 0.02], [WALK0 + 0.6, 0]], t)
        : t < tAim ? keyed([[WALK0 + 0.6, 0], [tTP, -0.1], [tTP + 1.5, -0.14], [tFP - 0.5, -0.1], [tFP, 0.02]], t)
          : keyed([[tAim, 0.02], [tAim + 0.9, aD[1]]], t);
      cam(G, wrap(yaw), pitch);
      w1!.drive(G, t, yaw, WALK0);
      // cats along the way talk (chat panel + bubbles)
      S.once('say0', t >= 1.3, () => say(G, 1, 'добрый вечер, ярмарка! 🌙'));
      S.once('say1', t >= 3.6, () => say(G, 0, 'кто сегодня в шахту?'));
      S.once('say2', S.has('jump') && t >= 9.0, () => say(G, 3, 'опа, прыгун! 😺'));
      S.once('tp', t >= tTP, () => S.mark('tp', t));
      S.tap('KeyV', t, tTP);                              // third person for the jump
      S.tap('KeyV', t, tFP);                              // back to first person before the door
      // jump: Space ~0.45 m before the bench (bench at y ≈ 1290 → z 9.8; we walk north = decreasing z)
      const f = G.ctx.feet;
      if (!jumpDone && u > 0 && f.z <= 0.02 * (1322 - 800) && f.z > 0.02 * (1290 - 800)) {
        jumpDone = true; key('keydown', 'Space'); S.mark('jump', t);
      }
      if (jumpDone) S.once('space-up', true, () => setTimeout(() => key('keyup', 'Space'), 120));
      // the door: aimed (outline + prompt), E
      const tE = tAim + 2.0;
      S.once('door-aim', t >= tAim + 0.9, () => S.mark('door-aim', t));
      S.tap('KeyE', t, tE);
      S.once('door-e', t >= tE, () => S.mark('door-e', t));
      return;
    }
    /* ---- inside «Лавка» */
    S.mark('shop-in', t);
    const u = S.since('shop-in', t);
    if (!shopIn && inShop) shopIn = planShop(G);
    if (!shopIn) return;
    const P = shopIn, sp = G.g.rooms.scene?.spawn || { x: 0, z: 0, face: 0 };
    const pt = (id: string): [number, number, number] | null => { const it = inters.get(id); return it ? hitCentre(it) : null; };
    const aimAt = (id: string, fb: V2): V2 => { const c = pt(id); return c ? aimTo(G, c) : fb; };
    const walkYaw = P.w.heading(Math.max(0, u - 0.4));
    const aL = aimAt(P.look, [walkYaw, 0]), aB = aimAt(P.buy, aL), aX = aimAt(P.exit, [sp.face + Math.PI, 0]);
    // timeline (s after entering)
    const tW = 0.4, tWE = tW + P.w.dur;               // walk to the shelves
    const tF = tWE + 0.9;                              // F «Осмотреть»
    const tEsc = tF + 3.4;                             // close the card
    const tB = tEsc + 1.4;                             // aim at the next good, E → «Купить «X» за Y?»
    const tYes = tB + 2.0;                             // click «Да»
    const tTurn = tYes + 3.4;                          // a look at the next shelf, then turn to the door, walk, E
    const tOutE = tTurn + 0.6 + (P.wOut ? P.wOut.dur : 0) + 0.9;
    const yaw = keyed([[0, sp.face + 0.5], [1.4, walkYaw], [tWE - 0.6, walkYaw], [tWE + 0.2, aL[0]], [tEsc + 0.2, aL[0]], [tEsc + 1.1, aB[0]], [tYes + 0.6, aB[0]], [tYes + 2.0, aB[0] - 0.55], [tTurn - 0.3, aB[0] - 0.5],
      [tTurn + 1.1, P.wOut ? P.wOut.heading(0.6) : aX[0]], [tOutE - 1.0, P.wOut ? P.wOut.heading(P.wOut.dur) : aX[0]], [tOutE - 0.3, aX[0]]], u, true);
    const pitch = keyed([[0, 0.02], [1.4, -0.02], [tWE - 0.6, -0.02], [tWE + 0.2, aL[1]], [tEsc + 0.2, aL[1]], [tEsc + 1.1, aB[1]], [tYes + 0.6, aB[1]], [tYes + 2.0, aB[1] + 0.12], [tTurn - 0.3, aB[1] + 0.1],
      [tTurn + 1.1, -0.04], [tOutE - 1.0, -0.02], [tOutE - 0.3, aX[1]]], u);
    cam(G, wrap(yaw), pitch);
    if (u < tTurn) P.w.drive(G, u, yaw, tW); else if (P.wOut) P.wOut.drive(G, u, yaw, tTurn + 0.6);
    S.tap('KeyF', u, tF, 0.1, 's'); S.once('m-look', u >= tF, () => S.mark('inspect', t));
    S.tap('Escape', u, tEsc, 0.1, 's');
    S.tap('KeyE', u, tB, 0.1, 's'); S.once('m-ask', u >= tB, () => S.mark('ask', t));
    const ck: CursorKey[] = [{ t: tB + 0.35, at: [0.56, 0.62] }, { t: tYes, at: '[data-yes]', click: true }, { t: tYes + 0.5, at: '[data-yes]' }];
    if (u >= tB - 0.3 && u <= tYes + 1.2) cursor(u, ck, shopClicks);
    else if (u > tYes + 1.2) cursor(u, ck, shopClicks);   // fades out
    S.once('m-yes', u >= tYes, () => S.mark('bought', t));
    S.tap('KeyE', u, tOutE, 0.1, 'out'); S.once('m-out', u >= tOutE, () => S.mark('leave', t));
  },
};

/** Shop plan: the first good to inspect (in front of the spawn), a coin good next to it to buy, the exit door. */
function planShop(G: G): typeof shopIn {
  const sp = G.g.rooms.scene.spawn;
  const goods = [...inters.values()].filter((i) => /^room:good:/.test(i.id) && hitCentre(i));
  if (!goods.length) { console.warn('[director] no goods in the shop'); return null; }
  const d = (i: any) => { const c = hitCentre(i)!; return Math.hypot(c[0] - sp.x, c[2] - sp.z); };
  const hero = G.store.hero;
  const affordable = (i: any) => { const m = /—\s*(.*)$/.exec(i.label || ''); void m; return /^Купить:/.test(i.label || '') && (+hero?.money || 0) > 0; };
  // a good 3–6 m away that is at eye/hand height, with a coin good within 1.6 m of it
  const cand = goods.filter((i) => { const c = hitCentre(i)!; return d(i) > 2.2 && d(i) < 7 && c[1] > 0.6 && c[1] < 1.7; }).sort((a, b) => d(a) - d(b));
  let look: any = null, buy: any = null;
  for (const a of cand) {
    const ca = hitCentre(a)!;
    const near = goods.filter((b) => b !== a && affordable(b)).map((b) => ({ b, dd: Math.hypot(hitCentre(b)![0] - ca[0], hitCentre(b)![2] - ca[2]) }))
      .filter((x) => x.dd > 0.35 && x.dd < 1.6 && hitCentre(x.b)![1] > 0.5 && hitCentre(x.b)![1] < 1.7).sort((p, q) => p.dd - q.dd);
    if (near.length) { look = a; buy = near[0].b; break; }
  }
  if (!look) { look = cand[0] || goods[0]; buy = goods.find((b) => b !== look && affordable(b)) || look; }
  const c = hitCentre(look)!, cb = hitCentre(buy)!;
  const mid: V2 = [(c[0] + cb[0]) / 2, (c[2] + cb[2]) / 2];
  const dir: V2 = [mid[0] - sp.x, mid[1] - sp.z], L = Math.hypot(dir[0], dir[1]) || 1;
  let stop: V2 = [mid[0] - dir[0] / L * 1.25, mid[1] - dir[1] / L * 1.25];
  const route = planPath(G, [sp.x, sp.z], stop) || [[sp.x, sp.z], stop];
  stop = route[route.length - 1];
  const w = walker(route.map((p) => [p[0] / 0.01, p[1] / 0.02 + 800] as V2), 1.25, 0.9);
  // the way out: back to ~1.3 m in front of the exit door
  const ex = [...inters.values()].find((i) => i.id === 'room:exit');
  let wOut: ReturnType<typeof walker> | null = null;
  if (ex) {
    const ce = hitCentre(ex)!;
    const dd: V2 = [stop[0] - ce[0], stop[1] - ce[2]], l2 = Math.hypot(dd[0], dd[1]) || 1;
    const front: V2 = [ce[0] + dd[0] / l2 * 1.3, ce[2] + dd[1] / l2 * 1.3];
    const r2 = planPath(G, stop, front) || [stop, front];
    if (new Spline(r2).length > 0.4) wOut = walker(r2.map((p) => [p[0] / 0.01, p[1] / 0.02 + 800] as V2), 1.4, 0.8);
  }
  console.log('[director] shop plan', look.id, '→ buy', buy.id, 'exit', !!ex, 'walk', w.dur.toFixed(2), 'out', wOut ? wOut.dur.toFixed(2) : '-');
  return { w, look: look.id, buy: buy.id, exit: 'room:exit', wOut };
}

/* ================================================================== 1b. out of the shop: chat, down the stairs */
const T1B = makeTimeline();
let wB1: ReturnType<typeof walker> | null = null, wB2: ReturnType<typeof walker> | null = null;
const CHAT_LINE = 'кто со мной в шахту?';
const GP_WALK: Segment = {
  id: 'gp-walk', cut: 'gameplay', dur: 13.5, xfade: 0.6,
  title: 'Out of «Лавка»: a few steps, Enter → type in the chat → own bubble, a cat answers; V → TP, run down the stairs towards the mine',
  narr: [{ mark: 'sent', off: 0.7, dur: 4.0, text: 'Чат прямо в игре — сообщение висит пузырём над головой.' }],
  async setup(G) {
    T1B.reset();
    mode(G, 'fp'); G.ctx.applyCamera?.(true);
    placeM(G, pxToM([4775, 985]), Math.PI);
    wB1 = routed(G, [4775, 985], [[4700, 1020], [4560, 1040]], 1.6, 0.9);
    wB2 = routed(G, [4560, 1040], [[4520, 1060], { to: [4505, 1150], direct: true }, [4380, 1230], [4150, 1300], [3900, 1330]], 2.3, 0.9);
    cam(G, Math.PI, 0.02);
    clearAround(G, 4775, 985, 2.5);
    park(G, 0, 4470, 1000, -1.4); park(G, 1, 4620, 1075, 1.2); park(G, 2, 4300, 1250, 2.0);
    await common(G);
  },
  frame(G, t) {
    const S = T1B;
    S.mark('go', t);
    black(1 - smooth(t / 0.6));
    relock(G);
    // V to third person first (your own bubble shows over your head), then type, send, run on
    const tTP = 2.8, tType = 3.7, tSend = tType + 2.1, tW2 = tSend + 1.3;
    const h1 = wB1!.heading(t - 0.3), h2 = wB2!.heading(Math.max(0, t - tW2));
    // TP: the camera swings round to the hero's side so the bubble and the face are in shot while typing
    const yaw = t < tW2 ? keyed([[0, Math.PI], [1.0, h1], [tTP, h1 + 0.2], [tType + 0.4, h1 + 2.3], [tSend + 1.0, h1 + 2.4], [tW2, h2]], t, true)
      : keyed([[tW2, h2], [tW2 + 1.5, h2 + 0.35], [13.5, h2 + 0.25]], t, true);
    const pitch = keyed([[0, 0.02], [tTP, -0.02], [tType + 0.4, -0.1], [tSend + 1.0, -0.1], [tW2, -0.12], [tW2 + 1.5, -0.16], [13.5, -0.14]], t);
    cam(G, wrap(yaw), pitch);
    if (t < tW2) wB1!.drive(G, t, yaw, 0.3); else wB2!.drive(G, t, yaw, tW2);
    // chat: Enter opens the input, the line is typed letter by letter, Enter sends (own bubble + the chat panel)
    S.tap('Enter', t, tType); S.once('m-chat', t >= tType, () => S.mark('chat', t));
    const inp = t >= tType + 0.2 && t < tSend + 0.1 ? (qsDeep('.chat label.in input') as HTMLInputElement | null) : null;
    if (inp) {
      const n = Math.min(CHAT_LINE.length, Math.floor((t - tType - 0.25) / 1.6 * CHAT_LINE.length));
      const want = [...CHAT_LINE].slice(0, Math.max(0, n)).join('');
      if (inp.value !== want) { inp.value = want; inp.dispatchEvent(new Event('input', { bubbles: true })); }
    }
    S.once('send', t >= tSend, () => {
      const i = qsDeep('.chat label.in input') as HTMLInputElement | null;
      if (i) { i.value = CHAT_LINE; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })); }
      S.mark('sent', t);
    });
    S.once('reply', t >= tSend + 1.3, () => say(G, 0, 'я! уже бегу 🏃'));
    S.tap('KeyV', t, tTP);
  },
};
/** querySelector through open shadow roots (the HUD lives in one). */
function qsDeep(sel: string): Element | null {
  const walk = (r: Document | ShadowRoot): Element | null => {
    const e = r.querySelector(sel); if (e) return e;
    for (const x of r.querySelectorAll('*')) if (x.shadowRoot) { const f = walk(x.shadowRoot); if (f) return f; }
    return null;
  };
  return walk(document);
}

/* ================================================================== 2. the mine */
const T2 = makeTimeline();
let w2: ReturnType<typeof walker> | null = null;
let mineIn: { w: ReturnType<typeof walker>; stone: string } | null = null;
const M_START: V2 = [1900, 1440];
const GP_MINE: Segment = {
  id: 'gp-mine', cut: 'gameplay', dur: 24.5, xfade: 0.6,
  title: 'Walk to the mine portal (outline), E → the 3D mine; walk between stones, aim, E: pickaxe swings, the stone breaks («+N»); L journal, L closes',
  narr: [
    { mark: 'mine-in', off: 1.0, dur: 4.5, text: 'Подходишь к камню, жмёшь E — кирка сама стучит.' },
    { mark: 'journal', off: 0.5, dur: 4.0, text: 'В журнале — что накопал и сколько заработал.' },
  ],
  async setup(G) {
    T2.reset(); mineIn = null;
    mode(G, 'fp'); G.ctx.applyCamera?.(true);
    enableMine(G, 2.6);
    placeM(G, pxToM(M_START), E - 1.2);
    w2 = routed(G, M_START, [[1720, 1440], [1560, 1430], [1400, 1410], [1322, 1402]], 1.9, 1.0);
    cam(G, w2.heading(0), 0.02);
    clearAround(G, M_START[0], M_START[1], 3);
    park(G, 0, 1500, 1460, 1.2); park(G, 1, 1180, 1430, -1.8); park(G, 2, 1880, 1410, 2.0);
    await common(G);
  },
  frame(G, t) {
    const S = T2, inMine = G.g.rooms.current === 'mine';
    S.mark('go', t);
    black(1 - smooth(t / 0.7));
    relock(G);
    if (!S.has('mine-in')) {
      const wd = w2!.dur, door = doorPoint(G, 'mine', 1.1), aD = aimTo(G, door);
      const tAim = 0.2 + wd - 0.7, tE = tAim + 1.9;
      const head = w2!.heading(Math.max(0, t - 0.2));
      const yaw = t < tAim ? head + keyed([[0, 0.25], [1.6, -0.3], [tAim, 0]], t) : keyed([[tAim, head], [tAim + 0.9, aD[0]]], t, true);
      const pitch = t < tAim ? keyed([[0, 0.02], [1.6, -0.04], [tAim, 0.0]], t) : keyed([[tAim, 0], [tAim + 0.9, aD[1]]], t);
      cam(G, wrap(yaw), pitch);
      w2!.drive(G, t, yaw, 0.2);
      S.once('door-aim', t >= tAim + 0.9, () => S.mark('door-aim', t));
      S.tap('KeyE', t, tE); S.once('door-e', t >= tE, () => S.mark('door-e', t));
      if (!inMine) return;
    }
    S.mark('mine-in', t);
    const u = S.since('mine-in', t);
    if (!mineIn && inMine) mineIn = planMine(G);
    if (!mineIn) return;
    const P = mineIn, sp = G.g.rooms.scene?.spawn || { x: 0, z: 0, face: 0 };
    const it = inters.get(P.stone), c = it && hitCentre(it);
    const a: V2 = c ? aimTo(G, c) : [sp.face, -0.1];
    const tW = 0.5, tA = tW + P.w.dur - 0.5, tDig = tW + P.w.dur + 0.8;
    const head = P.w.heading(Math.max(0, u - tW));
    const tb0 = S.since('break', t), lookA = tb0 >= 6.9 ? keyed([[6.9, 0], [8.2, 0.75], [9.6, -0.5]], tb0) : 0;
    const yaw = keyed([[0, sp.face], [1.0, head + 0.35], [2.2, head - 0.3], [tA, a[0]], [60, a[0]]], u, true) + lookA;
    const pitch = keyed([[0, 0.0], [1.0, 0.08], [2.2, 0.02], [tA, a[1] + 0.08], [tDig + 3, a[1] + 0.12]], u);
    cam(G, wrap(yaw), pitch);
    P.w.drive(G, u, yaw, tW);
    S.tap('KeyE', u, tDig, 0.12, 'dig'); S.once('m-dig', u >= tDig, () => S.mark('dig', t));
    // the stone broke: its interactable is gone or disabled
    const gone = !it || (typeof it.enabled === 'function' && !it.enabled()) || ![...inters.keys()].includes(P.stone);
    if (u > tDig + 0.5 && gone) S.mark('break', t);
    const tb = S.since('break', t);
    if (tb >= 0) {
      S.tap('KeyL', tb, 2.0, 0.1, 'jr'); S.once('m-jr', tb >= 2.0, () => S.mark('journal', t));
      S.tap('KeyL', tb, 6.6, 0.1, 'jr2');
    }
  },
};

function planMine(G: G): typeof mineIn {
  const sp = G.g.rooms.scene.spawn;
  const stones = [...inters.values()].filter((i) => /^mine:stone:/.test(i.id) && hitCentre(i) && (!i.enabled || i.enabled()));
  const d = (i: any) => { const c = hitCentre(i)!; return Math.hypot(c[0] - sp.x, c[2] - sp.z); };
  stones.sort((a, b) => d(a) - d(b));
  for (const st of stones.slice(0, 10)) {
    const c = hitCentre(st)!;
    const dir = [c[0] - sp.x, c[2] - sp.z], L = Math.hypot(dir[0], dir[1]) || 1;
    for (const back of [1.9, 1.6, 2.3]) {
      const pts = planPath(G, [sp.x, sp.z], [c[0] - dir[0] / L * back, c[2] - dir[1] / L * back]);
      if (!pts) continue;
      let p2 = pts;
      const full = new Spline(pts);
      if (full.length > 7) { const s0 = full.at(full.length - 6.5); placeM(G, s0); p2 = planPath(G, s0, pts[pts.length - 1]) || [s0, pts[pts.length - 1]]; }
      console.log('[director] mine plan stone', st.id, 'walk', new Spline(p2).length.toFixed(2), 'm');
      return { w: walker(p2.map((p) => [p[0] / 0.01, p[1] / 0.02 + 800] as V2), 1.45, 0.9), stone: st.id };
    }
  }
  console.warn('[director] no reachable stone');
  return null;
}

/* ================================================================== 3. fun (only when the features exist) */
const T3 = makeTimeline();
// (gp-fun) — see below
const hasCombat = (G: G) => !!G.ctx?.dev?.combat;
const hasPhoto = (G: G) => typeof G.ctx?.dev?.photo === 'function';
const FUN_AT: V2 = [3480, 1010], CAT_AT: V2 = [3625, 1004];
const GP_FUN: Segment = {
  id: 'gp-fun', cut: 'gameplay', dur: 12, xfade: 0.5,
  title: 'Fun: knock a cat over with a melee weapon (combat, ragdoll), then F9 photo mode, Enter snaps, Esc back',
  requires: (G) => (hasCombat(G) || hasPhoto(G) ? null : 'combat and photo mode are not in this build'),
  narr: [],
  async setup(G) {
    T3.reset();
    mode(G, 'tp'); G.ctx.applyCamera?.(true);
    placeM(G, pxToM(FUN_AT), E);
    cam(G, E + 0.3, -0.1);
    park(G, 0, CAT_AT[0], CAT_AT[1], Math.PI / 2); park(G, 1, 3700, 960, 2.4); park(G, 2, 3400, 1045, -0.6);
    // a melee weapon from the made-up hero's bag (the swing reads best on camera); equipped before the shot starts
    const sys = G.ctx.dev?.combat as any;
    if (sys) {
      for (const it of (G.store.hero?.items || []).filter((x: any) => x.slot === 'weapon')) {
        if (['slash', 'smash', 'thrust'].includes(sys.kind())) break;
        try { await G.ctx.actions.equip(it.uid); await until(() => false, 400); } catch { /* */ }
      }
      console.log('[director] combat attack kind', sys.kind());
    }
    const L: any[] = []; (window as any).__vCombat = L;
    window.addEventListener('l3d:combat', (e: any) => L.push([+(performance.now() / 1000).toFixed(3), e.detail?.kind]));
    await common(G);
  },
  frame(G, t) {
    const S = T3;
    S.mark('go', t);
    black(1 - smooth(t / 0.5));
    relock(G);
    const f = G.ctx.feet, cat = pxToM(CAT_AT), aY = yawTo([f.x, f.z], cat);
    const ph = hasPhoto(G);
    cam(G, keyed([[0, E + 0.3], [1.6, aY + 0.55], [5.5, aY + 0.6], [7, aY + 0.7]], t, true), keyed([[0, -0.1], [2, -0.13], [6, -0.1]], t));
    const w = funWalk || (funWalk = walker([FUN_AT, [3535, 1007], [3560, 1006]], 1.3, 0.6));
    w.drive(G, t, G.rig.yaw, 0.4);
    const sys = G.ctx.dev?.combat as any;
    if (sys) {
      const bow = sys.kind() === 'bow';
      S.once('hit1', t >= 2.5, () => { click(G, 'down'); S.mark('hit', t); });
      S.once('hit1u', t >= (bow ? 3.5 : 2.62), () => click(G, 'up'));
      if (!bow) { S.once('hit2', t >= 3.6, () => click(G, 'down')); S.once('hit2u', t >= 3.72, () => click(G, 'up')); }
    }
    if (ph) {
      S.tap('F9', t, 6.0); S.once('m-ph', t >= 6.0, () => S.mark('photo', t));
      S.tap('Enter', t, 8.4); S.tap('Escape', t, 10.4);
    }
  },
};
let funWalk: ReturnType<typeof walker> | null = null;

/* ================================================================== 4. end card */
const T4 = makeTimeline();
const GP_END: Segment = {
  id: 'gp-end', cut: 'gameplay', dur: 7, title: 'End card: install link over the fair at night',
  narr: [{ mark: 'go', off: 0.8, dur: 4.5, text: 'Ставь Legion 3D — ссылка на экране. Увидимся на ярмарке!' }],
  async setup(G) {
    T4.reset();
    mode(G, 'tp'); G.ctx.applyCamera?.(true);
    placeM(G, pxToM([4700, 1020]), N);
    cam(G, 0.25, 0.04);
    await common(G);
  },
  frame(G, t) {
    T4.mark('go', t);
    cam(G, keyed([[0, 0.3], [7, -0.2]], t, true), keyed([[0, 0.03], [7, 0.1]], t));
    installCard(t, 0.4, 7.2);
    uiOpacity(G, 1 - smooth((t - 0.2) / 0.8));
    void caption;
  },
};

export const GAMEPLAY: Segment[] = [GP_FAIR, GP_WALK, GP_MINE, GP_FUN, GP_END];
void FPS;
