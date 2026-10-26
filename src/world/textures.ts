/** Procedural canvas textures of the city. Generated once per buildCity(), disposed with the world. */
import * as THREE from 'three';
import type { Pal } from './palette';

export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, repeat = true, aniso = 8, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  return t;
}

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

function _paw(g: CanvasRenderingContext2D, x: number, y: number, s: number, col: string) {
  g.fillStyle = col;
  g.beginPath(); g.ellipse(x, y + s * 0.25, s * 0.42, s * 0.34, 0, 0, Math.PI * 2); g.fill();
  for (const [dx, dy] of [[-0.45, -0.25], [-0.15, -0.5], [0.15, -0.5], [0.45, -0.25]]) {
    g.beginPath(); g.ellipse(x + dx * s, y + dy * s, s * 0.14, s * 0.18, 0, 0, Math.PI * 2); g.fill();
  }
}

/** Radial glow for additive sprites/points. */
export function glowTexture(): THREE.CanvasTexture {
  const S = 128; const [c, g] = canvas(S, S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,.75)');
  gr.addColorStop(0.45, 'rgba(255,255,255,.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return tex(c, false, 1);
}

/** Soft round dot for stars / bulbs. */
export function dotTexture(): THREE.CanvasTexture {
  const S = 64; const [c, g] = canvas(S, S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.95)'); gr.addColorStop(0.6, 'rgba(255,255,255,.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return tex(c, false, 1);
}

/** Moon disc with craters and a soft halo. */
export function moonTexture(): THREE.CanvasTexture {
  const S = 256; const [c, g] = canvas(S, S);
  const halo = g.createRadialGradient(S / 2, S / 2, S * 0.2, S / 2, S / 2, S / 2);
  halo.addColorStop(0, 'rgba(255,240,190,.5)'); halo.addColorStop(1, 'rgba(255,240,190,0)');
  g.fillStyle = halo; g.fillRect(0, 0, S, S);
  g.fillStyle = '#fff3c4'; g.beginPath(); g.arc(S / 2, S / 2, S * 0.22, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#2b1d18'; g.lineWidth = 5; g.stroke();
  g.fillStyle = '#ecd9a0';
  for (const [x, y, rr0] of [[-0.07, -0.05, 0.05], [0.08, 0.06, 0.035], [0.02, 0.11, 0.025], [-0.09, 0.08, 0.02]]) {
    g.beginPath(); g.arc(S / 2 + x * S, S / 2 + y * S, rr0 * S, 0, Math.PI * 2); g.fill();
  }
  return tex(c, false, 1);
}

/** Sign atlas: one canvas, many signboards. Returns uv rects per key. */
export class SignAtlas {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  private g: CanvasRenderingContext2D;
  private n = 0;
  private readonly cw = 512; private readonly ch = 128; private readonly cols = 4; private readonly rows = 16;
  constructor(private pal: Pal) {
    const [c, g] = canvas(this.cw * this.cols, this.ch * this.rows);
    this.canvas = c; this.g = g;
    this.texture = tex(c, false, 4);
  }
  /** Draw a sign; returns [u0, v0, u1, v1] and aspect (w/h). */
  add(text: string, opts: { bg?: string; fg?: string; sub?: string } = {}): { uv: [number, number, number, number]; aspect: number } {
    const i = this.n++ % (this.cols * this.rows);
    const x = (i % this.cols) * this.cw, y = Math.floor(i / this.cols) * this.ch;
    const g = this.g, P = this.pal, W = this.cw, H = this.ch;
    g.save(); g.translate(x, y);
    g.fillStyle = P.line; rr(g, 4, 4, W - 8, H - 8, 22); g.fill();
    g.fillStyle = opts.bg || P.sign; rr(g, 12, 12, W - 24, H - 24, 16); g.fill();
    g.strokeStyle = opts.fg || P.signTx; g.globalAlpha = 0.5; g.lineWidth = 3; rr(g, 20, 20, W - 40, H - 40, 12); g.stroke(); g.globalAlpha = 1;
    const fam = "'Russo One','Dela Gothic One','Arial Black',sans-serif";
    let fs = opts.sub ? 50 : 60;
    g.font = `${fs}px ${fam}`;
    const up = text.toUpperCase();
    while (g.measureText(up).width > W - 70 && fs > 18) { fs -= 2; g.font = `${fs}px ${fam}`; }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const ty = opts.sub ? H * 0.42 : H * 0.53;
    g.lineWidth = 8; g.strokeStyle = P.line; g.lineJoin = 'round'; g.strokeText(up, W / 2, ty);
    g.fillStyle = opts.fg || P.signTx; g.fillText(up, W / 2, ty);
    if (opts.sub) { g.font = `22px ${fam}`; g.fillStyle = '#fff4e0'; g.globalAlpha = 0.85; g.fillText(opts.sub, W / 2, H * 0.78, W - 60); g.globalAlpha = 1; }
    g.restore();
    this.texture.needsUpdate = true;
    const CW = this.cw * this.cols, CH = this.ch * this.rows;
    // three.js flipY: v measured from bottom
    return { uv: [x / CW, 1 - (y + H) / CH, (x + W) / CW, 1 - y / CH], aspect: W / H };
  }
}
