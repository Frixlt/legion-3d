/**
 * Silhouette outline of the ONE current interaction target (doors, NPCs, shop goods, mine stones, items).
 *
 * Who shows what: one global slot. `showOutline(owner, sources)` replaces whatever was outlined; `hideOutline(owner)`
 * clears it only if `owner` still owns it (the interaction system and a room can hand the slot over to each other
 * without one clearing the other's target). Sources are meshes (or objects whose visible meshes are taken, at most
 * OUTLINE_MAX of the largest); they may be invisible "carriers" — only their geometry (incl. drawRange), skeleton and
 * matrixWorld are used. Nothing is added to the source objects themselves.
 *
 * Rendering, every frame `outlineFrame(renderer, scene, camera, t, post)` (engine, before render):
 *   q2–3 (post chain, `post = true`): OutlineMaskPass (after RenderPass) draws the source meshes into a mask target
 *     (R = silhouette, G = visible: fragment depth vs the scene depth texture) — one draw call per source; the edge
 *     detection + composite is folded into the OutputPass shader (OUTLINE_GLSL: ring taps around the pixel, only inside
 *     the target's screen rect): crisp warm-gold line ~3 CSS px outside the silhouette, soft glow out to ~8 px, no fill,
 *     hidden parts of the contour as a faint dashed line (x-ray). Nothing targeted → no pass, no taps, 0 draw calls.
 *   q0–1 (no post): inverted hull per source (back faces, extruded in clip space along smoothed normals by a constant
 *     number of pixels) — one draw call per source, no x-ray.
 * Gentle pulse 0.85…1.0 in both. No allocations per frame.
 */
import * as THREE from 'three';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';

/** Max meshes outlined at once (= extra draw calls while something is targeted). */
export const OUTLINE_MAX = 3;
/** Warm gold (sRGB). */
export const OUTLINE_COLOR = '#ffcf5a';
/** Line width (CSS px) of the q0–1 hull. */
export const HULL_PX = 2.6;
const NAME = 'l3d:outline';

/* ================================================================ state (one slot) */
let owner: unknown = null;
const sources: THREE.Mesh[] = [];
let version = 0;
let pulse = 1;
/** Screen rect of the target in uv (x0, y0, x1, y1), margins included; x0 > x1 = off screen. */
const rect = new THREE.Vector4(0, 0, 1, 1);

const isOutlineable = (m: THREE.Mesh): boolean => {
  if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh || !m.geometry || !m.geometry.getAttribute('position')) return false;
  if (m.name.startsWith(NAME)) return false;
  const mat = m.material as THREE.Material | THREE.Material[];
  const ok = (x: THREE.Material) => x.visible && x.side !== THREE.BackSide && !(x.transparent && !x.depthWrite);
  return Array.isArray(mat) ? mat.some(ok) : !!mat && ok(mat);
};
const sizeOf = (m: THREE.Mesh): number => {
  const g = m.geometry;
  if (!g.boundingSphere) g.computeBoundingSphere();
  return (g.boundingSphere ? g.boundingSphere.radius : 0) * m.matrixWorld.getMaxScaleOnAxis();
};

/** Visible, outlineable meshes under `root` (largest first, at most `max`). Used when an object (not a carrier) is given. */
export function collectOutlineMeshes(root: THREE.Object3D, out: THREE.Mesh[] = [], max = OUTLINE_MAX): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  root.updateWorldMatrix(true, true);
  root.traverseVisible((o) => { const m = o as THREE.Mesh; if (isOutlineable(m)) found.push(m); });
  found.sort((a, b) => sizeOf(b) - sizeOf(a));
  for (let i = 0; i < found.length && out.length < max; i++) out.push(found[i]);
  return out;
}

/**
 * Outline `src` (a mesh used as is, even when invisible = a carrier; or an object whose visible meshes are taken;
 * or a list of those). Replaces the current target. null/empty = same as hideOutline(owner) but unconditional.
 */
export function showOutline(who: unknown, src: THREE.Object3D | readonly THREE.Object3D[] | null | undefined): void {
  sources.length = 0;
  owner = null;
  version++;
  if (!src) return;
  const list = Array.isArray(src) ? src as readonly THREE.Object3D[] : [src as THREE.Object3D];
  for (const o of list) {
    if (sources.length >= OUTLINE_MAX) break;
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry && !(m as unknown as THREE.InstancedMesh).isInstancedMesh) sources.push(m);
    else collectOutlineMeshes(o, sources, OUTLINE_MAX);
  }
  if (sources.length) owner = who;
}
/** Clear the outline if `who` owns it. */
export function hideOutline(who: unknown): void {
  if (owner !== who || owner === null) return;
  owner = null; sources.length = 0; version++;
}
/** Who owns the outline now (null = nothing outlined). */
export function outlineOwner(): unknown { return owner; }
/** The meshes outlined now (read-only view; tests, debug). */
export function outlineSources(): readonly THREE.Mesh[] { return sources; }

/* ================================================================ smoothed normals (hull extrusion without cracks) */
/**
 * Attribute 'l3dON': per-vertex normal averaged over every face sharing the position (welded by position), so a
 * flat-shaded box extrudes as one closed hull. Computed once per geometry and draw range (lazily, on first outline).
 */
export function ensureSmoothNormals(g: THREE.BufferGeometry): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos) return;
  const idx = g.getIndex();
  const total = idx ? idx.count : pos.count;
  const start = Math.max(0, g.drawRange.start), count = Math.min(total - start, g.drawRange.count);
  const key = start + ':' + count;
  const done = (g.userData.l3dON ||= {}) as Record<string, true>;
  if (done[key] || done['0:' + total]) return;
  let on = g.getAttribute('l3dON') as THREE.BufferAttribute | undefined;
  if (!on || on.count !== pos.count) { on = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3); g.setAttribute('l3dON', on); }
  const acc = new Map<string, number[]>();
  const keyOf = (v: number) => `${Math.round(pos.getX(v) * 1e3)},${Math.round(pos.getY(v) * 1e3)},${Math.round(pos.getZ(v) * 1e3)}`;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  const vid = (k: number) => (idx ? idx.getX(k) : k);
  const end = start + count - (count % 3);
  for (let k = start; k < end; k += 3) {
    const i0 = vid(k), i1 = vid(k + 1), i2 = vid(k + 2);
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    n.subVectors(c, b).cross(a.sub(b));
    const l = n.length(); if (l < 1e-12) continue;
    n.multiplyScalar(1 / l);   // unweighted: thin bevel faces count as much as big ones (even extrusion on boxes)
    for (const i of [i0, i1, i2]) {
      const kk = keyOf(i); let s = acc.get(kk);
      if (!s) { s = [0, 0, 0]; acc.set(kk, s); }
      // each face plane once per welded vertex (two triangles of one quad must not double its weight)
      let dup = false;
      for (let q = 3; q < s.length; q += 3) if (s[q] * n.x + s[q + 1] * n.y + s[q + 2] * n.z > 0.999) { dup = true; break; }
      if (dup) continue;
      s.push(n.x, n.y, n.z);
      s[0] += n.x; s[1] += n.y; s[2] += n.z;
    }
  }
  for (let k = start; k < end; k++) {
    const i = vid(k), s = acc.get(keyOf(i));
    if (!s) continue;
    const l = Math.hypot(s[0], s[1], s[2]) || 1;
    on.setXYZ(i, s[0] / l, s[1] / l, s[2] / l);
  }
  on.needsUpdate = true;
  done[key] = true;
}

/* ================================================================ fitted proxy (Box3 / invisible hit volumes) */
const _inv = new THREE.Matrix4(), _lb = new THREE.Box3(), _wb = new THREE.Box3(), _v = new THREE.Vector3();
/**
 * A mesh made of the triangles of static scene geometry lying entirely inside `box` (world), e.g. the door leaf, its
 * frame and arch out of the merged city meshes, a stall out of a room's merged props. Skips skinned/instanced meshes,
 * sprites, lines, invisible and glow (transparent, no depth write) materials, back-face shells and our own objects.
 * Triangles lying wholly within `floorLift` of the box floor (ground / floor tiles) are never taken. Also returns the
 * room avatars (NPCs, mannequins: 'avatar-body' skinned meshes) standing inside the box — not the ones directly under
 * the scene (the hero, live players). One-time cost (≈ a few ms on the whole city); cache the result.
 */
export function fitOutlineProxy(root: THREE.Object3D, box: THREE.Box3, opts: { floorLift?: number; name?: string } = {}): { proxy: THREE.Mesh | null; avatars: THREE.Mesh[] } {
  const B = _wb.copy(box);
  const lift = box.min.y + (opts.floorLift ?? 0.05);
  const eps = 0.02;
  const out: number[] = [];
  const avatars: THREE.Mesh[] = [];
  root.updateWorldMatrix(true, true);
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3();
  const inside = (p: THREE.Vector3) => p.x >= B.min.x - eps && p.x <= B.max.x + eps && p.y >= B.min.y - 0.012 && p.y <= B.max.y + eps && p.z >= B.min.z - eps && p.z <= B.max.z + eps;
  root.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if ((m as unknown as THREE.SkinnedMesh).isSkinnedMesh) {
      if (m.name === 'avatar-body' && isOutlineable(m)) {
        let av: THREE.Object3D | null = m; while (av && av.name !== 'avatar') av = av.parent;
        if (av && !(av.parent as THREE.Scene | null)?.isScene && box.containsPoint(av.getWorldPosition(_v).setY(_v.y + 0.3))) avatars.push(m);
      }
      return;
    }
    if (!isOutlineable(m)) return;
    const g = m.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    if (!_lb.copy(g.boundingBox!).applyMatrix4(m.matrixWorld).intersectsBox(B)) return;
    // the box in the mesh's local space (conservative) for a fast per-vertex reject
    _inv.copy(m.matrixWorld).invert();
    _lb.copy(B).expandByScalar(eps).applyMatrix4(_inv);
    const pos = g.getAttribute('position') as THREE.BufferAttribute, idx = g.getIndex();
    const n = idx ? idx.count : pos.count;
    const s = Math.max(0, g.drawRange.start), e = Math.min(n, s + g.drawRange.count);
    const lb = _lb, arr = pos.array as ArrayLike<number>, st = (pos as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute ? 0 : pos.itemSize;
    const inL = (i: number) => {
      if (!st) { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); return x >= lb.min.x && x <= lb.max.x && y >= lb.min.y && y <= lb.max.y && z >= lb.min.z && z <= lb.max.z; }
      const x = arr[i * st], y = arr[i * st + 1], z = arr[i * st + 2];
      return x >= lb.min.x && x <= lb.max.x && y >= lb.min.y && y <= lb.max.y && z >= lb.min.z && z <= lb.max.z;
    };
    for (let k = s; k + 2 < e; k += 3) {
      const i0 = idx ? idx.getX(k) : k, i1 = idx ? idx.getX(k + 1) : k + 1, i2 = idx ? idx.getX(k + 2) : k + 2;
      if (!inL(i0) || !inL(i1) || !inL(i2)) continue;
      p0.fromBufferAttribute(pos, i0).applyMatrix4(m.matrixWorld);
      p1.fromBufferAttribute(pos, i1).applyMatrix4(m.matrixWorld);
      p2.fromBufferAttribute(pos, i2).applyMatrix4(m.matrixWorld);
      if (!inside(p0) || !inside(p1) || !inside(p2)) continue;
      if (p0.y < lift && p1.y < lift && p2.y < lift) continue;   // flat on the floor: ground / floor tiles, never the object
      out.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }
  });
  let proxy: THREE.Mesh | null = null;
  if (out.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
    proxy = new THREE.Mesh(g, PROXY_MAT);
    proxy.name = NAME + ':proxy' + (opts.name ? ':' + opts.name : '');
    proxy.matrixAutoUpdate = false; proxy.updateMatrixWorld(true);
    proxy.raycast = () => { /* never hit */ };
  }
  return { proxy, avatars };
}
/** Material of fitted proxies (never rendered: they are carriers, not in the scene). */
const PROXY_MAT = new THREE.MeshBasicMaterial({ visible: false });

/* ================================================================ shaders */
const MASK_VS = /* glsl */`
#include <common>
#include <skinning_pars_vertex>
void main() {
  #include <skinbase_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
}`;
/** R = silhouette, G = this fragment is not hidden behind other geometry (scene depth, linear metres, with a bias). */
const MASK_FS = /* glsl */`
uniform sampler2D tDepth;
uniform vec2 uInvRes;
uniform float uNear, uFar;
float linZ(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
void main() {
  float sd = texture2D(tDepth, gl_FragCoord.xy * uInvRes).x;
  float fz = linZ(gl_FragCoord.z), sz = linZ(sd);
  float vis = fz <= sz + 0.04 + 0.012 * fz ? 1.0 : 0.0;
  gl_FragColor = vec4(1.0, vis, 0.0, 1.0);
}`;
const HULL_VS = /* glsl */`
#include <common>
#include <skinning_pars_vertex>
uniform vec2 uRes;
uniform float uPx;
#ifdef L3D_SMOOTH
attribute vec3 l3dON;
#endif
void main() {
  #ifdef L3D_SMOOTH
  vec3 objectNormal = l3dON;
  #else
  vec3 objectNormal = normal;
  #endif
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #ifdef USE_SKINNING
  // characters carry their own ink outline shell (avatar/materials.ts outlineMat: 1.2 cm × distance factor):
  // start just outside it, so the gold line is never buried under the ink
  { vec4 mv0 = modelViewMatrix * vec4(transformed, 1.0); transformed += normalize(objectNormal) * 0.0125 * clamp(-mv0.z * 0.12, 1.0, 3.0); }
  #endif
  #include <project_vertex>
  vec3 nV = normalize(normalMatrix * objectNormal);
  vec4 cn = projectionMatrix * vec4(nV, 0.0);
  vec2 d = cn.xy * uRes;                 // direction in pixels
  float l = length(d);
  if (l > 1e-6) gl_Position.xy += (d / l) * (uPx * 2.0 / uRes) * gl_Position.w;
  // push the hull ~5 cm away from the eye: hulls of small parts in front of the body (door bands, a handle) hide
  // behind the body's surface; only the outer silhouette stays
  vec4 pb = projectionMatrix * vec4(mvPosition.xyz + normalize(mvPosition.xyz) * 0.05, 1.0);
  gl_Position.z = pb.z / pb.w * gl_Position.w;
}`;
const HULL_FS = /* glsl */`
uniform vec3 uCol;
uniform float uPulse;
void main() {
  gl_FragColor = vec4(uCol * uPulse, 1.0);
  #include <colorspace_fragment>
}`;

/**
 * Edge detection + composite, inserted into the OutputPass fragment shader after tone mapping (and the grade), before
 * the sRGB transfer. Uniforms: uOMask (mask texture), uOTexel (one CSS px in uv), uORect (target rect in uv), uOOn
 * (0 = off, else pulse), uOCol (linear gold).
 */
export const OUTLINE_GLSL_HEAD = 'uniform sampler2D uOMask;\nuniform vec2 uOTexel;\nuniform vec4 uORect;\nuniform float uOOn;\nuniform vec3 uOCol;';
export const OUTLINE_GLSL = /* glsl */`
			// --- l3d silhouette outline (current interaction target)
			if ( uOOn > 0.0 && vUv.x > uORect.x && vUv.x < uORect.z && vUv.y > uORect.y && vUv.y < uORect.w ) {
				float inS = texture2D( uOMask, vUv ).r;
				float lineA = 0.0, lineV = 0.0, glow = 0.0;
				for ( int i = 0; i < 12; i ++ ) {
					float a = float( i ) * 0.5235988 + 0.26;
					vec2 d = vec2( cos( a ), sin( a ) ) * uOTexel;
					vec2 s1 = texture2D( uOMask, vUv + d * 1.2 ).rg;
					vec2 s2 = texture2D( uOMask, vUv + d * 2.4 ).rg;
					lineA = max( lineA, max( s1.r, s2.r ) );
					lineV = max( lineV, max( s1.g, s2.g ) );
					glow += texture2D( uOMask, vUv + d * 4.2 ).r * 0.65 + texture2D( uOMask, vUv + d * 6.8 ).r * 0.35;
				}
				float outS = 1.0 - inS;
				float dash = step( 0.45, fract( ( gl_FragCoord.x + gl_FragCoord.y ) * 0.125 ) );
				float line = lineA * outS * mix( 0.42 * dash, 1.0, lineV );
				float g = clamp( glow / 12.0, 0.0, 1.0 ) * outS * ( 1.0 - line ) * mix( 0.15, 0.55, lineV );
				gl_FragColor.rgb = mix( gl_FragColor.rgb, uOCol * uOOn, line * uOOn ) + uOCol * g * uOOn * 0.8;
			}
			// color space`;

/* ================================================================ GPU objects (lazy) */
interface Slot { mask: THREE.Mesh; maskSk: THREE.SkinnedMesh; hull: THREE.Mesh; hullSk: THREE.SkinnedMesh }
let maskMat: THREE.ShaderMaterial | null = null;
let hullMat: THREE.ShaderMaterial | null = null, hullMatSmooth: THREE.ShaderMaterial | null = null;
let maskScene: THREE.Scene | null = null;
let hullGroup: THREE.Group | null = null;
const slots: Slot[] = [];
const gold = new THREE.Color(OUTLINE_COLOR);   // linear (ColorManagement converts the sRGB hex)
const hullUniforms = { uRes: { value: new THREE.Vector2(1, 1) }, uPx: { value: HULL_PX }, uCol: { value: gold }, uPulse: { value: 1 } };
const maskUniforms = { tDepth: { value: null as THREE.Texture | null }, uInvRes: { value: new THREE.Vector2(1, 1) }, uNear: { value: 0.05 }, uFar: { value: 400 } };

function initGpu(): void {
  if (maskMat) return;
  maskMat = new THREE.ShaderMaterial({
    name: NAME + ':mask', uniforms: maskUniforms, vertexShader: MASK_VS, fragmentShader: MASK_FS,
    side: THREE.DoubleSide, depthTest: false, depthWrite: false, fog: false,
    blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
  const hm = (smooth: boolean) => new THREE.ShaderMaterial({
    name: NAME + ':hull', uniforms: hullUniforms, vertexShader: HULL_VS, fragmentShader: HULL_FS,
    defines: smooth ? { L3D_SMOOTH: '' } : {}, side: THREE.BackSide, fog: false, toneMapped: false,
  });
  hullMat = hm(false); hullMatSmooth = hm(true);
  maskScene = new THREE.Scene(); maskScene.name = NAME + ':mask'; maskScene.matrixWorldAutoUpdate = false;
  hullGroup = new THREE.Group(); hullGroup.name = NAME; hullGroup.matrixAutoUpdate = false; hullGroup.matrixWorldAutoUpdate = false;
  const prep = <T extends THREE.Mesh>(m: T, n: string): T => {
    m.name = NAME + ':' + n; m.matrixAutoUpdate = false; m.matrixWorldAutoUpdate = false; m.frustumCulled = false;
    m.visible = false; m.raycast = () => { /* never hit */ }; m.renderOrder = 2;
    return m;
  };
  for (let i = 0; i < OUTLINE_MAX; i++) {
    const s: Slot = {
      mask: prep(new THREE.Mesh(undefined, maskMat), 'm' + i), maskSk: prep(new THREE.SkinnedMesh(undefined, maskMat), 'ms' + i),
      hull: prep(new THREE.Mesh(undefined, hullMat), 'h' + i), hullSk: prep(new THREE.SkinnedMesh(undefined, hullMat), 'hs' + i),
    };
    maskScene.add(s.mask, s.maskSk); hullGroup.add(s.hull, s.hullSk);
    slots.push(s);
  }
}

let boundVersion = -1, boundMode = -1;   // mode 0 = hull, 1 = mask
/** Assign the current sources to the slot meshes of one mode (only when the target or the mode changed). */
function bind(mode: 0 | 1): void {
  if (boundVersion === version && boundMode === mode) return;
  boundVersion = version; boundMode = mode;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    s.mask.visible = s.maskSk.visible = s.hull.visible = s.hullSk.visible = false;
    const src = sources[i];
    if (!src) continue;
    const sk = (src as THREE.SkinnedMesh).isSkinnedMesh ? src as THREE.SkinnedMesh : null;
    const m = mode === 1 ? (sk ? s.maskSk : s.mask) : (sk ? s.hullSk : s.hull);
    m.geometry = src.geometry;
    if (sk) { const p = m as THREE.SkinnedMesh; p.skeleton = sk.skeleton; p.bindMode = sk.bindMode; p.bindMatrix.copy(sk.bindMatrix); p.bindMatrixInverse.copy(sk.bindMatrixInverse); }
    if (mode === 0) {
      const smooth = !sk && !!src.geometry.getAttribute('position');
      if (smooth) ensureSmoothNormals(src.geometry);
      m.material = smooth ? hullMatSmooth! : hullMat!;
    }
    m.visible = true;
  }
}

const _cc = new THREE.Color();
const _c = new THREE.Vector3(), _bb = new THREE.Box3(), _mm = new THREE.Matrix4(), _res = new THREE.Vector2();
/** Copy matrices of the sources into the active slot meshes; screen rect of the target. Returns false if off screen. */
function track(mode: 0 | 1, camera: THREE.Camera, w: number, h: number): boolean {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, behind = false, front = 0;
  for (let i = 0; i < sources.length && i < slots.length; i++) {
    const src = sources[i], s = slots[i];
    const sk = (src as THREE.SkinnedMesh).isSkinnedMesh ? src as THREE.SkinnedMesh : null;
    const m = mode === 1 ? (sk ? s.maskSk : s.mask) : (sk ? s.hullSk : s.hull);
    m.matrixWorld.copy(src.matrixWorld);
    if (sk) { (m as THREE.SkinnedMesh).bindMatrix.copy(sk.bindMatrix); (m as THREE.SkinnedMesh).bindMatrixInverse.copy(sk.bindMatrixInverse); }
    const g = src.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    _bb.copy(g.boundingBox!);
    if (sk) _bb.expandByScalar(_bb.getSize(_c).length() * 0.25);   // posed limbs leave the bind-pose box
    _mm.multiplyMatrices(camera.matrixWorldInverse, src.matrixWorld);
    const pm = (camera as THREE.PerspectiveCamera).projectionMatrix;
    for (let k = 0; k < 8; k++) {
      _c.set(k & 1 ? _bb.max.x : _bb.min.x, k & 2 ? _bb.max.y : _bb.min.y, k & 4 ? _bb.max.z : _bb.min.z).applyMatrix4(_mm);
      if (_c.z > -((camera as THREE.PerspectiveCamera).near || 0.05)) { behind = true; continue; }
      _c.applyMatrix4(pm); front++;
      if (_c.x < x0) x0 = _c.x; if (_c.x > x1) x1 = _c.x;
      if (_c.y < y0) y0 = _c.y; if (_c.y > y1) y1 = _c.y;
    }
  }
  if (!front) return false;                              // wholly behind the camera
  if (behind) { rect.set(0, 0, 1, 1); return true; }     // crosses the near plane: whole screen
  const mx = 12 / Math.max(1, w), my = 12 / Math.max(1, h);   // margin: line + glow (CSS px)
  rect.set(x0 * 0.5 + 0.5 - mx, y0 * 0.5 + 0.5 - my, x1 * 0.5 + 0.5 + mx, y1 * 0.5 + 0.5 + my);
  return rect.x < 1 && rect.z > 0 && rect.y < 1 && rect.w > 0;
}

/** Composite uniforms shared with the OutputPass shader (post.ts merges them into its uniforms). */
export const outlineUniforms = {
  uOMask: { value: null as THREE.Texture | null },
  uOTexel: { value: new THREE.Vector2(1, 1) },
  uORect: { value: rect },
  uOOn: { value: 0 },
  uOCol: { value: new THREE.Color(OUTLINE_COLOR) },
};

let frameMode: 0 | 1 = 0, frameOn = false, lastCalls = 0;
/**
 * Per frame, before rendering. post = the post chain renders this frame (mask pass + composite); otherwise the hull
 * meshes are put into `scene`. No allocations.
 */
export function outlineFrame(renderer: THREE.WebGLRenderer, scene: THREE.Object3D, camera: THREE.Camera, t: number, post: boolean): void {
  pulse = 0.925 + 0.075 * Math.sin(t * 3.6);
  outlineUniforms.uOOn.value = 0;
  frameOn = false;
  if (!sources.length) { if (hullGroup) hullGroup.visible = false; boundVersion = -1; lastCalls = 0; return; }
  initGpu();
  const mode: 0 | 1 = post ? 1 : 0;
  frameMode = mode;
  bind(mode);
  renderer.getSize(_res);
  const on = track(mode, camera, _res.x, _res.y);
  frameOn = on;
  lastCalls = on ? Math.min(sources.length, OUTLINE_MAX) : 0;
  const hg = hullGroup!;
  if (mode === 0) {
    if (hg.parent !== scene) scene.add(hg);
    hg.visible = on;
    renderer.getDrawingBufferSize(hullUniforms.uRes.value);
    hullUniforms.uPx.value = HULL_PX * renderer.getPixelRatio();
    hullUniforms.uPulse.value = pulse;
  } else {
    hg.visible = false;
    if (on) outlineUniforms.uOOn.value = pulse;
  }
}
/** Draw calls the outline adds this frame (0 when nothing is targeted or it is off screen). */
export function outlineCalls(): number { return lastCalls; }

/**
 * Post-chain pass (after RenderPass): draws the target into the mask (R = silhouette, G = visible) using the scene
 * depth of the frame just rendered (readBuffer.depthTexture). Skipped entirely when nothing is targeted.
 */
export class OutlineMaskPass extends Pass {
  readonly mask: THREE.WebGLRenderTarget;
  private readonly cam: THREE.Camera;
  constructor(camera: THREE.Camera) {
    super();
    this.cam = camera;
    this.needsSwap = false;
    this.mask = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, type: THREE.UnsignedByteType, format: THREE.RGBAFormat });
    this.mask.texture.name = NAME + ':mask';
    outlineUniforms.uOMask.value = this.mask.texture;
  }
  override setSize(width: number, height: number): void { this.mask.setSize(Math.max(1, width), Math.max(1, height)); }
  override render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    if (!frameOn || frameMode !== 1 || !maskScene) return;
    const c = this.cam as THREE.PerspectiveCamera;
    maskUniforms.tDepth.value = read.depthTexture;
    maskUniforms.uInvRes.value.set(1 / this.mask.width, 1 / this.mask.height);
    maskUniforms.uNear.value = c.near ?? 0.05; maskUniforms.uFar.value = c.far ?? 400;
    const pr = renderer.getPixelRatio();
    outlineUniforms.uOTexel.value.set(Math.max(1, pr) / this.mask.width, Math.max(1, pr) / this.mask.height);
    outlineUniforms.uOMask.value = this.mask.texture;
    const prevRT = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
    renderer.getClearColor(_cc); const prevA = renderer.getClearAlpha();
    const sa = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.mask);
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false;
    renderer.clear(true, false, false);
    renderer.render(maskScene, this.cam);
    renderer.autoClear = prevAuto;
    renderer.setClearColor(_cc, prevA);
    renderer.shadowMap.autoUpdate = sa;
    renderer.setRenderTarget(prevRT);
  }
  override dispose(): void { this.mask.dispose(); if (outlineUniforms.uOMask.value === this.mask.texture) outlineUniforms.uOMask.value = null; }
}

/** Kept for tests / tooling: the hull group (q0–1) once created. */
export function outlineHullGroup(): THREE.Group | null { return hullGroup; }
