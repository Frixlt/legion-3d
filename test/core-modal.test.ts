/**
 * Modal stack (src/engine/input.ts pushModal/popModal + src/core/modal.ts setModal): while a DOM card is open over the
 * game, gameplay stays off whatever else calls setGameplay(true), the pointer is never grabbed (so a click on the
 * card's «Назад» is a click, not a re-lock), and Esc (closeTopModal) closes the topmost card first.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

const listeners = new Map<string, Set<(e: any) => void>>();
const on = (k: string, f: (e: any) => void) => { if (!listeners.has(k)) listeners.set(k, new Set()); listeners.get(k)!.add(f); };
const off = (k: string, f: (e: any) => void) => { listeners.get(k)?.delete(f); };
const fire = (k: string, e: any) => { for (const f of listeners.get(k) ?? []) f(e); };

beforeAll(() => {
  (globalThis as any).Element = class {};
  (globalThis as any).window = Object.assign(globalThis as any, { addEventListener: (k: string, f: any) => on('w:' + k, f), removeEventListener: (k: string, f: any) => off('w:' + k, f) });
  (globalThis as any).document = {
    addEventListener: (k: string, f: any) => on('d:' + k, f), removeEventListener: (k: string, f: any) => off('d:' + k, f),
    pointerLockElement: null, exitPointerLock: vi.fn(), activeElement: null,
  };
});

function mkTarget() {
  return { addEventListener() {}, removeEventListener() {}, requestPointerLock: vi.fn(() => undefined) } as unknown as HTMLElement & { requestPointerLock: ReturnType<typeof vi.fn> };
}
const key = (code: string) => ({ code, key: code, target: null, repeat: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {}, stopPropagation() {} });

describe('input modal stack', () => {
  it('keeps gameplay off while any modal is open, whatever setGameplay says', async () => {
    const { createInput } = await import('../src/engine/input');
    const inp = createInput(mkTarget());
    expect(inp.gameplay).toBe(true);
    inp.pushModal('mine:card', () => {});
    expect(inp.gameplay).toBe(false);
    inp.setGameplay(true);            // e.g. the overlay watcher / chat blur / a closing menu
    expect(inp.gameplay).toBe(false);
    inp.pushModal('mine:journal');
    inp.popModal('mine:card');
    expect(inp.gameplay).toBe(false);
    inp.popModal('mine:journal');
    expect(inp.gameplay).toBe(true);
    inp.popModal('mine:journal');     // idempotent
    expect(inp.modals).toEqual([]);
    // a menu that turned gameplay off keeps it off after the modal goes
    inp.setGameplay(false); inp.pushModal('x'); inp.popModal('x');
    expect(inp.gameplay).toBe(false);
    inp.dispose();
  });

  it('never grabs the pointer while a modal is open (a click on the card is a click)', async () => {
    const { createInput } = await import('../src/engine/input');
    const t = mkTarget();
    const inp = createInput(t);
    inp.pushModal('room:card', () => {});
    inp.lock();
    expect(t.requestPointerLock).not.toHaveBeenCalled();
    inp.popModal('room:card');
    const now = vi.spyOn(performance, 'now').mockReturnValue(1e6);   // past the re-lock cooldown
    inp.lock();
    now.mockRestore();
    expect(t.requestPointerLock).toHaveBeenCalledTimes(1);
    inp.dispose();
  });

  it('Esc closes the topmost modal first and still reaches the integrator while gameplay is off', async () => {
    const { createInput } = await import('../src/engine/input');
    const inp = createInput(mkTarget());
    const closed: string[] = [];
    inp.pushModal('mine:journal', () => { closed.push('journal'); inp.popModal('mine:journal'); });
    inp.pushModal('mine:card', () => { closed.push('card'); });   // forgets to pop: closeTopModal pops it
    const seen: string[] = [];
    inp.onKey((code) => { seen.push(code); if (code === 'Escape') return inp.closeTopModal(); return false; });
    fire('w:keydown', key('KeyW'));
    expect(inp.move.y).toBe(0);
    fire('w:keydown', key('Escape'));
    expect(closed).toEqual(['card']);
    expect(inp.modals).toEqual(['mine:journal']);
    fire('w:keydown', key('Escape'));
    expect(closed).toEqual(['card', 'journal']);
    expect(inp.modals).toEqual([]);
    expect(inp.gameplay).toBe(true);
    expect(seen).toEqual(['Escape', 'Escape']);   // no game key (W) while the modals were open
    expect(inp.closeTopModal()).toBe(false);
    inp.dispose();
  });

  it('setModal falls back to setGameplay for inputs without a modal stack', async () => {
    const { setModal } = await import('../src/core/modal');
    const calls: boolean[] = [];
    const plain = { setGameplay: (on: boolean) => { calls.push(on); }, unlock: vi.fn() };
    setModal(plain, 'room:card', true); setModal(plain, 'room:card', false);
    expect(calls).toEqual([false, true]);
    expect(plain.unlock).toHaveBeenCalledTimes(1);
    const { createInput } = await import('../src/engine/input');
    const inp = createInput(mkTarget());
    setModal(inp, 'room:card', true, () => {});
    expect(inp.modals).toEqual(['room:card']);
    expect(inp.gameplay).toBe(false);
    setModal(inp, 'room:card', false);
    expect(inp.gameplay).toBe(true);
    inp.dispose();
  });
});
