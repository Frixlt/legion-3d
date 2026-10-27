/**
 * Confetti (IDEAS #4): one THREE.Points (one draw call) with a fixed pool of particles. burst() throws a ring of
 * paper bits up around a point; update() integrates them on the CPU (gravity, drag, flutter) — no allocations per
 * frame. The «paper» flicker is a per-particle brightness wobble (a flat square seen edge-on and face-on).
 */
import * as THREE from 'three';

export const CONFETTI_MAX = 160;
const LIFE = 2.6;   // s
const COLORS = ['#ff5d8f', '#ffd23f', '#5ad1ff', '#7be07b', '#c38bff', '#ff9a3c', '#ffffff'];

let tex: THREE.CanvasTexture | null = null;
function paperTexture(): THREE.Texture {
  if (tex) return tex;
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.beginPath(); g.roundRect?.(7, 3, 18, 26, 4); if (!g.roundRect) g.rect(7, 3, 18, 26); g.fill();
  tex = new THREE.CanvasTexture(c);
  return tex;
}

export class Confetti {
  readonly points: THREE.Points;
  private pos = new Float32Array(CONFETTI_MAX * 3);
  private col = new Float32Array(CONFETTI_MAX * 4);
  private vel = new Float32Array(CONFETTI_MAX * 3);
  private age = new Float32Array(CONFETTI_MAX).fill(LIFE);
  private base = new Float32Array(CONFETTI_MAX * 3);
  private spin = new Float32Array(CONFETTI_MAX);
  private next = 0;
  private live = 0;
  private geo = new THREE.BufferGeometry();
  private mat: THREE.PointsMaterial;

  constructor() {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.PointsMaterial({ size: 0.09, map: paperTexture(), vertexColors: true, transparent: true, depthWrite: false, alphaTest: 0.05, sizeAttenuation: true });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.name = 'confetti'; this.points.frustumCulled = false; this.points.renderOrder = 5; this.points.visible = false;
  }

  get active(): boolean { return this.live > 0; }

  /** Throw `n` bits up from (x, y, z) in a ring of radius r (m). */
  burst(x: number, y: number, z: number, n = 90, r = 0.35, rnd: () => number = Math.random): void {
    const c = new THREE.Color();
    n = Math.min(n, CONFETTI_MAX);
    for (let k = 0; k < n; k++) {
      const i = this.next; this.next = (this.next + 1) % CONFETTI_MAX;
      const a = rnd() * Math.PI * 2, rr = r * (0.4 + rnd() * 0.6), up = 3.2 + rnd() * 2.2, out = 0.6 + rnd() * 1.4;
      this.pos[i * 3] = x + Math.cos(a) * rr; this.pos[i * 3 + 1] = y + rnd() * 0.2; this.pos[i * 3 + 2] = z + Math.sin(a) * rr;
      this.vel[i * 3] = Math.cos(a) * out; this.vel[i * 3 + 1] = up; this.vel[i * 3 + 2] = Math.sin(a) * out;
      c.set(COLORS[(rnd() * COLORS.length) | 0]);
      this.base[i * 3] = c.r; this.base[i * 3 + 1] = c.g; this.base[i * 3 + 2] = c.b;
      this.spin[i] = 6 + rnd() * 10;
      this.age[i] = -rnd() * 0.12;   // a slightly staggered start
    }
    this.live = CONFETTI_MAX;
    this.points.visible = true;
    this.geo.setDrawRange(0, CONFETTI_MAX);
  }

  update(dt: number): void {
    if (!this.live) return;
    dt = Math.min(dt, 0.05);
    const drag = Math.exp(-dt * 2.4);
    let alive = 0;
    for (let i = 0; i < CONFETTI_MAX; i++) {
      const a = this.age[i];
      if (a >= LIFE) { this.col[i * 4 + 3] = 0; continue; }
      this.age[i] = a + dt;
      if (a < 0) { this.col[i * 4 + 3] = 0; alive++; continue; }
      alive++;
      const o = i * 3;
      this.vel[o] *= drag; this.vel[o + 2] *= drag;
      this.vel[o + 1] = this.vel[o + 1] * drag - 9.8 * dt * 0.55;
      if (this.vel[o + 1] < -0.9) this.vel[o + 1] = -0.9;   // paper: a slow terminal fall
      const fl = Math.sin(a * this.spin[i]);
      this.pos[o] += (this.vel[o] + fl * 0.25) * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      const shade = 0.55 + 0.45 * Math.abs(fl);
      this.col[i * 4] = this.base[o] * shade; this.col[i * 4 + 1] = this.base[o + 1] * shade; this.col[i * 4 + 2] = this.base[o + 2] * shade;
      this.col[i * 4 + 3] = Math.min(1, (LIFE - a) / 0.6);
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    this.live = alive;
    if (!alive) { this.points.visible = false; this.geo.setDrawRange(0, 0); }
  }

  /** Stop at once. */
  clear(): void { this.age.fill(LIFE); this.live = 0; this.points.visible = false; this.geo.setDrawRange(0, 0); }

  dispose(): void { this.points.removeFromParent(); this.geo.dispose(); this.mat.dispose(); }
}

/**
 * Is a journal entry (SSE `j`, see docs/GAME-DESIGN.md: {id, at, k, t, r, c, x}) a personal milestone worth a
 * confetti burst? Achievements (k 'ach') and level-ups (k 'hero' / 'lvl' / «Новый уровень»). Returns a dedupe id or null.
 */
export function milestoneOf(e: unknown): string | null {
  if (!e || typeof e !== 'object') return null;
  const o = e as Record<string, unknown>;
  const k = String(o.k ?? ''), t = String(o.t ?? '');
  const ach = k === 'ach' || /^достижени/i.test(t);
  const lvl = k === 'lvl' || k === 'level' || /новый уровень|уровень повышен/i.test(t);
  if (!ach && !lvl) return null;
  const id = o.id != null ? String(o.id) : `${k}|${t}|${o.at ?? ''}`;
  return (lvl ? 'lvl:' : 'ach:') + id;
}

/** Entries of an SSE `j` payload: one entry, an array, or {list|e|j: …}. */
export function journalEntries(d: unknown): unknown[] {
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') {
    const o = d as Record<string, unknown>;
    for (const k of ['list', 'e', 'j', 'items']) if (Array.isArray(o[k])) return o[k] as unknown[];
    if (o.e && typeof o.e === 'object') return [o.e];
    return [d];
  }
  return [];
}
