/**
 * Cat-shaped constellations for the night sky (idea #5). Pure data + maths (no three.js): four hand-drawn cat figures
 * (head, paw, curly tail, fish) are placed on the sky dome with a STABLE seed (layout id + style), rotated and jittered
 * a little, and turned into one triangle soup — star quads and line ribbons — that sky.ts uploads as a single mesh.
 * Nothing here depends on the date or on Math.random, so the same city always shows the same sky.
 */
import { hashSeed, mulberry, smoothstep } from './rand';

export interface FigureStar { x: number; y: number; m: number }   // x,y in figure units (≈ −1…1), m = brightness 0…1
export interface Figure { id: string; name: string; stars: FigureStar[]; edges: [number, number][] }

const S = (x: number, y: number, m = 0.6): FigureStar => ({ x, y, m });

export const FIGURES: Figure[] = [
  {
    // a cat's head: two ears, cheeks, chin, two bright eyes and a nose
    id: 'head', name: 'Созвездие Мурлыки',
    stars: [S(-0.78, 1.0, 0.8), S(-0.92, 0.1, 0.55), S(-0.5, -0.72, 0.6), S(0.5, -0.72, 0.6), S(0.92, 0.1, 0.55), S(0.78, 1.0, 0.8), S(0, 0.38, 0.5),
      S(-0.36, 0.02, 1), S(0.36, 0.02, 1), S(0, -0.28, 0.7)],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 0], [7, 9], [8, 9]],
  },
  {
    // a paw: a pad and four toes
    id: 'paw', name: 'Созвездие Мягкой Лапки',
    stars: [S(-0.5, -0.18, 0.6), S(0.5, -0.18, 0.6), S(0.62, -0.78, 0.7), S(0, -1.02, 0.9), S(-0.62, -0.78, 0.7),
      S(-0.96, 0.22, 0.8), S(-0.36, 0.78, 0.9), S(0.36, 0.78, 0.9), S(0.96, 0.22, 0.8)],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [0, 5], [0, 6], [1, 7], [1, 8]],
  },
  {
    // a long fluffy tail curling like a question mark
    id: 'tail', name: 'Созвездие Пушистого Хвоста',
    stars: [S(-1.0, -0.82, 0.7), S(-0.62, -0.42, 0.55), S(-0.4, 0.2, 0.6), S(0.0, 0.58, 0.9), S(0.42, 0.4, 0.6), S(0.62, -0.06, 0.6), S(0.98, 0.16, 0.7), S(1.04, 0.72, 1)],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7]],
  },
  {
    // the cat's night fish
    id: 'fish', name: 'Созвездие Ночной Рыбки',
    stars: [S(-1.0, 0, 0.9), S(-0.5, 0.46, 0.55), S(0.2, 0.5, 0.6), S(0.72, 0.1, 0.55), S(0.2, -0.46, 0.6), S(-0.5, -0.42, 0.55),
      S(1.12, 0.5, 0.8), S(1.12, -0.5, 0.8), S(-0.62, 0.1, 1)],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [3, 6], [3, 7], [6, 7]],
  },
];

export interface Placed {
  figure: Figure;
  /** Direction of the figure centre: azimuth (rad, around +Y), elevation (rad above the horizon). */
  az: number; el: number;
  /** Roll of the figure around its view axis (rad) and angular scale (rad per figure unit). */
  roll: number; size: number;
  /** Star positions (unit sphere, three numbers each, flat) after jitter. */
  dirs: number[];
}

/** Stable seed for a city: its layout id and style (same city → same sky, on every visit and every day). */
export const skySeed = (layoutId: string, styleId: string): number => hashSeed(`sky:${layoutId}:${styleId}`);

/** Unit direction for azimuth/elevation. */
export function dirOf(az: number, el: number, out: number[] = [0, 0, 0]): number[] {
  const c = Math.cos(el);
  out[0] = Math.cos(az) * c; out[1] = Math.sin(el); out[2] = Math.sin(az) * c;
  return out;
}

/** Place the four figures around the compass: one per quadrant (jittered), elevation 32°…54° (reachable in third person too, pitch ≤ 55°) so they sit where you look up. */
export function placeConstellations(seed: number, figures: Figure[] = FIGURES): Placed[] {
  const r = mulberry(seed);
  const az0 = r() * Math.PI * 2;
  const order = figures.map((_, i) => i).sort(() => r() - 0.5);
  const out: Placed[] = [];
  figures.forEach((figure, k) => {
    const slot = order[k];
    const az = az0 + (slot + 0.5) * (Math.PI * 2 / figures.length) + (r() - 0.5) * 0.35;
    const el = (32 + r() * 22) * Math.PI / 180;
    const roll = (r() - 0.5) * 0.5;
    const size = (0.25 + r() * 0.04);
    // local tangent frame: right (towards increasing azimuth) and up (towards the zenith)
    const rx = -Math.sin(az), rz = Math.cos(az);
    const c = dirOf(az, el);
    const ux = -Math.cos(az) * Math.sin(el), uy = Math.cos(el), uz = -Math.sin(az) * Math.sin(el);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const dirs: number[] = [];
    for (const st of figure.stars) {
      const jx = (r() - 0.5) * 0.08, jy = (r() - 0.5) * 0.08;
      const lx = (st.x + jx) * cr - (st.y + jy) * sr, ly = (st.x + jx) * sr + (st.y + jy) * cr;
      let x = c[0] + (rx * lx + ux * ly) * size, y = c[1] + (uy * ly) * size, z = c[2] + (rz * lx + uz * ly) * size;
      const n = Math.hypot(x, y, z); x /= n; y /= n; z /= n;
      dirs.push(x, y, z);
    }
    out.push({ figure, az, el, roll, size, dirs });
  });
  return out.sort((a, b) => figures.indexOf(a.figure) - figures.indexOf(b.figure));
}

export interface SkyBuffers { position: Float32Array; uv: Float32Array; kind: Float32Array; con: Float32Array; index: Uint16Array; centers: Float32Array }

/**
 * One triangle soup for everything: a quad per star (kind 1) and a ribbon per edge (kind 0). Quads lie tangent to the
 * sphere of radius `R`; uv in −1…1 (the shader draws a soft dot / a soft line). `lineW`/`starR` are in metres at R.
 */
export function buildSkyBuffers(placed: Placed[], R = 268, lineW = 2.2, starR = 3.0): SkyBuffers {
  let quads = 0;
  for (const p of placed) quads += p.figure.stars.length + p.figure.edges.length;
  const position = new Float32Array(quads * 12), uv = new Float32Array(quads * 8), kind = new Float32Array(quads * 4), con = new Float32Array(quads * 4);
  const index = new Uint16Array(quads * 6), centers = new Float32Array(placed.length * 3);
  let q = 0;
  const put = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number,
    k: number, ci: number, uvs: number[]) => {
    const o = q * 12;
    position.set([ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz], o);
    uv.set(uvs, q * 8);
    for (let i = 0; i < 4; i++) { kind[q * 4 + i] = k; con[q * 4 + i] = ci; }
    index.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
    q++;
  };
  placed.forEach((p, ci) => {
    const d = p.dirs, n = p.figure.stars.length;
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < n; i++) { sx += d[i * 3]; sy += d[i * 3 + 1]; sz += d[i * 3 + 2]; }
    const m = Math.hypot(sx, sy, sz) || 1; centers[ci * 3] = sx / m; centers[ci * 3 + 1] = sy / m; centers[ci * 3 + 2] = sz / m;
    // star quads: right = normalize(up × dir), up' = dir × right
    for (let i = 0; i < n; i++) {
      const x = d[i * 3], y = d[i * 3 + 1], z = d[i * 3 + 2];
      let rx = z, rz = -x; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;      // (0,1,0) × dir
      const ux = y * rz, uy = z * rx - x * rz, uz = -y * rx;                              // dir × right
      const s = starR * (0.55 + p.figure.stars[i].m * 0.75);
      const px = x * R, py = y * R, pz = z * R;
      put(px - rx * s - ux * s, py - uy * s, pz - rz * s - uz * s, px + rx * s - ux * s, py - uy * s, pz + rz * s - uz * s,
        px + rx * s + ux * s, py + uy * s, pz + rz * s + uz * s, px - rx * s + ux * s, py + uy * s, pz - rz * s + uz * s, 1, ci, [-1, -1, 1, -1, 1, 1, -1, 1]);
    }
    // line ribbons between the stars, trimmed so they start/end beside the star discs
    for (const [a, b] of p.figure.edges) {
      const ax = d[a * 3] * R, ay = d[a * 3 + 1] * R, az = d[a * 3 + 2] * R, bx = d[b * 3] * R, by = d[b * 3 + 1] * R, bz = d[b * 3 + 2] * R;
      const tx = bx - ax, ty = by - ay, tz = bz - az, tl = Math.hypot(tx, ty, tz) || 1;
      const trim = Math.min(starR * 1.6, tl * 0.3) / tl;
      const x0 = ax + tx * trim, y0 = ay + ty * trim, z0 = az + tz * trim, x1 = bx - tx * trim, y1 = by - ty * trim, z1 = bz - tz * trim;
      const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
      // side = normalize(mid × t): tangent to the sphere, perpendicular to the segment
      let sx2 = my * tz - mz * ty, sy2 = mz * tx - mx * tz, sz2 = mx * ty - my * tx;
      const sl = Math.hypot(sx2, sy2, sz2) || 1; const w = lineW / 2 / sl; sx2 *= w; sy2 *= w; sz2 *= w;
      put(x0 - sx2, y0 - sy2, z0 - sz2, x1 - sx2, y1 - sy2, z1 - sz2, x1 + sx2, y1 + sy2, z1 + sz2, x0 + sx2, y0 + sy2, z0 + sz2, 0, ci, [0, -1, 1, -1, 1, 1, 0, 1]);
    }
  });
  return { position, uv, kind, con, index, centers };
}

/** Angle (rad) between two unit vectors given as raw components. */
export const angleBetween = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): number =>
  Math.acos(Math.min(1, Math.max(-1, ax * bx + ay * by + az * bz)));

export const GAZE_ANGLE = 13 * Math.PI / 180;   // looking within 13° of a figure's centre counts as looking at it
export const DWELL_IN = 0.55;                    // seconds of looking before a figure starts to brighten
export const DWELL_FULL = 1.5;

/** Advance one figure's dwell timer: grows while looked at, drains (a bit slower) otherwise. Returns [dwell, reveal 0…1]. */
export function gazeStep(dwell: number, angle: number, dt: number): [number, number] {
  const looking = angle < GAZE_ANGLE;
  const next = Math.min(DWELL_FULL + 0.5, Math.max(0, dwell + (looking ? dt : -dt * 0.7)));
  return [next, smoothstep(DWELL_IN, DWELL_FULL, next)];
}
