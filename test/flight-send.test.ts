/**
 * What the site gets while flying freely: random free 3D flights over the whole real fair city (fixture walk grid,
 * every point of the area flyable) driven through the same pipeline as the game — game.ts sends site.moveTo(ctl.x,
 * ctl.y) when moved (≥ 0.1 s apart), site.ts → createGoSender (≤ 2 go/s, projected onto the walk grid).
 * No go() point may be non-walkable, and two go() calls are never closer than the throttle.
 */
import { describe, it, expect } from 'vitest';
import { fixtureLayout } from '../dev/fixtures';
import { createPlayerController } from '../src/engine/player';
import { createGoSender, walkablePoint } from '../src/flight/sendpoint';

const L = fixtureLayout();
const A = L.area;
/** Fly map: everything inside the area is flat and flyable (roofs, the canal, the outcrop: all "non-walkable" space). */
const flyTop = (x: number, y: number) => (x < A.x0 || x > A.x1 || y < A.y0 || y > A.y1 ? Infinity : 0);
const DT = 1 / 60, GO_MS = 500;

function harness() {
  let now = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let tid = 0;
  const sent: { x: number; y: number; t: number }[] = [];
  const s = createGoSender({
    go: (x, y) => sent.push({ x, y, t: now }), map: () => L, now: () => now, minMs: GO_MS,
    setTimer: (fn, ms) => { timers.push({ at: now + ms, fn, id: ++tid }); return tid; },
    clearTimer: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
  });
  const advance = (ms: number) => {
    now += ms;
    for (;;) { const i = timers.findIndex((t) => t.at <= now); if (i < 0) break; const t = timers.splice(i, 1)[0]; t.fn(); }
  };
  return { s, sent, advance, get now() { return now; } };
}

describe('sent points while flying freely', () => {
  it('random free flights over the whole map: every go() point is walkable, never faster than the throttle', () => {
    let seed = 2026;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    let total = 0, offGrid = 0;
    for (let flight = 0; flight < 12; flight++) {
      const h = harness();
      const p = createPlayerController(L, () => 0, { solidTop: () => -Infinity });
      p.setFlyMap(flyTop);
      const [sx, sy] = L.nearest(A.x0 + rnd() * (A.x1 - A.x0), A.y0 + rnd() * (A.y1 - A.y0));
      p.teleport(sx, sy);
      p.setFlight(3);
      let yaw = 0, mx = 0, my = 1, sentAt = -1, t = 0;
      for (let i = 0; i < 60 * 40; i++) {
        if (i % 40 === 0) { yaw = rnd() * 6.28; mx = Math.round(rnd() * 2 - 1); my = Math.round(rnd() * 2 - 1) || 1; }
        const moved = p.update(DT, { move: { x: mx, y: my }, run: rnd() < 0.5, jump: false } as any, yaw);
        t += DT; h.advance(DT * 1000);
        if (!L.free(p.x, p.y)) offGrid++;
        if (moved && t - sentAt > 0.1) { h.s.move(p.x, p.y); sentAt = t; }   // = src/content/game.ts
      }
      h.advance(1000);
      for (const q of h.sent) expect(L.free(q.x, q.y), `go(${q.x}, ${q.y})`).toBe(true);
      for (let i = 1; i < h.sent.length; i++) expect(h.sent[i].t - h.sent[i - 1].t).toBeGreaterThanOrEqual(GO_MS - 1e-6);
      expect(h.sent.length).toBeLessThanOrEqual(40 * 1000 / GO_MS + 1);
      total += h.sent.length;
    }
    expect(offGrid).toBeGreaterThan(1000);   // the flights really went over non-walkable space
    expect(total).toBeGreaterThan(100);       // …and points were sent
  });

  it('hovering around over non-walkable space with the same projected point sends nothing more', () => {
    const h = harness();
    // a non-walkable spot of the fixture map with walkable cells around (scan for one)
    let bx = 0, by = 0;
    for (let y = A.y0 + 40; y < A.y1 - 40 && !bx; y += 8) for (let x = A.x0 + 40; x < A.x1 - 40; x += 8) {
      if (!L.free(x, y) && !L.free(x + 3, y) && !L.free(x, y + 2)) { bx = x; by = y; break; }
    }
    expect(bx).toBeGreaterThan(0);
    h.s.move(bx, by); h.advance(600);
    const n = h.sent.length;
    expect(n).toBe(1);
    expect(L.free(h.sent[0].x, h.sent[0].y)).toBe(true);
    const same = walkablePoint(L, bx, by);
    for (let i = 0; i < 50; i++) {
      const x = bx + (i % 3) * 0.5, y = by + (i % 2) * 0.3;   // tiny drift: projects to the same walkable point
      if (walkablePoint(L, x, y).join() !== same.join()) continue;
      h.s.move(x, y); h.advance(120);
    }
    expect(h.sent.length).toBe(n);
  });

  it('walkablePoint keeps walkable points (rounded) and projects the rest', () => {
    const [wx, wy] = L.nearest(A.x0 + 900, A.y0 + 200);
    expect(walkablePoint(L, wx + 0.2, wy - 0.2)).toEqual([Math.round(wx + 0.2), Math.round(wy - 0.2)]);
    for (let i = 0; i < 2000; i++) {
      const x = A.x0 - 50 + ((i * 97) % (A.x1 - A.x0 + 100)), y = A.y0 - 50 + ((i * 53) % (A.y1 - A.y0 + 100));
      const q = walkablePoint(L, x, y);
      expect(L.free(q[0], q[1]), `${x},${y} → ${q}`).toBe(true);
    }
  });

  it('pause drops the pending point; reset re-sends a close point', () => {
    const h = harness();
    const [x, y] = L.nearest(A.x0 + 1500, A.y0 + 300);
    h.s.move(x, y); expect(h.sent.length).toBe(1);
    h.s.move(x + 30, y); h.s.pause(true); h.advance(1000);
    expect(h.sent.length).toBe(1);
    h.s.pause(false); h.s.move(x + 2, y); h.advance(1000);
    expect(h.sent.length).toBe(1);   // too close to the last sent one
    h.s.reset(); h.s.move(x + 2, y); h.advance(1000);
    expect(h.sent.length).toBe(2);
  });
});
