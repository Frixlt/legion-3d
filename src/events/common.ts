/**
 * Small helpers shared by the seasonal events (src/events/*): garland re-colouring, a self-lit material patch,
 * reduced-motion detection and the city raster from the Halloween placement (re-exported).
 */
import * as THREE from 'three';
import type { EventContext } from './types';

export { placeCity } from './halloween';
export { Grid, clearOfDoors, mulberry32, DOOR_CLEAR, type PlaceCity } from './halloween/placement';
export { glowTexture } from './halloween/tex';
export { groundQuad } from './halloween/geo';

/** prefers-reduced-motion (false where matchMedia is missing: node tests). */
export function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The world's garland bulbs ('fx:bulbs' Points) and cable ('fx:cable'), or null when the city has none. */
export function garland(ctx: EventContext): { bulbs: THREE.Points | null; cable: THREE.LineSegments | null } {
  const root = ctx.world.root;
  return {
    bulbs: (root.getObjectByName('fx:bulbs') as THREE.Points | undefined) ?? null,
    cable: (root.getObjectByName('fx:cable') as THREE.LineSegments | undefined) ?? null,
  };
}

/** Re-colour the garland bulbs with a palette (cycled in a pleasant irregular order); returns the undo. */
export function recolourBulbs(bulbs: THREE.Points | null, palette: readonly (readonly number[])[], gain = 1.4): () => void {
  if (!bulbs) return () => {};
  const a = bulbs.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!a) return () => {};
  const orig = (a.array as Float32Array).slice();
  for (let i = 0; i < a.count; i++) { const c = palette[(i * 7 + (i >> 2)) % palette.length]; a.setXYZ(i, c[0] * gain, c[1] * gain, c[2] * gain); }
  a.needsUpdate = true;
  return () => { (a.array as Float32Array).set(orig); a.needsUpdate = true; };
}

/**
 * Self-lit vertex colours: the emissive term is multiplied by the vertex (and instance) colour, so a night scene
 * still shows the object's own colours softly (snow, paper, a fir tree) without real lights.
 */
export function selfLit<T extends THREE.MeshStandardMaterial | THREE.MeshLambertMaterial>(m: T, k: number): T {
  m.emissive = new THREE.Color(1, 1, 1); m.emissiveIntensity = k;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )\ntotalEmissiveRadiance *= vColor.rgb;\n#endif');
  };
  m.customProgramCacheKey = () => 'l3d-selflit';
  return m;
}

/** Pixel scale for point sizes in world units: renderer height / (2 tan(fov / 2)). */
export function pointScale(ctx: EventContext): number {
  const h = ctx.renderer?.domElement.height || 720;
  return h / (2 * Math.tan((ctx.camera.fov * Math.PI / 180) / 2));
}

/** Tint a material colour towards `to` by k; returns the undo (the colour object itself is kept). */
export function tintColor(c: THREE.Color, to: THREE.Color, k: number): () => void {
  const o = c.clone(); c.lerp(to, k); return () => { c.copy(o); };
}

/** Meshes of the batched static city ('world:static' children, named 'city:<material>'). */
export function staticMeshes(ctx: EventContext): THREE.Mesh[] {
  return ((ctx.world.root.getObjectByName('world:static')?.children ?? []) as THREE.Mesh[]).filter((m) => (m as THREE.Mesh).isMesh);
}
