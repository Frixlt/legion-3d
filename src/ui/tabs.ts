/**
 * Menu tab registry. Every tab of the Character/World ribbon (and every 'system' page a feature adds) is an entry here;
 * the built-in pages are entries too, rendered by Menus. Features add/remove tabs at runtime with `ui.addTab(id, def)`
 * / `ui.removeTab(id)` (contract MenuTabDef, src/contracts/ext.ts). Pure (no DOM) — unit-tested in test/ui-tabs.test.ts.
 *
 * Groups: 'char' (Герой) and 'world' (Мир) show in the ribbon; 'system' pages are reachable by ui.open(id), their
 * hotkey and an entry in the Pause menu.
 */
import type { MenuTabDef } from '../contracts/ext';
import type { Hero } from '../contracts';

export type TabGroup = 'char' | 'world' | 'system';
export interface TabEntry {
  id: string;
  name: string;
  group: TabGroup;
  /** KeyboardEvent.code of the hotkey ('' = none). */
  code: string;
  /** Label for the hotkey badge ('C', '1', 'F4'…). */
  key: string;
  orbit: boolean;
  order: number;
  /** Built-in page (rendered by Menus) when def is absent. */
  def?: MenuTabDef;
  /** Hidden for this hero (e.g. achievements before they unlock). */
  visible?: (h: Hero | null) => boolean;
}

/** KeyboardEvent.code → short label. */
export function keyLabel(code: string | undefined): string {
  if (!code) return '';
  let m = /^Key([A-Z])$/.exec(code); if (m) return m[1];
  m = /^(?:Digit|Numpad)(\d)$/.exec(code); if (m) return m[1];
  if (/^F\d{1,2}$/.test(code)) return code;
  const N: Record<string, string> = { Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Backslash: '\\' };
  return N[code] || code;
}

const groupOf = (g: MenuTabDef['group']): TabGroup => (g === 'character' ? 'char' : g === 'world' ? 'world' : 'system');

/** Built-in tabs (order in steps of 10 so features can slot in between). */
export function builtinTabs(): TabEntry[] {
  const t = (id: string, name: string, code: string, group: TabGroup, order: number, orbit = false, visible?: TabEntry['visible']): TabEntry =>
    ({ id, name, group, code, key: keyLabel(code), orbit, order, visible });
  return [
    t('gear', 'Снаряжение', 'KeyC', 'char', 10, true),
    t('bag', 'Сумка', 'KeyI', 'char', 20, true),
    t('stats', 'Характеристики', 'KeyP', 'char', 30),
    t('skills', 'Навыки', 'KeyK', 'char', 40, false, (H) => !H || !!H.sk),
    t('ach', 'Достижения', 'KeyY', 'char', 50, false, (H) => !!(H && H.ac)),
    t('log', 'Журнал', 'KeyJ', 'char', 60),
    t('look', 'Облик', 'KeyO', 'char', 70, true),
    t('legion', 'Рейтинг', 'KeyR', 'world', 110),
    t('news', 'Новости', 'KeyN', 'world', 120),
    t('map', 'Карта', 'KeyM', 'world', 130),
  ];
}
/** Extra hotkeys of built-in tabs (B = bag, like the site's «Сумка»). */
export const EXTRA_KEYS: Record<string, string> = { KeyB: 'bag' };
/** Keys a feature tab must not take (movement, camera, chat, interact and the menu's own navigation). */
export const RESERVED_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyV', 'KeyE', 'KeyQ', 'KeyT', 'KeyH', 'Space', 'ShiftLeft', 'ShiftRight', 'Enter', 'Escape', 'Tab', 'Slash', 'F1', 'F2', 'F3', 'F8', 'BracketLeft', 'BracketRight']);

export class TabRegistry {
  private map = new Map<string, TabEntry>();
  private builtin = new Map<string, TabEntry>();
  private subs = new Set<() => void>();
  constructor(entries: TabEntry[] = builtinTabs()) { for (const e of entries) { this.map.set(e.id, e); this.builtin.set(e.id, e); } }

  /**
   * Add (or replace) a tab. Replacing a built-in id swaps its page for the feature's; removeTab() restores it.
   * A hotkey that is reserved or already taken by another tab is dropped (with a console warning).
   */
  add(id: string, def: MenuTabDef): () => void {
    const prev = this.map.get(id);
    let code = def.hotkey || '';
    if (code && (RESERVED_KEYS.has(code) || (this.byCode(code) && this.byCode(code)!.id !== id))) {
      console.warn('[legion-3d] ui.addTab: hotkey taken or reserved, ignored', id, code);
      code = '';
    }
    if (!code && prev && !def.hotkey) code = prev.code;
    const e: TabEntry = {
      id, name: def.title, group: groupOf(def.group), code, key: keyLabel(code), orbit: !!def.orbit,
      order: def.order ?? (prev ? prev.order : this.maxOrder(groupOf(def.group)) + 10), def,
    };
    this.map.set(id, e);
    this.emit();
    return () => { if (this.map.get(id) === e) this.remove(id); };
  }
  remove(id: string): boolean {
    const cur = this.map.get(id); if (!cur) return false;
    const b = this.builtin.get(id);
    if (b && cur !== b) this.map.set(id, b); else if (b) this.map.delete(id); else this.map.delete(id);
    this.emit();
    return true;
  }
  get(id: string): TabEntry | undefined { return this.map.get(id); }
  has(id: string): boolean { return this.map.has(id); }
  /** Tabs of the ribbon (char + world) visible for this hero, sorted by group then order. */
  ribbon(H: Hero | null): TabEntry[] { return this.all().filter((t) => t.group !== 'system' && (!t.visible || t.visible(H))); }
  /** Feature 'system' pages (for the Pause menu). */
  system(): TabEntry[] { return this.all().filter((t) => t.group === 'system'); }
  all(): TabEntry[] {
    const G: Record<TabGroup, number> = { char: 0, world: 1, system: 2 };
    return Array.from(this.map.values()).sort((a, b) => G[a.group] - G[b.group] || a.order - b.order || (a.id < b.id ? -1 : 1));
  }
  byCode(code: string): TabEntry | undefined {
    for (const t of this.map.values()) if (t.code === code) return t;
    const x = EXTRA_KEYS[code]; return x ? this.map.get(x) : undefined;
  }
  onChange(fn: () => void): () => void { this.subs.add(fn); return () => this.subs.delete(fn); }
  private maxOrder(g: TabGroup) { let m = 0; for (const t of this.map.values()) if (t.group === g) m = Math.max(m, t.order); return m; }
  private emit() { for (const f of this.subs) { try { f(); } catch (e) { console.warn('[legion-3d] tabs onChange', e); } } }
}
