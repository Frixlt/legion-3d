/**
 * Modal helper for DOM cards / windows opened over the game (mine cards and journal, the shop buy card…): routes to
 * the input's modal stack (src/engine/input.ts pushModal / popModal) — while any modal is open gameplay is off, the
 * pointer is never grabbed, the «click to return» hint never shows and Esc closes the topmost modal. Inputs without a
 * modal stack (tests, old hosts) fall back to setGameplay + exitPointerLock.
 */
export interface ModalInput {
  setGameplay(on: boolean): void;
  unlock?(): void;
  pushModal?(id: string, close?: () => void): void;
  popModal?(id: string): void;
}

/** Open (`open` = true, with an optional close callback for Esc) or close the modal `id` on `input`. */
export function setModal(input: ModalInput | null | undefined, id: string, open: boolean, close?: () => void): void {
  if (!input) return;
  if (typeof input.pushModal === 'function' && typeof input.popModal === 'function') {
    if (open) input.pushModal(id, close); else input.popModal(id);
    return;
  }
  input.setGameplay(!open);
  if (open) {
    try { input.unlock?.(); } catch { /* */ }
    try { if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock(); } catch { /* */ }
  }
}
