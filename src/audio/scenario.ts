/**
 * Scripted scenarios for the offline mix report (dev/sound.html, src/audio/tools/mix-report.mjs): the same calls the
 * game makes, on a fixed timeline. 'walk' (30 s): street walk with another player passing, a jump, a chat pop, a menu,
 * into the forge (door, hearth, coin) and back out, a creak and a far-away cat. 'mine' (12 s): steps on dirt, six
 * pickaxe hits and a stone breaking.
 */
import type { SoundEngine } from './engine';
import { StepTracker, landGain } from './mix';

type Ev = [number, (at: number) => void];

/** Step times (s) of a walk from t0 to t1 at speed01, as the game's StepTracker would emit them at 60 fps. */
export function stepTimes(t0: number, t1: number, speed01: number): number[] {
  const s = new StepTracker(), out: number[] = [];
  for (let t = t0; t < t1 + 0.5; t += 1 / 60) if (s.update(1 / 60, t < t1 ? speed01 : 0)) out.push(t);
  return out;
}

export function scenario(name: 'walk' | 'mine', e: SoundEngine): { events: Ev[]; seconds: number } {
  const ev: Ev[] = [];
  const at = (t: number, f: (a: number) => void) => ev.push([t, f]);
  const steps = (t0: number, t1: number, id: string, sp = 1) => { for (const t of stepTimes(t0, t1, sp)) at(t, (a) => e.play(id, { at: a, own: true, gain: 0.85 + Math.min(0.6, sp) * 0.25, key: 'step-me' })); };
  if (name === 'walk') {
    at(0, (a) => { e.setSpace('street', a, 0); e.setListener(0, 1.15, 0, 0, 0, -1); });
    steps(0.5, 2.8, 'step.cobble');
    at(3.0, (a) => e.play('jump', { at: a, own: true }));
    at(3.55, (a) => { e.play('step.cobble', { at: a, own: true, gain: 0.8 + landGain(4) * 0.6, rate: 0.92, key: 'land-step' }); e.play('land', { at: a, own: true, gain: landGain(4) }); });
    steps(3.9, 11.5, 'step.cobble', 1.35);
    // another player passes 4 m ahead, left → right
    for (const t of stepTimes(2, 10, 1)) { const x = -8 + (t - 2) * 2; at(t, (a) => e.play('step.cobble', { at: a, x, y: 0, z: -4, gain: 0.5, key: 'st:bot' })); }
    at(6, (a) => e.play('bubble', { at: a, x: 0, y: 1.6, z: -4, key: 'bb:bot' }));
    at(7.5, (a) => e.play('ui.tick', { at: a }));
    at(8, (a) => { e.play('ui.open', { at: a }); });
    at(9.6, (a) => { e.play('ui.close', { at: a }); });
    at(12, (a) => e.play('door.open', { at: a, own: true }));
    at(12.6, (a) => { e.setSpace('forge', a); e.setFire({ x: 1.5, y: 1, z: -4 }); e.play('door.close', { at: a, own: true, delay: 0.15 }); });
    steps(13.2, 17.5, 'step.wood');
    at(15, (a) => e.play('ui.tick', { at: a }));
    at(16, (a) => e.play('ui.tick', { at: a }));
    at(18.2, (a) => e.play('shop.buy', { at: a }));
    at(20.5, (a) => { e.setSpace('street', a); e.play('door.open', { at: a, own: true }); e.play('door.close', { at: a, own: true, delay: 0.55 }); });
    steps(21.5, 29, 'step.cobble');
    at(24.5, (a) => e.play('amb.creak', { at: a, x: 7, y: 1, z: -6 }));
    at(27, (a) => e.play('amb.meow', { at: a, x: -15, y: 1, z: -12 }));
    return { events: ev.sort((p, q) => p[0] - q[0]), seconds: 30 };
  }
  at(0, (a) => { e.setSpace('mine', a, 0); e.setListener(0, 1.15, 0, 0, 0, -1); });
  steps(0.3, 3, 'step.dirt');
  for (let i = 0; i < 6; i++) at(3.6 + i * 1.1, (a) => e.play('mine.hit', { at: a, x: 0, y: 0.8, z: -1.2 }));
  at(10.3, (a) => e.play('mine.break', { at: a, x: 0, y: 0.6, z: -1.3 }));
  return { events: ev.sort((p, q) => p[0] - q[0]), seconds: 12 };
}

/** Run a scenario on an engine whose clock starts at t0 (offline: 0; live: currentTime + a small lead). */
export function runScenario(name: 'walk' | 'mine', e: SoundEngine, t0: number): number {
  const { events, seconds } = scenario(name, e);
  let k = 0;
  for (let t = 0; t <= seconds; t += 0.1) {
    while (k < events.length && events[k][0] <= t + 1e-6) { events[k][1](t0 + events[k][0]); k++; }
    e.tick(0.1, t0 + t);
  }
  return seconds;
}
