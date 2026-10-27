/**
 * Show the own hero for a moment: in first person the camera swings out to third person for `sec` seconds and back
 * (emotes, the boom). The chosen mode is not saved (state.mode only; the V key / menus keep working: if the player
 * switches the view meanwhile, nothing is restored).
 */
import type { CoreContext } from '../core/context';

export class TpPeek {
  private until = 0;
  private active = false;
  private now = 0;
  constructor(private ctx: CoreContext) {}

  /** Peek for at least `sec` s from now (extends a running peek). */
  start(sec: number) {
    const { state, rooms } = this.ctx;
    if (!this.active) {
      if (state.mode !== 'fp' || state.menu || rooms.stage) return;
      this.active = true;
      const ctl = this.ctx.controller();
      // the body faces where we looked, so the camera ends up behind it
      ctl.setFace(this.ctx.rig.yaw); this.ctx.me.face = this.ctx.rig.yaw;
      state.mode = 'tp'; this.ctx.applyCamera();
    }
    this.until = Math.max(this.until, this.now + sec);
  }

  update(dt: number) {
    this.now += dt;
    if (!this.active || this.now < this.until) return;
    this.end();
  }

  end() {
    if (!this.active) return;
    this.active = false;
    const { state } = this.ctx;
    if (state.mode === 'tp') { state.mode = 'fp'; this.ctx.applyCamera(); }
  }
  get on() { return this.active; }
}
