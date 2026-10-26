/**
 * Local player movement with collision and real jumping, generic over a walk "space".
 *
 * A space is `{ free(x,y), groundAt(x,y), solidTop?(x,y), path? }`:
 *  - 'px' units = the 2D city (x px, depth y px; SX = 0.01 m/px along x, SZ = 0.02 m/px along depth, Y0 offset);
 *  - 'm'  units = a room (RoomScene: x, z in room-local metres).
 * The city layout + world.groundAt form a px space (createPlayerController(layout, groundAt) keeps working);
 * the room manager switches spaces with setSpace(room, 'm') and back with setSpace(citySpace, 'px').
 *
 * Speed is uniform in 3D: the input direction is built in metres (camera-relative), integrated in m/s, then converted
 * to space units. `speed` is always reported in "site x px/s" (= m/s ÷ SX) in every space, so 230 ⇔ the site's walk
 * speed (main uses speed/230 as speed01) — also inside rooms.
 *
 * Vertical: the feet height `feetY` (m) is real state. Space jumps (apex ~1 m, gravity 14 m/s², coyote 0.1 s,
 * buffer 0.12 s, 40 % air control). Passability of a point for feet at height fy (STEP = 0.25 m):
 *  - solidTop = +Infinity (wall, building, lamp, water, ledge face)             → blocked
 *  - solidTop finite (bench, fence, crate, counter) → passable iff top ≤ fy + STEP; you stand on max(top, ground)
 *    — this overrides free() = false (the site's walk grid blocks benches and planters too);
 *  - free() and nothing solid → passable iff ground ≤ fy + STEP (stairs/ramps/curbs; climbing a ledge is impossible);
 *  - free() = false and nothing solid (solidTop = -Infinity: a gap in the walk grid, e.g. the band above the
 *    retaining wall) → passable only while the feet are above its ground by more than STEP (jumping across it, or
 *    walking off an edge into a drop), for at most VOID_RUN metres in a row (no jumping out of the map).
 * Without space.solidTop the old behaviour holds exactly: free() = false is a wall.
 */
import type { CityLayout, Unsub } from '../contracts';
import type { Input, PlayerController } from '../contracts/modules';
import { SX, SZ, Y0 } from '../world/coords';
import { damp, dampAngle, wrapAngle } from './math';

/** A walkable area in its own units (see header). */
export interface WalkSpace {
  free(x: number, y: number): boolean;
  groundAt(x: number, y: number): number;
  /** -Infinity = nothing solid, finite = top height (m) of something you can stand on / jump over, Infinity = wall. */
  solidTop?(x: number, y: number): number;
  /** A* path in the same units, first point = a. Optional. */
  path?(a: [number, number], b: [number, number]): [number, number][];
}
export type SpaceUnits = 'px' | 'm';

export interface PlayerOptions {
  /** m/s; default 2.3 (= the site's SPEED 230 px/s along x). */
  walk?: number;
  /** run multiplier; default 2 (≈ 4.6 m/s). */
  runMult?: number;
  /** acceleration / deceleration rates (1/s) of the exponential velocity approach. */
  accel?: number;
  decel?: number;
  /** body radius (m) for the 5-point probe. */
  radius?: number;
  /** facing turn rate (1/s). */
  turn?: number;
  /** gravity (m/s²), default 14. */
  gravity?: number;
  /** jump apex height (m), default 1.0. */
  jumpHeight?: number;
  /** coyote time (s) after walking off an edge during which a jump still works; default 0.1. */
  coyote?: number;
  /** jump buffer (s): a press this long before landing still jumps on landing; default 0.12. */
  buffer?: number;
  /** fraction of ground acceleration available in the air; default 0.4. */
  airControl?: number;
  /** max step-up while walking (m), default 0.25. */
  step?: number;
  /** World solid tops for the initial city space (World3DExt.solidTop). */
  solidTop?: (x: number, y: number) => number;
}

/** Movement input; `jump` (held) and/or `consumeJump()` (pressed since last call) are optional. */
export type PlayerInput = Pick<Input, 'move' | 'run'> & { jump?: boolean; consumeJump?(): boolean };

export interface PlayerControllerEx extends PlayerController {
  /** Height (m) of what the player stands on (or would land on) at the current position. */
  readonly ground: number;
  /** Feet height (m): the real vertical position — use it for the avatar and the camera. */
  readonly feetY: number;
  /** Vertical velocity (m/s, + up). */
  readonly vy: number;
  /** True while in the air (jumping or falling). */
  readonly airborne: boolean;
  /** Velocity in m/s on the 3D ground plane (X right, Z towards the viewer). */
  readonly vx: number; readonly vz: number;
  /** True while auto-walking (walkTo). */
  readonly walking: boolean;
  /** Current space and its units. */
  readonly space: WalkSpace;
  readonly units: SpaceUnits;
  /** Cancel auto-walk and stop. */
  stop(): void;
  /** Write the 3D feet position (m) into out: (X, feetY, Z) of the current space. */
  feet<T extends { x: number; y: number; z: number }>(out: T): T;
  /** Set the facing directly (e.g. FP: face = camera yaw; after leaving a room). */
  setFace(f: number): void;
  /** Integrate input for dt using camera yaw (Input, or any {move, run, jump?, consumeJump?}). Returns true if moved. */
  update(dt: number, input: PlayerInput, yaw: number): boolean;
  /** Request a jump (same as a Space press: buffered, coyote time applies). */
  jump(): void;
  /**
   * Switch to another walk space (city ⇄ room). Cancels auto-walk, zeroes velocity. Pass `at` to teleport in the
   * same call (coordinates in the new units); otherwise call teleport() right after.
   */
  setSpace(space: WalkSpace, units: SpaceUnits, at?: { x: number; y: number; face?: number }): void;
  /** Called when a jump starts (vy = take-off speed). */
  onJump(fn: (vy: number) => void): Unsub;
  /** Called on touching down: impact speed (m/s, ≥ 0) and fall height from the apex (m). */
  onLand(fn: (impact: number, fall: number) => void): Unsub;
}

const WAYPOINT_EPS = 0.12;   // m
const SUBSTEP_M = 0.06;      // m per collision sub-step (grid cells are 16 px = 0.16 m × 0.32 m)
const VOID_RUN = 2.5;        // m: max distance from the last walkable point while over walk-grid gaps (nothing solid)
const SLOPE_SNAP = 1.2;      // m of drop per m moved still followed as "walking down" (stairs) instead of falling
const AIR_STEP = 0.1;        // m: step-up margin while airborne (catch a top edge, no visible pop)

export function createPlayerController(
  layout: CityLayout | WalkSpace,
  groundAt?: (x: number, y: number) => number,
  opts: PlayerOptions = {},
): PlayerControllerEx {
  const WALK = opts.walk ?? 2.3;
  const RUN = WALK * (opts.runMult ?? 2);
  const ACC = opts.accel ?? 10;
  const DEC = opts.decel ?? 14;
  const R = opts.radius ?? 0.08;
  const TURN = opts.turn ?? 12;
  const G = opts.gravity ?? 14;
  const V0 = Math.sqrt(2 * G * (opts.jumpHeight ?? 1.0));
  const COYOTE = opts.coyote ?? 0.1;
  const BUFFER = opts.buffer ?? 0.12;
  const AIR = opts.airControl ?? 0.4;
  const STEP = opts.step ?? 0.25;

  // ---- space
  let space!: WalkSpace;
  let units: SpaceUnits = 'px';
  let kx = SX, kz = SZ, z0 = Y0;   // metres per unit, depth origin
  let rx = 0, ry = 0;              // probe radius in units
  let hasTop = false;
  let fFree!: (x: number, y: number) => boolean;
  let fGround!: (x: number, y: number) => number;
  let fTop: (x: number, y: number) => number = () => -Infinity;
  function useSpace(s: WalkSpace, u: SpaceUnits): void {
    space = s; units = u;
    if (u === 'px') { kx = SX; kz = SZ; z0 = Y0; } else { kx = 1; kz = 1; z0 = 0; }
    rx = R / kx; ry = R / kz;
    fFree = (x, y) => s.free(x, y);
    fGround = (x, y) => { const g = s.groundAt(x, y); return Number.isFinite(g) ? g : 0; };
    hasTop = typeof s.solidTop === 'function';
    if (hasTop) fTop = (x, y) => { const t = s.solidTop!(x, y); return t === t ? t : -Infinity; };
    else fTop = () => -Infinity;
  }
  {
    const L = layout as CityLayout & WalkSpace;
    const gfn = groundAt ?? (typeof L.groundAt === 'function' ? L.groundAt.bind(L) : () => 0);
    const top = opts.solidTop ?? (groundAt ? undefined : L.solidTop?.bind(L));
    useSpace({
      free: (x, y) => L.free(x, y),
      groundAt: gfn,
      solidTop: top,
      path: L.path ? (a, b) => L.path!(a, b) : undefined,
    }, 'px');
  }

  // ---- state
  let x = 0, y = 0;
  let vx = 0, vz = 0;                // m/s
  let speed = 0;                     // x-px/s
  let face = 0;
  let ground = 0;                    // support height under the body (m)
  let fy = 0;                        // feet height (m)
  let vy = 0;
  let air = false;
  let jumped = false;                // airborne because of a jump (no coyote)
  let sinceGround = 0;               // s since last grounded
  let bufferT = 0;                   // s left of a buffered jump press
  let apex = 0;                      // highest feet height of the current flight
  let anchorX = 0, anchorY = 0;      // last position whose body was entirely on walkable / solid cells
  let prevJumpHeld = false;
  let reach = STEP;                  // current step-up margin (STEP grounded, AIR_STEP airborne)
  let voidWalk = false;              // grounded inside a grid gap: walking on within it is allowed
  // auto-walk
  let path: [number, number][] | null = null;
  let wp = 0;
  let runWalk = false;
  const jumpFns: ((vy: number) => void)[] = [];
  const landFns: ((impact: number, fall: number) => void)[] = [];

  /**
   * Support height (m) of one point for feet at height `hi`, or NaN if the point is blocked.
   * `voidOk`: grid gaps with nothing solid are allowed (see header).
   */
  let lastVoid = false;
  function pointSupport(px: number, py: number, hi: number, voidOk: boolean): number {
    lastVoid = false;
    const top = hasTop ? fTop(px, py) : (fFree(px, py) ? -Infinity : Infinity);
    if (top === Infinity) return NaN;
    const g = fGround(px, py);
    if (top > -Infinity) {
      if (top > hi + reach) return NaN;
      return top > g ? top : g;
    }
    if (!hasTop || fFree(px, py)) return g <= hi + reach ? g : NaN;
    // grid gap, nothing solid: crossing it in the air / dropping into it, or walking on inside it after landing there
    if (voidOk && (g + STEP < hi || (voidWalk && g <= hi + reach))) { lastVoid = true; return g; }
    return NaN;
  }
  /** Body support (max over the 5 probes) at (px,py), or NaN if any probe is blocked. Sets bodyVoid. */
  let bodyVoid = false;
  function bodySupport(px: number, py: number, hi: number, voidOk: boolean, strict: boolean): number {
    let s = pointSupport(px, py, hi, voidOk); if (s !== s) return NaN;
    let v = lastVoid;
    if (strict) {
      let t = pointSupport(px + rx, py, hi, voidOk); if (t !== t) return NaN; if (t > s) s = t; v = v || lastVoid;
      t = pointSupport(px - rx, py, hi, voidOk); if (t !== t) return NaN; if (t > s) s = t; v = v || lastVoid;
      t = pointSupport(px, py + ry, hi, voidOk); if (t !== t) return NaN; if (t > s) s = t; v = v || lastVoid;
      t = pointSupport(px, py - ry, hi, voidOk); if (t !== t) return NaN; if (t > s) s = t; v = v || lastVoid;
    }
    bodyVoid = v;
    return s;
  }
  /** Support under the body ignoring blocked probes (for standing / landing): highest reachable surface. */
  function supportUnder(px: number, py: number, hi: number): number {
    // ground: the centre (centre of mass decides when you step off an edge); solid tops: any probe (crate edge)
    let s = fGround(px, py);
    if (!hasTop) return s;
    let t = topH(px, py, hi); if (t > s) s = t;
    t = topH(px + rx, py, hi); if (t > s) s = t; t = topH(px - rx, py, hi); if (t > s) s = t;
    t = topH(px, py + ry, hi); if (t > s) s = t; t = topH(px, py - ry, hi); if (t > s) s = t;
    return s;
  }
  /** Reachable solid top (m) at one point for feet at `hi`, or -Infinity. */
  function topH(ax: number, ay: number, hi: number): number {
    const top = fTop(ax, ay);
    return top < Infinity && top <= hi + reach ? top : -Infinity;
  }
  /** Truly inside something solid (bad spawn / server teleport)? */
  function stuck(px: number, py: number, hi: number): boolean {
    if (!hasTop) return !fFree(px, py);
    const top = fTop(px, py);
    if (top === Infinity) return true;
    return top > -Infinity && top > hi + reach;
  }

  /** Move by (dX, dZ) metres with sliding at feet height `hi`; returns the bitmask of blocked axes (1 = x, 2 = z). */
  function moveBy(dX: number, dZ: number, hi: number): number {
    const dx = dX / kx, dy = dZ / kz;
    // stuck inside an obstacle: move freely until we are out
    if (stuck(x, y, hi)) { x += dx; y += dy; anchorX = x; anchorY = y; return 0; }
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(dX), Math.abs(dZ)) / SUBSTEP_M));
    const sx = dx / n, sy = dy / n;
    let blocked = 0;
    for (let i = 0; i < n; i++) {
      voidWalk = !air && hasTop && !fFree(x, y) && fTop(x, y) === -Infinity;
      // strict 5-point test when the body currently fits, else the centre only (squeezing out of a tight spot)
      const here = bodySupport(x, y, hi, true, true);
      const strict = here === here;
      const dHere = anchorDist(x, y);
      let nx = x + sx, ny = y + sy, s = bodySupport(nx, ny, hi, voidAllowed(nx, ny, dHere), strict);
      let ok = s === s;
      if (!ok && sx !== 0) { nx = x + sx; ny = y; s = bodySupport(nx, ny, hi, voidAllowed(nx, ny, dHere), strict); ok = s === s; if (ok) blocked |= 2; }
      if (!ok && sy !== 0) { nx = x; ny = y + sy; s = bodySupport(nx, ny, hi, voidAllowed(nx, ny, dHere), strict); ok = s === s; if (ok) blocked |= 1; }
      if (!ok) { blocked |= 3; break; }
      x = nx; y = ny;
      if (!bodyVoid) { anchorX = x; anchorY = y; }
    }
    voidWalk = false;
    return blocked;
  }

  function anchorDist(px: number, py: number): number { return Math.hypot((px - anchorX) * kx, (py - anchorY) * kz); }
  /** Grid gaps are allowed within VOID_RUN of the last walkable point, or when heading back towards it. */
  function voidAllowed(px: number, py: number, dHere: number): boolean {
    const d = anchorDist(px, py);
    return d <= VOID_RUN || d < dHere;
  }

  function clearPath(): void { path = null; wp = 0; }
  function doJump(): void {
    vy = V0; air = true; jumped = true; bufferT = 0; apex = fy;
    for (let i = 0; i < jumpFns.length; i++) { try { jumpFns[i](vy); } catch (e) { console.error('[l3d] onJump', e); } }
  }
  function land(): void {
    const impact = vy < 0 ? -vy : 0;
    const fall = apex - fy;
    air = false; jumped = false; vy = 0; sinceGround = 0;
    for (let i = 0; i < landFns.length; i++) { try { landFns[i](impact, fall > 0 ? fall : 0); } catch (e) { console.error('[l3d] onLand', e); } }
  }
  function resetVertical(): void {
    // on teleport we stand on the ground (not on top of a crate we were placed into)
    ground = supportUnder(x, y, fGround(x, y));
    fy = ground; vy = 0; air = false; jumped = false; sinceGround = 0; anchorX = x; anchorY = y; apex = fy;
  }

  const ctl: PlayerControllerEx = {
    get x() { return x; },
    get y() { return y; },
    get speed() { return speed; },
    get face() { return face; },
    get ground() { return ground; },
    get feetY() { return fy; },
    get vy() { return vy; },
    get airborne() { return air; },
    get vx() { return vx; },
    get vz() { return vz; },
    get walking() { return path !== null; },
    get space() { return space; },
    get units() { return units; },

    teleport(nx, ny) {
      x = nx; y = ny; vx = 0; vz = 0; speed = 0; clearPath();
      resetVertical();
    },

    setSpace(s, u, at) {
      useSpace(s, u);
      clearPath(); vx = 0; vz = 0; speed = 0; bufferT = 0;
      if (at) { x = at.x; y = at.y; if (at.face != null) face = wrapAngle(at.face); }
      resetVertical();
    },

    setFace(f) { face = wrapAngle(f); },

    stop() { clearPath(); vx = 0; vz = 0; speed = 0; },

    jump() { bufferT = BUFFER; },

    onJump(fn) { jumpFns.push(fn); return () => { const i = jumpFns.indexOf(fn); if (i >= 0) jumpFns.splice(i, 1); }; },
    onLand(fn) { landFns.push(fn); return () => { const i = landFns.indexOf(fn); if (i >= 0) landFns.splice(i, 1); }; },

    feet(out) { out.x = x * kx; out.y = fy; out.z = (y - z0) * kz; return out; },

    walkTo(tx, ty) {
      let p: [number, number][] | null = null;
      try { p = space.path ? space.path([x, y], [tx, ty]) : null; } catch { p = null; }
      if (!p || p.length === 0) p = [[tx, ty]];
      path = p.slice();
      // first point = start: skip it
      wp = path.length > 1 && Math.hypot((path[0][0] - x) * kx, (path[0][1] - y) * kz) < WAYPOINT_EPS * 2 ? 1 : 0;
      runWalk = false;
    },

    update(dt, input: PlayerInput, yaw) {
      if (!(dt > 0)) return false;
      const inp = input as PlayerInput | undefined;
      const mx = inp?.move?.x || 0, my = inp?.move?.y || 0;

      // ---- jump request (press edge / consumeJump), buffered
      let pressed = false;
      if (inp && typeof inp.consumeJump === 'function') pressed = inp.consumeJump();
      else { const held = !!inp?.jump; pressed = held && !prevJumpHeld; prevJumpHeld = held; }
      if (pressed) bufferT = BUFFER;

      let tx = 0, tz = 0;   // target velocity m/s
      if (mx !== 0 || my !== 0) {
        clearPath();
        // camera-relative direction in metres: forward = (-sin, -cos), right = (cos, -sin)
        const s = Math.sin(yaw), c = Math.cos(yaw);
        let dX = -s * my + c * mx;
        let dZ = -c * my - s * mx;
        const l = Math.hypot(dX, dZ);
        if (l > 1) { dX /= l; dZ /= l; }
        const sp = inp!.run ? RUN : WALK;
        tx = dX * sp; tz = dZ * sp;
      } else if (path) {
        // auto-walk along the path
        while (wp < path.length) {
          const p = path[wp];
          const ex = (p[0] - x) * kx, ez = (p[1] - y) * kz;
          const d = Math.hypot(ex, ez);
          const last = wp === path.length - 1;
          if (d < (last ? 0.04 : WAYPOINT_EPS)) { wp++; continue; }
          const sp = runWalk ? RUN : WALK;
          // ease into the final point (no overshoot): v ≤ d·k
          const v = last ? Math.min(sp, d * 6) : sp;
          tx = (ex / d) * v; tz = (ez / d) * v;
          break;
        }
        if (wp >= path.length) clearPath();
      }

      // ---- take-off (grounded, or within coyote time after walking off an edge)
      if (bufferT > 0 && (!air || (!jumped && sinceGround <= COYOTE))) doJump();
      if (bufferT > 0) bufferT = Math.max(0, bufferT - dt);

      // ---- horizontal velocity (reduced control in the air)
      const moving = tx !== 0 || tz !== 0;
      const k = (moving ? ACC : DEC) * (air ? AIR : 1);
      vx = damp(vx, tx, k, dt);
      vz = damp(vz, tz, k, dt);
      if (!moving && !air && vx * vx + vz * vz < 1e-4) { vx = 0; vz = 0; }

      // ---- vertical (exact parabola per frame)
      const fy0 = fy;
      if (air) {
        fy += vy * dt - 0.5 * G * dt * dt;
        vy -= G * dt;
        if (fy > apex) apex = fy;
        sinceGround += dt;
      }
      const hi = fy > fy0 ? fy : fy0;   // collide with the highest feet of this frame (no tunnelling into tops)
      reach = air ? AIR_STEP : STEP;

      // ---- horizontal move with collision
      const x0 = x, y0 = y;
      if (vx !== 0 || vz !== 0) {
        const blocked = moveBy(vx * dt, vz * dt, hi);
        if (blocked & 1) vx = (x - x0) * kx / dt;
        if (blocked & 2) vz = (y - y0) * kz / dt;
      }
      const mX = (x - x0) * kx, mZ = (y - y0) * kz;
      const moved = mX !== 0 || mZ !== 0;
      const hm = Math.hypot(mX, mZ);
      const ms = hm / dt;
      speed = ms / SX;
      if (ms > 0.05) {
        // face the actual motion (sliding along a wall turns the body along the wall)
        face = wrapAngle(dampAngle(face, Math.atan2(-mX, -mZ), TURN, dt));
      }

      // ---- support, landing, walking off edges
      ground = supportUnder(x, y, hi);
      if (air) {
        if (fy <= ground && vy <= 0) { fy = ground; land(); }
        else if (fy < ground) fy = ground;   // rising past a step edge: never inside a top
      } else if (ground > fy) {
        fy = ground;                           // step up (≤ STEP, guaranteed by the collision test)
      } else if (fy - ground <= STEP + SLOPE_SNAP * hm) {
        fy = ground;                           // walking down stairs / off a curb
      } else {
        air = true; jumped = false; vy = 0; apex = fy; sinceGround = 0;   // walked off an edge: fall
      }

      if (path && !moved && moving && ms < 0.01) {
        // path blocked (walk grid mismatch): give up instead of pushing forever
        clearPath();
      }
      return moved;   // horizontal motion only (the integrator sends site.moveTo on it)
    },
  };
  return ctl;
}
