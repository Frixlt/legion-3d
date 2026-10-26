/**
 * Keyboard + mouse input with pointer-lock mouse look.
 *
 * Gating rules (docs/GAME-DESIGN.md §3.3):
 *  - while an <input>/<textarea>/<select>/contenteditable is focused no game key fires and movement reads zero;
 *    onKey still gets 'Escape' (so the integrator can blur) — 'Enter' is left to the field itself;
 *  - setGameplay(false) (menu open, chat): movement/look read zero, onKey only gets 'Escape' / 'Enter' / 'NumpadEnter'
 *    (menus handle their own hotkeys with their own listeners);
 *  - Ctrl/Meta/Alt chords are never treated as game keys (browser shortcuts stay intact).
 * Held keys are released on window blur, tab hide, focusing a text field and Ctrl/Alt/Meta chords.
 */
import type { Unsub } from '../contracts';
import type { Input } from '../contracts/modules';

/** Input plus jump (Space), read by the player controller. */
export interface InputEx extends Input {
  /** Space held (gameplay only). */
  readonly jump: boolean;
  /** True once per Space press (pressed within the last 250 ms and not consumed yet). */
  consumeJump(): boolean;
}

const JUMP = 'Space';
const JUMP_STALE_MS = 250;

const FWD = new Set(['KeyW', 'ArrowUp']);
const BACK = new Set(['KeyS', 'ArrowDown']);
const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);
const RUN = new Set(['ShiftLeft', 'ShiftRight']);
/** Keys whose browser default we suppress in gameplay (scrolling, focus moves). */
const PREVENT = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', 'F3']);
const MENU_KEYS = new Set(['Escape', 'Enter', 'NumpadEnter']);

/** Mouse deltas above this (px per event) are browser glitches (Chrome pointer-lock spikes) and are dropped. */
const SPIKE = 300;

export function isTyping(el: Element | null = typeof document !== 'undefined' ? document.activeElement : null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return type !== 'button' && type !== 'checkbox' && type !== 'radio' && type !== 'range' && type !== 'submit';
  }
  return tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable === true;
}

export function createInput(target: HTMLElement): InputEx {
  const down = new Set<string>();
  const move = { x: 0, y: 0 };
  const look = { dx: 0, dy: 0 };
  const lookOut = { dx: 0, dy: 0 };
  let wheel = 0;
  let gameplay = true;
  let locked = false;
  let lastLockReq = 0;
  let dropNext = 0;          // drop the first events after lock (Chrome sends a jump)
  let jumpAt = -1;           // performance.now() of the last unconsumed Space press
  const keyFns: ((code: string, e: KeyboardEvent) => boolean | void)[] = [];

  function recompute(): void {
    if (!gameplay || isTyping()) { move.x = 0; move.y = 0; return; }
    let x = 0, y = 0;
    for (const c of down) {
      if (FWD.has(c)) y += 1; else if (BACK.has(c)) y -= 1;
      else if (LEFT.has(c)) x -= 1; else if (RIGHT.has(c)) x += 1;
    }
    move.x = x > 1 ? 1 : x < -1 ? -1 : x;
    move.y = y > 1 ? 1 : y < -1 ? -1 : y;
  }

  function releaseAll(): void { down.clear(); move.x = 0; move.y = 0; jumpAt = -1; }

  function onKeyDown(e: KeyboardEvent): void {
    const code = e.code;
    const typing = isTyping(e.target instanceof Element ? e.target : document.activeElement);
    const chord = e.ctrlKey || e.metaKey || e.altKey;
    if (typing) {
      // fields own their keys; only Escape reaches the game (to blur / close)
      if (code === 'Escape') dispatch(code, e);
      return;
    }
    if (!gameplay) {
      if (MENU_KEYS.has(code) && !e.repeat) dispatch(code, e);
      return;
    }
    if (chord) { releaseAll(); return; }
    if (!down.has(code)) { down.add(code); recompute(); }
    if (PREVENT.has(code)) e.preventDefault();
    if (code === JUMP && !e.repeat) jumpAt = performance.now();
    if (!e.repeat) dispatch(code, e);
  }
  function onKeyUp(e: KeyboardEvent): void {
    if (down.delete(e.code)) recompute();
  }
  function dispatch(code: string, e: KeyboardEvent): void {
    for (let i = 0; i < keyFns.length; i++) {
      if (keyFns[i](code, e) === true) { e.preventDefault(); e.stopPropagation(); break; }
    }
  }

  function onMouseMove(e: MouseEvent): void {
    if (!locked || !gameplay) return;
    if (dropNext > 0) { dropNext--; return; }
    const dx = e.movementX, dy = e.movementY;
    if (dx > SPIKE || dx < -SPIKE || dy > SPIKE || dy < -SPIKE) return;
    look.dx += dx; look.dy += dy;
  }
  function onWheel(e: WheelEvent): void {
    if (!gameplay && !locked) {
      // menus: wheel over the 3D area still zooms the orbit camera only when it is aimed at the canvas
      if (e.target !== target) return;
    }
    if (isTyping()) return;
    // normalise lines/pages to "notches" of ~100 px
    const k = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 600 : 1;
    wheel += (e.deltaY * k) / 100;
    if (e.target === target) e.preventDefault();
  }
  function onLockChange(): void {
    locked = document.pointerLockElement === target;
    if (locked) dropNext = 2; else { look.dx = 0; look.dy = 0; }
  }
  function onLockError(): void { locked = false; }
  function onBlur(): void { releaseAll(); look.dx = 0; look.dy = 0; }
  function onFocusIn(): void { if (isTyping()) releaseAll(); }
  function onVis(): void { if (document.hidden) onBlur(); }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);
  target.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('pointerlockerror', onLockError);
  window.addEventListener('blur', onBlur);
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('visibilitychange', onVis);

  return {
    move,
    get run() { return gameplay && (down.has('ShiftLeft') || down.has('ShiftRight')) && !isTyping(); },
    get jump() { return gameplay && down.has(JUMP) && !isTyping(); },
    consumeJump() {
      if (jumpAt < 0) return false;
      const fresh = gameplay && performance.now() - jumpAt <= JUMP_STALE_MS;
      jumpAt = -1;
      return fresh;
    },
    consumeLook() {
      lookOut.dx = look.dx; lookOut.dy = look.dy;
      look.dx = 0; look.dy = 0;
      return lookOut;   // reused object: copy if you keep it
    },
    consumeWheel() { const w = wheel; wheel = 0; return w; },
    onKey(fn): Unsub {
      keyFns.push(fn);
      return () => { const i = keyFns.indexOf(fn); if (i >= 0) keyFns.splice(i, 1); };
    },
    lock() {
      if (locked) return;
      const now = performance.now();
      // Chrome refuses re-lock for ~1 s after the user left the lock with Esc
      if (now - lastLockReq < 250) return;
      lastLockReq = now;
      try {
        const r = (target as HTMLElement & { requestPointerLock(o?: { unadjustedMovement?: boolean }): Promise<void> | void })
          .requestPointerLock({ unadjustedMovement: true });
        if (r && typeof (r as Promise<void>).catch === 'function') {
          (r as Promise<void>).catch(() => {
            // raw input unsupported (or too early after Esc) → retry plain lock once
            try { const r2 = target.requestPointerLock() as unknown as Promise<void> | void; (r2 as Promise<void> | undefined)?.catch?.(() => { /* user gesture needed */ }); } catch { /* */ }
          });
        }
      } catch {
        try { target.requestPointerLock(); } catch { /* */ }
      }
    },
    unlock() { if (document.pointerLockElement === target) document.exitPointerLock(); locked = false; },
    get locked() { return locked; },
    setGameplay(on) {
      if (gameplay === on) return;
      gameplay = on;
      if (!on) { releaseAll(); look.dx = 0; look.dy = 0; } else recompute();
    },
    get gameplay() { return gameplay; },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('mousemove', onMouseMove);
      target.removeEventListener('wheel', onWheel);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('pointerlockerror', onLockError);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('visibilitychange', onVis);
      keyFns.length = 0;
      if (document.pointerLockElement === target) document.exitPointerLock();
    },
  };
}
