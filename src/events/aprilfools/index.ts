/**
 * День нелепых шляп (April 1, local time): every cat you see wears a striped paper party hat with a pompom — LOCALLY:
 * the hats are our own decoration drawn over the avatars, the players' real looks (Appearance.gear / look.hat) are
 * never touched and nothing is sent anywhere.
 *
 *  - one InstancedMesh for all hats; each frame the hat follows the head (the body bone the head is skinned to, via the
 *    avatar's combatRig(); ragdolls and emotes included), sits on the head top or on a small hat, tilted jauntily;
 *  - cats in a tall helmet / big hat (head top more than 0.22 m above the head) are skipped — no hat-on-a-helmet;
 *  - the own cat gets one in third person (never in first person: no hat in the view);
 *  - the nearest N cats within 24 m (N by quality); the garland bulbs turn candy colours.
 * Draw calls: hats = 1. Cost: a few matrix products per hatted cat (≈ 0.05 ms for 60 cats).
 */
import * as THREE from 'three';
import type { SeasonalEvent, EventContext, EventAvatar } from '../types';
import type { QualityLevel } from '../../contracts';
import { inWindow, windowDistance } from '../calendar';
import { garland, recolourBulbs, selfLit } from '../common';

export const APRIL_FROM: [number, number] = [4, 1];
export const APRIL_TO: [number, number] = [4, 1];
export const HAT_BUDGET: Record<QualityLevel, number> = { 0: 16, 1: 32, 2: 64, 3: 96 };
/** Head-top clearance above the head (m) beyond which the cat's own headwear is too tall for a party hat. */
export const TALL_HAT = 0.22;
const RANGE = 24;

const BULBS = [[1.0, 0.45, 0.7], [0.45, 0.85, 1.0], [1.0, 0.9, 0.35], [0.55, 1.0, 0.6], [0.8, 0.55, 1.0]];
const COLORS = ['#ff8fb8', '#7fd8c8', '#ffd45e', '#8fb8ff', '#c49bff', '#ffa36b', '#9be07a'].map((h) => new THREE.Color(h));

/**
 * A paper party cone: base radius 1 at y = 0, apex at y = 2.3, with a pompom. Vertex colour channels are masks for the
 * shader (r = cream stripe, g = shading, b = gold rim) so one instance colour gives every hat its own pastel.
 */
export function hatGeometry(): THREE.BufferGeometry {
  const seg = 24, cone = new THREE.ConeGeometry(1, 2.3, seg, 6, true).toNonIndexed();
  cone.translate(0, 1.15, 0);
  const p = cone.getAttribute('position'), c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x);
    const stripe = Math.sin(a * 3 + y * 2.6) > 0.35 ? 1 : 0;                       // three spiral cream stripes
    c[i * 3] = stripe; c[i * 3 + 1] = 0.85 + 0.15 * (y / 2.3); c[i * 3 + 2] = y < 0.12 ? 1 : 0;
  }
  cone.setAttribute('color', new THREE.BufferAttribute(c, 3));
  // pompom: a fluffy ball on the apex (cream mask)
  const pom = new THREE.IcosahedronGeometry(0.42, 1), pp = pom.getAttribute('position');
  for (let i = 0; i < pp.count; i++) { const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i), k = 1 + 0.12 * Math.sin(x * 19 + y * 13 + z * 17); pp.setXYZ(i, x * k, y * k + 2.3, z * k); }
  pom.deleteAttribute('uv'); cone.deleteAttribute('uv');
  const pc = new Float32Array(pp.count * 3); for (let i = 0; i < pp.count; i++) { pc[i * 3] = 1; pc[i * 3 + 1] = 1; pc[i * 3 + 2] = 0; }
  pom.setAttribute('color', new THREE.BufferAttribute(pc, 3));
  pom.computeVertexNormals(); cone.computeVertexNormals();
  const g = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'color']) {
    const a = cone.getAttribute(k).array as Float32Array, b = pom.getAttribute(k).array as Float32Array, out = new Float32Array(a.length + b.length);
    out.set(a); out.set(b, a.length); g.setAttribute(k, new THREE.BufferAttribute(out, 3));
  }
  g.computeBoundingSphere();
  return g;
}

const _m = new THREE.Matrix4(), _l = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const hashId = (id: string) => { let h = 2166136261; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619); return h >>> 0; };

/**
 * Hat transform for an avatar into `out` (world); false when the cat gets no hat (tall headwear, no rig, hidden).
 * The head is skinned to the body bone: a point P of the model (feet at 0) is posed as (P − rest[body]) · body.matrixWorld.
 */
export function hatMatrix(av: EventAvatar, seed: number, out: THREE.Matrix4): boolean {
  const rig = av.combatRig?.();
  let lift: number, w: number;
  if (rig && rig.bones.length > 1) {
    const extra = rig.headTop - rig.top;
    if (extra > TALL_HAT) return false;
    lift = extra > 0.05 ? rig.headTop - 0.03 : rig.top - 0.035;
    w = rig.w;
    const body = rig.bones[1], r = rig.rest[1];
    body.updateWorldMatrix(true, false);
    const tilt = ((seed & 7) / 7 - 0.5) * 0.5, side = tilt * 0.12;
    const rad = Math.min(0.15, Math.max(0.085, w * 0.42));
    _e.set(((seed >> 3) & 3) * 0.05 - 0.05, (seed >> 5) % 6, tilt); _q.setFromEuler(_e);
    _p.set(side - r.x, lift - r.y, -r.z); _s.set(rad, rad * 1.05, rad);
    _l.compose(_p, _q, _s);
    out.multiplyMatrices(body.matrixWorld, _l);
    return true;
  }
  // no rig: on the head top of the root, upright
  if (av.headTop > 1.9) return false;
  av.root.updateWorldMatrix(true, false);
  _p.set(0, av.headTop - 0.03, 0); _q.identity(); _s.setScalar(0.11);
  _l.compose(_p, _q, _s); out.multiplyMatrices(av.root.matrixWorld, _l);
  return true;
}

function setup(ctx: EventContext): () => void {
  const undo = [recolourBulbs(garland(ctx).bulbs, BULBS)];
  const group = new THREE.Group(); group.name = 'event:aprilfools';
  const geo = hatGeometry();
  const mat = selfLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }), 0.3);
  mat.onBeforeCompile = ((prev) => (sh: Parameters<NonNullable<THREE.Material['onBeforeCompile']>>[0], r: THREE.WebGLRenderer) => {
    prev.call(mat, sh, r);
    // vertex colour = masks: cream stripes / pompom (r), shading (g), gold rim (b) over the per-hat pastel
    sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', `#include <color_vertex>
      #if defined( USE_COLOR ) && defined( USE_INSTANCING_COLOR )
        vColor.rgb = mix(mix(instanceColor.rgb, vec3(1.0, 0.96, 0.86), color.r), vec3(1.0, 0.78, 0.3), color.b) * color.g;
      #endif`);
  })(mat.onBeforeCompile);
  mat.customProgramCacheKey = () => 'l3d-partyhat';
  const MAX = HAT_BUDGET[3] + 1;
  const hats = new THREE.InstancedMesh(geo, mat, MAX); hats.name = 'aprilfools:hats'; hats.frustumCulled = false; hats.count = 0;
  for (let i = 0; i < MAX; i++) hats.setColorAt(i, COLORS[i % COLORS.length]);
  group.add(hats);
  let q = ctx.quality();
  const offQ = ctx.onQuality((nq) => { q = nq; });
  const cam = ctx.camera.position;
  let n = 0, limit = HAT_BUDGET[q];
  const visit = (id: string, av: EventAvatar) => {
    if (n >= limit || !av.root.visible) return;
    const r = av.root.position;
    if ((r.x - cam.x) ** 2 + (r.z - cam.z) ** 2 > RANGE * RANGE) return;
    const seed = hashId(id);
    if (!hatMatrix(av, seed, _m)) return;
    hats.setMatrixAt(n, _m);
    hats.setColorAt(n, COLORS[seed % COLORS.length]);
    n++;
  };
  const offF = ctx.onFrame(() => {
    const game = ctx.game; if (!game) return;
    n = 0; limit = HAT_BUDGET[q];
    const me = game.me();
    if (me && me.visible) visit('\u0000me', me.av);
    game.forEachCat(visit);
    hats.count = n; hats.visible = n > 0;
    if (n) { hats.instanceMatrix.needsUpdate = true; if (hats.instanceColor) hats.instanceColor.needsUpdate = true; }
  });
  ctx.group.add(group);
  return () => {
    offF(); offQ();
    group.removeFromParent();
    hats.dispose(); geo.dispose(); mat.dispose();
    for (const u of undo.reverse()) u();
  };
}

const aprilfools: SeasonalEvent = {
  id: 'aprilfools',
  title: 'День нелепых шляп',
  short: 'Шляпы',
  greeting: '🎉 1 апреля — день нелепых шляп! Колпаки видишь только ты, настоящие облики не меняются. Отключить: Настройки → События',
  active: (d) => inWindow(d, APRIL_FROM, APRIL_TO),
  distance: (d) => windowDistance(d, APRIL_FROM, APRIL_TO),
  setup,
};
export default aprilfools;
export { setup as setupAprilFools };
