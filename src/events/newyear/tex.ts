/** New Year textures, rasterised on the CPU (DataTextures; no canvas, no assets — original shapes drawn here). */
import * as THREE from 'three';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
function hash2(x: number, y: number, s: number): number { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x: number, y: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), e = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + e) * u * v;
}
function make(w: number, h: number, d: Uint8Array): THREE.DataTexture {
  const t = new THREE.DataTexture(d, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/**
 * A snow drift seen from above: a lumpy rounded blob with a soft rim; rgb = a faint blue shade towards the rim (the
 * drift's slope), alpha = the shape. Several variants side by side in u (variant k = u in [k/n, (k+1)/n]).
 */
export function driftTexture(size = 128, variants = 4): THREE.DataTexture {
  const W = size * variants, H = size, d = new Uint8Array(W * H * 4);
  for (let v = 0; v < variants; v++) for (let y = 0; y < H; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size * 2 - 1, w = (y + 0.5) / size * 2 - 1, r = Math.hypot(u, w), a = Math.atan2(w, u);
    const edge = 0.72 + 0.16 * vnoise(Math.cos(a) * 2.2 + 5, Math.sin(a) * 2.2 + 5, 3 + v * 7) + 0.08 * Math.sin(a * 3 + v * 1.7);
    const fill = 1 - smooth(edge - 0.22, edge, r);
    const n = 0.85 + 0.15 * vnoise(u * 6 + v * 3, w * 6, 11 + v);
    const shade = 1 - 0.18 * smooth(0.2, 1, r / edge);
    const i = (y * W + v * size + x) * 4;
    d[i] = Math.round(255 * shade * 0.94 * n); d[i + 1] = Math.round(255 * shade * 0.97 * n); d[i + 2] = Math.round(255 * Math.min(1, shade * 1.04));
    d[i + 3] = Math.round(255 * fill);
  }
  return make(W, H, d);
}

/** A snowball splat: a dense round core with a few blobby splashes around it. White, alpha = shape. */
export function splatTexture(size = 64): THREE.DataTexture {
  const d = new Uint8Array(size * size * 4);
  const blobs: [number, number, number][] = [[0, 0, 0.42]];
  for (let k = 0; k < 7; k++) { const a = k * 0.9 + 0.4, r = 0.55 + 0.25 * ((k * 37) % 5) / 5; blobs.push([Math.cos(a) * r, Math.sin(a) * r, 0.08 + 0.05 * (k % 3)]); }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size * 2 - 1, w = (y + 0.5) / size * 2 - 1;
    let a = 0;
    for (const [bx, by, br] of blobs) a = Math.max(a, 1 - smooth(br * 0.75, br, Math.hypot(u - bx, w - by)));
    const i = (y * size + x) * 4, sh = 1 - 0.12 * Math.min(1, Math.hypot(u, w));
    d[i] = Math.round(244 * sh); d[i + 1] = Math.round(248 * sh); d[i + 2] = 255; d[i + 3] = Math.round(255 * a);
  }
  return make(size, size, d);
}

/**
 * Patchy snow cover for the street (tiles seamlessly): soft-edged patches from a periodic 3-octave value noise, with a
 * faint sparkle; rgb = snow white with blue shade in the thin parts, alpha = coverage (≈ 55 % of the tile).
 */
export function snowCoverTexture(size = 256): THREE.DataTexture {
  const d = new Uint8Array(size * size * 4);
  const pn = (x: number, y: number, p: number, s: number) => {   // periodic value noise, period p cells
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const h = (i: number, j: number) => hash2(((i % p) + p) % p, ((j % p) + p) % p, s);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), e = h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + e) * u * v;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const n = 0.55 * pn(u * 4, v * 4, 4, 5) + 0.3 * pn(u * 9, v * 9, 9, 9) + 0.15 * pn(u * 23, v * 23, 23, 13);
    const a = smooth(0.42, 0.56, n), core = smooth(0.5, 0.7, n);
    const sp = hash2(x, y, 77) > 0.996 ? 1 : 0;
    const i = (y * size + x) * 4, sh = 0.86 + 0.14 * core;
    d[i] = Math.round(255 * Math.min(1, sh * 0.95 + sp * 0.1)); d[i + 1] = Math.round(255 * Math.min(1, sh * 0.97 + sp * 0.1)); d[i + 2] = 255;
    d[i + 3] = Math.round(255 * a * (0.75 + 0.25 * core));
  }
  const t = make(size, size, d); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
