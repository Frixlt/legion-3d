/**
 * Paper boats on the canal (idea #6): the drift path from the world's canal/bridge data and the pose of each boat at time t.
 * Pure maths (metres, no three.js). The canal is ~1.9 m wide and every bridge has a pier in its middle, so boats keep to two
 * lanes beside the pier line and never touch anything; they pass under the humped bridge decks (≥ 0.4 m of water clearance).
 */
import { toX, toZ } from '../world/coords';
import { CANAL_WATER, LOW_H } from '../world/ground';
import type { CityLayout } from '../contracts';

export interface BoatLane { z: number; dir: 1 | -1 }
export interface BoatPath {
  x0: number; x1: number;           // drift range along the canal (m)
  y: number;                        // water surface (m)
  lanes: BoatLane[];
  bridgesX: number[];               // bridge centres (m)
  span: number;
}
export interface BoatState { x: number; y: number; z: number; yaw: number; roll: number; pitch: number; scale: number }

/** The canal path from the layout, or null when the city has no canal (district towns). */
export function boatPath(L: Pick<CityLayout, 'low' | 'area'>): BoatPath | null {
  const low = L.low;
  if (!low?.canal) return null;
  const c0 = toZ(low.canal[0]), c1 = toZ(low.canal[1]), mid = (c0 + c1) / 2, w = c1 - c0;
  if (!(w > 0.8)) return null;
  const off = Math.max(0.3, Math.min(0.6, w / 2 - 0.3));   // lane distance from the middle line: clear of the 0.5 m pier and the coping
  const x0 = toX(L.area.x0) + 0.8, x1 = toX(L.area.x1) - 0.8;
  return {
    x0, x1, y: LOW_H + CANAL_WATER,
    lanes: [{ z: mid - off, dir: 1 }, { z: mid + off, dir: 1 }],
    bridgesX: (low.bridges || []).map((b) => (toX(b[0]) + toX(b[1])) / 2),
    span: x1 - x0,
  };
}

export interface BoatSpec { lane: number; speed: number; phase: number; hue: number }

/** 2–3 boats; each starts a few metres before a bridge so one is under or near a bridge when you arrive. */
export function boatSpecs(p: BoatPath, count = 3): BoatSpec[] {
  const out: BoatSpec[] = [];
  const hues = [0, 1, 2];
  for (let i = 0; i < count; i++) {
    const bx = p.bridgesX.length ? p.bridgesX[i % p.bridgesX.length] : p.x0 + p.span * (i + 0.5) / count;
    out.push({ lane: i % p.lanes.length, speed: 0.32 + 0.06 * (i % 2) + 0.03 * i, phase: ((bx - p.x0 - 2.5 - i * 0.7) / p.span + 1) % 1, hue: hues[i % hues.length] });
  }
  return out;
}

const EDGE = 1.6;   // boats grow/shrink over this distance at the ends of the canal (no pop)

/** Pose of a boat at time t (seconds). Allocation-free: writes into `out`. */
export function boatState(p: BoatPath, s: BoatSpec, t: number, out: BoatState): BoatState {
  const lane = p.lanes[s.lane % p.lanes.length];
  const u = (((s.phase + t * s.speed / p.span) % 1) + 1) % 1;
  const along = u * p.span;
  const x = lane.dir > 0 ? p.x0 + along : p.x1 - along;
  const ph = s.phase * 40 + s.hue * 1.7;
  const meander = Math.sin(t * 0.37 + ph) * 0.045;
  out.x = x; out.z = lane.z + meander;
  out.y = p.y + 0.012 + Math.sin(t * 1.6 + ph) * 0.011;
  out.yaw = (lane.dir > 0 ? 0 : Math.PI) + Math.cos(t * 0.37 + ph) * 0.045 * 0.37 * 2.2;
  out.roll = Math.sin(t * 1.25 + ph * 1.3) * 0.07;
  out.pitch = Math.sin(t * 0.9 + ph) * 0.035;
  const e = Math.min(along, p.span - along);
  const k = Math.min(1, Math.max(0, e / EDGE));
  out.scale = k * k * (3 - 2 * k);
  return out;
}
