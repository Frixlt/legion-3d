/**
 * Mine geometry and walking rules — a faithful port of the site's world library (`/lib/world.js` → LGWorldLib.mine,
 * also used by the game server), plus the mapping of the site's mine px space to our room metres.
 *
 * Site mine space (px): world 1024 × 2476. Hall = 7 × 12 cells of 128 px starting at (SIDE = 64, Y0 = 420); row 11 is
 * next to the entrance, row 0 next to the way down. Below the hall (y ≥ YB = 1956) is the entrance area (lift, cart,
 * board, buyer, supplier). Cells: i = gy * 7 + gx; "virtual" cells 84…90 = the columns of the entrance area.
 *
 * Room space (m): X = (x − W/2) · K, Z = (y − YB) · K (isotropic K = 2.4 m per cell). The hall lies at Z < 0, the
 * entrance area at Z ∈ [0, 9.75]; the player looks to −Z (Walker.face = 0) when walking into the mine.
 * Pure TS, no THREE, no DOM — unit-tested in test/mine-geo.test.ts.
 */

export const GW = 7, GH = 12;
export const CW = 128, RH = 128;
export const SIDE = 64, W = GW * CW + SIDE * 2;            // 1024
export const TOP = 420, Y0 = TOP, GRID_H = GH * RH, BOT = 520;
export const H = TOP + GRID_H + BOT;                       // 2476
export const YB = Y0 + GRID_H;                             // 1956: bottom of the hall, entrance area below
export const VW = 1920, VX0 = -(VW - W) / 2;
/** Max distance (px) from a stone centre at which digging is allowed (site atRock / server mineDig). */
export const REACH = 200;
/** Site walk speed in the mine (px/s) — other miners move along their paths at this speed. */
export const SPEED = 260;
export const N_CELLS = GW * GH;

/** metres per mine px. */
export const K = 2.4 / CW;
export const mx = (x: number) => (x - W / 2) * K;
export const mz = (y: number) => (y - YB) * K;
export const px = (X: number) => X / K + W / 2;
export const py = (Z: number) => Z / K + YB;

export type Rect = [number, number, number, number];
export interface Foot { k: string; npc?: string; lamp?: 1; r: Rect; s: Rect; z: number; at?: [number, number] }

/** Entrance objects (site FOOT table): r = floor under the object (not walkable), s = where not to stand, at = where to walk to. */
export const FOOT: Foot[] = [
  { k: 'lift', r: [30, 2340, 246, 2422], s: [30, 2200, 246, 2422], z: 2406 },
  { k: 'cart', r: [216, 2276, 444, 2350], s: [216, 2236, 444, 2350], z: 2342 },
  { k: 'board', r: [414, 2370, 590, 2430], s: [414, 2200, 590, 2430], z: 2416, at: [502, 2440] },
  { k: 'buyer', r: [650, 2300, 1000, 2400], s: [650, 2180, 1000, 2400], z: 2392, at: [770, 2434] },
  { k: 'npcBuy', npc: 'buy', r: [636, 2400, 692, 2432], s: [636, 2400, 692, 2432], z: 2426 },
  { k: 'lamp', lamp: 1, r: [264, 2120, 380, 2168], s: [264, 2090, 380, 2168], z: 2156, at: [490, 2176] },
  { k: 'npcLamp', npc: 'lamp', lamp: 1, r: [397, 2140, 453, 2172], s: [397, 2140, 453, 2172], z: 2166 },
];
/** Entrance area where one may stand (server MINE_AREA without the walls). */
export const ZONE: Rect = [56, YB + 20, 968, 2440];
export const feet = (o: { lamp?: boolean } = {}) => FOOT.filter((f) => !f.lamp || o.lamp);
export const inR = (r: Rect, x: number, y: number) => x > r[0] && x < r[2] && y > r[1] && y < r[3];

export interface Pt { x: number; y: number }

export const cellXY = (i: number) => {
  const gx = i % GW, gy = Math.floor(i / GW);
  return { x: SIDE + gx * CW + CW / 2, y: Y0 + gy * RH + RH * 0.78, cx: SIDE + gx * CW + CW / 2, cy: Y0 + gy * RH + RH / 2 };
};
export const cellAt = (x: number, y: number) => {
  const gx = Math.floor((x - SIDE) / CW), gy = Math.floor((y - Y0) / RH);
  return gx < 0 || gy < 0 || gx >= GW || gy >= GH ? -1 : gy * GW + gx;
};
/** Segment a-b passes through the inside of rect r (touching the edge is fine). */
export function segHit(a: Pt, b: Pt, r: Rect): boolean {
  let t0 = 0, t1 = 1; const dx = b.x - a.x, dy = b.y - a.y, e = 0.5;
  for (const [p, q] of [[-dx, a.x - (r[0] + e)], [dx, (r[2] - e) - a.x], [-dy, a.y - (r[1] + e)], [dy, (r[3] - e) - a.y]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p; if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 < t1;
}
/** Nearest free spot in the entrance area (stop: where one may stand; else only the objects' floor). In the hall — as is. */
export function free(x: number, y: number, F: Foot[] = FOOT, stop = true): Pt {
  x = +x || 0; y = +y || 0; if (y < YB) return { x, y };
  const cl = (px_: number, py_: number): [number, number] => [Math.round(Math.max(ZONE[0], Math.min(ZONE[2], px_))), Math.round(Math.max(ZONE[1], Math.min(ZONE[3], py_)))];
  const R = F.map((f) => (stop ? f.s : f.r)), bad = (a: number, b: number) => R.some((r) => inR([r[0] - 3, r[1] - 3, r[2] + 3, r[3] + 3], a, b));
  const [cx, cy] = cl(x, y); if (!bad(cx, cy)) return { x: cx, y: cy };
  let best: Pt | null = null, bd = Infinity;
  const tryP = (a: number, b: number) => { const [qx, qy] = cl(a, b); if (bad(qx, qy)) return; const d = Math.hypot(qx - x, qy - y); if (d < bd) { bd = d; best = { x: qx, y: qy }; } };
  for (const r of R) { tryP(r[0] - 4, cy); tryP(r[2] + 4, cy); tryP(cx, r[1] - 4); tryP(cx, r[3] + 4); for (const a of [r[0] - 4, r[2] + 4]) for (const b of [r[1] - 4, r[3] + 4]) tryP(a, b); }
  for (let d = 24; !best && d < 700; d += 24) for (let a = 0; a < 24; a++) tryP(cx + Math.cos(a / 24 * Math.PI * 2) * d, cy + Math.sin(a / 24 * Math.PI * 2) * d);
  return best || { x: W / 2, y: YB + 56 };
}
/** Path a → b around the objects' floor (shortest via rectangle corners): points after a, the last is b. */
export function route(a: Pt, b: Pt, F: Foot[] = FOOT): Pt[] {
  const R = F.map((f) => f.r).filter((r) => !inR(r, a.x, a.y) && !inR(r, b.x, b.y));
  const clear = (p: Pt, q: Pt) => !R.some((r) => segHit(p, q, r));
  if (clear(a, b)) return [b];
  const N: Pt[] = [a, b];
  for (const r of R) for (const [x, y] of [[r[0] - 6, r[1] - 6], [r[2] + 6, r[1] - 6], [r[0] - 6, r[3] + 6], [r[2] + 6, r[3] + 6]]) if (x >= ZONE[0] - 8 && x <= ZONE[2] + 8 && y >= YB && y <= ZONE[3] && !R.some((q) => inR(q, x, y))) N.push({ x, y });
  const D = N.map(() => Infinity), P = N.map(() => -1), done = N.map(() => false); D[0] = 0;
  for (;;) {
    let u = -1; for (let k = 0; k < N.length; k++) if (!done[k] && D[k] < Infinity && (u < 0 || D[k] < D[u])) u = k;
    if (u < 0 || u === 1) break; done[u] = true;
    for (let v = 0; v < N.length; v++) { if (done[v]) continue; const d = D[u] + Math.hypot(N[v].x - N[u].x, N[v].y - N[u].y); if (d < D[v] && clear(N[u], N[v])) { D[v] = d; P[v] = u; } }
  }
  if (P[1] < 0) return [b];
  const out: Pt[] = []; for (let k = 1; k > 0; k = P[k]) out.unshift(N[k]);
  return out;
}

/* ---------- hall: walkable = cleared cells + the entrance area (virtual row 12: cells 84…90) ---------- */
export type Dug = ArrayLike<number>;
export function walkable(dug: Dug, i: number): boolean { if (i >= N_CELLS) return true; return !!dug[i]; }
export const cellOfPt = (x: number, y: number) => { if (y >= Y0 + GH * RH) return N_CELLS + Math.max(0, Math.min(GW - 1, Math.floor((x - (W - GW * CW) / 2) / CW))); return cellAt(x, y); };
export const centerOf = (i: number): Pt => { if (i >= N_CELLS) { const gx = i - N_CELLS; return { x: (W - GW * CW) / 2 + gx * CW + CW / 2, y: Y0 + GH * RH + 56 }; } const p = cellXY(i); return { x: p.cx, y: p.cy + 34 }; };
export function nbrs(i: number): number[] {
  if (i >= N_CELLS) { const gx = i - N_CELLS, out: number[] = []; if (gx > 0) out.push(i - 1); if (gx < GW - 1) out.push(i + 1); out.push((GH - 1) * GW + gx); return out; }
  const gx = i % GW, gy = Math.floor(i / GW), out: number[] = [];
  if (gy > 0) out.push(i - GW); if (gx > 0) out.push(i - 1); if (gx < GW - 1) out.push(i + 1); out.push(gy < GH - 1 ? i + GW : N_CELLS + gx);
  return out;
}
/** BFS over cells (4 neighbours) from → to: [from, …, to] or null. */
export function pathTo(dug: Dug, from: number, to: number): number[] | null {
  if (from === to) return [to];
  const prev = new Map<number, number>([[from, -1]]), q = [from];
  while (q.length) { const i = q.shift()!; if (i === to) break; for (const j of nbrs(i)) if (!prev.has(j) && walkable(dug, j)) { prev.set(j, i); q.push(j); } }
  if (!prev.has(to)) return null;
  const out: number[] = []; for (let i = to; i !== -1; i = prev.get(i)!) out.unshift(i);
  return out;
}
/** Where to stand to dig stone i: a cleared neighbour (below is best). */
export function digSpot(dug: Dug, i: number): number | null {
  const gx = i % GW, gy = Math.floor(i / GW);
  const cand = [gy < GH - 1 ? i + GW : N_CELLS + gx, gx > 0 ? i - 1 : -1, gx < GW - 1 ? i + 1 : -1, gy > 0 ? i - GW : -1].filter((j) => j >= 0 && walkable(dug, j));
  return cand.length ? cand[0] : null;
}
/** Where point p may stand (cleared hall cell as is; entrance area: not inside objects; else snapped to the entrance). */
export function walkPt(dug: Dug, p: Pt, stop = true, F: Foot[] = FOOT): Pt {
  const c = cellOfPt(p.x, p.y);
  if (c >= N_CELLS) return free(p.x, p.y, F, stop);
  if (c >= 0 && dug[c]) return p;
  return free(Math.max(VX0 + 40, Math.min(W - 40, p.x)), Y0 + GH * RH + 56, F, true);
}
/** Front stones as the site/server define them: not dug, not a wall/void/entry, with a walkable 4-neighbour. */
export function frontOf(dug: Dug, types: ArrayLike<string>): number[] {
  const out: number[] = [];
  for (let i = 0; i < N_CELLS; i++) {
    if (dug[i] || types[i] === 'wall' || types[i] === 'void' || types[i] === 'entry') continue;
    if (nbrs(i).some((j) => walkable(dug, j))) out.push(i);
  }
  return out;
}
/** Site hashL (login → spawn jitter). */
export const hashL = (s: string) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
/** Own spawn point: in front of the cart, by the lift (site spawnPt). */
export const spawnPt = (login: string, F: Foot[] = FOOT): Pt => { const h = hashL(login); return free(290 + (h % 110), 2372 + ((h >>> 7) % 60), F, true); };
/** Where to walk to use an entrance object (FOOT at). */
export const frontOfObj = (k: string, login = '', F: Foot[] = FOOT): Pt => { const f = FOOT.find((x) => x.k === k); return f && f.at ? free(f.at[0], f.at[1], F, true) : spawnPt(login, F); };

/**
 * Can a body stand at px point (x, y)? Hall: inside a cleared cell; entrance area: inside the zone and not on an
 * object's floor (FOOT r, grown by pad). Used by the room's free() (with the body radius handled by the controller).
 */
export function standable(dug: Dug, x: number, y: number, pad = 0, F: Foot[] = FOOT): boolean {
  if (y >= YB) {
    if (x < ZONE[0] || x > ZONE[2] || y > ZONE[3]) return false;
    for (const f of F) { const r = f.r; if (x > r[0] - pad && x < r[2] + pad && y > r[1] - pad && y < r[3] + pad) return false; }
    // the strip between the hall and the zone (YB … YB+20) is walkable only under the hall columns
    if (y < ZONE[1] && (x < SIDE || x > W - SIDE)) return false;
    return true;
  }
  const c = cellAt(x, y);
  return c >= 0 && !!dug[c];
}
