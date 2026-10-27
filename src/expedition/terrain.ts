/**
 * Procedural low-poly terrain per biome: sky dome, rolling ground with a path (travel) or a clearing (arenas), water,
 * walls for gorges and caves, instanced props. The ground and the props repeat along x with period P, so the travel
 * scene scrolls the whole terrain (`scroll(offset)`) for an endless road without rebuilding anything.
 * Budget: ≤ ~12 draw calls, ≤ ~45k triangles per biome.
 */
import * as THREE from 'three';
import type { BiomeId } from './adapter';
import { propGeo, GB, T, type PropKind } from './art';
import type { ExpMats } from './mats';

export const P = 48;           // repeat period along x (m)
const SPAN = 1.5 * P;          // ground spans x ∈ [−SPAN, SPAN]
const ZW = 36;                 // ground half-depth (m)

export interface BiomeSpec {
  sky: [string, string, string]; fog: string; fogNear: number; fogFar: number; stars: number;
  ground: [string, string]; path: string; amp: number;
  hemi: [string, string, number]; sun: [string, number];
  props: [PropKind, number, number][];   // kind, palette, count per tile
  water: 'none' | 'river' | 'falls' | 'bridge' | 'swamp';
  walls: 'none' | 'gorge' | 'cave';
  /** label of the place for the HUD («Курган») */
  ru: string;
}
const DAY: [string, string, string] = ['#5aa8f0', '#bfe4ff', '#e8f4ff'];
export const BIOMES: Record<BiomeId, BiomeSpec> = {
  meadow: { ru: 'Луг', sky: DAY, fog: '#cfe8f4', fogNear: 30, fogFar: 85, stars: 0, ground: ['#7cc85a', '#9ad86a'], path: '#d8b87a', amp: 0.8, hemi: ['#fff6e8', '#7a8a5a', 2.6], sun: ['#fff2dc', 2.4],
    props: [['tree', 0, 10], ['tree', 1, 6], ['bush', 0, 12], ['rock', 0, 6], ['grass', 0, 70], ['flower', 0, 16], ['flower', 1, 12], ['fence', 0, 3]], water: 'none', walls: 'none' },
  forest: { ru: 'Лес', sky: ['#4a8ad8', '#a8d4f0', '#d8eef8'], fog: '#a8d0c0', fogNear: 18, fogFar: 70, stars: 0, ground: ['#5aa85a', '#6ab86a'], path: '#b8986a', amp: 1.0, hemi: ['#f0f8e0', '#4a6a3a', 2.4], sun: ['#fff2d0', 2.0],
    props: [['pine', 0, 22], ['tree', 3, 12], ['bush', 1, 14], ['mushroom', 0, 18], ['mushroom', 1, 10], ['grass', 3, 90], ['rock', 2, 6]], water: 'none', walls: 'none' },
  river: { ru: 'Река', sky: DAY, fog: '#cfe8f4', fogNear: 30, fogFar: 85, stars: 0, ground: ['#7cc85a', '#8ad46a'], path: '#d8c08a', amp: 0.6, hemi: ['#fff6e8', '#6a8a7a', 2.6], sun: ['#fff2dc', 2.4],
    props: [['tree', 0, 8], ['bush', 0, 10], ['reed', 0, 30], ['lily', 1, 14], ['rock', 3, 8], ['grass', 0, 100], ['flower', 2, 25]], water: 'river', walls: 'none' },
  falls: { ru: 'Водопад', sky: DAY, fog: '#d8eef8', fogNear: 28, fogFar: 80, stars: 0, ground: ['#6ac05a', '#8ad06a'], path: '#d0b88a', amp: 0.7, hemi: ['#fff6e8', '#5a8a8a', 2.6], sun: ['#fff2dc', 2.3],
    props: [['tree', 3, 8], ['pine', 0, 6], ['reed', 0, 20], ['rock', 0, 10], ['grass', 0, 90], ['flower', 2, 25]], water: 'falls', walls: 'none' },
  bridge: { ru: 'Старый мост', sky: ['#6aa0e0', '#f0d0b0', '#ffe8d0'], fog: '#f0d8c8', fogNear: 28, fogFar: 85, stars: 0, ground: ['#8ac05a', '#a8c86a'], path: '#c8a878', amp: 0.7, hemi: ['#ffeedd', '#7a6a5a', 2.5], sun: ['#ffd8b0', 2.4],
    props: [['tree', 2, 8], ['dead', 0, 4], ['bush', 2, 10], ['reed', 0, 16], ['rock', 1, 8], ['grass', 2, 100]], water: 'bridge', walls: 'none' },
  mound: { ru: 'Курган', sky: ['#5a7ac0', '#b8cce0', '#e0e8ec'], fog: '#c8d4dc', fogNear: 26, fogFar: 85, stars: 0, ground: ['#6aa84a', '#86bc5a'], path: '#c0a878', amp: 1.2, hemi: ['#fff8ec', '#5a6a4a', 2.6], sun: ['#fff0dc', 2.4],
    props: [['mound', 0, 3], ['stone', 0, 6], ['dead', 0, 6], ['tree', 2, 8], ['bush', 3, 10], ['pine', 0, 6], ['rock', 2, 8], ['grass', 2, 110], ['flower', 3, 12]], water: 'none', walls: 'none' },
  gorge: { ru: 'Ущелье', sky: ['#5a90d0', '#d8c8a8', '#f0e0c8'], fog: '#e0d0b8', fogNear: 24, fogFar: 75, stars: 0, ground: ['#b8a07a', '#c8b088'], path: '#a8906a', amp: 0.5, hemi: ['#fff0e0', '#7a5a4a', 2.4], sun: ['#ffe0b8', 2.4],
    props: [['cliff', 0, 10], ['cliff', 1, 8], ['rock', 1, 14], ['dead', 0, 4], ['grass', 2, 50], ['cactus', 0, 2]], water: 'none', walls: 'gorge' },
  mine: { ru: 'Шахта', sky: ['#1a1424', '#2a2034', '#3a2e40'], fog: '#2a2034', fogNear: 10, fogFar: 42, stars: 0, ground: ['#6a5a52', '#7a6a5e'], path: '#8a7a62', amp: 0.3, hemi: ['#ffd8a8', '#3a2a2a', 2.0], sun: ['#ffcf8a', 1.6],
    props: [['support', 0, 6], ['stalag', 0, 14], ['crystal', 3, 10], ['rock', 2, 14], ['torch', 0, 6]], water: 'none', walls: 'cave' },
  cave: { ru: 'Пещера', sky: ['#120e22', '#1e1834', '#2a2240'], fog: '#1e1834', fogNear: 9, fogFar: 40, stars: 0, ground: ['#5a5470', '#6a6280'], path: '#7a7090', amp: 0.4, hemi: ['#b8c8ff', '#2a2034', 2.0], sun: ['#a8c0ff', 1.4],
    props: [['stalag', 1, 22], ['crystal', 0, 14], ['crystal', 1, 8], ['mushroom', 3, 16], ['rock', 2, 14]], water: 'none', walls: 'cave' },
  dungeon: { ru: 'Данж', sky: ['#120e1a', '#1e1828', '#2a2234'], fog: '#1e1828', fogNear: 10, fogFar: 40, stars: 0, ground: ['#6a6478', '#7a7488'], path: '#8a8498', amp: 0.05, hemi: ['#ffd8b0', '#2a2030', 2.0], sun: ['#ffc88a', 1.4],
    props: [['pillar', 0, 12], ['torch', 0, 12], ['rock', 2, 8], ['crystal', 2, 4]], water: 'none', walls: 'cave' },
  gate: { ru: 'Врата башни', sky: ['#3a3a7a', '#c88aa8', '#ffc8a8'], fog: '#d8a8b8', fogNear: 26, fogFar: 85, stars: 0.3, ground: ['#7aa86a', '#8ab070'], path: '#a89c8a', amp: 0.8, hemi: ['#ffe0e8', '#5a4a6a', 2.4], sun: ['#ffc8a0', 2.2],
    props: [['pillar', 0, 6], ['stone', 0, 4], ['tree', 2, 6], ['rock', 2, 8], ['grass', 2, 80], ['torch', 0, 6]], water: 'none', walls: 'none' },
  swamp: { ru: 'Болото', sky: ['#5a7a7a', '#a8c0a8', '#c8d8c0'], fog: '#a8c0a8', fogNear: 16, fogFar: 60, stars: 0, ground: ['#5a7a4a', '#6a8a52'], path: '#7a6a4a', amp: 0.4, hemi: ['#e8f0d8', '#3a4a3a', 2.2], sun: ['#e8f0c8', 1.8],
    props: [['dead', 0, 10], ['reed', 0, 40], ['lily', 0, 20], ['mushroom', 2, 12], ['grass', 3, 80]], water: 'swamp', walls: 'none' },
  snow: { ru: 'Тайга', sky: ['#6a9ad8', '#d8e8f8', '#f4f8ff'], fog: '#e8f0f8', fogNear: 24, fogFar: 75, stars: 0, ground: ['#e8f0f8', '#f8fbff'], path: '#c8d0e0', amp: 1.0, hemi: ['#ffffff', '#8a9ab8', 2.6], sun: ['#fff8f0', 2.2],
    props: [['snowpine', 0, 24], ['rock', 2, 10], ['dead', 0, 4]], water: 'none', walls: 'none' },
  desert: { ru: 'Пустыня', sky: ['#4a9ae0', '#f8e0b0', '#fff0d0'], fog: '#f8e8c8', fogNear: 30, fogFar: 90, stars: 0, ground: ['#e8c88a', '#f0d49a'], path: '#d8b078', amp: 1.1, hemi: ['#fff8e8', '#a8805a', 2.6], sun: ['#fff0d0', 2.6],
    props: [['cactus', 0, 12], ['rock', 3, 12], ['dead', 0, 4], ['cliff', 3, 4]], water: 'none', walls: 'none' },
};

function rng(seed: number) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const K = (2 * Math.PI) / P;

export type TerrainMode = 'path' | 'clearing';

export class Terrain {
  readonly root = new THREE.Group();
  readonly spec: BiomeSpec;
  private scrollRoot = new THREE.Group();
  private disposables: { dispose(): void }[] = [];
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private fill: THREE.PointLight | null = null;
  private waterMesh: THREE.Mesh | null = null;
  private fallMesh: THREE.Mesh | null = null;
  private night = false;
  /** a river along x behind the action (river, falls, the bridge arena) */
  private get parallel(): boolean { const w = this.spec.water; return w === 'river' || w === 'falls' || (w === 'bridge' && this.mode === 'clearing'); }

  constructor(private mats: ExpMats, readonly biome: BiomeId, readonly mode: TerrainMode, o: { night?: boolean; seed?: number } = {}) {
    this.spec = BIOMES[biome] || BIOMES.meadow;
    this.root.name = `exp-terrain-${biome}-${mode}`;
    this.night = !!o.night;
    const S = this.spec;
    this.root.add(this.scrollRoot);
    // sky dome
    const sky = new THREE.Mesh(new THREE.SphereGeometry(120, 24, 12), mats.sky);
    sky.frustumCulled = false; sky.renderOrder = -10; sky.name = 'exp-sky';
    this.disposables.push(sky.geometry);
    this.root.add(sky);
    // lights
    this.hemi = new THREE.HemisphereLight(S.hemi[0], S.hemi[1], S.hemi[2] * 0.62);
    this.sun = new THREE.DirectionalLight(S.sun[0], S.sun[1] * 1.45);
    this.sun.position.set(-12, 30, 18); this.sun.target.position.set(0, 0, 0);
    this.root.add(this.hemi, this.sun, this.sun.target);
    if (this.night || S.walls === 'cave') {
      this.fill = new THREE.PointLight(this.night ? '#ff9a4a' : '#ffcf8a', this.night ? 30 : 18, 22, 1.6);
      this.fill.position.set(0, 2.2, 0);
      this.root.add(this.fill);
    }
    this.ground(o.seed ?? 7);
    this.water();
    this.props(o.seed ?? 7);
  }

  /** Colours for scene.background / fog, the sky uniforms (applied by the scene every set change). */
  apply(scene: THREE.Scene): void {
    const S = this.spec, m = this.mats.sky.uniforms;
    if (this.night) { m.uTop.value.set('#0e0c2a'); m.uMid.value.set('#2a2450'); m.uLow.value.set('#4a3a5a'); m.uStars.value = 1; }
    else { m.uTop.value.set(S.sky[0]); m.uMid.value.set(S.sky[1]); m.uLow.value.set(S.sky[2]); m.uStars.value = S.stars; }
    const fog = this.night ? '#2a2450' : S.fog;
    scene.background = new THREE.Color(fog);
    scene.fog = new THREE.Fog(fog, this.night ? 14 : S.fogNear, this.night ? 60 : S.fogFar);
    if (this.night) { this.hemi.intensity = 0.9; this.hemi.color.set('#8a9aff'); this.sun.intensity = 0.5; this.sun.color.set('#a8b0ff'); }
  }

  /** Ground height (m). Periodic in x; flat where the action is. */
  heightAt(x: number, z: number): number {
    const S = this.spec;
    let h = S.amp * (0.9 * Math.sin(K * x + 0.7) * Math.sin(z * 0.21 + 1.3) + 0.55 * Math.sin(2 * K * x + 2.1) * Math.cos(z * 0.37) + 0.3 * Math.sin(5 * K * x + z * 0.5));
    const az = Math.abs(z);
    let flat: number;
    if (this.mode === 'path') flat = smooth(3, 8, az);
    else { const r = Math.hypot(x, z * 1.15); flat = smooth(10, 18, r); }
    h *= flat;
    if (S.walls === 'gorge' || S.walls === 'cave') h += Math.max(0, az - (this.mode === 'path' ? 7 : 11)) * (S.walls === 'cave' ? 0.9 : 1.4);
    if (this.parallel && z < -6 && z > -15) h = Math.min(h, -0.7 * smooth(-6, -8, z) * smooth(-15, -13, z) + h * (1 - smooth(-6, -8, z) * smooth(-15, -13, z)));
    if (S.water === 'bridge' && this.mode === 'path') { const xm = mod(x - 14, P); const d = Math.min(xm, P - xm); h -= 1.6 * (1 - smooth(3, 5.5, d)); }
    return h;
  }
  /** Water surface at (x, z) or −Infinity. */
  waterAt(x: number, z: number): number {
    const S = this.spec;
    if (this.parallel && z < -7 && z > -14) return -0.25;
    if (S.water === 'bridge' && this.mode === 'path') { const xm = mod(x - 14, P); if (Math.min(xm, P - xm) < 3.5) return -0.6; }
    return -Infinity;
  }

  private ground(seed: number) {
    const S = this.spec, R = rng(seed);
    const nx = 80, nz = 40;
    const g = new THREE.PlaneGeometry(SPAN * 2, ZW * 2, nx, nz);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const c0 = new THREE.Color(S.ground[0]), c1 = new THREE.Color(S.ground[1]), cp = new THREE.Color(S.path), c = new THREE.Color();
    const sand = new THREE.Color('#c8b088');
    const hsl = { h: 0, s: 0, l: 0 };
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = this.heightAt(x, z);
      pos.setY(i, h);
      const n = 0.5 + 0.5 * Math.sin(x * 0.9 + Math.sin(z * 0.7) * 2) * Math.sin(z * 1.1 + x * 0.3);
      c.copy(c0).lerp(c1, n * 0.8 + R() * 0.2);
      let pathK = 0;
      if (this.mode === 'path') pathK = 1 - smooth(1.7, 2.6, Math.abs(z + Math.sin(x * K * 2) * 0.4));
      else pathK = (1 - smooth(6, 9.5, Math.hypot(x, z * 1.2))) * 0.55 + (1 - smooth(1.2, 2.2, Math.abs(z))) * (1 - smooth(10, 20, Math.abs(x))) * 0.0;
      if (S.walls === 'cave' || S.walls === 'gorge') pathK *= 0.7;
      c.lerp(cp, pathK);
      if (this.waterAt(x, z) > -Infinity || h < -0.3) c.lerp(sand, 0.6);
      if ((S.walls === 'gorge' || S.walls === 'cave') && h > 1.5) c.lerp(new THREE.Color(S.walls === 'cave' ? '#3a3448' : '#a8886a'), Math.min(1, (h - 1.5) / 3));
      c.getHSL(hsl); c.setHSL(hsl.h, Math.min(1, hsl.s * 1.2), hsl.l * 0.94);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.deleteAttribute('uv');
    const mesh = new THREE.Mesh(g, this.mats.tint);
    mesh.name = 'exp-ground';
    this.disposables.push(g);
    this.scrollRoot.add(mesh);
  }

  private water() {
    const S = this.spec;
    if (S.water === 'none') return;
    if (this.parallel || S.water === 'swamp') {
      const geo = S.water === 'swamp' ? new THREE.PlaneGeometry(SPAN * 2, ZW * 2) : new THREE.PlaneGeometry(SPAN * 2, 8.5);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, this.mats.water);
      m.position.set(0, S.water === 'swamp' ? -0.18 : -0.25, S.water === 'swamp' ? 0 : -10.5);
      m.name = 'exp-water';
      this.disposables.push(geo); this.scrollRoot.add(m); this.waterMesh = m;
      if (S.water === 'swamp') { this.mats.water.color.set('#5a8a6a'); }
    }
    if (S.water === 'falls') {
      const b = new GB();
      b.add(new THREE.DodecahedronGeometry(6, 0), '#8a8498', T(-4, 4, -19, 0.2, 0.3, 0, [2.6, 1.4, 0.8]));
      b.add(new THREE.DodecahedronGeometry(5, 0), '#7a7488', T(9, 3.5, -18, 0.4, 0.2, 0.1, [2.2, 1.3, 0.8]));
      b.add(new THREE.DodecahedronGeometry(3, 0), '#6aa85a', T(2, 9.6, -18, 0.1, 0.3, 0, [3, 0.4, 1.2]));
      const cliff = new THREE.Mesh(b.build(), this.mats.tint); this.disposables.push(cliff.geometry); this.root.add(cliff);
      const fg = new THREE.PlaneGeometry(4.2, 9.5, 1, 6);
      const fm = new THREE.MeshBasicMaterial({ color: '#d8f4ff', transparent: true, opacity: 0.8, toneMapped: false });
      this.fallMesh = new THREE.Mesh(fg, fm); this.fallMesh.position.set(2.5, 4.4, -14.6); this.fallMesh.name = 'exp-fall';
      this.disposables.push(fg, fm); this.root.add(this.fallMesh);
    }
    if (S.water === 'bridge') {
      const geo = new THREE.PlaneGeometry(7.5, this.mode === 'path' ? ZW * 2 : 0.01); geo.rotateX(-Math.PI / 2);
      const water = new THREE.InstancedMesh(geo, this.mats.water, 4);
      const b = new GB();
      for (let i = 0; i < 9; i++) b.add(new THREE.BoxGeometry(0.85, 0.12, 3.4), i % 2 ? '#9a7448' : '#8a6a40', T(-3.6 + i * 0.9, 0, 0, 0, 0, Math.sin(i * 1.7) * 0.03));
      for (const s of [-1, 1]) { b.add(new THREE.BoxGeometry(8.4, 0.12, 0.12), '#7a5436', T(0, 0.8, s * 1.65)); for (let i = 0; i < 6; i++) b.add(new THREE.BoxGeometry(0.14, 1.6, 0.14), '#6a4a30', T(-4 + i * 1.6, 0.2, s * 1.65)); }
      const bridge = new THREE.InstancedMesh(b.build(), this.mats.tint, 4);
      const m = new THREE.Matrix4();
      if (this.mode === 'path') for (let k = 0; k < 4; k++) {
        const x = 14 + (k - 2) * P;
        m.makeTranslation(x, -0.6, 0); water.setMatrixAt(k, m);
        m.makeTranslation(x, -0.02, 0); bridge.setMatrixAt(k, m);
      } else {
        // arena next to the river: the old bridge goes across it behind the party
        water.count = 0; bridge.count = 1;
        m.makeRotationY(Math.PI / 2).setPosition(0, 0.05, -10.5); bridge.setMatrixAt(0, m);
      }
      water.frustumCulled = false; bridge.frustumCulled = false;
      this.disposables.push(geo, bridge.geometry, water, bridge);
      this.scrollRoot.add(water, bridge);
    }
  }

  private props(seed: number) {
    const S = this.spec, R = rng(seed * 31 + 5);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const [kind, pal, count0] of S.props) {
      const big = kind === 'mound' || kind === 'cliff';
      const count = Math.round(count0 * (kind === 'grass' ? 0.65 : kind === 'flower' ? 0.6 : 1));
      const pts: number[] = [];
      let tries = 0;
      while (pts.length / 3 < count && tries++ < count * 30) {
        const x = R() * P - P / 2, z = (R() * 2 - 1) * (ZW - 2);
        const az = Math.abs(z);
        const minZ = kind === 'grass' || kind === 'flower' ? 2.6 : big ? 9 : 5;
        if (this.mode === 'path' && az < minZ) continue;
        if (this.mode === 'clearing' && Math.hypot(x, z * 1.15) < (kind === 'grass' || kind === 'flower' ? 8 : big ? 17 : 13)) continue;
        const small = kind === 'grass' || kind === 'flower' || kind === 'lily';
        if (!small && z > 2.5 && z < 16 && Math.abs(x) < (this.mode === 'path' ? P : 16)) continue;   // camera side stays clear
        if (S.walls === 'gorge' && kind === 'cliff' && az < 9) continue;
        if (S.walls === 'cave' && (kind === 'stalag' || kind === 'support') && az < 6) continue;
        const wa = this.waterAt(x, z);
        if (wa > -Infinity && kind !== 'reed' && kind !== 'lily') continue;
        if (kind === 'lily' && wa === -Infinity) continue;
        if (kind === 'reed' && this.spec.water !== 'swamp' && !(z < -5.5 && z > -8) && !(z < -13 && z > -16) && wa === -Infinity) continue;
        if (kind === 'support' && this.mode === 'path') { pts.push(x, 0, R()); continue; }
        pts.push(x, z, R());
      }
      const n = pts.length / 3;
      if (!n) continue;
      const geo = propGeo(kind, pal);
      const inst = new THREE.InstancedMesh(geo, this.mats.tint, n * 3);
      let k = 0;
      for (let i = 0; i < n; i++) {
        const x = pts[i * 3], z = pts[i * 3 + 1], r = pts[i * 3 + 2];
        const sc = (kind === 'grass' || kind === 'flower' ? 0.8 + r * 0.6 : 0.75 + r * 0.6) * (big ? 1 + r * 0.5 : 1);
        q.setFromAxisAngle(up, kind === 'support' ? 0 : r * 6.283);
        s.set(sc, sc * (kind === 'tree' || kind === 'pine' || kind === 'snowpine' ? 0.85 + r * 0.5 : 1), sc);
        for (const dx of [-P, 0, P]) {
          const xx = x + dx;
          if (xx < -SPAN || xx > SPAN) continue;
          const y = kind === 'lily' ? this.waterAt(xx, z) + 0.03 : kind === 'support' && this.mode === 'path' ? 0 : this.heightAt(xx, z) - (kind === 'stone' || kind === 'rock' || kind === 'pillar' ? 0.18 : kind === 'cliff' ? 0.6 : 0.04);
          p.set(xx, y, z); m.compose(p, q, s); inst.setMatrixAt(k++, m);
        }
      }
      inst.count = k;
      inst.frustumCulled = false;
      inst.name = 'exp-prop-' + kind;
      this.disposables.push(inst);
      this.scrollRoot.add(inst);
    }
  }

  /** Travel: shift the endless terrain (offset in metres walked). */
  scroll(offset: number): void { this.scrollRoot.position.x = -mod(offset, P); }

  update(t: number): void {
    if (this.fill) this.fill.intensity = (this.night ? 30 : 18) * (0.9 + 0.1 * Math.sin(t * 9) * Math.sin(t * 5.3));
    if (this.fallMesh) { const mt = this.fallMesh.material as THREE.MeshBasicMaterial; mt.opacity = 0.72 + 0.08 * Math.sin(t * 6); }
    if (this.waterMesh) this.waterMesh.position.y = (this.spec.water === 'swamp' ? -0.18 : -0.25) + Math.sin(t * 1.2) * 0.02;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.root.removeFromParent();
  }
}

const mod = (a: number, b: number) => ((a % b) + b) % b;
function smooth(a: number, b: number, x: number): number { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
