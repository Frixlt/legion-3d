/**
 * Static city content into a Ctx (Batch + Instancer + glow/light lists): terrain, backdrop, every building, the filler
 * facades between upper buildings and the props. No materials/renderer/DOM needed (tests build the city with a fake
 * sign atlas and run the z-fight detector on the Batch).
 */
import type { CityLayout } from '../contracts';
import { toX } from './coords';
import { archWallGeo, M } from './batch';
import type { GroundSpec } from './ground';
import { type Ctx, box, shade } from './kit';
import { buildBuilding, house, isUpper } from './buildings';
import { buildTerrain, buildBackdrop } from './terrain';
import { placeProps, type Placed } from './place';

export function buildStatic(k: Ctx, L: CityLayout, spec: GroundSpec, groundAt: (x: number, y: number) => number, lampHead: number): Placed {
  const P = k.pal;
  k.b.tag = 'terrain';
  buildTerrain(k, L, spec);
  k.b.tag = 'backdrop';
  buildBackdrop(k, L, toX(L.W) / 2, 6);

  const upper = L.buildings.filter(isUpper).sort((a, b) => a.hit[0] - b.hit[0]);
  for (const b of L.buildings) { k.b.tag = b.id; buildBuilding(k, b); }
  // fillers between upper buildings → a continuous street facade
  let x = 0;
  const W = L.W;
  const fill = (a: number, b: number) => {
    k.b.tag = 'filler@' + Math.round(a);
    if (b - a < 170) {   // narrow gap → a connecting brick wall with an arched passage (no tiny houses)
      const X0 = toX(a), X1 = toX(b), xc = (X0 + X1) / 2, ow = Math.min(0.9, (X1 - X0) * 0.6);
      if (X1 - X0 < 0.3) return;
      const g = archWallGeo(X1 - X0, 2.6, ow, 1.9);
      k.b.add('brick', g, M(xc, 0, -0.9, 1, 1, 0.4), P.brick, 1.2); g.dispose();
      box(k, 'stone', shade(P.stone, 0.15), X0 - 0.05, X1 + 0.05, 2.6, 2.75, -1.17, -0.627, 0.6);
      box(k, 'flat', '#1b1426', xc - ow / 2, xc + ow / 2, 0, 1.9, -1.4, -1.35);
      k.colliders.push(X0, X1, 0, 2.7, -1.1, -0.7);
      (k.solids ||= []).push(X0, X1, -6, -0.62, Infinity);
      return;
    }
    let p = a;
    while (b - p > 45) {
      const w = Math.min(b - p, 160 + k.rnd() * 140);
      const rem = b - p - w;
      const ww = rem < 70 ? b - p : w;
      const X0 = toX(p) + 0.05, X1 = toX(p + ww) - 0.05;
      const r = k.rnd();
      k.colliders.push(X0, X1, 0, 3, -5, -0.3);
      (k.solids ||= []).push(X0, X1, -6, -0.28, Infinity);
      house(k, X0, X1, -0.3 - k.rnd() * 0.4, 4.5, 2.9 + k.rnd() * 1.6, {
        wall: r < 0.45 ? 'brick' : r < 0.8 ? 'plaster' : 'wood', timber: r >= 0.45 && r < 0.8 && k.rnd() < 0.6,
        roofCol: k.rnd() < 0.6 ? P.roof : P.roof2, chimney: k.rnd() < 0.5, lit: 0.55, shutters: k.rnd() < 0.5 ? P.sign : undefined,
        door: X1 - X0 > 1.4,
      });
      p += ww;
    }
  };
  for (const b of upper) { if (b.hit[0] > x) fill(x, b.hit[0]); x = Math.max(x, b.hit[1]); }
  if (x < W) fill(x, W);
  k.b.tag = 'props';
  const placed = placeProps(k, L, spec, groundAt, lampHead);
  k.b.tag = '';
  return placed;
}
