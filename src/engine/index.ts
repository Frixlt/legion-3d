/**
 * Engine module: renderer + loop + adaptive quality, input, camera rig, local player controller.
 *
 * Per-frame order the integrator must keep (single engine.onFrame callback, or callbacks registered in this order):
 *   1. input       look = input.consumeLook(); rig.yaw/pitch from look; rig.zoom(input.consumeWheel())
 *   2. controller  player.update(dt, input, rig.yaw)   (Space = jump via input.consumeJump(); player.jump() for UI)
 *   3. avatars     player.feet(feet) (y = real feet height while jumping); me.root.rotation.y = (fp ? rig.yaw : player.face)
 *   4. camera      rig.face = player.face; rig.follow(feet, EYE, player.airborne); rig.update(dt)
 *                  once at setup: player.onLand((impact) => rig.landed(impact))   (FP landing dip)
 *   5. labels / world.update(dt, t, camera)
 *   6. render      (engine, after all callbacks)
 *
 * Player spaces: the city (px, layout.free + world.groundAt + world.solidTop) or a room (metres, RoomScene) —
 * player.setSpace(space, 'px' | 'm', at). Collision/jump rules: header of player.ts.
 * createEngine throws NoWebGLError (code 'no_webgl') when no WebGL 2 context can be created with any attributes;
 * context loss pauses the loop and fires window events 'l3d:contextlost' / 'l3d:contextrestored'.
 */
export { createEngine, NoWebGLError } from './engine';
export { createInput, isTyping, type InputEx } from './input';
export { createCameraRig, layoutColliderBoxes, type CameraRigEx } from './camera';
export { createPlayerController, type PlayerControllerEx, type PlayerOptions, type PlayerInput, type WalkSpace, type SpaceUnits } from './player';
export { AutoGovernor, PRESETS, LS_QUALITY, type QualitySetting, type LevelPreset } from './quality';
export { CrowdLod, CROWD, crowdBudget, type CrowdBudget } from './budget';
export { Spring, damp, dampAngle, wrapAngle } from './math';
