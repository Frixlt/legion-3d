import { describe, it, expect, vi } from 'vitest';
import { TabRegistry, keyLabel } from '../src/ui/tabs';
import type { MenuTabDef } from '../src/contracts/ext';

const def = (o: Partial<MenuTabDef> = {}): MenuTabDef => ({ title: 'Задания', group: 'world', render: () => {}, ...o });

describe('menu tab registry (ui.addTab / ui.removeTab)', () => {
  it('built-ins keep their order and hotkeys', () => {
    const r = new TabRegistry();
    expect(r.ribbon({ ac: {}, sk: {} } as any).map((t) => t.id)).toEqual(['gear', 'bag', 'stats', 'skills', 'ach', 'log', 'look', 'legion', 'news', 'map']);
    expect(r.byCode('KeyM')!.id).toBe('map');
    expect(r.byCode('KeyB')!.id).toBe('bag');
    expect(r.get('gear')!.orbit).toBe(true);
  });
  it('hides achievements until the hero has them', () => {
    const r = new TabRegistry();
    expect(r.ribbon({ sk: {} } as any).some((t) => t.id === 'ach')).toBe(false);
  });
  it('adds a feature tab by order and removes it again', () => {
    const r = new TabRegistry(); const fn = vi.fn(); r.onChange(fn);
    const off = r.add('quests', def({ hotkey: 'KeyG', order: 125 }));
    const ids = r.ribbon({ ac: {}, sk: {} } as any).map((t) => t.id);
    expect(ids.slice(-3)).toEqual(['news', 'quests', 'map']);
    expect(r.byCode('KeyG')!.id).toBe('quests');
    expect(r.get('quests')!.key).toBe('G');
    off();
    expect(r.has('quests')).toBe(false);
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it('appends without order; character group maps to the Герой ribbon', () => {
    const r = new TabRegistry();
    r.add('pets', def({ group: 'character', title: 'Питомцы' }));
    const ch = r.ribbon(null).filter((t) => t.group === 'char').map((t) => t.id);
    expect(ch[ch.length - 1]).toBe('pets');
  });
  it('drops taken or reserved hotkeys', () => {
    const r = new TabRegistry();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    r.add('a', def({ hotkey: 'KeyM' })); r.add('b', def({ hotkey: 'KeyW' }));
    expect(r.get('a')!.code).toBe(''); expect(r.get('b')!.code).toBe('');
    expect(r.byCode('KeyM')!.id).toBe('map');
    warn.mockRestore();
  });
  it('replacing a built-in swaps its page; removeTab restores the built-in', () => {
    const r = new TabRegistry();
    r.add('map', def({ title: 'Новая карта' }));
    expect(r.get('map')!.def).toBeTruthy();
    expect(r.get('map')!.code).toBe('KeyM');
    r.remove('map');
    expect(r.get('map')!.def).toBeUndefined();
    expect(r.get('map')!.name).toBe('Карта');
  });
  it('system pages are not in the ribbon', () => {
    const r = new TabRegistry();
    r.add('debug', def({ group: 'system', title: 'Отладка', hotkey: 'F4' }));
    expect(r.ribbon(null).some((t) => t.id === 'debug')).toBe(false);
    expect(r.system().map((t) => t.id)).toEqual(['debug']);
    expect(keyLabel('F4')).toBe('F4'); expect(keyLabel('Digit3')).toBe('3');
  });
});
