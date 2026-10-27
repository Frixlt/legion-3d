/**
 * Paper boats (idea #6): 3 origami boats drift along the lower-street canal and under its bridges (path from the world's
 * canal/bridge data, src/explore/boats.ts), bobbing gently. One InstancedMesh = one draw call, no collisions, off at quality 0.
 */
import * as THREE from 'three';
import { registerSettingRow, settingValue } from '../ui/settings-ext';
import { boatPath, boatSpecs, boatState, type BoatPath, type BoatSpec, type BoatState } from '../explore/boats';
import { coreFeature } from './types';

export const BOATS_KEY = 'l3d.world.boats';

/** One merged geometry: hull (trapezoid prism, open top) + two sail triangles, vertex-coloured paper. Length 0.5 m along x. */
export function paperBoatGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [];
  const hull = new THREE.Color('#f2e8d0'), hullIn = new THREE.Color('#d9ccae'), sail = new THREE.Color('#fff7e2'), edge = new THREE.Color('#e7d9b8');
  const tri = (a: number[], b: number[], c: number[], k: THREE.Color, s = 1) => {
    pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) col.push(k.r * s, k.g * s, k.b * s);
  };
  const quad = (a: number[], b: number[], c: number[], d: number[], k: THREE.Color, s = 1) => { tri(a, b, c, k, s); tri(a, c, d, k, s); };
  const L = 0.25, W = 0.1, H = 0.1, l = 0.15, w = 0.03;
  const r = [[-L, H, -W], [L, H, -W], [L, H, W], [-L, H, W]];          // rim
  const b = [[-l, 0, -w], [l, 0, -w], [l, 0, w], [-l, 0, w]];          // keel
  quad(b[0], b[1], r[1], r[0], hull, 0.92);   // side −z
  quad(b[2], b[3], r[3], r[2], hull, 1.0);    // side +z
  quad(b[1], b[2], r[2], r[1], hull, 0.85);   // bow
  quad(b[3], b[0], r[0], r[3], hull, 0.85);   // stern
  quad(b[0], b[3], b[2], b[1], hullIn, 0.7);  // floor
  // inner faces (the hull is seen from above)
  quad(r[0], r[1], b[1], b[0], hullIn, 0.95); quad(r[3], r[2], b[2], b[3], hullIn, 0.85);
  quad(r[1], r[2], b[2], b[1], hullIn, 0.9); quad(r[2 + 1], r[0], b[0], b[3], hullIn, 0.9);
  // sail: a tall triangle standing on the rim, two sheets (front/back, a hair apart) like folded paper
  for (const z of [-0.006, 0.006]) tri([-0.2, H, z], [0.2, H, z], [0.02, H + 0.26, z], sail, z < 0 ? 0.95 : 1);
  // a small lip along the rim
  quad([-L, H, -W], [L, H, -W], [L, H + 0.012, -W], [-L, H + 0.012, -W], edge); quad([L, H, W], [-L, H, W], [-L, H + 0.012, W], [L, H + 0.012, W], edge);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

const TINTS = ['#ffffff', '#ffd3df', '#cfe3ff'].map((c) => new THREE.Color(c));

export default coreFeature({
  id: 'boats',
  order: 89,
  setup(ctx) {
    const offRow = registerSettingRow({ key: BOATS_KEY, label: 'Бумажные кораблики', sub: 'Кораблики плывут по каналу под мостами (от среднего качества)', group: 'Мир', order: 20, kind: 'seg', options: [['1', 'Вкл'], ['0', 'Выкл']], def: '1' });
    let mesh: THREE.InstancedMesh | null = null, root: THREE.Object3D | null = null;
    let path: BoatPath | null = null, specs: BoatSpec[] = [];
    const st: BoatState = { x: 0, y: 0, z: 0, yaw: 0, roll: 0, pitch: 0, scale: 1 };
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const enabled = () => settingValue<string>(BOATS_KEY, '1') !== '0' && ctx.quality() >= 1;
    const drop = () => {
      if (!mesh) return;
      mesh.removeFromParent(); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); mesh.dispose(); mesh = null;
    };
    const place = (t: number) => {
      if (!mesh || !path) return;
      for (let i = 0; i < specs.length; i++) {
        boatState(path, specs[i], t, st);
        e.set(st.pitch, st.yaw, st.roll); q.setFromEuler(e);
        p.set(st.x, st.y, st.z); sc.setScalar(Math.max(0.001, st.scale));
        m4.compose(p, q, sc); mesh.setMatrixAt(i, m4);
      }
      mesh.instanceMatrix.needsUpdate = true;
    };
    const sync = () => {
      const w = ctx.world();
      if (!enabled()) { drop(); return; }
      if (mesh && root === w.root) return;
      drop();
      path = boatPath(ctx.layout());
      if (!path) return;
      specs = boatSpecs(path, 3);
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: new THREE.Color('#3a3250') });
      mesh = new THREE.InstancedMesh(paperBoatGeometry(), mat, specs.length);
      mesh.name = 'fx:boats'; mesh.frustumCulled = false;
      specs.forEach((s, i) => mesh!.setColorAt(i, TINTS[s.hue % TINTS.length]));
      root = w.root; w.root.add(mesh); place(0);
    };
    sync();
    const offW = ctx.onWorld(() => { root = null; sync(); });
    const offQ = ctx.engine.onQuality(() => sync());
    const onSet = (ev: Event) => { const k = (ev as CustomEvent).detail?.key; if (!k || k === BOATS_KEY) sync(); };
    window.addEventListener('l3d:settings', onSet);
    const offF = ctx.onFrame((_dt, t) => { if (mesh && !ctx.state.inRoom) place(t); });
    ctx.dev.boats = { mesh: () => mesh, path: () => path };
    return () => { offF(); offW(); offQ(); window.removeEventListener('l3d:settings', onSet); drop(); offRow(); };
  },
});
