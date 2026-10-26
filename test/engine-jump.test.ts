import { describe, it, expect } from 'vitest';
import type { CityLayout } from '../src/contracts';
import { createPlayerController, type WalkSpace } from '../src/engine/player';
import { SZ } from '../src/world/coords';

/**
 * Test city (px): open field x 0..4000, depth 800..2000.
 *  - bench   x 1950..2050, y 1300..1325 (0.5 m deep): grid-blocked, solidTop 0.5
 *  - crate   x 2950..3050, y 1300..1350 (1 m × 1 m): grid-blocked, solidTop 0.6
 *  - wall    x 950..1050,  y 1300..1325: grid-blocked, solidTop Infinity
 *  - ledge   (like the fair city): upper street y < 1600 at 0 m, grid gap 1600..1660 (wall face at 1630),
 *            lower street y > 1660 at −1.4 m; no stairs in this test
 */
const BENCH = [1950, 1300, 2050, 1325, 0.5] as const;
const CRATE = [2950, 1300, 3050, 1350, 0.6] as const;
const WALL = [950, 1300, 1050, 1325, Infinity] as const;
const SOLIDS = [BENCH, CRATE, WALL];
const LEDGE = { y0: 1600, face: 1630, y1: 1660, low: -1.4 };
const inBox = (x: number, y: number, b: readonly number[]) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

function city(): { layout: CityLayout; groundAt: (x: number, y: number) => number; solidTop: (x: number, y: number) => number } {
  const free = (x: number, y: number) => {
    if (x < 0 || x > 4000 || y < 800 || y > 2000) return false;
    if (y >= LEDGE.y0 && y <= LEDGE.y1) return false;
    for (const b of SOLIDS) if (inBox(x, y, b)) return false;
    return true;
  };
  const groundAt = (_x: number, y: number) => (y < LEDGE.face ? 0 : LEDGE.low);
  const solidTop = (x: number, y: number) => {
    if (x < 0 || x > 4000 || y < 800 || y > 2000) return Infinity;   // city walls
    for (const b of SOLIDS) if (inBox(x, y, b)) return b[4];
    return -Infinity;
  };
  const layout: CityLayout = {
    id: 't', styleId: 'cats', W: 4000, H: 2000, QW: 0, area: { x0: 0, x1: 4000, y0: 800, y1: 2000 },
    obstacles: [], buildings: [], free, nearest: (x, y) => [x, y],
  };
  return { layout, groundAt, solidTop };
}

const DT = 1 / 60;
const inp = (x: number, y: number, jump = false) => ({ move: { x, y }, run: false, jump }) as any;
/** yaw 0: W goes to −Z = smaller y; yaw π: W goes to +y (towards the lower street). */
const TO_PLUS_Y = Math.PI, TO_MINUS_Y = 0;

function mk(opts = {}) {
  const c = city();
  const p = createPlayerController(c.layout, c.groundAt, { solidTop: c.solidTop, ...opts });
  return { p, c };
}
function frames(p: ReturnType<typeof mk>['p'], input: any, yaw: number, secs: number, each?: () => void) {
  for (let t = 0; t < secs - 1e-9; t += DT) { p.update(DT, input, yaw); each?.(); }
}
/** Walk towards +y and press Space once when the feet reach depth `at`. */
function runAndJumpAt(p: ReturnType<typeof mk>['p'], at: number, yaw: number, secs: number, each?: () => void) {
  let jumped = false;
  for (let t = 0; t < secs - 1e-9; t += DT) {
    const go = !jumped && (yaw === TO_PLUS_Y ? p.y >= at : p.y <= at);
    if (go) jumped = true;
    p.update(DT, inp(0, 1, go), yaw);
    each?.();
  }
}

describe('jump: physics', () => {
  it('apex ≈ 1.0 m, frame-rate independent; airborne / vy / feetY are exposed', () => {
    for (const dt of [1 / 30, 1 / 60, 1 / 144, 0.1]) {
      const { p } = mk();
      p.teleport(2000, 1000);
      let top = 0, airSeen = false;
      p.update(dt, inp(0, 0, true), 0);
      for (let t = 0; t < 2; t += dt) {
        p.update(dt, inp(0, 0), 0);
        top = Math.max(top, p.feetY);
        if (p.airborne) { airSeen = true; expect(Number.isFinite(p.vy)).toBe(true); }
      }
      expect(airSeen).toBe(true);
      expect(top).toBeGreaterThan(0.9);
      expect(top).toBeLessThanOrEqual(1.0001);
      expect(p.airborne).toBe(false);
      expect(p.feetY).toBe(0);
    }
  });

  it('fires onJump once and onLand with impact speed and fall height', () => {
    const { p } = mk();
    p.teleport(2000, 1000);
    const jumps: number[] = [], lands: [number, number][] = [];
    p.onJump((v) => jumps.push(v));
    const off = p.onLand((i, f) => lands.push([i, f]));
    p.jump();
    frames(p, inp(0, 0), 0, 1.5);
    expect(jumps.length).toBe(1);
    expect(jumps[0]).toBeCloseTo(Math.sqrt(2 * 14 * 1.0), 3);
    expect(lands.length).toBe(1);
    expect(lands[0][0]).toBeGreaterThan(4);
    expect(lands[0][1]).toBeCloseTo(1.0, 1);
    off();
    p.jump(); frames(p, inp(0, 0), 0, 1.5);
    expect(lands.length).toBe(1);
  });

  it('jump buffer: a press shortly before landing jumps again; an early press does not', () => {
    const { p } = mk();
    p.teleport(2000, 1000);
    let n = 0; p.onJump(() => n++);
    p.jump();
    // airtime ≈ 0.756 s: press 0.08 s before touching down
    frames(p, inp(0, 0), 0, 0.756 - 0.08);
    p.update(DT, inp(0, 0, true), 0);
    frames(p, inp(0, 0), 0, 0.3);
    expect(n).toBe(2);
    // a press 0.4 s before landing is forgotten
    const q = mk().p; q.teleport(2000, 1000);
    let m = 0; q.onJump(() => m++);
    q.jump(); frames(q, inp(0, 0), 0, 0.3);
    q.update(DT, inp(0, 0, true), 0);
    frames(q, inp(0, 0), 0, 1.5);
    expect(m).toBe(1);
  });

  it('holding Space does not auto-repeat (needs a new press)', () => {
    const { p } = mk();
    p.teleport(2000, 1000);
    let n = 0; p.onJump(() => n++);
    frames(p, inp(0, 0, true), 0, 2);
    expect(n).toBe(1);
  });

  it('air control is limited: a jump from standing covers less ground than walking', () => {
    const a = mk().p; a.teleport(2000, 1000);
    a.update(DT, inp(0, 0, true), TO_PLUS_Y);
    frames(a, inp(0, 1), TO_PLUS_Y, 0.5);
    const b = mk().p; b.teleport(2000, 1000);
    frames(b, inp(0, 1), TO_PLUS_Y, 0.5);
    expect((a.y - 1000) * SZ).toBeGreaterThan(0.1);
    expect((a.y - 1000)).toBeLessThan((b.y - 1000) * 0.8);
  });
});

describe('jump: obstacles (solidTop)', () => {
  it('walking into a bench is blocked; jumping over its footprint works and lands beyond', () => {
    const { p, c } = mk();
    p.teleport(2000, 1200);
    frames(p, inp(0, 1), TO_PLUS_Y, 2);
    expect(p.y).toBeLessThan(BENCH[1]);              // stopped in front of it
    expect(p.feetY).toBe(0);
    // back off 0.6 m, then run up and jump
    p.teleport(2000, 1240);
    let overMin = Infinity;   // lowest feet height while above the bench footprint
    runAndJumpAt(p, 1280, TO_PLUS_Y, 2, () => { if (!c.layout.free(p.x, p.y)) overMin = Math.min(overMin, p.feetY); });
    expect(overMin).toBeGreaterThan(BENCH[4] - 0.1);
    expect(p.y).toBeGreaterThan(BENCH[3]);           // beyond the bench
    expect(p.airborne).toBe(false);
    expect(p.feetY).toBe(0);
  });

  it('jumps onto a crate, stands on it, then walks off and falls back to the ground', () => {
    const { p } = mk();
    p.teleport(3000, 1280);
    let landed = 0; p.onLand(() => landed++);
    // jump straight up next to the crate while pushing into it
    runAndJumpAt(p, 1280, TO_PLUS_Y, 0.3);
    frames(p, inp(0, 0), TO_PLUS_Y, 1);
    expect(p.y).toBeGreaterThan(CRATE[1]);
    expect(p.y).toBeLessThan(CRATE[3]);
    expect(p.feetY).toBeCloseTo(0.6, 5);
    expect(p.ground).toBeCloseTo(0.6, 5);
    expect(p.airborne).toBe(false);
    expect(landed).toBe(1);
    // stand still: stays on top
    frames(p, inp(0, 0), 0, 1);
    expect(p.feetY).toBeCloseTo(0.6, 5);
    // walk along x off the crate's side
    let wasAir = false;
    frames(p, inp(1, 0), 0, 1.5, () => { if (p.airborne) wasAir = true; });
    expect(p.x).toBeGreaterThan(CRATE[2]);
    expect(wasAir).toBe(true);
    expect(p.feetY).toBe(0);
    expect(landed).toBe(2);
  });

  it('coyote time: a press just after walking off the crate still jumps', () => {
    const { p } = mk();
    p.teleport(3000, 1280);
    runAndJumpAt(p, 1280, TO_PLUS_Y, 0.3); frames(p, inp(0, 0), 0, 1);
    expect(p.feetY).toBeCloseTo(0.6, 5);
    let n = 0; p.onJump(() => n++);
    let leftAt = -1;
    for (let i = 0; i < 120; i++) {
      p.update(DT, inp(1, 0, leftAt >= 0 && i - leftAt === 3), 0);   // press 3 frames (0.05 s) after the fall began
      if (leftAt < 0 && p.airborne) leftAt = i;
    }
    expect(n).toBe(1);
  });

  it('a wall (solidTop = Infinity) blocks even at the top of a jump', () => {
    const { p } = mk();
    p.teleport(1000, 1200);
    runAndJumpAt(p, 1280, TO_PLUS_Y, 2);
    expect(p.y).toBeLessThan(WALL[1]);
    // and from the side, mid-air
    const q = mk().p; q.teleport(900, 1310);
    q.update(DT, inp(0, 0, true), 0);
    frames(q, inp(1, 0), 0, 1.5);
    expect(q.x).toBeLessThan(WALL[0]);
  });

  it('walking up to the ledge gap stops; a jump crosses it and falls to the lower street', () => {
    const { p } = mk();
    p.teleport(2500, 1500);
    frames(p, inp(0, 1), TO_PLUS_Y, 2);
    expect(p.y).toBeLessThan(LEDGE.y0);              // the grid gap stops a walking player
    expect(p.feetY).toBe(0);
    let falls = 0, lands: number[] = [];
    p.onLand((_i, f) => { falls++; lands.push(f); });
    runAndJumpAt(p, 1500, TO_PLUS_Y, 2.5);
    expect(p.y).toBeGreaterThan(LEDGE.face);
    expect(p.feetY).toBeCloseTo(LEDGE.low, 5);
    expect(p.airborne).toBe(false);
    expect(falls).toBe(1);
    expect(lands[0]).toBeGreaterThan(1.4);           // apex + the drop
  });

  it('cannot climb up from the lower street (walking or jumping)', () => {
    const { p } = mk();
    p.teleport(2500, 1800);
    expect(p.feetY).toBeCloseTo(LEDGE.low, 5);
    frames(p, inp(0, 1), TO_MINUS_Y, 3);
    expect(p.y).toBeGreaterThan(LEDGE.face);
    for (let k = 0; k < 5; k++) runAndJumpAt(p, 99999, TO_MINUS_Y, 1);   // jump repeatedly into the wall
    for (let k = 0; k < 5; k++) { p.jump(); frames(p, inp(0, 1), TO_MINUS_Y, 1); }
    expect(p.y).toBeGreaterThan(LEDGE.face);
    expect(p.feetY).toBeCloseTo(LEDGE.low, 5);
  });

  it('cannot jump out of the map over a long grid gap', () => {
    // a long gap with nothing solid (no solidTop = Infinity) beyond y 1900
    const c = city();
    const free = (x: number, y: number) => c.layout.free(x, y) && y < 1900;
    const top = (x: number, y: number) => (y > 1900 && y < 2600 ? -Infinity : c.solidTop(x, y));
    const p = createPlayerController({ ...c.layout, free }, () => -1.4, { solidTop: top });
    p.teleport(2500, 1880);
    for (let k = 0; k < 6; k++) { p.jump(); frames(p, inp(0, 1), TO_PLUS_Y, 0.9); }
    expect((p.y - 1900) * SZ).toBeLessThan(2.6);   // VOID_RUN from the last walkable point
    // and never stuck there: walking back reaches the walk grid again
    frames(p, inp(0, 1), TO_MINUS_Y, 3);
    expect(free(p.x, p.y)).toBe(true);
  });

  it('without solidTop the old behaviour holds: blocked cells are walls even mid-jump', () => {
    const c = city();
    const p = createPlayerController(c.layout, c.groundAt);
    p.teleport(2000, 1200);
    runAndJumpAt(p, 1280, TO_PLUS_Y, 2);
    expect(p.y).toBeLessThan(BENCH[1]);
  });
});

describe('player spaces', () => {
  it('setSpace switches to a room in metres and back to the city in px', () => {
    const { p, c } = mk();
    p.teleport(2000, 1000);
    // a 6 × 4 m room with a 0.9 m counter at x 2..4, z 1..1.5
    const room: WalkSpace = {
      free: (x, z) => x > 0 && x < 6 && z > 0 && z < 4 && !(x >= 2 && x <= 4 && z >= 1 && z <= 1.5),
      groundAt: () => 0,
      solidTop: (x, z) => (x <= 0 || x >= 6 || z <= 0 || z >= 4 ? Infinity : x >= 2 && x <= 4 && z >= 1 && z <= 1.5 ? 0.9 : -Infinity),
    };
    p.setSpace(room, 'm', { x: 3, y: 3, face: 0 });
    expect(p.units).toBe('m');
    const f = p.feet({ x: 0, y: 0, z: 0 });
    expect(f).toEqual({ x: 3, y: 0, z: 3 });
    // walk 1 s forward (−z): 2.3 m/s, but the counter at z 1.5 stops us
    frames(p, inp(0, 1), 0, 2);
    expect(p.y).toBeGreaterThan(1.5);
    expect(p.y).toBeLessThan(1.6);
    expect(p.speed).toBeLessThan(5);
    // speed convention: x px/s even in metres (230 ⇔ walk)
    p.teleport(1, 3); frames(p, inp(1, 0), 0, 0.5);
    expect(p.speed).toBeGreaterThan(180); expect(p.speed).toBeLessThan(240);
    // back to the city
    p.setSpace({ free: c.layout.free, groundAt: c.groundAt, solidTop: c.solidTop }, 'px', { x: 2000, y: 1000 });
    expect(p.units).toBe('px');
    expect(p.feet({ x: 0, y: 0, z: 0 }).z).toBeCloseTo((1000 - 800) * SZ, 6);
  });

  it('steps ≤ 0.25 m are walked up, higher blocks need a jump', () => {
    const steps: WalkSpace = {
      free: () => true,
      groundAt: () => 0,
      solidTop: (x) => (x >= 2 && x < 3 ? 0.2 : x >= 3 && x < 4 ? 0.4 : x >= 4 ? 1.3 : -Infinity),
    };
    const p = createPlayerController(steps, undefined, {});
    p.setSpace(steps, 'm', { x: 1, y: 1 });
    frames(p, inp(1, 0), 0, 3);
    expect(p.x).toBeGreaterThan(3);   // walked up 0.2 and 0.4 (0.2 step each)
    expect(p.x).toBeLessThan(4);      // 1.3 m is a wall for walking and jumping (apex 1.0 + 0.4)
    expect(p.feetY).toBeCloseTo(0.4, 5);
    p.jump(); frames(p, inp(1, 0), 0, 1.5);
    expect(p.x).toBeGreaterThan(4);   // 0.4 + 1.0 apex ≥ 1.3 − air step → onto the 1.3 m block
    expect(p.feetY).toBeCloseTo(1.3, 5);
  });
});

describe('the real fair city ledge (fixture walk grid + analytic ground)', () => {
  it('jumping off the retaining wall lands on the lower street; walking back up only works via the stairs', async () => {
    const { fixtureLayout } = await import('../dev/fixtures');
    const { groundSpec, makeGroundAt } = await import('../src/world/ground');
    const L = fixtureLayout();
    const s = groundSpec(L);
    const g = makeGroundAt(s);
    // what world3 is expected to report: the ledge band is "nothing solid" (a drop), everything else blocked = wall
    const solidTop = (x: number, y: number) => (L.free(x, y) ? -Infinity : y >= s.edge[0] - 16 && y <= s.edge[1] + 16 ? -Infinity : Infinity);
    const p = createPlayerController(L, g, { solidTop });
    const X = L.QW + 1500;   // away from stairs
    p.teleport(X, s.edge[0] - 40);
    expect(p.feetY).toBe(0);
    frames(p, inp(0, 1), TO_PLUS_Y, 2);
    expect(p.y).toBeLessThan(s.edge[0]);
    runAndJumpAt(p, 0, TO_PLUS_Y, 3);
    expect(p.y).toBeGreaterThan(s.edge[1]);
    expect(p.feetY).toBeCloseTo(s.lowH, 3);
    expect(L.free(p.x, p.y)).toBe(true);
    for (let k = 0; k < 4; k++) { p.jump(); frames(p, inp(0, 1), TO_MINUS_Y, 1); }
    expect(p.y).toBeGreaterThan(s.wallY);
    expect(p.feetY).toBeCloseTo(s.lowH, 3);
  });
});
