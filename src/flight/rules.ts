/**
 * «Летать за мага» — the flight logic without three.js (unit-tested): who may fly, and the small state machine that
 * turns Space / X presses into a flight height for PlayerControllerEx.setFlight(h).
 *
 *  - off  → fly: double-tap Space (the second tap while in the air), or keep Space held in the air past the apex;
 *  - fly:  Space held = up, X held = down, nothing = hover (the height is relative to what is under the hero, so the
 *          flight follows the ground); X all the way down = a soft landing; double-tap Space = land;
 *  - land: the height glides to 0, then flight ends (setFlight(null): the controller drops the last centimetres and
 *          fires onLand as usual).
 * Free 3D flight (owner feedback 2026-10-27): with the city's fly map the controller moves in 3D — over the canal,
 * fences and the walk-grid gaps, bumping into walls only below their tops, landing on roofs (src/engine/player.ts,
 * src/flight/heightfield.ts). The site only ever gets walkable go() points (src/flight/sendpoint.ts).
 * Down = X or Ctrl. Over water a landing is refused: the hover keeps `floor` metres (FlightInput.floor).
 */
import type { Appearance } from '../contracts';

export const FLY = {
  /** Max height above the support (m): street / 3D rooms (ceilings). */
  maxStreet: 8, maxRoom: 1,
  /** Height change speeds (m/s) while Space / X are held; the landing glide. */
  rise: 3.2, sink: 3.6, land: 3.2,
  /** Double-tap window (s); Space held this long after a jump starts a flight. */
  tapGap: 0.34, holdStart: 0.3,
  /** Height the flight starts at at least (m above the support). */
  startLift: 1.3,
  /** Below this height (m) a landing is complete. */
  landEps: 0.06,
};

/** Site roles and weapons of the magic families that fly: mage / necromancer / priest, staffs, crooks and tomes. */
export const FLY_ROLES = new Set(['mage', 'necromancer', 'priest']);
export const FLY_WEAPONS = new Set(['staff', 'skullstaff', 'grimoire', 'crook', 'censer']);

/** May this hero fly (role first, the held weapon as a fallback for unknown roles)? */
export function canFly(app: Pick<Appearance, 'role' | 'gear'> | null | undefined): boolean {
  if (!app) return false;
  if (app.role && FLY_ROLES.has(String(app.role))) return true;
  const w = app.gear?.w;
  return !!w && FLY_WEAPONS.has(String(w));
}

export type FlightPhase = 'off' | 'fly' | 'land';

/** What the flight sees each frame. */
export interface FlightInput {
  /** Space held / X held (already gated: gameplay, not typing). */
  up: boolean; down: boolean;
  /** The controller is in the air (jump, fall or flight) and how high the feet are above the support (m). */
  airborne: boolean; above: number;
  /** Flying is allowed now (mage, setting on, no menu / modal / photo, a room that allows it). */
  allowed: boolean;
  /** Max height here (FLY.maxStreet or FLY.maxRoom). */
  max: number;
  /** Lowest hover height here (m): > 0 where you may not land (water); 0 / undefined = landing allowed. */
  floor?: number;
}

export class FlightLogic {
  phase: FlightPhase = 'off';
  /** Target height above the support (m). */
  h = 0;
  private now = 0;
  private lastTap = -Infinity;
  private holdT = 0;

  /**
   * A Space press (keydown, not a repeat). Returns 'start' when it started a flight, 'land' when it asked to land,
   * 'deny' for a double-tap in the air by someone who may not fly (the caller shows «летают маги»), else null.
   */
  tap(airborne: boolean, allowed: boolean, above: number, max: number): 'start' | 'land' | 'deny' | null {
    const dbl = this.now - this.lastTap <= FLY.tapGap;
    this.lastTap = dbl ? -Infinity : this.now;
    if (!dbl) return null;
    if (this.phase === 'fly') { this.phase = 'land'; return 'land'; }
    if (this.phase === 'land') { if (!allowed) return null; this.phase = 'fly'; return 'start'; }
    if (!airborne) return null;
    if (!allowed) return 'deny';
    this.start(above, max);
    return 'start';
  }

  private start(above: number, max: number) {
    this.phase = 'fly';
    this.h = Math.min(max, Math.max(FLY.startLift, above + 0.6));
    this.holdT = 0;
  }

  /** One frame. Returns the flight height for setFlight (null = not flying). */
  update(dt: number, i: FlightInput): number | null {
    this.now += dt;
    if (this.phase === 'off') {
      // keep Space held through the jump → take off
      if (i.up && i.airborne) this.holdT += dt; else this.holdT = 0;
      if (this.holdT >= FLY.holdStart && i.allowed) { this.start(i.above, i.max); this.lastTap = -Infinity; }
      else return null;
    }
    if (!i.allowed && this.phase === 'fly') this.phase = 'land';
    const floor = Math.min(i.floor ?? 0, i.max);
    if (this.phase === 'fly') {
      if (i.up && !i.down && this.h < i.max) this.h = Math.min(i.max, this.h + FLY.rise * dt);
      else if (i.down && !i.up) this.h -= FLY.sink * dt;
      if (this.h > i.max) this.h = Math.max(i.max, this.h - FLY.land * dt);   // a lower ceiling (room): glide down to it
      if (this.h < floor) this.h = floor;
      if (this.h < 0) this.h = 0;
      if (floor <= 0 && i.down && this.h <= 0 && i.above <= FLY.landEps * 3) return this.end();
      return this.h;
    }
    // landing glide (over water: keep hovering at the floor until the hero is over something to land on)
    this.h = Math.max(floor, Math.min(this.h, i.above + 0.2) - FLY.land * dt);
    if (floor <= 0 && this.h <= 0 && i.above <= FLY.landEps) return this.end();
    return this.h;
  }

  private end(): null { this.phase = 'off'; this.h = 0; this.holdT = 0; return null; }

  /** Flight ended from outside (room change, teleport, the feature switched off). */
  reset() { this.end(); this.lastTap = -Infinity; }
}
