/**
 * A minimal 3D room (kind 'debug'): a lit 7×5 m hall with a counter, a crate to jump on and an exit door.
 * It exists to exercise the room manager without the real room modules (tests, dev/game.html?room=forge:debug)
 * and as the smallest working example of a RoomDef (docs/EXTENDING.md).
 */
import * as THREE from 'three';
import type { RoomDef, RoomScene, Interactable } from '../contracts/ext';

const W = 7, D = 5, H = 3;   // inner size (m): x ∈ [-W/2, W/2], z ∈ [-D, 0]

export const debugRoom: RoomDef = {
  title: 'Комната',
  async create(ctx) {
    const root = new THREE.Group(); root.name = 'room:debug';
    const mats: THREE.Material[] = [];
    const geos: THREE.BufferGeometry[] = [];
    const mat = (c: string) => { const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }); mats.push(m); return m; };
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
      const g = new THREE.BoxGeometry(w, h, d); geos.push(g);
      const o = new THREE.Mesh(g, m); o.position.set(x, y, z); root.add(o); return o;
    };
    const floor = box(W, 0.1, D, 0, -0.05, -D / 2, mat('#6b4a33'));
    floor.receiveShadow = true;
    const wall = mat('#3b2f52');
    const walls = [
      box(W, H, 0.2, 0, H / 2, -D - 0.1, wall), box(0.2, H, D, -W / 2 - 0.1, H / 2, -D / 2, wall),
      box(0.2, H, D, W / 2 + 0.1, H / 2, -D / 2, wall), box(W, H, 0.2, 0, H / 2, 0.1, wall),
    ];
    box(W, 0.1, D, 0, H + 0.05, -D / 2, mat('#2a2140'));
    const counter = { x0: -1.5, x1: 1.5, z0: -4.2, z1: -3.6, top: 1.0 };
    box(counter.x1 - counter.x0, counter.top, counter.z1 - counter.z0, 0, counter.top / 2, (counter.z0 + counter.z1) / 2, mat('#a0703f'));
    const crate = { x0: 2.0, x1: 2.6, z0: -2.0, z1: -1.4, top: 0.6 };
    box(0.6, 0.6, 0.6, 2.3, 0.3, -1.7, mat('#c49a5a'));
    const door = box(1.0, 2.0, 0.06, 0, 1.0, -0.02, mat('#7a4b2a'));
    root.add(new THREE.HemisphereLight('#fff1d6', '#3a2a40', 1.2));
    const lamp = new THREE.PointLight('#ffd9a0', 6, 9, 1.6); lamp.position.set(0, H - 0.4, -D / 2); root.add(lamp);

    const exit: Interactable = {
      id: 'room:exit', label: 'Выйти на улицу', icon: '🚪', hit: door, reach: 3,
      use: () => ctx.exit(),
    };
    ctx.interact.add(exit);   // removed by the room manager on exit

    const inside = (x: number, z: number, r: { x0: number; x1: number; z0: number; z1: number }) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
    const scene: RoomScene = {
      root,
      free: (x, z) => x > -W / 2 + 0.25 && x < W / 2 - 0.25 && z > -D + 0.25 && z < -0.25 && !inside(x, z, counter),
      groundAt: () => 0,
      solidTop: (x, z) => (inside(x, z, counter) ? counter.top : inside(x, z, crate) ? crate.top : -Infinity),
      spawn: { x: 0, z: -0.9, face: 0 },
      colliders: walls,
      update() { /* static */ },
      dispose() { for (const g of geos) g.dispose(); for (const m of mats) m.dispose(); root.removeFromParent(); },
    };
    return scene;
  },
};
