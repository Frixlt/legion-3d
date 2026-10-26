/**
 * Camera rig: first person, GTA-style third person (right shoulder, spring-arm collision) and an orbit
 * "equipment" camera, with smooth transitions between them.
 *
 * Every mode is expressed in the same parameter space — a pivot near the character, a view direction (yaw, pitch),
 * an arm length behind the pivot, a lateral shoulder offset, a vertical FOV and a screen-space framing shift — so a
 * transition simply blends parameters. That is what makes FP → orbit look like "the camera pulls out of your eyes and
 * flies around you": the arm grows from 0 while the azimuth swings to the front of the character.
 *
 * The rig never reads input: the integrator writes rig.yaw / rig.pitch (mouse look) and calls rig.zoom(wheel).
 * In orbit mode the rig itself handles mouse drag / wheel over the 3D canvas (menus release pointer lock).
 *
 * Expected order per frame: input → player controller → avatars → rig.follow(feet, eye) → rig.update(dt) → render.
 */
import * as THREE from 'three';
import type { CameraMode, CityLayout } from '../contracts';
import { SX, Y0, fromX, fromZ, toX, toZ } from '../world/coords';
import type { CameraRig } from '../contracts/modules';
import { DEG, Spring, clamp, damp, smootherstep, wrapAngle } from './math';

export interface CameraRigEx extends CameraRig {
  /** TP zoom: d > 0 zooms out (wheel down), in "wheel notches". */
  zoom(d: number): void;
  /** Base vertical FOV for FP/TP (degrees, Settings 60–90). Default = camera.fov at creation (75). */
  fov: number;
  /** Optional facing of the followed character (radians, Walker.face convention). Orbit starts in front of it. Null → yaw. */
  face: number | null;
  /** Shoulder side in TP: 1 = right (default), -1 = left. */
  shoulder: 1 | -1;
  /** Head-bob amount in FP (0 = off, 1 = default subtle). Auto 0 with prefers-reduced-motion. */
  bob: number;
  /** Current arm length (m) of the blended camera — main can hide the own head while < ~0.35 m. */
  readonly distance: number;
  /** True while a mode transition is running. */
  readonly transitioning: boolean;
  /**
   * Cheap analytic colliders (world-space boxes), tested in addition to setColliders() meshes.
   * Use layoutColliderBoxes(layout) — building blocks + a backstop behind the street.
   */
  setColliderBoxes(boxes: THREE.Box3[]): void;
  /**
   * Follow the feet; `air` = the character is airborne (PlayerControllerEx.airborne): FP then tracks the jump arc
   * rigidly instead of through the vertical spring. TP/orbit keep the spring (the character moves within the frame).
   */
  follow(feet: THREE.Vector3, eye: number, air?: boolean): void;
  /** Touch-down impact (m/s, PlayerControllerEx.onLand): a short FP camera dip. No-op in TP/orbit or with reduced motion. */
  landed(impact: number): void;
  /** Ground height in px space (same as World3D.groundAt): keeps the camera above terrain (ledges, stairs). */
  setGround(fn: ((x: number, y: number) => number) | null): void;
  /** Element that receives orbit drag / wheel (default: any <canvas>). Pass engine.renderer.domElement. */
  setDragElement(el: HTMLElement | null): void;
  dispose(): void;
}

/** Max triangles of plain meshes the rig will raycast each frame (merged city geometry is far bigger → skipped). */
const MESH_TRI_BUDGET = 20000;
/** Per-mesh triangle limit for collision raycasts without dedicated colliders. */
const MESH_TRI_LIMIT = 3000;

/**
 * Coarse camera colliders from the 2D layout: one box per building (from its hit rect, standing behind the
 * street line) and a backstop wall along the whole city behind the street, so the TP spring-arm never shows the
 * unmodelled backs of facades. Pure geometry, no meshes.
 */
export function layoutColliderBoxes(layout: CityLayout, groundAt?: (x: number, y: number) => number): THREE.Box3[] {
  const out: THREE.Box3[] = [];
  for (const b of layout.buildings) {
    const [x0, x1, y0, y1] = b.hit;
    const g = groundAt ? groundAt(b.door.x, b.door.y) : 0;
    const front = toZ(Math.min(y1, b.door.y)) - 0.35;
    const back = y0 < Y0;   // facade row behind the street; others (mine, storage) stand on the lower street
    const hgt = back ? (Y0 - y0) * SX : Math.max(1.5, (y1 - y0) * SX);
    const depth = back ? 12 : 1.6;
    out.push(new THREE.Box3(new THREE.Vector3(toX(x0) + 0.1, g - 1, front - depth), new THREE.Vector3(toX(x1) - 0.1, g + hgt, front)));
  }
  out.push(new THREE.Box3(new THREE.Vector3(toX(layout.area.x0) - 40, -5, toZ(layout.area.y0) - 40), new THREE.Vector3(toX(layout.area.x1) + 40, 60, toZ(layout.area.y0) - 2.2)));
  return out;
}

/* --------------------------------------------------------------- tuning */
const FP = { pitchMin: -85 * DEG, pitchMax: 85 * DEG };
const TP = { frame: -0.12, pivotH: 1.42, side: 0.72, dist: 3.2, min: 1.8, max: 6, pitchMin: -70 * DEG, pitchMax: 55 * DEG, upOffset: 0.18 };
const ORB = { pivotH: 0.72, dist: 2.4, min: 1.3, max: 4.2, elev: 10 * DEG, elevMin: -15 * DEG, elevMax: 50 * DEG, fov: 50, spin: 8 * DEG, front: 0.42 };
const ARM_MARGIN = 0.22;        // keep the camera this far in front of a hit surface
const ARM_OUT = 4.5;            // arm lengthening rate (1/s) — slow to avoid popping
const FOLLOW_OMEGA = 26;        // TP/orbit horizontal follow spring (rad/s): ~0.18 m lag at walk speed
const FOLLOW_Y_OMEGA = 14;      // vertical follow (stairs / ledges) in every mode
const TRANS_FP_TP = 0.45;       // s
const TRANS_ORBIT = 0.6;        // s (bigger sweep)
const SNAP_DIST = 3;            // m: follow target jumped (teleport) → snap
const DIP_OMEGA = 16;           // FP landing dip spring (rad/s): peak dip = v / (ω·e)
const DIP_MAX_V = 4.2;          // m/s: caps the dip at ~0.1 m (hard falls)

/** cubic-bezier(.2,.8,.2,1) — the site's --ease. */
function ease(t: number): number {
  if (t <= 0) return 0; if (t >= 1) return 1;
  const x1 = 0.2, y1 = 0.8, x2 = 0.2, y2 = 1;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  let u = t;
  for (let i = 0; i < 6; i++) {
    const x = ((ax * u + bx) * u + cx) * u - t;
    const d = (3 * ax * u + 2 * bx) * u + cx;
    if (Math.abs(x) < 1e-5 || d === 0) break;
    u = clamp(u - x / d, 0, 1);
  }
  return ((ay * u + by) * u + cy) * u;
}

/** Camera pose parameters (all relative to the followed feet so a stale snapshot still moves with the player). */
interface Pose { ph: number; yaw: number; pitch: number; dist: number; side: number; up: number; fov: number; frame: number; }
const mkPose = (): Pose => ({ ph: 0, yaw: 0, pitch: 0, dist: 0, side: 0, up: 0, fov: 75, frame: 0 });
function copyPose(o: Pose, a: Pose): Pose { o.ph = a.ph; o.yaw = a.yaw; o.pitch = a.pitch; o.dist = a.dist; o.side = a.side; o.up = a.up; o.fov = a.fov; o.frame = a.frame; return o; }
/**
 * Blend two poses. `t` drives the view direction / framing; `td` drives the arm length and pivot height (when
 * leaving first person the arm grows first — the camera backs out of the eyes — and the swing around follows).
 * `lift` raises the camera on an arc so it passes over the head instead of through it.
 */
function blendPose(o: Pose, a: Pose, b: Pose, t: number, td = t, lift = 0): Pose {
  o.ph = a.ph + (b.ph - a.ph) * td;
  o.yaw = a.yaw + wrapAngle(b.yaw - a.yaw) * t;
  o.pitch = a.pitch + (b.pitch - a.pitch) * t - lift * 0.35;
  o.dist = a.dist + (b.dist - a.dist) * td;
  o.side = a.side + (b.side - a.side) * t;
  o.up = a.up + (b.up - a.up) * td + lift;
  o.fov = a.fov + (b.fov - a.fov) * t;
  o.frame = a.frame + (b.frame - a.frame) * t;
  return o;
}

export function createCameraRig(camera: THREE.PerspectiveCamera): CameraRigEx {
  camera.rotation.order = 'YXZ';
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let mode: CameraMode = 'fp';
  let yaw = 0, pitch = 0;
  let tpDist = TP.dist;
  let orbDist = ORB.dist, orbYaw = 0, orbElev = ORB.elev;
  let orbFrameSide = -0.42;     // NDC x of the character (−: left of centre)
  let orbFrameDist = ORB.dist;
  let face: number | null = null;
  let shoulder: 1 | -1 = 1;
  let baseFov = camera.fov || 75;
  let bobAmt = reduced ? 0 : 1;

  // follow state
  const target = new THREE.Vector3();     // raw feet
  let eyeH = 1.15;
  let hasTarget = false;
  const fx = new Spring(), fy = new Spring(), fz = new Spring();   // smoothed feet
  let airborne = false;                   // followed character is in the air (jump / fall)
  const dip = new Spring();               // FP landing dip (m, ≤ 0)
  const prevTarget = new THREE.Vector3();
  let speedS = 0;          // smoothed horizontal speed (m/s), for head bob
  let bobPhase = 0;
  let bobGain = 0;

  // transitions
  const from = mkPose(), to = mkPose(), cur = mkPose();
  let tElapsed = 1, tDur = 1, transitioning = false;
  let fromMode: CameraMode = 'fp';
  let arm = 0;             // collision-limited arm length (m)
  let shortS = 0;          // smoothed collision shortening (m)
  let armInit = false;

  // orbit interaction
  let dragging = false, dragId = -1, lastX = 0, lastY = 0, idleSpin = 0;

  // colliders
  let colliders: THREE.Object3D[] = [];
  const ray = new THREE.Raycaster();
  const hits: THREE.Intersection[] = [];
  const boxes: THREE.Box3[] = [];
  let extraBoxes: THREE.Box3[] = [];
  let groundFn: ((x: number, y: number) => number) | null = null;

  // scratch (no per-frame allocations)
  const pivot = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const want = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const tmpV = new THREE.Vector3();

  /* ----------------------------------------------------------- poses per mode */
  function poseFor(m: CameraMode, o: Pose): Pose {
    if (m === 'fp') {
      o.ph = eyeH; o.yaw = yaw; o.pitch = clamp(pitch, FP.pitchMin, FP.pitchMax); o.dist = 0; o.side = 0; o.up = 0;
      o.fov = baseFov; o.frame = 0;
    } else if (m === 'tp') {
      o.ph = TP.pivotH; o.yaw = yaw; o.pitch = clamp(pitch, TP.pitchMin, TP.pitchMax);
      o.dist = tpDist; o.side = TP.side * shoulder * clamp(tpDist / TP.dist, 0.65, 1.2); o.up = TP.upOffset;
      o.fov = baseFov; o.frame = TP.frame * shoulder;
    } else {
      o.ph = ORB.pivotH; o.yaw = orbYaw; o.pitch = -orbElev; o.dist = orbDist; o.side = 0; o.up = 0;
      o.fov = ORB.fov; o.frame = orbFrameSide;
    }
    return o;
  }

  function startTransition(m: CameraMode, instant: boolean): void {
    // snapshot what is on screen right now (handles interrupted transitions)
    if (instant || reduced || !hasTarget) {
      transitioning = false; tElapsed = tDur = 1;
    } else {
      copyPose(from, cur);
      from.dist = armInit ? Math.min(cur.dist, arm) : cur.dist;   // start from the collided arm, not the wished one
      tElapsed = 0;
      tDur = m === 'orbit' || fromMode === 'orbit' ? TRANS_ORBIT : TRANS_FP_TP;
      transitioning = true;
    }
  }

  function setMode(m: CameraMode, opts?: { instant?: boolean }): void {
    if (m === mode && !opts?.instant) return;
    fromMode = mode;
    if (m === 'orbit' && mode !== 'orbit') {
      // start in front of the character, 3/4 view on the side away from the panel
      const f = face ?? yaw;
      orbYaw = f + Math.PI + (orbFrameSide <= 0 ? -ORB.front : ORB.front);
      orbElev = ORB.elev;
      orbDist = orbFrameDist;
      idleSpin = 0.8;   // short delay before auto-rotation
    }
    if (mode === 'orbit' && m !== 'orbit') dragging = false;
    mode = m;
    startTransition(m, !!opts?.instant);
  }

  /* ----------------------------------------------------------- collisions */
  function setColliders(objs: THREE.Object3D[]): void {
    // Prefer dedicated coarse colliders (userData.cameraCollider) when the world provides them.
    const flagged: THREE.Object3D[] = [];
    const meshes: THREE.Object3D[] = [];
    for (const o of objs) {
      o.updateWorldMatrix(true, true);
      o.traverse((c) => {
        if (c.userData && c.userData.cameraCollider) flagged.push(c);
        const mesh = c as THREE.Mesh;
        if (!mesh.isMesh || (c as THREE.InstancedMesh).isInstancedMesh) return;
        if (c.userData && (c.userData.noCameraCollide || c.userData.noCollide)) return;
        const mat = mesh.material as THREE.Material;
        if (mat && !Array.isArray(mat) && mat.transparent && mat.opacity < 0.6) return;
        meshes.push(c);
      });
    }
    if (flagged.length) colliders = flagged;
    else {
      // No dedicated colliders: use plain meshes, but skip heavy ones (merged city chunks) — a brute-force
      // raycast over 100k triangles per frame would cost milliseconds. Layout boxes cover buildings anyway.
      colliders = [];
      let tris = 0, skipped = 0;
      for (const m of meshes) {
        const g = (m as THREE.Mesh).geometry;
        const n = (g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3;
        if (n > MESH_TRI_LIMIT || tris + n > MESH_TRI_BUDGET) { skipped++; continue; }
        tris += n; colliders.push(m);
      }
      if (skipped) console.info(`[l3d] camera: ${skipped} heavy meshes skipped for collision; mark coarse colliders with userData.cameraCollider`);
    }
    boxes.length = 0;
    for (const c of colliders) {
      const b = new THREE.Box3().setFromObject(c);
      boxes.push(b);
    }
  }

  /** Longest free arm length (m) from `pivot` along `dir` (unit), up to `len`. */
  function castArm(len: number): number {
    len = castBoxes(len);
    if (!colliders.length || len <= 0.01) return len;
    ray.set(pivot, dir);
    ray.near = 0;
    ray.far = len + ARM_MARGIN;
    let best = len + ARM_MARGIN;
    for (let i = 0; i < colliders.length; i++) {
      const b = boxes[i];
      if (b && !b.isEmpty() && !ray.ray.intersectsBox(b)) continue;
      hits.length = 0;
      colliders[i].raycast(ray, hits);
      for (let k = 0; k < hits.length; k++) if (hits[k].distance < best) best = hits[k].distance;
    }
    hits.length = 0;
    return Math.max(0, Math.min(len, best - ARM_MARGIN));
  }
  function castBoxes(len: number): number {
    if (!extraBoxes.length || len <= 0.01) return len;
    ray.set(pivot, dir);
    let best = len + ARM_MARGIN;
    for (let i = 0; i < extraBoxes.length; i++) {
      const b = extraBoxes[i];
      if (b.containsPoint(pivot)) continue;   // inside a box (door niche): ignore it
      const p = ray.ray.intersectBox(b, tmpV);
      if (p) { const d = p.distanceTo(pivot); if (d < best) best = d; }
    }
    return Math.max(0, Math.min(len, best - ARM_MARGIN));
  }

  /* ----------------------------------------------------------- orbit interaction */
  let dragEl: HTMLElement | null = null;
  const isCanvas = (t: EventTarget | null) => !!t && (dragEl ? t === dragEl : (t as Element).tagName === 'CANVAS');
  function onDown(e: PointerEvent): void {
    if (mode !== 'orbit' || !isCanvas(e.target) || e.button !== 0) return;
    dragging = true; dragId = e.pointerId; lastX = e.clientX; lastY = e.clientY;
  }
  function onMove(e: PointerEvent): void {
    if (!dragging || e.pointerId !== dragId) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    orbYaw -= dx * 0.008;
    orbElev = clamp(orbElev + dy * 0.005, ORB.elevMin, ORB.elevMax);
    idleSpin = 2.5;
  }
  function onUp(e: PointerEvent): void { if (e.pointerId === dragId) { dragging = false; dragId = -1; } }
  function onWheel(e: WheelEvent): void {
    if (mode !== 'orbit' || !isCanvas(e.target)) return;
    const k = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 600 : 1;
    orbDist = clamp(orbDist * Math.exp((e.deltaY * k) / 100 * 0.12), ORB.min, ORB.max);
  }
  const hasWin = typeof window !== 'undefined';
  if (hasWin) {
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('wheel', onWheel, { passive: true });
  }

  /* ----------------------------------------------------------- per frame */
  function update(dt: number): void {
    if (!hasTarget) return;
    if (!(dt > 0)) dt = 1 / 60;
    if (dt > 0.1) dt = 0.1;

    // follow springs (snap on teleport)
    const jump = Math.abs(target.x - fx.x) + Math.abs(target.z - fz.x);
    if (jump > SNAP_DIST || !armInit) {
      fx.reset(target.x); fy.reset(target.y); fz.reset(target.z); prevTarget.copy(target);
    }
    // horizontal: FP is rigid (view-model and body must not lag), TP/orbit get a little weight
    const rigid = (mode === 'fp' && !transitioning);
    if (rigid) { fx.reset(target.x); fz.reset(target.z); }
    else {
      fx.step(target.x, FOLLOW_OMEGA, dt); fz.step(target.z, FOLLOW_OMEGA, dt);
      // during FP↔TP blends, converge the lag smoothly towards rigid
      if (mode === 'fp') { const k = ease(tElapsed / tDur); fx.x += (target.x - fx.x) * k; fz.x += (target.z - fz.x) * k; }
    }
    // vertical: the jump arc is already smooth → FP follows it rigidly (no eye lag); steps / stairs / TP use the spring
    if (airborne && mode === 'fp' && !transitioning) fy.reset(target.y);
    else fy.step(target.y, FOLLOW_Y_OMEGA, dt);
    dip.step(0, DIP_OMEGA, dt);

    // speed for head bob
    const sp = Math.hypot(target.x - prevTarget.x, target.z - prevTarget.z) / dt;
    prevTarget.copy(target);
    speedS = damp(speedS, sp < 12 ? sp : 0, 10, dt);

    // orbit auto-rotation
    if (mode === 'orbit' && !dragging) {
      if (idleSpin > 0) idleSpin -= dt;
      else if (!reduced) orbYaw += ORB.spin * dt;
    }

    // TP has a narrower pitch range than FP: clamp the stored value too, so there is no dead zone when looking back
    if (mode === 'tp' && !transitioning) pitch = clamp(pitch, TP.pitchMin, TP.pitchMax);

    // pose
    poseFor(mode, to);
    if (transitioning) {
      tElapsed += dt;
      const u = clamp(tElapsed / tDur, 0, 1);
      const k = ease(u);
      // arm: out-of-the-eyes pulls lead the swing; into-the-eyes pushes lag it (swing first, then dive in)
      const out = to.dist >= from.dist;
      const kd = out ? ease(clamp(u * 1.6, 0, 1)) : smootherstep(clamp(u * 1.25 - 0.25, 0, 1));
      const ks = out ? smootherstep(clamp(u * 1.15 - 0.1, 0, 1)) : k;
      // a gentle arc over the head when the arm is short at one end and the view swings a lot
      // the arc peaks early on the way out (camera clears the head right away) and late on the way in
      const swing = Math.abs(wrapAngle(to.yaw - from.yaw));
      const short = Math.min(from.dist, to.dist) < 0.5 ? 1 : 0;
      const arcU = out ? Math.sqrt(u) : 1 - Math.sqrt(1 - u);
      const lift = short * (0.18 + 0.2 * Math.min(1, swing / 1.5)) * Math.sin(Math.PI * arcU);
      blendPose(cur, from, to, ks, kd, lift);
      if (tElapsed >= tDur) { transitioning = false; copyPose(cur, to); }
    } else copyPose(cur, to);

    // pivot + view basis
    const cp = Math.cos(cur.pitch), spch = Math.sin(cur.pitch);
    const sy = Math.sin(cur.yaw), cy = Math.cos(cur.yaw);
    fwd.set(-sy * cp, spch, -cy * cp);
    right.set(cy, 0, -sy);
    pivot.set(fx.x, fy.x + cur.ph, fz.x);

    // FP head bob (vertical double-frequency, lateral sway), faded by speed and by arm length
    if (bobAmt > 0 && cur.dist < 0.5) {
      const v01 = clamp(speedS / 2.3, 0, 1.8);
      bobGain = damp(bobGain, v01 > 0.15 ? Math.min(1, v01) : 0, 6, dt);
      bobPhase += (Math.PI * speedS / 0.62) * dt;      // one dip per ~0.62 m step
      if (bobPhase > 1e4) bobPhase -= 2 * Math.PI * 1000;
      const g = bobGain * bobAmt * (1 - cur.dist / 0.5) * (v01 > 1.2 ? 1.35 : 1);
      pivot.y += (Math.abs(Math.sin(bobPhase)) - 0.5) * 0.028 * g;
      pivot.addScaledVector(right, Math.sin(bobPhase) * 0.012 * g);
    } else bobGain = 0;
    // FP landing dip (faded out with the arm length, like the bob)
    if (cur.dist < 0.5 && dip.x !== 0) pivot.y += dip.x * (1 - cur.dist / 0.5);

    // desired camera position: pivot − fwd·dist + right·side + up
    want.copy(pivot).addScaledVector(fwd, -cur.dist).addScaledVector(right, cur.side);
    want.y += cur.up;
    // spring-arm: cast from the pivot to the wanted point
    dir.subVectors(want, pivot);
    const len = dir.length();
    if (len > 0.01) {
      dir.multiplyScalar(1 / len);
      const free = castArm(len);
      // Track how much the collision shortens the arm, not the arm itself: without a hit the arm is exactly the
      // wished length (transitions stay crisp); after a hit the shortening relaxes slowly (no popping out).
      const short = len - free;
      if (!armInit || short > shortS) shortS = short; else shortS = damp(shortS, short, ARM_OUT, dt);
      arm = Math.min(free, Math.max(0, len - shortS));   // never behind a wall, even for one frame
      camera.position.copy(pivot).addScaledVector(dir, arm);
    } else {
      arm = 0;
      camera.position.copy(pivot);
    }
    armInit = true;
    // keep above the ground under the character
    let minY = fy.x + 0.12;
    if (groundFn && cur.dist > 0.3) {
      const g = groundFn(fromX(camera.position.x), fromZ(camera.position.z));
      if (Number.isFinite(g) && g + 0.25 > minY) minY = g + 0.25;
    }
    if (camera.position.y < minY) camera.position.y = minY;

    camera.rotation.set(cur.pitch, cur.yaw, 0, 'YXZ');

    // projection: fov + screen-space framing (off-axis shift via filmOffset, so the character is not distorted)
    const fov = cur.fov;
    // three: left += near·filmOffset/filmWidth. Putting the view centre at NDC x = frame needs a window shift of
    // −frame·(width/2) = −frame·aspect·near·tan(fov/2)  ⇒  filmOffset = −frame·aspect·tan(fov/2)·filmWidth.
    const skew = cur.frame === 0 ? 0 : -cur.frame * camera.aspect * Math.tan((fov * DEG) / 2) * camera.getFilmWidth();
    if (Math.abs(camera.fov - fov) > 1e-4 || Math.abs(camera.filmOffset - skew) > 1e-5) {
      camera.fov = fov;
      camera.filmOffset = skew;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  }

  function follow(feet: THREE.Vector3, eye: number, air?: boolean): void {
    target.copy(feet);
    eyeH = eye;
    airborne = !!air;
    if (!hasTarget) { hasTarget = true; fx.reset(feet.x); fy.reset(feet.y); fz.reset(feet.z); prevTarget.copy(feet); }
  }

  const rig: CameraRigEx = {
    get mode() { return mode; },
    set mode(m: CameraMode) { setMode(m); },
    get yaw() { return yaw; },
    set yaw(v: number) { yaw = v; },
    get pitch() { return pitch; },
    set pitch(v: number) { pitch = clamp(v, FP.pitchMin, FP.pitchMax); },
    get fov() { return baseFov; },
    set fov(v: number) { baseFov = clamp(v, 30, 110); },
    get face() { return face; },
    set face(v: number | null) { face = v; },
    get shoulder() { return shoulder; },
    set shoulder(v: 1 | -1) { shoulder = v; },
    get bob() { return bobAmt; },
    set bob(v: number) { bobAmt = reduced ? 0 : clamp(v, 0, 2); },
    get distance() { return armInit ? Math.min(arm, cur.dist) : cur.dist; },
    get transitioning() { return transitioning; },
    setMode,
    follow,
    update,
    setColliders,
    setColliderBoxes(b) { extraBoxes = b.slice(); },
    setGround(fn) { groundFn = fn; },
    landed(impact: number) {
      if (reduced || bobAmt <= 0 || !(impact > 1.5)) return;
      dip.v -= clamp((impact - 1.5) * 0.75, 0, DIP_MAX_V) * Math.min(1, bobAmt);
    },
    setDragElement(el) { dragEl = el; },
    zoom(d: number) {
      if (!d) return;
      if (mode === 'tp') tpDist = clamp(tpDist * Math.exp(d * 0.12), TP.min, TP.max);
      else if (mode === 'orbit') orbDist = clamp(orbDist * Math.exp(d * 0.12), ORB.min, ORB.max);
    },
    setOrbitFraming(o) {
      orbFrameSide = o.side === 'left' ? -0.42 : o.side === 'right' ? 0.42 : 0;
      if (o.distance) { orbFrameDist = clamp(o.distance, ORB.min, ORB.max); if (mode === 'orbit') orbDist = orbFrameDist; }
    },
    dispose() {
      if (!hasWin) return;
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('wheel', onWheel);
    },
  };
  return rig;
}
