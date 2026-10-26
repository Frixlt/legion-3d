/**
 * Procedural tileable canvas textures (generated once, cached by key).
 * Every kind returns { map, normalMap?, roughnessMap? }: map is sRGB, the others linear; power-of-two, mipmapped,
 * RepeatWrapping. Colour maps come in the site's warm cartoon palette by default; `neutral: true` gives a light
 * greyscale version meant to be multiplied by vertex colours / material colour (used by the prop kit).
 */
import * as THREE from 'three';

export type TexKind =
  | 'cobble' | 'brick' | 'plaster' | 'wood' | 'roofTiles' | 'slate' | 'stone' | 'canvas' | 'metal'
  | 'grass' | 'soil' | 'water' | 'glow' | 'rock';

export interface TexOpts {
  /** Colours, meaning depends on the kind (see DEFAULTS). Missing entries fall back to defaults. */
  colors?: string[];
  /** Light greyscale version (for tinting with vertex colours). */
  neutral?: boolean;
  seed?: number;
  /** Canvas size (power of two, ≤ 1024). */
  size?: number;
  /** Normal map strength (default per kind). */
  bump?: number;
}

export interface TexSet { map: THREE.CanvasTexture; normalMap?: THREE.CanvasTexture; roughnessMap?: THREE.CanvasTexture }

/** Default colours per kind (CATS palette of the site). */
export const DEFAULTS: Record<TexKind, string[]> = {
  cobble: ['#c46a4c', '#b45a40', '#7a3426', '#e08a68'],       // stone, alt stone, mortar, highlight
  brick: ['#b85e48', '#a9503c', '#7a3426', '#d98a6a'],        // brick, alt, joint, highlight
  plaster: ['#f2d4a8', '#e6c08e', '#fff0d0'],                 // base, stain, light
  wood: ['#b07a50', '#8a5a38', '#5e3c24', '#d9a066'],         // plank, alt, gaps/grain, light
  roofTiles: ['#d0603e', '#b84e32', '#6e2a1c', '#f08a5e'],    // terracotta scalloped tiles
  slate: ['#7a4a8a', '#5f3a72', '#2e1d3a', '#a070b0'],        // purple slate shingles
  stone: ['#a59cb0', '#8e8698', '#4e4858', '#c8c0d2'],        // block, alt, joint, light
  canvas: ['#e0605a', '#f5e6d2'],                             // stripe A, stripe B
  metal: ['#3a3450', '#2a2440', '#6a6488'],                   // base, dark, highlight
  grass: ['#5a9a4a', '#3e7436', '#7fbf5a'],
  soil: ['#6e4a2f', '#523522', '#8a6040'],
  water: ['#3a7bd5', '#2a5aa8', '#9fd8ff'],
  glow: ['#ffffff'],
  rock: ['#8a6a5a', '#a8887a', '#5e4638', '#c4a898'],         // base, light facet, crack/dark, highlight
};

const NEUTRAL: Partial<Record<TexKind, string[]>> = {
  cobble: ['#f2f2f2', '#dedede', '#8c8c8c', '#ffffff'],
  brick: ['#f0f0f0', '#dcdcdc', '#8a8a8a', '#ffffff'],
  plaster: ['#f4f4f4', '#e2e2e2', '#ffffff'],
  wood: ['#f0f0f0', '#d8d8d8', '#9a9a9a', '#ffffff'],
  roofTiles: ['#f0f0f0', '#dadada', '#7a7a7a', '#ffffff'],
  slate: ['#f0f0f0', '#d6d6d6', '#7a7a7a', '#ffffff'],
  stone: ['#f0f0f0', '#dcdcdc', '#8e8e8e', '#ffffff'],
  canvas: ['#ffffff', '#e4e4e4'],
  metal: ['#e8e8e8', '#c8c8c8', '#ffffff'],
  grass: ['#eeeeee', '#cfcfcf', '#ffffff'],
  soil: ['#eeeeee', '#cccccc', '#ffffff'],
  water: ['#ffffff', '#dddddd', '#ffffff'],
  rock: ['#e4e4e4', '#f4f4f4', '#8a8a8a', '#ffffff'],
};

const DEFAULT_SIZE: Record<TexKind, number> = {
  cobble: 512, brick: 256, plaster: 256, wood: 256, roofTiles: 256, slate: 256, stone: 256, canvas: 128,
  metal: 128, grass: 256, soil: 128, water: 256, glow: 128, rock: 256,
};

let ANISO = 4;
const cache = new Map<string, TexSet>();
const all = new Set<THREE.Texture>();

/** Set anisotropy for all cached and future textures (pass renderer.capabilities.getMaxAnisotropy()). */
export function setTexAnisotropy(a: number): void {
  ANISO = Math.max(1, Math.min(16, a | 0));
  for (const t of all) { if (t.anisotropy !== ANISO) { t.anisotropy = ANISO; t.needsUpdate = true; } }
}

export function rng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

function mk(c: HTMLCanvasElement, srgb: boolean, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = ANISO;
  all.add(t);
  return t;
}

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/** Draw `fn` at the 9 wrapped offsets that intersect the tile (keeps shapes seamless). */
function wrap(S: number, x: number, y: number, w: number, h: number, fn: (dx: number, dy: number) => void): void {
  for (const dx of [0, -S, S]) for (const dy of [0, -S, S]) {
    if (x + dx + w < 0 || x + dx > S || y + dy + h < 0 || y + dy > S) continue;
    fn(dx, dy);
  }
}

/** Height canvas (greyscale) → tangent-space normal map canvas (Sobel, wrapped). */
function normalFromHeight(h: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const S = h.width, T = h.height;
  const src = h.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, S, T).data;
  const H = new Float32Array(S * T);
  for (let i = 0; i < S * T; i++) H[i] = src[i * 4] / 255;
  const [c, g] = canvas(S, T);
  const img = g.createImageData(S, T); const d = img.data;
  for (let y = 0; y < T; y++) {
    const ym = ((y - 1 + T) % T) * S, y0 = y * S, yp = ((y + 1) % T) * S;
    for (let x = 0; x < S; x++) {
      const xm = (x - 1 + S) % S, xp = (x + 1) % S;
      const dx = (H[ym + xp] + 2 * H[y0 + xp] + H[yp + xp]) - (H[ym + xm] + 2 * H[y0 + xm] + H[yp + xm]);
      const dy = (H[yp + xm] + 2 * H[yp + x] + H[yp + xp]) - (H[ym + xm] + 2 * H[ym + x] + H[ym + xp]);
      let nx = -dx * strength, ny = dy * strength, nz = 1;
      const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz); nx *= l; ny *= l; nz *= l;
      const o = (y0 + x) * 4;
      d[o] = (nx * 0.5 + 0.5) * 255; d[o + 1] = (ny * 0.5 + 0.5) * 255; d[o + 2] = (nz * 0.5 + 0.5) * 255; d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Height canvas → roughness canvas: low (mortar/gaps) = rough, high = `top` roughness. */
function roughFromHeight(h: HTMLCanvasElement, top: number, low: number): HTMLCanvasElement {
  const S = h.width, T = h.height;
  const src = h.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, S, T).data;
  const [c, g] = canvas(S, T);
  const img = g.createImageData(S, T); const d = img.data;
  for (let i = 0; i < S * T; i++) {
    const v = (low + (top - low) * (src[i * 4] / 255)) * 255;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function grey(v: number): string { const k = Math.max(0, Math.min(255, Math.round(v * 255))); return `rgb(${k},${k},${k})`; }

/** Soft-edged raised shape on the height canvas: dark rim → bright top (fake bevel by stacked insets). */
function bevelRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, top: number, steps = 4, inset = 2): void {
  for (let i = 0; i < steps; i++) {
    g.fillStyle = grey(top * (0.45 + 0.55 * (i + 1) / steps));
    rr(g, x + i * inset, y + i * inset, w - 2 * i * inset, h - 2 * i * inset, Math.max(1, r - i * inset)); g.fill();
  }
}

function noise(g: CanvasRenderingContext2D, S: number, r: () => number, n: number, col: string, a: number, sz: number): void {
  g.fillStyle = col; g.globalAlpha = a;
  for (let i = 0; i < n; i++) { const s = sz * (0.5 + r()); g.fillRect(r() * S, r() * S, s, s); }
  g.globalAlpha = 1;
}

type Gen = (S: number, C: CanvasRenderingContext2D, H: CanvasRenderingContext2D, k: string[], r: () => number) => void;

const GEN: Partial<Record<TexKind, Gen>> = {
  /** Rounded cobbles in staggered rows with mortar, highlight strokes and rare cracks. 1 tile ≈ 2 m. */
  cobble(S, C, H, k, r) {
    C.fillStyle = k[2]; C.fillRect(0, 0, S, S);
    H.fillStyle = grey(0.05); H.fillRect(0, 0, S, S);
    const rows = Math.max(8, Math.round(S / 64)),   // 1024 → 16 rows: the same cobble size, 4× less visible tiling
    bh = S / rows;
    for (let row = 0; row < rows; row++) {
      let x = (row % 2) * bh * 0.6 + r() * 6;
      const end = x + S;
      while (x < end - 4) {
        const w = bh * (0.9 + r() * 0.8);
        const ww = Math.min(w, end - x) - 5, hh = bh - 5 - r() * 3, y = row * bh + 2 + r() * 2;
        const xx = x + 2, col = r() < 0.32 ? k[1] : k[0];
        const top = 0.75 + r() * 0.25;
        wrap(S, xx, y, ww, hh, (dx, dy) => {
          C.fillStyle = col; rr(C, xx + dx, y + dy, ww, hh, bh * 0.32); C.fill();
          C.fillStyle = 'rgba(0,0,0,.12)'; rr(C, xx + dx + 2, y + dy + hh * 0.55, ww - 4, hh * 0.45, bh * 0.25); C.fill();
          C.strokeStyle = k[3]; C.globalAlpha = 0.55; C.lineWidth = 3; C.lineCap = 'round';
          C.beginPath(); C.moveTo(xx + dx + bh * 0.25, y + dy + 6); C.lineTo(xx + dx + ww * (0.5 + r() * 0.3), y + dy + 6); C.stroke(); C.globalAlpha = 1;
          bevelRect(H, xx + dx, y + dy, ww, hh, bh * 0.32, top, 5, 1.6);
        });
        x += w;
      }
    }
    noise(C, S, r, 260, '#000', 0.06, 3); noise(C, S, r, 160, '#fff', 0.06, 2);
  },
  /** Running-bond bricks (1 tile = 1.2 m wide, 6 courses). */
  brick(S, C, H, k, r) {
    C.fillStyle = k[2]; C.fillRect(0, 0, S, S);
    H.fillStyle = grey(0.1); H.fillRect(0, 0, S, S);
    const rows = 8, bh = S / rows, cols = 4, bw = S / cols;
    for (let row = 0; row < rows; row++) {
      const off = (row % 2) * bw / 2;
      for (let col = -1; col <= cols; col++) {
        const x = col * bw + off + 3, y = row * bh + 3, w = bw - 6, h = bh - 6;
        const v = r(); C.fillStyle = v < 0.25 ? k[1] : v > 0.9 ? k[3] : k[0];
        rr(C, x, y, w, h, 3); C.fill();
        C.fillStyle = 'rgba(255,255,255,.18)'; C.fillRect(x + 4, y + 3, w - 10, 3);
        C.fillStyle = 'rgba(0,0,0,.14)'; C.fillRect(x + 2, y + h - 4, w - 4, 3);
        bevelRect(H, x, y, w, h, 3, 0.8 + r() * 0.2, 3, 1.5);
      }
    }
    noise(C, S, r, 200, '#000', 0.07, 2);
  },
  /** Soft plaster with stains and a few cracks. */
  plaster(S, C, H, k, r) {
    C.fillStyle = k[0]; C.fillRect(0, 0, S, S);
    H.fillStyle = grey(0.6); H.fillRect(0, 0, S, S);
    for (let i = 0; i < 14; i++) {
      const x = r() * S, y = r() * S, rad = 12 + r() * 40, col = r() < 0.5 ? k[1] : k[2];
      wrap(S, x - rad, y - rad, rad * 2, rad * 2, (dx, dy) => {
        C.globalAlpha = 0.25; C.fillStyle = col; C.beginPath(); C.arc(x + dx, y + dy, rad, 0, 7); C.fill(); C.globalAlpha = 1;
        H.globalAlpha = 0.3; H.fillStyle = grey(r() < 0.5 ? 0.4 : 0.8); H.beginPath(); H.arc(x + dx, y + dy, rad * 0.8, 0, 7); H.fill(); H.globalAlpha = 1;
      });
    }
    for (let i = 0; i < 3; i++) {
      let x = r() * S * 0.8 + S * 0.1, y = r() * S * 0.8 + S * 0.1;
      C.strokeStyle = 'rgba(80,40,30,.35)'; H.strokeStyle = grey(0.2); C.lineWidth = H.lineWidth = 1.5;
      C.beginPath(); H.beginPath(); C.moveTo(x, y); H.moveTo(x, y);
      for (let j = 0; j < 4; j++) { x += (r() - 0.5) * 24; y += 6 + r() * 10; C.lineTo(x, y); H.lineTo(x, y); }
      C.stroke(); H.stroke();
    }
    noise(C, S, r, 900, '#000', 0.04, 2); noise(H, S, r, 900, '#000', 0.25, 2);
  },
  /** Vertical planks with grain and nail dots (planks run along v). 1 tile ≈ 1 m, 4 planks. */
  wood(S, C, H, k, r) {
    const n = 4, pw = S / n;
    C.fillStyle = k[2]; C.fillRect(0, 0, S, S);
    H.fillStyle = grey(0.05); H.fillRect(0, 0, S, S);
    for (let i = 0; i < n; i++) {
      const x = i * pw + 2, w = pw - 4;
      const cut = r() * S;   // plank end joint
      C.fillStyle = r() < 0.4 ? k[1] : k[0]; C.fillRect(x, 0, w, S);
      H.fillStyle = grey(0.85); H.fillRect(x + 1, 0, w - 2, S);
      H.fillStyle = grey(0.7); H.fillRect(x, 0, 1.5, S); H.fillRect(x + w - 1.5, 0, 1.5, S);
      // grain
      for (let j = 0; j < 4; j++) {
        const gx = x + 6 + r() * (w - 12), amp = 1 + r() * 3, ph = r() * 6;
        C.strokeStyle = k[2]; C.globalAlpha = 0.12 + r() * 0.12; C.lineWidth = 1.5 + r();
        H.strokeStyle = grey(0.65); H.lineWidth = 1;
        C.beginPath(); H.beginPath();
        for (let y = 0; y <= S; y += 8) {
          const xx = gx + Math.sin(y / S * Math.PI * 4 + ph) * amp;
          if (y === 0) { C.moveTo(xx, y); H.moveTo(xx, y); } else { C.lineTo(xx, y); H.lineTo(xx, y); }
        }
        C.stroke(); H.stroke(); C.globalAlpha = 1;
      }
      // highlight edge
      C.fillStyle = k[3]; C.globalAlpha = 0.35; C.fillRect(x + 2, 0, 2, S); C.globalAlpha = 1;
      // end joint + nails
      C.fillStyle = k[2]; C.fillRect(x, cut, w, 2); H.fillStyle = grey(0.1); H.fillRect(x, cut, w, 2);
      for (const ny of [cut + 8, cut - 8]) {
        const yy = (ny + S) % S;
        for (const nx of [x + w * 0.25, x + w * 0.75]) {
          C.fillStyle = 'rgba(40,25,20,.75)'; C.beginPath(); C.arc(nx, yy, 2.2, 0, 7); C.fill();
          H.fillStyle = grey(1); H.beginPath(); H.arc(nx, yy, 2, 0, 7); H.fill();
        }
      }
      // knot
      if (r() < 0.6) {
        const kx = x + w * (0.3 + r() * 0.4), ky = r() * S;
        C.strokeStyle = k[2]; C.globalAlpha = 0.5; C.lineWidth = 1.5;
        C.beginPath(); C.ellipse(kx, ky, 3, 6, 0, 0, 7); C.stroke(); C.beginPath(); C.ellipse(kx, ky, 5.5, 10, 0, 0, 7); C.stroke(); C.globalAlpha = 1;
      }
    }
  },
  /** Scalloped terracotta tiles (rows overlap downward). 1 tile ≈ 1 m. */
  roofTiles(S, C, H, k, r) { scales(S, C, H, k, r, 6, 5, true); },
  /** Purple slate shingles: rectangular with clipped corners. */
  slate(S, C, H, k, r) { scales(S, C, H, k, r, 7, 6, false); },
  /** Large ashlar stone blocks (2 courses per 1 m tile). */
  stone(S, C, H, k, r) {
    C.fillStyle = k[2]; C.fillRect(0, 0, S, S);
    H.fillStyle = grey(0.1); H.fillRect(0, 0, S, S);
    const rows = 4, bh = S / rows;
    for (let row = 0; row < rows; row++) {
      let x = r() * bh; const end = x + S;
      while (x < end - 6) {
        const w = Math.min(bh * (1.1 + r() * 0.9), end - x);
        const xx = x + 3, y = row * bh + 3, ww = w - 6, hh = bh - 6;
        const col = r() < 0.35 ? k[1] : k[0], top = 0.7 + r() * 0.3;
        wrap(S, xx, y, ww, hh, (dx, dy) => {
          C.fillStyle = col; rr(C, xx + dx, y + dy, ww, hh, 6); C.fill();
          C.fillStyle = k[3]; C.globalAlpha = 0.4; C.fillRect(xx + dx + 5, y + dy + 4, ww - 12, 3); C.globalAlpha = 1;
          C.fillStyle = 'rgba(0,0,0,.12)'; C.fillRect(xx + dx + 3, y + dy + hh - 6, ww - 6, 5);
          bevelRect(H, xx + dx, y + dy, ww, hh, 6, top, 4, 2);
        });
        if (r() < 0.3) { C.strokeStyle = k[2]; C.lineWidth = 1.5; C.beginPath(); const cx = xx + r() * ww; C.moveTo(cx, y); C.lineTo(cx + 5, y + hh * 0.4); C.lineTo(cx + 1, y + hh * 0.7); C.stroke(); }
        x += w;
      }
    }
    noise(C, S, r, 500, '#000', 0.06, 2); noise(C, S, r, 300, '#fff', 0.05, 2); noise(H, S, r, 600, '#000', 0.2, 2);
  },
  /**
   * Natural rock (no courses, no rows): overlapping angular facets in base/light tones, dark fractures and grit.
   * 1 tile ≈ 1.6 m in the world (MAT_UV in batch.ts); meant for flat-shaded low-poly boulders (each face projects
   * along its own normal, so there is no stretching).
   */
  rock(S, C, H, k, r) {
    C.fillStyle = k[0]; C.fillRect(0, 0, S, S);
    H.fillStyle = grey(0.45); H.fillRect(0, 0, S, S);
    const poly = (g: CanvasRenderingContext2D, cx: number, cy: number, rad: number, n: number, rot: number) => {
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const a = rot + (i / n) * Math.PI * 2, rr2 = rad * (0.6 + r() * 0.5);
        const x = cx + Math.cos(a) * rr2, y = cy + Math.sin(a) * rr2 * (0.55 + r() * 0.3);
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.closePath();
    };
    // big facets → medium chips (light planes catch the light, dark ones are in shade)
    for (const [n, rad] of [[22, S * 0.16], [70, S * 0.07], [160, S * 0.03]] as const) {
      for (let i = 0; i < n; i++) {
        const cx = r() * S, cy = r() * S, rot = r() * 6.28, sides = 4 + Math.floor(r() * 3), t = r();
        const col = t < 0.45 ? k[1] : t < 0.7 ? k[0] : k[2], h = t < 0.45 ? 0.62 + r() * 0.3 : t < 0.7 ? 0.45 : 0.3;
        const a = rad > S * 0.1 ? 0.35 : 0.42;
        wrap(S, cx - rad, cy - rad, rad * 2, rad * 2, (dx, dy) => {
          C.globalAlpha = col === k[2] ? a * 0.55 : a; C.fillStyle = col; poly(C, cx + dx, cy + dy, rad, sides, rot); C.fill();
          H.globalAlpha = 0.7; H.fillStyle = grey(h); poly(H, cx + dx, cy + dy, rad, sides, rot); H.fill();
          if (col === k[1] && rad > S * 0.05) { C.globalAlpha = 0.18; C.fillStyle = k[3]; C.fillRect(cx + dx - rad * 0.4, cy + dy - rad * 0.45, rad * 0.7, 2); }
        });
        C.globalAlpha = 1; H.globalAlpha = 1;
      }
    }
    // fractures: jagged dark lines (low in the height map)
    for (let i = 0; i < 14; i++) {
      let x = r() * S, y = r() * S; const len = 4 + Math.floor(r() * 6), dir = r() * 6.28;
      C.strokeStyle = k[2]; C.globalAlpha = 0.6; C.lineWidth = 1 + r() * 1.2; H.strokeStyle = grey(0.15); H.lineWidth = 2.5;
      C.beginPath(); H.beginPath(); C.moveTo(x, y); H.moveTo(x, y);
      for (let j = 0; j < len; j++) { x += Math.cos(dir + (r() - 0.5) * 1.6) * S * 0.035; y += Math.sin(dir + (r() - 0.5) * 1.6) * S * 0.035; C.lineTo(x, y); H.lineTo(x, y); }
      C.stroke(); H.stroke(); C.globalAlpha = 1;
    }
    noise(C, S, r, 900, '#000', 0.08, 2); noise(C, S, r, 500, '#fff', 0.07, 1.5); noise(H, S, r, 900, '#000', 0.25, 2); noise(H, S, r, 500, '#fff', 0.2, 2);
  },
  /** Vertical stripes (A/B) of woven canvas. 2 stripe pairs per tile. */
  canvas(S, C, H, k) {
    const n = 4, w = S / n;
    for (let i = 0; i < n; i++) { C.fillStyle = k[i % 2]; C.fillRect(i * w, 0, w, S); }
    H.fillStyle = grey(0.5); H.fillRect(0, 0, S, S);
    // weave
    for (let y = 0; y < S; y += 2) { C.fillStyle = y % 4 ? 'rgba(0,0,0,.05)' : 'rgba(255,255,255,.05)'; C.fillRect(0, y, S, 1); H.fillStyle = grey(y % 4 ? 0.4 : 0.6); H.fillRect(0, y, S, 1); }
    for (let x = 0; x < S; x += 2) { C.fillStyle = 'rgba(0,0,0,.04)'; C.fillRect(x, 0, 1, S); }
    for (let i = 0; i < n; i++) { C.fillStyle = 'rgba(0,0,0,.12)'; C.fillRect(i * w, 0, 1.5, S); }
  },
  /** Brushed dark iron with rivets. */
  metal(S, C, H, k, r) {
    C.fillStyle = k[0]; C.fillRect(0, 0, S, S);
    H.fillStyle = grey(0.5); H.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y++) { C.fillStyle = r() < 0.5 ? k[1] : k[2]; C.globalAlpha = 0.08 + r() * 0.1; C.fillRect(0, y, S, 1); }
    C.globalAlpha = 1;
    for (let i = 0; i < 8; i++) { C.fillStyle = k[1]; C.globalAlpha = 0.25; const x = r() * S, y = r() * S, rad = 6 + r() * 14; C.beginPath(); C.arc(x, y, rad, 0, 7); C.fill(); }
    C.globalAlpha = 1;
    for (const [x, y] of [[S * 0.12, S * 0.12], [S * 0.62, S * 0.12], [S * 0.12, S * 0.62], [S * 0.62, S * 0.62]]) {
      C.fillStyle = k[2]; C.beginPath(); C.arc(x, y, 3, 0, 7); C.fill();
      H.fillStyle = grey(1); H.beginPath(); H.arc(x, y, 3.2, 0, 7); H.fill();
    }
    noise(H, S, r, 400, '#000', 0.2, 1.5);
  },
  /** Stylised grass: dark base + many short blade strokes and a few tiny flowers. */
  grass(S, C, H, k, r) {
    C.fillStyle = k[1]; C.fillRect(0, 0, S, S);
    H.fillStyle = grey(0.3); H.fillRect(0, 0, S, S);
    C.lineCap = H.lineCap = 'round';
    for (let i = 0; i < 1400; i++) {
      const x = r() * S, y = r() * S, l = 4 + r() * 7, a = -Math.PI / 2 + (r() - 0.5) * 0.9;
      const col = r() < 0.5 ? k[0] : r() < 0.6 ? k[2] : k[1];
      C.strokeStyle = col; C.lineWidth = 1.5 + r() * 1.5; H.strokeStyle = grey(0.5 + r() * 0.5); H.lineWidth = 1.5;
      wrap(S, x - l, y - l, 2 * l, 2 * l, (dx, dy) => {
        C.beginPath(); C.moveTo(x + dx, y + dy); C.lineTo(x + dx + Math.cos(a) * l, y + dy + Math.sin(a) * l); C.stroke();
        H.beginPath(); H.moveTo(x + dx, y + dy); H.lineTo(x + dx + Math.cos(a) * l, y + dy + Math.sin(a) * l); H.stroke();
      });
    }
    if (k === DEFAULTS.grass) for (let i = 0; i < 10; i++) { C.fillStyle = r() < 0.5 ? '#ffd6e6' : '#fff3a0'; C.beginPath(); C.arc(r() * S, r() * S, 2.2, 0, 7); C.fill(); }
  },
  /** Soil with pebbles. */
  soil(S, C, H, k, r) {
    C.fillStyle = k[0]; C.fillRect(0, 0, S, S);
    H.fillStyle = grey(0.4); H.fillRect(0, 0, S, S);
    noise(C, S, r, 500, k[1], 0.5, 3); noise(C, S, r, 200, k[2], 0.5, 2); noise(H, S, r, 500, '#000', 0.3, 3);
    for (let i = 0; i < 18; i++) {
      const x = r() * S, y = r() * S, rad = 1.5 + r() * 3;
      C.fillStyle = k[2]; C.beginPath(); C.ellipse(x, y, rad * 1.3, rad, 0, 0, 7); C.fill();
      H.fillStyle = grey(0.9); H.beginPath(); H.ellipse(x, y, rad * 1.3, rad, 0, 0, 7); H.fill();
    }
  },
};

/** Shared scale/shingle painter (rows painted bottom→top so upper rows overlap lower). */
function scales(S: number, C: CanvasRenderingContext2D, H: CanvasRenderingContext2D, k: string[], r: () => number, rows: number, n: number, round: boolean): void {
  C.fillStyle = k[2]; C.fillRect(0, 0, S, S);
  H.fillStyle = grey(0.1); H.fillRect(0, 0, S, S);
  const h = S / rows, w = S / n;
  for (let row = rows; row >= -1; row--) {
    const off = (((row % 2) + 2) % 2) * w / 2;
    for (let i = -1; i <= n; i++) {
      const x = i * w + off + 1, y = row * h, ww = w - 2, hh = h * 1.35;
      const col = r() < 0.25 ? k[1] : r() < 0.08 ? k[3] : k[0];
      const path = (g: CanvasRenderingContext2D, dy: number, ins: number) => {
        g.beginPath();
        if (round) {
          g.moveTo(x + ins, y + dy); g.lineTo(x + ins, y + dy + hh - ww / 2);
          g.arc(x + ww / 2, y + dy + hh - ww / 2, ww / 2 - ins, Math.PI, 0, true); g.lineTo(x + ww - ins, y + dy);
        } else {
          const c = ww * 0.22;
          g.moveTo(x + ins, y + dy); g.lineTo(x + ins, y + dy + hh - c); g.lineTo(x + c, y + dy + hh - ins);
          g.lineTo(x + ww - c, y + dy + hh - ins); g.lineTo(x + ww - ins, y + dy + hh - c); g.lineTo(x + ww - ins, y + dy);
        }
        g.closePath();
      };
      for (const dy of [0, S, -S]) {
        if (y + dy > S || y + dy + hh < 0) continue;
        C.fillStyle = col; path(C, dy, 0); C.fill();
        C.strokeStyle = k[2]; C.lineWidth = 2.5; C.stroke();
        C.fillStyle = k[3]; C.globalAlpha = 0.35; C.fillRect(x + 4, y + dy + hh * 0.55, ww * 0.12, hh * 0.3); C.globalAlpha = 1;
        C.fillStyle = 'rgba(0,0,0,.15)'; C.fillRect(x, y + dy, ww, h * 0.18);
        for (let s = 0; s < 4; s++) { H.fillStyle = grey(0.35 + 0.65 * (s + 1) / 4 * (0.4 + 0.6 * (row % 2 ? 0.95 : 1))); path(H, dy - s * 0, s * 1.6); H.fill(); }
        // vertical gradient: tile bottom edge high, top tucked under
        const gr = H.createLinearGradient(0, y + dy, 0, y + dy + hh);
        gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(0.5, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        H.fillStyle = gr; path(H, dy, 2); H.fill();
      }
    }
  }
  noise(C, S, r, 300, '#000', 0.06, 2);
}

/** Water: deep colour with light ripple strokes; normal map from a sum of tileable sine waves. */
function water(S: number, k: string[], r: () => number, bump: number): TexSet {
  const [c, C] = canvas(S);
  const gr = C.createLinearGradient(0, 0, S, S); gr.addColorStop(0, k[0]); gr.addColorStop(0.5, k[1]); gr.addColorStop(1, k[0]);
  C.fillStyle = gr; C.fillRect(0, 0, S, S);
  C.strokeStyle = k[2]; C.lineCap = 'round';
  for (let i = 0; i < 18; i++) {
    const x = r() * S, y = r() * S, w = 16 + r() * 34;
    C.globalAlpha = 0.35 + r() * 0.3; C.lineWidth = 2 + r() * 2;
    wrap(S, x, y - 10, w, 20, (dx, dy) => { C.beginPath(); C.moveTo(x + dx, y + dy); C.quadraticCurveTo(x + dx + w / 2, y + dy - 7, x + dx + w, y + dy); C.stroke(); });
  }
  C.globalAlpha = 1;
  // tileable height field
  const N = 128; const [hc, H] = canvas(N);
  const img = H.createImageData(N, N); const d = img.data;
  const waves: [number, number, number, number][] = [];
  for (let i = 0; i < 7; i++) waves.push([1 + Math.floor(r() * 4), Math.floor(r() * 5) - 2, r() * 6.28, 0.5 + r() * 0.5]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0;
    for (const [fx, fy, ph, a] of waves) v += a * Math.sin(((fx * x + fy * y) / N) * Math.PI * 2 + ph);
    const g = (v / 7) * 0.5 + 0.5, o = (y * N + x) * 4;
    d[o] = d[o + 1] = d[o + 2] = g * 255; d[o + 3] = 255;
  }
  H.putImageData(img, 0, 0);
  return { map: mk(c, true), normalMap: mk(normalFromHeight(hc, bump), false) };
}

function glow(S: number): TexSet {
  const [c, g] = canvas(S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,255,255,.8)');
  gr.addColorStop(0.4, 'rgba(255,255,255,.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return { map: mk(c, true, false) };
}

const BUMP: Record<TexKind, number> = {
  cobble: 3, brick: 2.5, plaster: 1.2, wood: 1.6, roofTiles: 2.5, slate: 2.5, stone: 2.5, canvas: 1, metal: 1.2,
  grass: 1.5, soil: 1.5, water: 2.5, glow: 0, rock: 3,
};
const ROUGH: Partial<Record<TexKind, [number, number]>> = {
  cobble: [0.7, 1], stone: [0.75, 1], rock: [0.7, 1], brick: [0.8, 1], roofTiles: [0.6, 0.95], slate: [0.55, 0.95], metal: [0.45, 0.7],
};

function pow2(n: number): number { let p = 16; while (p < n && p < 1024) p *= 2; return p; }

/** Cached procedural texture set. Key = kind + options. */
export function getTexture(kind: TexKind, opts: TexOpts = {}): TexSet {
  const S = pow2(opts.size ?? DEFAULT_SIZE[kind]);
  const base = opts.neutral ? (NEUTRAL[kind] ?? DEFAULTS[kind]) : DEFAULTS[kind];
  const k = base.map((c, i) => opts.colors?.[i] ?? c);
  const seed = opts.seed ?? 1;
  const bump = opts.bump ?? BUMP[kind];
  const key = `${kind}|${k.join(',')}|${seed}|${S}|${bump}`;
  const hit = cache.get(key); if (hit) return hit;
  const r = rng(seed * 7919 + kind.length * 131);
  let set: TexSet;
  if (kind === 'water') set = water(S, k, r, bump);
  else if (kind === 'glow') set = glow(S);
  else {
    // height (→ normal/roughness) at half resolution for big tiles: 4× cheaper Sobel, visually identical
    const hs = S >= 512 ? S / 2 : S;
    const [c, C] = canvas(S); const [hc, H] = canvas(hs);
    if (hs !== S) H.scale(hs / S, hs / S);
    GEN[kind]!(S, C, H, k, r);
    set = { map: mk(c, true), normalMap: mk(normalFromHeight(hc, bump * hs / S), false) };
    const ro = ROUGH[kind]; if (ro) set.roughnessMap = mk(roughFromHeight(hc, ro[0], ro[1]), false);
  }
  cache.set(key, set);
  return set;
}

/** All kinds (for tests/demo). */
export const TEX_KINDS: TexKind[] = ['cobble', 'brick', 'plaster', 'wood', 'roofTiles', 'slate', 'stone', 'canvas', 'metal', 'grass', 'soil', 'water', 'glow', 'rock'];

/** Dispose every cached texture. */
export function disposeTextures(): void {
  for (const t of all) t.dispose();
  all.clear(); cache.clear();
}
