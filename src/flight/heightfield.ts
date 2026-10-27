/**
 * The 3D fly map of the city: a top-down height field of what is really built (roofs, the mine outcrop, lamps, trees,
 * fences, bridges, the water surface, the paving), rendered once per world with an orthographic depth pass and read
 * back into a Float32Array (1 cell = 1/ppm m). A query is a bilinear-free cell lookup (max over a 3×3 dilation done
 * at build time), no allocations.
 *
 * It is 2.5D: one height per cell — overhangs (tree canopies, awnings, garland wires are skipped) count as solid down
 * to the ground. Sky, stars, moon, glow sprites, particles, lights, the far silhouettes, contact blobs and garlands are
 * hidden for the pass.
 */
import * as THREE from 'three';

export interface HeightGrid {
  /** World metres of cell (0, 0)'s corner, cells per metre, size. */
  x0: number; z0: number; ppm: number; w: number; h: number;
  /** Top height (m) per cell, row-major (row = z); -Infinity = nothing rendered there. */
  data: Float32Array;
}

/** Top (m) at world (X, Z); -Infinity outside the grid or where nothing was rendered. */
export function gridTop(g: HeightGrid, X: number, Z: number): number {
  const i = Math.floor((X - g.x0) * g.ppm), j = Math.floor((Z - g.z0) * g.ppm);
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return -Infinity;
  return g.data[j * g.w + i];
}

/** In-place 3×3 max dilation (thin posts and roof edges are never missed between two samples). */
export function dilate(g: HeightGrid): void {
  const { w, h, data } = g, src = data.slice();
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let m = -Infinity;
    for (let b = j - 1; b <= j + 1; b++) {
      if (b < 0 || b >= h) continue;
      for (let a = i - 1; a <= i + 1; a++) { if (a < 0 || a >= w) continue; const v = src[b * w + a]; if (v > m) m = v; }
    }
    data[j * w + i] = m;
  }
}

const CAM_Y = 120, NEAR = 1, FAR = 200;

/**
 * Render the height field of `root` over the world box [x0, x1] × [z0, z1] (metres). Synchronous (one draw of the
 * city at a small size + a readback). Throws if the renderer cannot (no WebGL): the caller keeps flying on the walk grid.
 */
export function renderHeightGrid(renderer: THREE.WebGLRenderer, root: THREE.Object3D, x0: number, x1: number, z0: number, z1: number, ppm = 10): HeightGrid {
  const maxTex = Math.min(4096, renderer.capabilities?.maxTextureSize || 4096);
  ppm = Math.max(2, Math.min(ppm, maxTex / (x1 - x0), maxTex / (z1 - z0)));
  const w = Math.ceil((x1 - x0) * ppm), h = Math.ceil((z1 - z0) * ppm);
  // looking straight down; image x = world X, image row 0 (GL bottom) = z1 … top row = z0 (see the flip below)
  const cam = new THREE.OrthographicCamera(x0, x0 + w / ppm, -z0, -(z0 + h / ppm), NEAR, FAR);
  cam.position.set(0, CAM_Y, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();

  const scene = new THREE.Scene();
  scene.background = null;
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  scene.overrideMaterial = mat;
  const parent = root.parent, wasVisible = root.visible, hidden: THREE.Object3D[] = [];
  root.traverse((o) => {
    const n = o.name || '';
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    const m0 = Array.isArray(m) ? m[0] : m;
    const hide = n.startsWith('sky:') || n.startsWith('fx:') || n === 'city:back' || n === 'world:blobs' || n === 'world:garlands'
      || (o as THREE.Sprite).isSprite || (o as THREE.Light).isLight || (o as THREE.Points).isPoints || (o as THREE.Line).isLine
      || (!!m0 && m0.transparent && m0.depthWrite === false);
    if (hide && o.visible) { o.visible = false; hidden.push(o); }
  });
  root.visible = true;
  scene.add(root);
  const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true });
  const prevRT = renderer.getRenderTarget(), prevShadow = renderer.shadowMap.autoUpdate;
  const prevClear = new THREE.Color(); renderer.getClearColor(prevClear); const prevAlpha = renderer.getClearAlpha();
  const buf = new Uint8Array(w * h * 4);
  try {
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0xffffff, 1);   // packed depth 1.0 = the far plane = nothing
    renderer.clear();
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
  } finally {
    renderer.setRenderTarget(prevRT); renderer.shadowMap.autoUpdate = prevShadow;
    renderer.setClearColor(prevClear, prevAlpha);
    scene.remove(root);
    if (parent) parent.add(root);
    root.visible = wasVisible;
    for (const o of hidden) o.visible = true;
    rt.dispose(); mat.dispose();
  }
  const data = new Float32Array(w * h);
  // three's unpackRGBAToDepth (r0.186 packing.glsl): dot(v / 255, (255/256, 255/256², 255/256³, 1/256³))
  const k0 = 1 / 256, k1 = 1 / 65536, k2 = 1 / 16777216, k3 = 1 / (255 * 16777216);
  for (let r = 0; r < h; r++) {
    const row = h - 1 - r;   // GL rows are bottom-up: GL row 0 = image bottom = z1
    for (let i = 0; i < w; i++) {
      const o = (r * w + i) * 4;
      const d = buf[o] * k0 + buf[o + 1] * k1 + buf[o + 2] * k2 + buf[o + 3] * k3;
      data[row * w + i] = d >= 0.9999 ? -Infinity : CAM_Y - (NEAR + d * (FAR - NEAR));
    }
  }
  const g: HeightGrid = { x0, z0, ppm, w, h, data };
  dilate(g);
  return g;
}

