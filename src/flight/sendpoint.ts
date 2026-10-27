/**
 * What the city sends to the site: LGCity.go(x, y) points, throttled. Since the free 3D flight the 3D position may be
 * over non-walkable space (a roof, the canal, the mine outcrop, a bench) — the site must only ever get walkable
 * points, so every point is projected onto the walk grid first (layout.nearest), and a projected point that did not
 * change is not sent again (no extra requests while hovering over a roof).
 *
 * Pure (timers and the clock are injected) so test/flight-send.test.ts can drive it; src/net/site.ts wires it to
 * performance.now / setTimeout / LGCity.go.
 */
export interface WalkGrid {
  free(x: number, y: number): boolean;
  nearest(x: number, y: number): [number, number];
}

/** A walkable integer point for (x, y): (x, y) itself rounded when walkable, else the nearest walkable one. */
export function walkablePoint(map: WalkGrid | null, x: number, y: number): [number, number] {
  let px = Math.round(x), py = Math.round(y);
  if (!map) return [px, py];
  if (map.free(px, py)) return [px, py];
  let n: [number, number];
  try { n = map.nearest(x, y); } catch { return [px, py]; }
  px = Math.round(n[0]); py = Math.round(n[1]);
  if (map.free(px, py)) return [px, py];
  // rounding pushed it over a cell edge: try the four integer neighbours of the unrounded point
  for (const [ax, ay] of [[Math.floor(n[0]), Math.floor(n[1])], [Math.ceil(n[0]), Math.floor(n[1])], [Math.floor(n[0]), Math.ceil(n[1])], [Math.ceil(n[0]), Math.ceil(n[1])]]) {
    if (map.free(ax, ay)) return [ax, ay];
  }
  return [px, py];
}

export interface GoSenderOptions {
  /** The actual request (LGCity.go). */
  go(x: number, y: number): void;
  /** The walk grid (null before the layout is known: points go out rounded). */
  map(): WalkGrid | null;
  /** False while a move must not be sent right now (a site interior is shown): the pending point is dropped. */
  canSend?(): boolean;
  now(): number;
  setTimer(fn: () => void, ms: number): number;
  clearTimer(id: number): void;
  /** Minimum time between two go() calls (ms). */
  minMs: number;
  /** Points closer than this to the last sent one are skipped (px, depth counted ×2 like the site's grid). */
  minDist?: number;
}

export interface GoSender {
  /** The hero is at (x, y) (any point, walkable or not). */
  move(x: number, y: number): void;
  /** Send the pending point now (leaving 3D, opening a building). */
  flush(): void;
  /** Drop the pending point and refuse moves while on (our own 3D rooms). */
  pause(on: boolean): void;
  /** Forget the last sent point (the site moved the hero itself): the next move is sent even if it is close. */
  reset(): void;
  readonly lastSent: readonly [number, number] | null;
}

export function createGoSender(o: GoSenderOptions): GoSender {
  const minDist = o.minDist ?? 10;
  let lastSent: [number, number] | null = null, lastAt = -Infinity, pend: [number, number] | null = null, timer = 0, paused = false;
  const flush = () => {
    if (timer) { o.clearTimer(timer); timer = 0; }
    if (!pend || paused) return;
    const p = pend; pend = null;
    if (o.canSend && !o.canSend()) return;
    lastSent = p; lastAt = o.now();
    o.go(p[0], p[1]);
  };
  return {
    get lastSent() { return lastSent; },
    move(x, y) {
      if (paused || !(x === x) || !(y === y)) return;
      const p = walkablePoint(o.map(), x, y);
      if (lastSent && Math.hypot(p[0] - lastSent[0], (p[1] - lastSent[1]) * 2) < minDist) { pend = null; return; }
      pend = p;
      // the server answers 429 «не так быстро» to bursts (seen live at ~3/s): stay at ≤ 2 go/s, the site's client
      // walks our 2D hero along the path between them, so other players still see smooth motion
      const wait = o.minMs - (o.now() - lastAt);
      if (wait <= 0) flush(); else if (!timer) timer = o.setTimer(flush, wait);
    },
    flush,
    pause(on) { paused = on; if (on) { pend = null; if (timer) { o.clearTimer(timer); timer = 0; } } },
    reset() { lastSent = null; },
  };
}
