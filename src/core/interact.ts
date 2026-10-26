/**
 * InteractSystem: what the player can use right now (contract in src/contracts/ext.ts).
 *
 * Each frame (update):
 *   - AIM: a ray from the screen centre (the crosshair = camera position + view direction) is tested against every
 *     registered hit volume. Candidates are first culled by distance (bounding sphere vs reach), then by the ray-vs-AABB
 *     test (Box3 hits end here), then, for Object3D hits, by an exact mesh raycast (rotated or odd-shaped volumes).
 *     The nearest hit within `reach` (default 3 m, measured from the eye; in third person the camera→eye distance is
 *     added) is `aimed`.
 *   - NEAR: the closest volume whose footprint is within the proximity reach (default 2.2 m) of the player's feet,
 *     unless the interactable says `proximity: false`.
 *   - target = aimed ?? near.
 * Use: E → target (aimed or nearby); LMB → only `aimed` (so clicking near a building never opens it); RMB is never
 * routed here (block). No allocations per frame except the exact raycast while the crosshair is inside an AABB.
 *
 * Highlight: exactly one object — the current target — is highlighted. An interactable with `highlight(on)` draws
 * its own (shop goods, mine stones); otherwise a generic one is applied: a golden back-face shell over the visible
 * meshes of an Object3D hit (shares their geometry, pooled meshes), or a glowing frame on the AABB (or on
 * `highlightBox`) for Box3 / invisible hit volumes. `hit.userData.highlight = false` turns the generic highlight off for an object.
 */
import * as THREE from 'three';
import type { Interactable, InteractSystem } from '../contracts/ext';
import type { Unsub } from '../contracts';

/** Interactable with the optional highlight hook (not in the v2 contract yet; duck-typed). */
export type InteractableEx = Interactable & {
  highlight?(on: boolean): void;
  /** Box for the generic frame highlight when it should differ from the hit volume (doors: the doorway only). */
  highlightBox?: THREE.Box3;
  soon?: boolean; title?: string;
};

export const AIM_REACH = 3.0;
export const NEAR_REACH = 2.2;

/** What the HUD shows (UiHost.focusTarget). One mutable object, refreshed only when the target changes. */
export interface FocusInfo { id: string; title: string; icon?: string; label: string; soon?: boolean; aimed: boolean }

export interface InteractSystemEx extends InteractSystem {
  /** The interactable under the crosshair (within reach) or null. */
  readonly aimed: Interactable | null;
  /** The nearest interactable usable by E proximity or null. */
  readonly near: Interactable | null;
  /**
   * Recompute targets. feet = player feet (m, world). eyeExtra = distance from the camera to the eye point
   * (0 in first person; the TP boom length otherwise), added to the aim reach.
   */
  update(camera: THREE.Camera, feet: { x: number; y: number; z: number }, eyeExtra?: number): void;
  /** Use the current target: 'key' → aimed or nearby, 'click' → aimed only. Returns true if something was used. */
  use(how: 'key' | 'click'): boolean;
  /** Off: no targets (menus, overlays, loading). */
  setEnabled(on: boolean): void;
  /** HUD info for the current target (null = nothing). */
  focus(): FocusInfo | null;
  /** Number of registered interactables. */
  readonly size: number;
}

interface Entry {
  i: Interactable;
  box: THREE.Box3;          // world AABB (= i.hit for Box3 hits)
  obj: THREE.Object3D | null;
  center: THREE.Vector3; radius: number;
  exact: boolean;           // exact mesh raycast after the AABB test
  hasMesh: boolean;
}

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3();
const _ray = new THREE.Ray();
const _rc = new THREE.Raycaster();
const _hits: THREE.Intersection[] = [];

/* ---- generic highlight: pooled shells + one AABB frame, created lazily once ---- */
const SHELL_MAX = 8, SHELL_SCALE = 1.06;
const GOLD = 0xffd36a;
let shellMat: THREE.MeshBasicMaterial | null = null;
let frame: THREE.LineSegments | null = null;
const shells: THREE.Mesh[] = [];
const noRaycast = () => { /* highlight meshes are never hit */ };
function shellPool(): THREE.Mesh[] {
  if (!shellMat) {
    shellMat = new THREE.MeshBasicMaterial({ color: GOLD, side: THREE.BackSide, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < SHELL_MAX; i++) { const m = new THREE.Mesh(undefined, shellMat); m.name = 'l3d:highlight'; m.raycast = noRaycast; m.renderOrder = 3; m.matrixAutoUpdate = true; shells.push(m); }
  }
  return shells;
}
function frameMesh(): THREE.LineSegments {
  if (!frame) {
    const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    const m = new THREE.LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    frame = new THREE.LineSegments(g, m); frame.name = 'l3d:highlight-frame'; frame.raycast = noRaycast; frame.renderOrder = 3;
  }
  return frame;
}

export function createInteractSystem(opts: { scene?: THREE.Object3D } = {}): InteractSystemEx {
  const entries: Entry[] = [];
  let lit: Entry | null = null, litShells = 0;
  const unlight = () => {
    if (!lit) return;
    const i = lit.i as InteractableEx;
    if (typeof i.highlight === 'function') { try { i.highlight(false); } catch (e) { console.error('[l3d] highlight', i.id, e); } }
    for (let k = 0; k < litShells; k++) { const m = shells[k]; m.removeFromParent(); m.geometry = undefined as unknown as THREE.BufferGeometry; }
    litShells = 0;
    if (frame) frame.removeFromParent();
    lit = null;
  };
  const light = (e: Entry) => {
    lit = e;
    const i = e.i as InteractableEx;
    if (typeof i.highlight === 'function') { try { i.highlight(true); } catch (err) { console.error('[l3d] highlight', i.id, err); } return; }
    if (e.obj?.userData?.highlight === false) return;
    if (e.obj) {
      const pool = shellPool();
      e.obj.traverseVisible((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || litShells >= SHELL_MAX || m.name === 'l3d:highlight' || !m.geometry) return;
        const mat = m.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat) ? !mat.some((x) => x.visible) : !mat.visible) return;
        const g = m.geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        const sh = pool[litShells++];
        sh.geometry = g;
        // scale about the geometry centre (not the mesh origin) so the shell wraps the object evenly
        g.boundingBox!.getCenter(sh.position).multiplyScalar(1 - SHELL_SCALE);
        sh.scale.setScalar(SHELL_SCALE);
        m.add(sh);
      });
      if (litShells > 0) return;
    }
    // Box3 or invisible hit volume → glowing frame on the AABB
    if (!opts.scene) return;
    const f = frameMesh();
    const hb = i.highlightBox ?? e.box;
    hb.getCenter(f.position);
    hb.getSize(f.scale);
    f.scale.addScalar(0.04);
    opts.scene.add(f);
  };
  let aimed: Interactable | null = null, near: Interactable | null = null;
  let enabled = true;
  const info: FocusInfo = { id: '', title: '', label: '', aimed: false };
  let infoFor: Interactable | null = null, infoAimed = false, infoLabel = '';

  const refreshBox = (e: Entry) => {
    if (!e.obj) return;
    e.obj.updateWorldMatrix(true, true);
    e.box.setFromObject(e.obj);
    if (e.box.isEmpty()) { e.radius = -1; return; }
    e.box.getCenter(e.center);
    e.radius = e.box.max.distanceTo(e.center);
  };
  /** Parents visible (the hit volume itself may be invisible on purpose). */
  const parentsVisible = (o: THREE.Object3D) => {
    for (let p = o.parent; p; p = p.parent) if (!p.visible) return false;
    return true;
  };
  const usable = (e: Entry) => (!e.i.enabled || e.i.enabled()) && (!e.obj || parentsVisible(e.obj));

  const sys: InteractSystemEx = {
    get target() { return aimed ?? near; },
    get aimed() { return aimed; },
    get near() { return near; },
    get size() { return entries.length; },

    add(i): Unsub {
      const isBox = (i.hit as THREE.Box3).isBox3 === true;
      const obj = isBox ? null : (i.hit as THREE.Object3D);
      let hasMesh = false;
      if (obj) obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) hasMesh = true; });
      const e: Entry = {
        i, obj, box: isBox ? (i.hit as THREE.Box3) : new THREE.Box3(), center: new THREE.Vector3(), radius: 0,
        exact: !!obj && hasMesh && obj.userData?.exactHit !== false, hasMesh,
      };
      if (isBox) { e.box.getCenter(e.center); e.radius = e.box.max.distanceTo(e.center); } else refreshBox(e);
      entries.push(e);
      return () => {
        if (lit === e) unlight();
        const k = entries.indexOf(e); if (k >= 0) entries.splice(k, 1);
        if (aimed === i) aimed = null;
        if (near === i) near = null;
      };
    },

    update(camera, feet, eyeExtra = 0) {
      aimed = null; near = null;
      let aimedE: Entry | null = null, nearE: Entry | null = null;
      if (!enabled || entries.length === 0) { if (lit) unlight(); return; }
      camera.getWorldPosition(_o);
      camera.getWorldDirection(_d);
      _ray.set(_o, _d);
      let bestA = Infinity, bestN = Infinity;
      for (let k = 0; k < entries.length; k++) {
        const e = entries[k];
        if (!usable(e)) continue;
        const i = e.i;
        // moving/animated hit objects: refresh their AABB only when they could be in reach
        if (e.obj && e.obj.matrixWorldAutoUpdate !== false && !e.obj.userData?.staticHit) {
          const dc = _o.distanceTo(e.center) - e.radius;
          if (dc < (i.reach ?? AIM_REACH) + eyeExtra + 2) refreshBox(e);
        }
        if (e.radius < 0) continue;
        const reachA = (i.reach ?? AIM_REACH) + eyeExtra;
        // aim
        if (_o.distanceTo(e.center) - e.radius <= reachA) {
          const hp = _ray.intersectBox(e.box, _p);
          if (hp) {
            let td = _o.distanceTo(hp);
            if (td <= reachA && td < bestA && e.exact) {
              _hits.length = 0;
              _rc.ray.copy(_ray); _rc.near = 0; _rc.far = reachA;
              _rc.intersectObject(e.obj!, true, _hits);
              td = _hits.length ? _hits[0].distance : Infinity;
              _hits.length = 0;
            }
            if (td <= reachA && td < bestA) { bestA = td; aimed = i; aimedE = e; }
          }
        }
        // proximity (horizontal distance from the feet to the AABB footprint; feet roughly at the volume's height)
        if (i.proximity !== false) {
          const reachN = i.reach != null ? Math.min(i.reach, NEAR_REACH * 1.5) : NEAR_REACH;
          const b = e.box;
          if (feet.y < b.min.y - 1.2 || feet.y > b.max.y + 0.5) continue;
          const dx = feet.x < b.min.x ? b.min.x - feet.x : feet.x > b.max.x ? feet.x - b.max.x : 0;
          const dz = feet.z < b.min.z ? b.min.z - feet.z : feet.z > b.max.z ? feet.z - b.max.z : 0;
          const dd = dx * dx + dz * dz;
          if (dd <= reachN * reachN && dd < bestN) { bestN = dd; near = i; nearE = e; }
        }
      }
      const tE = aimedE ?? nearE;
      if (tE !== lit) { unlight(); if (tE) light(tE); }
    },

    use(how) {
      const t = how === 'click' ? aimed : (aimed ?? near);
      if (!t) return false;
      try { t.use(how); } catch (e) { console.error('[l3d] interact', t.id, e); }
      return true;
    },

    setEnabled(on) { enabled = on; if (!on) { aimed = null; near = null; unlight(); } },

    focus() {
      const t = aimed ?? near;
      if (!t) { infoFor = null; return null; }
      const isAimed = t === aimed;
      if (t !== infoFor || isAimed !== infoAimed || t.label !== infoLabel) {
        infoFor = t; infoAimed = isAimed; infoLabel = t.label;
        info.id = t.id; info.label = t.label; info.title = (t as InteractableEx).title ?? t.label; info.icon = t.icon;
        info.soon = (t as InteractableEx).soon; info.aimed = isAimed;
      }
      return info;
    },
  };
  return sys;
}
