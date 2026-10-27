/**
 * Director toolkit: smooth curves, player steering along Catmull-Rom splines, camera keys, overlay cards.
 * Everything is a pure function of the shot-local time so a frame can be re-rendered (resume) identically.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { SX, SZ, Y0 } from '../../../src/world/coords';
export type V2 = [number, number];

export const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => { t = clamp(t); return t * t * (3 - 2 * t); };
export const smoother = (t: number) => { t = clamp(t); return t * t * t * (t * (t * 6 - 15) + 10); };
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * clamp(t)) - 1) / 2;
export const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/**
 * Smooth keyed value: keys [[t, v], …] (t ascending). Cubic Hermite with Catmull-Rom tangents inside and zero
 * tangents at the first/last key, so motion starts and ends at rest. `angle` unwraps the values first.
 */
export function keyed(keys: [number, number][], t: number, angle = false): number {
  if (!keys.length) return 0;
  let ks = keys;
  if (angle) {
    ks = [keys[0].slice() as [number, number]];
    for (let i = 1; i < keys.length; i++) { const p = ks[i - 1][1]; ks.push([keys[i][0], p + wrap(keys[i][1] - p)]); }
  }
  if (t <= ks[0][0]) return ks[0][1];
  const n = ks.length;
  if (t >= ks[n - 1][0]) return ks[n - 1][1];
  let i = 0; while (i < n - 2 && t > ks[i + 1][0]) i++;
  const [t0, v0] = ks[i], [t1, v1] = ks[i + 1];
  const h = t1 - t0, u = (t - t0) / h;
  const tan = (j: number) => {
    if (j <= 0 || j >= n - 1) return 0;
    return (ks[j + 1][1] - ks[j - 1][1]) / (ks[j + 1][0] - ks[j - 1][0]);
  };
  const m0 = tan(i) * h, m1 = tan(i + 1) * h;
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * v0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * v1 + (u3 - u2) * m1;
}

/** Centripetal-ish uniform Catmull-Rom through points (metres), sampled by arclength. */
export class Spline {
  private pts: V2[];
  private lut: { s: number; p: V2 }[] = [];
  readonly length: number;
  constructor(points: V2[]) {
    this.pts = points.length > 1 ? points : [points[0], points[0]];
    const N = 400;
    let s = 0, prev = this.raw(0);
    this.lut.push({ s: 0, p: prev });
    for (let i = 1; i <= N; i++) {
      const p = this.raw(i / N);
      s += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      this.lut.push({ s, p }); prev = p;
    }
    this.length = s;
  }
  private raw(u: number): V2 {
    const P = this.pts, n = P.length - 1;
    const f = clamp(u) * n; let i = Math.floor(f); if (i >= n) i = n - 1;
    const t = f - i;
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n, i + 2)];
    const t2 = t * t, t3 = t2 * t;
    const c = (a: number, b: number, cc: number, d: number) => 0.5 * ((2 * b) + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
    return [c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])];
  }
  /** Point at arclength s (metres). */
  at(s: number): V2 {
    const L = this.lut; s = clamp(s, 0, this.length);
    let lo = 0, hi = L.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m].s < s) lo = m; else hi = m; }
    const a = L[lo], b = L[hi], k = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
    return [lerp(a.p[0], b.p[0], k), lerp(a.p[1], b.p[1], k)];
  }
}

/**
 * Arclength travelled after `t` seconds when walking a path of `len` metres at cruise speed `v` with smooth
 * acceleration over `acc` seconds at both ends (trapezoid velocity profile with smoothstep ramps).
 */
export function travel(t: number, len: number, v: number, acc = 0.8): { s: number; total: number } {
  // ramp distance = v·acc/2 each end
  let a = acc; const ramp = v * a / 2;
  let cruiseLen = len - 2 * ramp;
  if (cruiseLen < 0) { a = Math.sqrt(len / v * a) ; cruiseLen = 0; }
  const vEff = cruiseLen === 0 ? len / a : v;
  const tc = cruiseLen / vEff, total = 2 * a + tc;
  // velocity(t) = vEff·smooth(t/a) in ramp-up; integrate numerically closed form: ∫ smooth = u³ - u⁴/2 (scaled)
  const I = (u: number) => u * u * u - u * u * u * u / 2;   // ∫0^u (3x²-2x³) dx
  let s: number;
  if (t <= 0) s = 0;
  else if (t < a) s = vEff * a * I(t / a);
  else if (t < a + tc) s = vEff * a * 0.5 + vEff * (t - a);
  else if (t < total) { const r = total - t; s = len - vEff * a * I(r / a); }
  else s = len;
  return { s, total };
}

/** Game-time rate at output second t: piecewise-linear keys [[t, rate], …] (held before the first / after the last). */
export function rateAt(keys: [number, number][], t: number): number {
  if (!keys.length) return 1;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t < keys[i][0]) { const [a, ra] = keys[i - 1], [b, rb] = keys[i]; return ra + (rb - ra) * (t - a) / (b - a); }
  return keys[keys.length - 1][1];
}

/* ------------------------------------------------------------------ game access */
export interface G {
  g: any;           // window.__l3dGame
  ctx: any;
  rig: any;
  ctl: any;         // player controller
  input: any;
  store: any;
  ui: any;
  demo: any;        // window.__demo (bots, hero)
  sc: any;          // window.__showcase (showcase page)
}

export { SX, SZ, Y0 };
/** px (city) → metres */
export const pxToM = (p: V2): V2 => [p[0] * SX, (p[1] - Y0) * SZ];
export const mToPx = (m: V2): V2 => [m[0] / SX, m[1] / SZ + Y0];

/** Feet in metres (x, z) and height. */
export function feet(G: G): { x: number; y: number; z: number } {
  const f = G.ctx.feet; return { x: f.x, y: f.y, z: f.z };
}
/** Teleport the player to a point given in metres (works in both city px and room metre spaces). */
export function placeM(G: G, m: V2, face?: number): void {
  const c = G.ctl;
  if (c.units === 'px') { const p = mToPx(m); c.teleport(p[0], p[1]); } else c.teleport(m[0], m[1]);
  if (face != null) { c.setFace(face); G.rig.face = face; }
}
/** Yaw that looks from a to b (metres), game convention: forward = (-sin yaw, -cos yaw). */
export const yawTo = (a: V2, b: V2) => Math.atan2(-(b[0] - a[0]), -(b[1] - a[1]));

/**
 * Steer the player towards spline point `want` moving with velocity `vel` (m/s, feed-forward) by writing the input
 * stick (camera-relative). Uses the run flag so speeds up to 4.6 m/s are reachable with a partial stick.
 */
export function steer(G: G, want: V2, vel: V2, yaw: number, gain = 5): void {
  const f = G.ctx.feet;
  let dX = vel[0] + (want[0] - f.x) * gain, dZ = vel[1] + (want[1] - f.z) * gain;
  const RUN = 4.6;
  dX /= RUN; dZ /= RUN;
  const l = Math.hypot(dX, dZ);
  if (l > 1) { dX /= l; dZ /= l; }
  if (l < 0.004) { dX = 0; dZ = 0; }
  const s = Math.sin(yaw), c = Math.cos(yaw);
  // inverse of: dX = -s·my + c·mx; dZ = -c·my - s·mx
  G.input.move.x = c * dX - s * dZ;
  G.input.move.y = -s * dX - c * dZ;
  G.input.run = true;
  setRun(G, true);
}
export function stopStick(G: G): void { G.input.move.x = 0; G.input.move.y = 0; setRun(G, false); }
function setRun(G: G, on: boolean): void {
  try { Object.defineProperty(G.input, 'run', { value: on, configurable: true, writable: true }); } catch { /* */ }
}

/* ------------------------------------------------------------------ overlay (title / end cards, captions) */
let layer: HTMLDivElement | null = null;
export function overlay(): HTMLDivElement {
  if (layer) return layer;
  layer = document.createElement('div');
  layer.id = 'video-layer';
  layer.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;font-family:"Golos Text","Nunito",sans-serif';
  const css = document.createElement('style');
  css.textContent = `
  #video-layer .card{position:absolute;inset:0;display:grid;place-content:center;text-align:center;color:#fff3c9;
    background:radial-gradient(ellipse at 50% 55%,rgba(20,14,48,.35),rgba(8,6,22,.82));opacity:0}
  #video-layer .card h1{margin:0;font:400 150px/1 "Dela Gothic One","Russo One",sans-serif;letter-spacing:.02em;
    color:#ffe08a;text-shadow:0 0 38px rgba(255,190,90,.55),0 6px 0 #5a2d12,0 10px 30px rgba(0,0,0,.6)}
  #video-layer .card p{margin:26px 0 0;font:600 38px/1.3 "Golos Text",sans-serif;color:#f3e6ff;text-shadow:0 2px 12px rgba(0,0,0,.7)}
  #video-layer .card .keys{margin-top:44px;display:flex;gap:26px;justify-content:center;flex-wrap:wrap;font:600 26px/1 "Golos Text",sans-serif;color:#e8defa}
  #video-layer .card .keys span{display:inline-flex;align-items:center;gap:10px}
  #video-layer .card kbd{display:inline-block;min-width:44px;padding:9px 12px;border-radius:10px;background:rgba(255,240,200,.12);
    border:2px solid rgba(255,224,138,.65);color:#ffe08a;font:800 24px/1 "Golos Text",sans-serif;box-shadow:0 3px 0 rgba(255,224,138,.35)}
  #video-layer .cap{position:absolute;left:50%;bottom:120px;transform:translateX(-50%);padding:16px 34px;border-radius:18px;
    background:rgba(14,10,36,.72);border:2px solid rgba(255,224,138,.45);color:#fff3c9;font:700 36px/1.2 "Golos Text",sans-serif;
    text-shadow:0 2px 8px rgba(0,0,0,.6);opacity:0;white-space:nowrap}
  #video-layer .cap.top{bottom:auto;top:96px}
  #video-layer .black{position:absolute;inset:0;background:#07051a;opacity:0}`;
  layer.appendChild(css);
  // cards and captions are laid out for 1920×1080 and scaled to the viewport (the cursor is not scaled)
  stage = document.createElement('div');
  const k = innerWidth / 1920;
  stage.style.cssText = `position:absolute;left:0;top:0;width:1920px;height:${Math.round(innerHeight / k)}px;transform:scale(${k});transform-origin:0 0`;
  layer.appendChild(stage);
  document.body.appendChild(layer);
  return layer;
}
let stage: HTMLDivElement | null = null;
const els = new Map<string, HTMLElement>();
/** A card/caption element by key (created once). */
export function el(key: string, cls: string, html: string): HTMLElement {
  let e = els.get(key);
  if (!e) { e = document.createElement('div'); e.className = cls; e.innerHTML = html; const L = overlay(); (key === 'cursor' ? L : stage!).appendChild(e); els.set(key, e); }
  return e;
}
/** Opacity envelope: fade in over [a, a+fi], hold, fade out over [b-fo, b]. */
export const env = (t: number, a: number, b: number, fi = 0.5, fo = 0.5) => smooth((t - a) / fi) * (1 - smooth((t - (b - fo)) / fo));
export function caption(key: string, text: string, t: number, a: number, b: number, top = false): void {
  const e = el('cap:' + key, 'cap' + (top ? ' top' : ''), text);
  const o = env(t, a, b, 0.4, 0.4);
  e.style.opacity = String(o);
  e.style.transform = `translateX(-50%) translateY(${(1 - o) * 14}px)`;
}
export function black(o: number): void { el('black', 'black', '').style.opacity = String(clamp(o)); }

/* ------------------------------------------------------------------ DOM (incl. open shadow roots) + a fake cursor */
/** querySelector through the document and every open shadow root. */
export function qs(sel: string): HTMLElement | null {
  // the first VISIBLE match (non-empty box) through the document and every open shadow root
  let fallback: HTMLElement | null = null;
  const walk = (root: Document | ShadowRoot): HTMLElement | null => {
    for (const e of root.querySelectorAll<HTMLElement>(sel)) { const r = e.getBoundingClientRect(); if (r.width > 0 && r.height > 0) return e; fallback = fallback || e; }
    for (const e of root.querySelectorAll<HTMLElement>('*')) if (e.shadowRoot) { const r = walk(e.shadowRoot); if (r) return r; }
    return null;
  };
  return walk(document) || fallback;
}
/** Centre of an element (viewport px) or null. */
export function centre(sel: string, dx = 0, dy = 0): V2 | null {
  const e = qs(sel); if (!e) return null;
  const r = e.getBoundingClientRect(); if (!r.width && !r.height) return null;
  return [r.left + r.width / 2 + dx, r.top + r.height / 2 + dy];
}
const lastPos = new WeakMap<object, V2>();
export interface CursorKey { t: number; at: V2 | string | (() => V2 | null); click?: boolean }
/**
 * A drawn mouse cursor gliding between keyed targets (element selectors are resolved every frame, so a moving
 * layout is followed). `click: true` keys press visually at their time and fire element.click() once.
 * Visible while t is within [first key − 0.3, last key + 0.5].
 */
export function cursor(t: number, keys: CursorKey[], clicked: Set<number>): void {
  const c = el('cursor', 'cursor', `<svg width="34" height="40" viewBox="0 0 34 40"><path d="M3 2 L3 31 L10.5 24.5 L15.5 36 L21 33.5 L16 22.5 L26 22 Z" fill="#fff8e6" stroke="#1a1030" stroke-width="2.4" stroke-linejoin="round"/></svg>`);
  c.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;filter:drop-shadow(0 3px 6px rgba(0,0,0,.55));will-change:transform';
  // literal points ≤ 1.5 are viewport fractions; an element that is gone keeps its last known position
  const pos = (k: CursorKey): V2 | null => {
    let p: V2 | null = typeof k.at === 'string' ? centre(k.at) : typeof k.at === 'function' ? k.at() : k.at;
    if (p && p[0] <= 1.5 && p[1] <= 1.5) p = [p[0] * innerWidth, p[1] * innerHeight];
    if (p) lastPos.set(k, p); else p = lastPos.get(k) || null;
    return p;
  };
  const first = keys[0].t, last = keys[keys.length - 1].t;
  const vis = smooth((t - (first - 0.3)) / 0.3) * (1 - smooth((t - (last + 0.2)) / 0.3));
  let i = 0; while (i < keys.length - 1 && t > keys[i + 1].t) i++;
  const a = keys[i], b = keys[Math.min(keys.length - 1, i + 1)];
  const pa = pos(a) || (i > 0 ? pos(keys[i - 1]) : null) || [innerWidth / 2, innerHeight / 2], pb = pos(b) || pa;
  const u = b.t > a.t ? smoother((t - a.t) / (b.t - a.t)) : 1;
  const x = lerp(pa[0], pb[0], u), y = lerp(pa[1], pb[1], u);
  let press = 0;
  keys.forEach((k, j) => {
    if (!k.click) return;
    press = Math.max(press, 1 - clamp(Math.abs(t - k.t) / 0.12));
    if (t >= k.t && !clicked.has(j)) {
      clicked.add(j);
      const e = typeof k.at === 'string' ? qs(k.at) : null;
      if (e) e.click(); else console.warn('[director] click target missing', String(k.at));
    }
  });
  c.style.opacity = String(vis);
  c.style.transform = `translate(${x - 3}px, ${y - 2}px) scale(${1 - 0.14 * press})`;
}

/* ------------------------------------------------------------------ path planning in any walk space (rooms: metres) */
/**
 * A* on a `step`-metre grid over the player's current walk space (free + no solid top above the step height),
 * with a body clearance; the result (metres) is thinned by line of sight so the spline stays smooth.
 */
export function planPath(G: G, from: V2, to: V2, step = 0.12, clear = 0.06): V2[] | null {
  const sp = G.ctl.space, px = G.ctl.units === 'px';
  const toU = (m: V2): V2 => (px ? mToPx(m) : m);
  const ok = (m: V2): boolean => {
    for (const [dx, dz] of [[0, 0], [clear, 0], [-clear, 0], [0, clear], [0, -clear]]) {
      const u = toU([m[0] + dx, m[1] + dz]);
      const top = sp.solidTop ? sp.solidTop(u[0], u[1]) : -Infinity;
      if (top === Infinity || (top > -Infinity && top > 0.25)) return false;
      if (top === -Infinity && !sp.free(u[0], u[1])) return false;
    }
    return true;
  };
  const R = 400, key = (i: number, j: number) => (i + R) * (2 * R + 1) + (j + R);
  const ci = (v: number, o: number) => Math.round((v - o) / step);
  const ox = from[0], oz = from[1];
  const gi = ci(to[0], ox), gj = ci(to[1], oz);
  // binary heap of [f, g, i, j]
  const heap: [number, number, number, number][] = [[0, 0, 0, 0]];
  const push = (n: [number, number, number, number]) => { heap.push(n); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  const came = new Map<number, number>(), gs = new Map<number, number>([[key(0, 0), 0]]);
  const H = (i: number, j: number) => Math.hypot(i - gi, j - gj);
  let found = -1;
  for (let it = 0; heap.length && it < 400000; it++) {
    const [, g, i, j] = pop();
    if (g > (gs.get(key(i, j)) ?? Infinity)) continue;
    if (Math.abs(i - gi) <= 1 && Math.abs(j - gj) <= 1) { found = key(i, j); came.set(key(gi, gj), found); found = key(gi, gj); break; }
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const ni = i + di, nj = j + dj; if (Math.abs(ni) > R || Math.abs(nj) > R) continue;
      const nk = key(ni, nj), ng = g + Math.hypot(di, dj);
      if (ng >= (gs.get(nk) ?? Infinity)) continue;
      if (!ok([ox + ni * step, oz + nj * step])) continue;
      gs.set(nk, ng); came.set(nk, key(i, j)); push([ng + H(ni, nj), ng, ni, nj]);
    }
  }
  if (found < 0) return null;
  const cells: V2[] = [];
  for (let k: number | undefined = found; k !== undefined && k !== key(0, 0); k = came.get(k)) {
    const i = Math.floor(k / (2 * R + 1)) - R, j = (k % (2 * R + 1)) - R;
    cells.push([ox + i * step, oz + j * step]);
  }
  cells.push(from); cells.reverse(); cells[cells.length - 1] = to;
  // line-of-sight thinning
  const los = (a: V2, b: V2) => { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (step * 0.5)); for (let s = 1; s < n; s++) if (!ok([lerp(a[0], b[0], s / n), lerp(a[1], b[1], s / n)])) return false; return true; };
  const out: V2[] = [cells[0]];
  let a = 0;
  while (a < cells.length - 1) { let b = cells.length - 1; while (b > a + 1 && !los(cells[a], cells[b])) b--; out.push(cells[b]); a = b; }
  return out;
}
