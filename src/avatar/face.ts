/**
 * Face decals: eyes, nose, mouth, blush, whiskers drawn on a canvas, one texture per face combo (cached),
 * applied to a patch of the body surface (planar projection from the front).
 */
import * as THREE from 'three';
import { INK, radiusAt, sectionXZ, type BodyDims } from './geom';

/** Face texture covers x ∈ [-FW, FW] and y ∈ [eyeY - FB, eyeY + FT] (metres) of the body front. */
export const FW = 0.27, FT = 0.2, FB = 0.34;
const SZ = 256, PX = SZ / (2 * FW);        // px per metre
const EYE_Y = FT * PX;                     // canvas y of the eye line
const IRIS = ['#9be15d', '#ffd23f', '#f5a623', '#6ec6ff', '#7bdcb5'];
const NOSE = '#ff8fa3';

export interface FaceKey { eyes: string; mouth: string; blush: boolean; iris: number; style: string; narrow: boolean; ghost: boolean }
export const faceKeyStr = (f: FaceKey) => `${f.eyes}|${f.mouth}|${+f.blush}|${f.iris}|${f.style}|${+f.narrow}|${+f.ghost}`;

const texCache = new Map<string, THREE.CanvasTexture>();

export function faceTexture(f: FaceKey): THREE.CanvasTexture {
  const key = faceKeyStr(f);
  let t = texCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas'); c.width = c.height = SZ;
  drawFace(c.getContext('2d')!, f);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}

function drawFace(g: CanvasRenderingContext2D, f: FaceKey) {
  const cx = SZ / 2, ey = EYE_Y, u = PX * 0.0113;   // u: one site SVG unit in px (≈ 5.4 px)
  const ex = (f.narrow ? 9.5 : 11.5) * u, my = ey + 15.5 * u;
  const cat = f.style === 'cats', monkey = f.style === 'monkeys' || f.style === 'ugabugi';
  g.lineCap = 'round'; g.lineJoin = 'round';
  const ink = f.ghost ? '#1d2a4a' : INK;
  const iris = IRIS[f.iris % IRIS.length];

  if (monkey) {   // pale muzzle: heart-ish face plate
    g.fillStyle = 'rgba(255,228,196,.82)';
    g.beginPath(); g.ellipse(cx - ex * 0.9, ey + 2 * u, ex * 1.05, 10 * u, 0, 0, Math.PI * 2); g.ellipse(cx + ex * 0.9, ey + 2 * u, ex * 1.05, 10 * u, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(cx, my + 1 * u, 17 * u, 10.5 * u, 0, 0, Math.PI * 2); g.fill();
  }
  // blush
  if (f.blush) {
    g.fillStyle = 'rgba(255,122,162,.55)';
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * (ex + 9 * u), ey + 8 * u, 4.6 * u, 2.9 * u, 0, 0, Math.PI * 2); g.fill(); }
  }
  // whiskers
  if (cat) {
    g.strokeStyle = 'rgba(43,29,24,.55)'; g.lineWidth = 1.3 * u;
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
      g.beginPath(); g.moveTo(cx + s * 16 * u, my - 2 * u + i * 2.6 * u); g.lineTo(cx + s * (31 + i) * u, my - 5 * u + i * 4.5 * u); g.stroke();
    }
  }
  // eyes
  const eyeIris = (x: number, y: number, r: number) => {
    g.fillStyle = iris; g.strokeStyle = ink; g.lineWidth = 2 * u;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = ink; g.beginPath();
    if (cat) g.ellipse(x, y, r * 0.24, r * 0.78, 0, 0, Math.PI * 2); else g.arc(x + r * 0.08, y + r * 0.1, r * 0.48, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(x - r * 0.38, y - r * 0.4, r * 0.26, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(x + r * 0.3, y + r * 0.35, r * 0.12, 0, Math.PI * 2); g.fill();
  };
  const starPath = (x: number, y: number, r: number) => {
    g.beginPath();
    for (let i = 0; i < 10; i++) { const a = (i * 36 - 90) * Math.PI / 180, q = i % 2 ? r * 0.45 : r; i ? g.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q) : g.moveTo(x + Math.cos(a) * q, y + Math.sin(a) * q); }
    g.closePath();
  };
  const xs = [cx - ex, cx + ex];
  // chibi: eyes ~1.3× the doodle size, scaled around the eye line
  g.save(); g.translate(cx, ey); g.scale(1.3, 1.3); g.translate(-cx, -ey);
  xs[0] = cx - ex / 1.3; xs[1] = cx + ex / 1.3;
  switch (f.eyes) {
    case 'big': case 'wide': for (const x of xs) eyeIris(x, ey, 7 * u); break;
    case 'cyclops': eyeIris(cx, ey - 2 * u, 9.5 * u); break;
    case 'stars':
      for (const x of xs) { starPath(x, ey, 6.4 * u); g.fillStyle = '#ffd23f'; g.fill(); g.strokeStyle = ink; g.lineWidth = 1.6 * u; g.stroke(); }
      break;
    case 'happy': case 'sleepy':
      g.strokeStyle = ink; g.lineWidth = 2.6 * u;
      for (const x of xs) { g.beginPath(); g.moveTo(x - 5 * u, ey + 1.5 * u); g.quadraticCurveTo(x, ey - 6 * u, x + 5 * u, ey + 1.5 * u); g.stroke(); }
      break;
    case 'slit':
      for (const x of xs) {
        g.fillStyle = iris; g.strokeStyle = ink; g.lineWidth = 2 * u;
        g.beginPath(); g.moveTo(x - 7 * u, ey); g.quadraticCurveTo(x, ey - 8 * u, x + 7 * u, ey); g.quadraticCurveTo(x, ey + 8 * u, x - 7 * u, ey); g.fill(); g.stroke();
        g.beginPath(); g.moveTo(x, ey - 4 * u); g.lineTo(x, ey + 4 * u); g.lineWidth = 2.2 * u; g.stroke();
      }
      break;
    case 'void':
      g.fillStyle = '#120c18'; for (const x of xs) { g.beginPath(); g.ellipse(x, ey, 5.5 * u, 6.5 * u, 0, 0, Math.PI * 2); g.fill(); }
      break;
    case 'jack':
      g.fillStyle = '#ffb02e'; g.strokeStyle = ink; g.lineWidth = 1.6 * u;
      for (const x of xs) { g.beginPath(); g.moveTo(x - 6 * u, ey + 4 * u); g.lineTo(x, ey - 6 * u); g.lineTo(x + 6 * u, ey + 4 * u); g.closePath(); g.fill(); g.stroke(); }
      break;
    default:   // dots
      for (const x of xs) {
        g.fillStyle = ink; g.beginPath(); g.ellipse(x, ey, 4 * u, 4.9 * u, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(x - 1.3 * u, ey - 1.8 * u, 1.45 * u, 0, Math.PI * 2); g.fill();
      }
  }
  g.restore();
  // nose
  if (cat || monkey) {
    g.fillStyle = cat ? NOSE : '#7a4a3a'; g.strokeStyle = ink; g.lineWidth = 1.6 * u;
    g.beginPath();
    if (cat) { g.moveTo(cx - 3.6 * u, my - 6 * u); g.lineTo(cx + 3.6 * u, my - 6 * u); g.lineTo(cx, my - 2 * u); g.closePath(); }
    else { g.ellipse(cx - 2 * u, my - 4 * u, 1.2 * u, 1.6 * u, 0, 0, Math.PI * 2); g.ellipse(cx + 2 * u, my - 4 * u, 1.2 * u, 1.6 * u, 0, 0, Math.PI * 2); }
    g.fill(); if (cat) g.stroke();
  }
  // mouth
  g.strokeStyle = ink; g.lineWidth = 2.3 * u;
  const omega = (w: number) => {
    g.beginPath(); g.moveTo(cx, my - 2 * u); g.lineTo(cx, my + 0.2 * u);
    g.moveTo(cx, my); g.quadraticCurveTo(cx - w * 0.45, my + 4 * u, cx - w, my + 0.5 * u);
    g.moveTo(cx, my); g.quadraticCurveTo(cx + w * 0.45, my + 4 * u, cx + w, my + 0.5 * u); g.stroke();
  };
  switch (f.mouth) {
    case 'grin':
      if (cat) {
        omega(9 * u);
        g.fillStyle = '#fff'; g.lineWidth = 1.2 * u;
        for (const x of [cx - 5.5 * u, cx + 5.5 * u]) { g.beginPath(); g.moveTo(x - 1.5 * u, my + 2 * u); g.lineTo(x, my + 5.4 * u); g.lineTo(x + 1.5 * u, my + 2 * u); g.closePath(); g.fill(); g.stroke(); }
      } else {
        g.fillStyle = '#fff'; g.lineWidth = 2.2 * u;
        g.beginPath(); g.moveTo(cx - 10 * u, my - 3 * u); g.lineTo(cx + 10 * u, my - 3 * u); g.quadraticCurveTo(cx + 8 * u, my + 7 * u, cx, my + 7 * u); g.quadraticCurveTo(cx - 8 * u, my + 7 * u, cx - 10 * u, my - 3 * u); g.fill(); g.stroke();
      }
      break;
    case 'tongue':
      g.fillStyle = '#ff7f9a'; g.lineWidth = 1.5 * u;
      g.beginPath(); g.moveTo(cx - 2.6 * u, my + 1 * u); g.quadraticCurveTo(cx, my + 9 * u, cx + 2.6 * u, my + 1 * u); g.closePath(); g.fill(); g.stroke();
      g.lineWidth = 2.3 * u; omega(6.5 * u);
      break;
    case 'none': break;
    default: {   // open
      if (cat || monkey) { g.beginPath(); g.moveTo(cx, my - 2 * u); g.lineTo(cx, my); g.stroke(); }
      g.fillStyle = '#7a2b3a'; g.lineWidth = 2 * u;
      g.beginPath(); g.moveTo(cx - 7 * u, my - 0.5 * u); g.quadraticCurveTo(cx, my + 13 * u, cx + 7 * u, my - 0.5 * u); g.quadraticCurveTo(cx, my + 3 * u, cx - 7 * u, my - 0.5 * u); g.fill(); g.stroke();
      g.fillStyle = '#ff8fa3'; g.beginPath(); g.ellipse(cx, my + 5.6 * u, 3 * u, 1.8 * u, 0, 0, Math.PI * 2); g.fill();
    }
  }
}

/* ------------------------------------------------------------------ face patch geometry (cached per body dims) */
const patchCache = new Map<string, THREE.BufferGeometry>();
export function facePatch(d: BodyDims, key: string): THREE.BufferGeometry {
  let g = patchCache.get(key);
  if (g) return g;
  const segs = 24, rings = 18, pos: number[] = [], uv: number[] = [], idx: number[] = [], p = { x: 0, z: 0 };
  const yA = d.eyeY - FB, yB = Math.min(d.top - 0.004, d.eyeY + FT);
  for (let j = 0; j <= rings; j++) {
    const y = yA + (yB - yA) * (j / rings), r = radiusAt(d, y) + 0.0035;
    // angular range so that |x| ≤ FW (and never beyond the side)
    const th = r > FW ? Math.asin(Math.min(1, Math.pow(FW / r, d.n / 2))) : Math.PI / 2;
    for (let i = 0; i <= segs; i++) {
      const a = -th + (2 * th * i) / segs;
      sectionXZ(d, r, a, p);
      pos.push(p.x, y, p.z);
      // the character looks to −Z: the viewer's right is −X, so canvas x grows towards −X
      uv.push(0.5 - p.x / (2 * FW), (y - (d.eyeY - FB)) / (FT + FB));
    }
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) {
    const a = j * (segs + 1) + i, b = a + 1, c = a + segs + 1, e = c + 1;
    idx.push(a, c, b, b, c, e);
  }
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  patchCache.set(key, g);
  return g;
}
