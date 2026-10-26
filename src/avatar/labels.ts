/**
 * Nameplates and chat bubbles: sprites with canvas textures, re-rendered only when their content changes.
 * Sizes are in world metres at a reference distance and grow slowly with distance so text stays readable.
 */
import * as THREE from 'three';
import type { Labels } from '../contracts/modules';

const FONT = `"Rubik", "Segoe UI", "Arial", sans-serif`;
const MAX_CHARS = 90;
const PLATE_FAR = 25, BUBBLE_FAR = 40;
const PX_PER_M = 220;   // canvas px per world metre at scale 1
const MAX_CAND = 64, MAX_PLATES = 20;
// plate canvas: 96 px high, the visible box is 64 px high and starts 18 px above the canvas bottom
const PLATE_FH = 64 / 96, PLATE_FY0 = 18 / 96;
const PLATE_H = 64 / PX_PER_M, BUBBLE_H = PLATE_H * 0.9;
/** Does [x0,x1]×[y0,y1] overlap any of the first n rects by more than `tol` of its own area? */
function overlaps(R: Float32Array, n: number, x0: number, y0: number, x1: number, y1: number, tol: number): boolean {
  const area = Math.max(1e-9, (x1 - x0) * (y1 - y0));
  for (let i = 0; i < n; i++) {
    const ox = Math.min(x1, R[i * 4 + 2]) - Math.max(x0, R[i * 4]);
    if (ox <= 0) continue;
    const oy = Math.min(y1, R[i * 4 + 3]) - Math.max(y0, R[i * 4 + 1]);
    if (oy > 0 && ox * oy > area * tol) return true;
  }
  return false;
}

interface Entry {
  login: string;
  plate: THREE.Sprite; plateKey: string; plateCanvas: HTMLCanvasElement; plateTex: THREE.CanvasTexture; plateMat: THREE.SpriteMaterial;
  plateW: number; plateH: number;
  bubble: THREE.Sprite | null; bubbleCanvas: HTMLCanvasElement | null; bubbleTex: THREE.CanvasTexture | null; bubbleMat: THREE.SpriteMaterial | null;
  bubbleKey: string; bubbleW: number; bubbleH: number;
  bubbleUntil: number; bubbleShown: number;   // ms timestamp; fade 0..1
  fade: number;
  me: boolean;
  plateFW: number; bubbleFW: number; bubbleFH: number;   // visible box fractions of the canvas
  // per-frame scratch (declutter)
  dist: number; depth: number; sx: number; sy: number; vis: number; bVis: number;
  pScale: number; pLift: number; bScale: number; bTop: number; lastScale: number; lastLift: number;
}

const measure = (() => { let c: CanvasRenderingContext2D | null = null; return () => (c ||= document.createElement('canvas').getContext('2d')!); })();

/** Word-wrap text (keeps long words by hard-splitting). */
export function wrapText(text: string, maxW: number, font: string, maxLines = 4): string[] {
  const g = measure(); g.font = font;
  const words = text.split(/\s+/).filter(Boolean), lines: string[] = [];
  let cur = '';
  const push = (s: string) => { lines.push(s); };
  for (let w of words) {
    while (g.measureText(w).width > maxW) {   // hard split very long words
      let i = w.length; while (i > 1 && g.measureText(w.slice(0, i)).width > maxW) i--;
      if (cur) { push(cur); cur = ''; }
      push(w.slice(0, i)); w = w.slice(i);
    }
    const next = cur ? cur + ' ' + w : w;
    if (g.measureText(next).width > maxW && cur) { push(cur); cur = w; } else cur = next;
  }
  if (cur) push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,2}$/, '') + '…'; }
  return lines;
}

export function clampText(text: string): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > MAX_CHARS ? t.slice(0, MAX_CHARS - 1).trimEnd() + '…' : t;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

function newTex(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4;
  return t;
}

class LabelsImpl implements Labels {
  readonly root = new THREE.Group();
  private map = new Map<string, Entry>();
  private tmp = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private cand: Entry[] = [];
  private rects = new Float32Array(MAX_CAND * 2 * 4);
  private showMe = true;
  private plateFar = PLATE_FAR;
  private maxPlates = MAX_PLATES;
  private tanHalf = Math.tan((75 / 2) * Math.PI / 180);

  constructor() { this.root.name = 'labels'; }

  private entry(login: string): Entry {
    let e = this.map.get(login);
    if (e) return e;
    const plateCanvas = document.createElement('canvas'); plateCanvas.width = 512; plateCanvas.height = 96;
    const plateTex = newTex(plateCanvas);
    const plateMat = new THREE.SpriteMaterial({ map: plateTex, transparent: true, depthWrite: false, depthTest: true, sizeAttenuation: true });
    const plate = new THREE.Sprite(plateMat);
    plate.center.set(0.5, 0); plate.renderOrder = 10; plate.visible = false;
    this.root.add(plate);
    e = { login, plate, plateKey: '', plateCanvas, plateTex, plateMat, plateW: 1, plateH: 0.2,
      bubble: null, bubbleCanvas: null, bubbleTex: null, bubbleMat: null, bubbleKey: '', bubbleW: 1, bubbleH: 0.3, bubbleUntil: 0, bubbleShown: 0, fade: 0,
      me: false, plateFW: 1, bubbleFW: 1, bubbleFH: 1,
      dist: 1e9, depth: 1, sx: 0, sy: 0, vis: 0, bVis: 0, pScale: 1, pLift: 0, bScale: 1, bTop: 0, lastScale: 1, lastLift: 0 };
    this.map.set(login, e);
    return e;
  }

  set(login: string, p: { name: string; level?: number; me?: boolean; color?: string; badge?: string }): void {
    const e = this.entry(login);
    const key = `${p.name}|${p.level ?? ''}|${p.me ? 1 : 0}|${p.color ?? ''}|${p.badge ?? ''}`;
    if (key === e.plateKey) return;
    e.plateKey = key;
    e.me = !!p.me;
    const c = e.plateCanvas, g = c.getContext('2d')!;
    const name = String(p.name || login).slice(0, 24), lv = p.level ? String(p.level) : '';
    const fN = `700 40px ${FONT}`, fL = `800 28px ${FONT}`, fB = `30px ${FONT}`;
    g.font = fN; const nw = g.measureText(name).width;
    g.font = fL; const lw = lv ? g.measureText(lv).width + 24 : 0;
    g.font = fB; const bw = p.badge ? g.measureText(p.badge).width + 8 : 0;
    const W = Math.min(1024, Math.ceil(nw + lw + bw + 40 + (lv ? 10 : 0))), H = 64;
    if (c.width < W) c.width = Math.min(1024, Math.max(W, c.width * 2));   // grows only
    g.clearRect(0, 0, c.width, c.height);
    const x0 = Math.round((c.width - W) / 2), y0 = 14;
    roundRect(g, x0, y0, W, H, 22);
    g.fillStyle = p.me ? 'rgba(60,32,8,.72)' : 'rgba(21,18,46,.62)'; g.fill();
    g.lineWidth = 3; g.strokeStyle = p.me ? 'rgba(255,201,77,.9)' : 'rgba(255,255,255,.18)'; g.stroke();
    let x = x0 + 20;
    if (p.badge) { g.font = fB; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText(p.badge, x, y0 + H / 2 + 1); x += bw; }
    g.font = fN; g.textBaseline = 'middle';
    g.lineWidth = 6; g.strokeStyle = 'rgba(10,8,24,.9)'; g.lineJoin = 'round'; g.strokeText(name, x, y0 + H / 2 + 1);
    g.fillStyle = p.color || (p.me ? '#ffd76a' : '#ffffff'); g.fillText(name, x, y0 + H / 2 + 1);
    x += nw + 10;
    if (lv) {
      g.font = fL;
      roundRect(g, x, y0 + 14, lw, H - 28, 12); g.fillStyle = p.me ? '#ffc94d' : '#8fb6ff'; g.fill();
      g.fillStyle = '#15122e'; g.textAlign = 'center'; g.fillText(lv, x + lw / 2, y0 + H / 2 + 1); g.textAlign = 'left';
    }
    e.plateTex.needsUpdate = true;
    // sprite scale: canvas px → metres; use the canvas aspect (whole canvas is mapped)
    e.plateW = c.width / PX_PER_M; e.plateH = c.height / PX_PER_M; e.plateFW = W / c.width;
  }

  bubble(login: string, text: string, ms: number): void {
    const e = this.entry(login);
    const t = clampText(text);
    if (!t) return;
    const now = performance.now();
    e.bubbleUntil = now + Math.max(1000, ms);
    if (t === e.bubbleKey && e.bubble) return;
    e.bubbleKey = t;
    if (!e.bubble) {
      e.bubbleCanvas = document.createElement('canvas'); e.bubbleCanvas.width = 512; e.bubbleCanvas.height = 256;
      e.bubbleTex = newTex(e.bubbleCanvas);
      e.bubbleMat = new THREE.SpriteMaterial({ map: e.bubbleTex, transparent: true, depthWrite: false, depthTest: true, opacity: 0 });
      e.bubble = new THREE.Sprite(e.bubbleMat);
      e.bubble.center.set(0.5, 0); e.bubble.renderOrder = 11; e.bubble.visible = false;
      this.root.add(e.bubble);
      e.bubbleShown = 0;
    }
    const c = e.bubbleCanvas!, g = c.getContext('2d')!;
    const font = `600 34px ${FONT}`, lh = 42, pad = 22, maxW = 400;
    const lines = wrapText(t, maxW, font, 4);
    g.font = font;
    let tw = 0; for (const l of lines) tw = Math.max(tw, g.measureText(l).width);
    const W = Math.ceil(Math.max(90, tw + pad * 2)), Hb = lines.length * lh + pad * 1.4, tail = 22;
    g.clearRect(0, 0, c.width, c.height);
    const x0 = Math.round((c.width - W) / 2), y0 = Math.round(c.height - tail - Hb - 6);
    // bubble with tail
    g.beginPath();
    const r = 26;
    g.moveTo(x0 + r, y0); g.arcTo(x0 + W, y0, x0 + W, y0 + Hb, r); g.arcTo(x0 + W, y0 + Hb, x0, y0 + Hb, r);
    g.lineTo(c.width / 2 + 16, y0 + Hb); g.lineTo(c.width / 2 - 4, y0 + Hb + tail); g.lineTo(c.width / 2 - 6, y0 + Hb);
    g.arcTo(x0, y0 + Hb, x0, y0, r); g.arcTo(x0, y0, x0 + W, y0, r); g.closePath();
    g.fillStyle = '#fffaf0'; g.fill();
    g.lineWidth = 5; g.strokeStyle = '#2b1d18'; g.lineJoin = 'round'; g.stroke();
    g.fillStyle = '#2b1d18'; g.textBaseline = 'middle'; g.textAlign = 'center';
    lines.forEach((l, i) => g.fillText(l, c.width / 2, y0 + pad * 0.7 + lh * (i + 0.5)));
    g.textAlign = 'left';
    e.bubbleTex!.needsUpdate = true;
    e.bubbleW = c.width / PX_PER_M; e.bubbleH = c.height / PX_PER_M; e.bubbleFW = W / c.width; e.bubbleFH = (c.height - y0) / c.height;
  }

  remove(login: string): void {
    const e = this.map.get(login);
    if (!e) return;
    this.root.remove(e.plate); e.plateTex.dispose(); e.plateMat.dispose();
    if (e.bubble) { this.root.remove(e.bubble); e.bubbleTex!.dispose(); e.bubbleMat!.dispose(); }
    this.map.delete(login);
  }

  /**
   * Options: `showMe` — draw our own plate in third person (never in first person); `range` — plate distance
   * ('near' ≈ 10 m, 'all' ≈ 25 m); `max` — at most this many plates (nearest first).
   */
  configure(o: { showMe?: boolean; range?: 'all' | 'near'; max?: number }): void {
    if (o.showMe !== undefined) this.showMe = o.showMe;
    if (o.range) this.plateFar = o.range === 'near' ? 10 : PLATE_FAR;
    if (o.max) this.maxPlates = Math.max(1, Math.min(MAX_CAND, o.max | 0));
  }

  update(anchors: ReadonlyMap<string, THREE.Vector3>, camera: THREE.Camera, dt: number): void {
    const now = performance.now();
    camera.updateMatrixWorld();
    camera.getWorldPosition(this.camPos);
    const V = camera.matrixWorldInverse.elements, P = (camera as THREE.PerspectiveCamera).projectionMatrix.elements;
    const px = P[0], py = P[5];
    this.tanHalf = 1 / py;
    // pass 0: project every anchor, collect candidates (no allocations: entries carry their own scratch fields)
    let n = 0;
    const cand = this.cand;
    for (const e of this.map.values()) {
      e.vis = 0; e.bVis = 0;
      const a = anchors.get(e.login);
      if (!a || a.y < -100 || n >= MAX_CAND) { e.dist = 1e9; continue; }
      const dx = a.x - this.camPos.x, dy = a.y - this.camPos.y, dz = a.z - this.camPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      e.dist = dist;
      // view-space depth (camera looks down −Z)
      const vz = V[2] * a.x + V[6] * a.y + V[10] * a.z + V[14];
      if (vz > -0.2) continue;                               // behind / at the camera
      if (e.me && dist < 1.2) continue;                      // own labels: never in first person
      const vx = V[0] * a.x + V[4] * a.y + V[8] * a.z + V[12], vy = V[1] * a.x + V[5] * a.y + V[9] * a.z + V[13];
      e.sx = (px * vx) / -vz; e.sy = (py * vy) / -vz; e.depth = -vz;
      if (e.sx < -1.3 || e.sx > 1.3 || e.sy < -1.3 || e.sy > 1.4) continue;
      cand[n++] = e;
    }
    // nearest first (insertion sort: n ≤ ~40, no allocations); our own plate yields to everybody else
    for (let i = 1; i < n; i++) {
      const e = cand[i], k = e.me ? 1e6 + e.dist : e.dist;
      let j = i - 1;
      while (j >= 0 && (cand[j].me ? 1e6 + cand[j].dist : cand[j].dist) > k) { cand[j + 1] = cand[j]; j--; }
      cand[j + 1] = e;
    }
    // pass 1: bubbles (they win over plates), nearest first; a bubble hidden behind a nearer one waits
    const R = this.rects; let nr = 0;
    for (let i = 0; i < n; i++) {
      const e = cand[i];
      if (!e.bubble || now >= e.bubbleUntil || e.dist >= BUBBLE_FAR) continue;
      const s = this.scaleFor(e.depth, BUBBLE_H);
      const hw = (e.bubbleW * e.bubbleFW * s * px) / e.depth / 2, h = (e.bubbleH * e.bubbleFH * s * py) / e.depth;
      const x0 = e.sx - hw, x1 = e.sx + hw, y0 = e.sy, y1 = e.sy + h;
      if (overlaps(R, nr, x0, y0, x1, y1, 0.5)) continue;
      R[nr * 4] = x0; R[nr * 4 + 1] = y0; R[nr * 4 + 2] = x1; R[nr * 4 + 3] = y1; nr++;
      e.bVis = 1; e.bScale = s; e.bTop = e.bubbleH * e.bubbleFH * s;
    }
    // pass 2: plates, nearest first, skipped where they would cover a nearer label; at most maxPlates
    let shown = 0;
    for (let i = 0; i < n && shown < this.maxPlates; i++) {
      const e = cand[i];
      if (e.dist >= this.plateFar || (e.me && !this.showMe)) continue;
      const s = this.scaleFor(e.depth, PLATE_H) * (e.me ? 0.85 : 1);
      const lift = e.bVis ? e.bTop * 0.96 : 0;
      const hw = (e.plateW * e.plateFW * s * px) / e.depth / 2, h0 = (lift * py) / e.depth, h = (e.plateH * PLATE_FH * s * py) / e.depth;
      const y0 = e.sy + h0 + (e.plateH * PLATE_FY0 * s * py) / e.depth;
      const x0 = e.sx - hw, x1 = e.sx + hw, y1 = y0 + h;
      if (overlaps(R, nr, x0, y0, x1, y1, 0.12)) continue;
      if (nr < MAX_CAND * 2) { R[nr * 4] = x0; R[nr * 4 + 1] = y0; R[nr * 4 + 2] = x1; R[nr * 4 + 3] = y1; nr++; }
      e.vis = 1; e.pScale = s; e.pLift = lift; shown++;
    }
    // pass 3: apply (fade in/out smoothly; hidden plates fade out instead of popping)
    const kIn = Math.min(1, dt * 10), kOut = Math.min(1, dt * 7);
    for (const e of this.map.values()) {
      const a = anchors.get(e.login);
      const far = this.plateFar;
      const df = e.dist < far - 6 ? 1 : Math.max(0, (far - e.dist) / 6);
      e.fade += ((e.vis ? 1 : 0) - e.fade) * (e.vis ? kIn : kOut);
      if (e.fade < 0.02 || !a) { e.plate.visible = false; e.fade = e.vis ? e.fade : 0; }
      else {
        if (e.vis) { e.lastScale = e.pScale; e.lastLift = e.pLift; }
        const s = e.lastScale;
        e.plate.visible = true;
        e.plate.scale.set(e.plateW * s, e.plateH * s, 1);
        e.plate.position.set(a.x, a.y + e.lastLift, a.z);
        e.plateMat.opacity = e.fade * df * (e.me ? 0.85 : 1);
        e.plate.renderOrder = 10 + (e.vis ? Math.max(0, 40 - Math.round(e.dist)) : 0);
      }
      if (e.bubble) {
        const live = now < e.bubbleUntil;
        e.bubbleShown += ((live && e.bVis ? 1 : 0) - e.bubbleShown) * Math.min(1, dt * (live && e.bVis ? 9 : 6));
        if ((e.bubbleShown < 0.02 && !(live && e.bVis)) || !a) { e.bubble.visible = false; continue; }
        const s = e.bVis ? e.bScale : e.bubble.scale.y / Math.max(1e-6, e.bubbleH);
        e.bubble.visible = true;
        e.bubble.scale.set(e.bubbleW * s, e.bubbleH * s, 1);
        e.bubble.position.set(a.x, a.y, a.z);
        e.bubbleMat!.opacity = e.bubbleShown * (e.dist > BUBBLE_FAR - 5 ? Math.max(0, (BUBBLE_FAR - e.dist) / 5) : 1);
        e.bubble.renderOrder = 60 + Math.max(0, 40 - Math.round(e.dist));
      }
    }
  }

  /** World scale for a label so its on-screen height shrinks gently with distance (≈ d^-0.35) and stays legible. */
  private scaleFor(depth: number, refH: number): number {
    // target height as a fraction of the screen height (NDC units are 2 per screen)
    const frac = Math.max(0.022, Math.min(0.044, 0.042 * Math.pow(3 / Math.max(0.5, depth), 0.35)));
    // NDC height of 1 m at this depth = py / depth (py = 1/tan(fov/2)); keep the plate box at `frac`
    return (frac * 2 * depth * this.tanHalf) / refH;
  }

  dispose(): void {
    for (const k of [...this.map.keys()]) this.remove(k);
    this.root.removeFromParent();
  }
}

/** Labels with the optional extras the integrator may use (configure). */
export type LabelsEx = Labels & { configure(o: { showMe?: boolean; range?: 'all' | 'near'; max?: number }): void };
export function createLabels(): LabelsEx { return new LabelsImpl(); }
