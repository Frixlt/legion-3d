/**
 * Menus: registries.menus → UI tabs. A module adds a menu page with
 *   ctx.registries.menus.register('pets', { title: 'Питомцы', group: 'character', hotkey: 'KeyU', render(el, ctx) { … } })
 * and it appears in the ribbon (ui.addTab); unregistering removes it (a replaced built-in page comes back).
 */
import type { MenuTabDef } from '../contracts/ext';
import { coreFeature } from './types';

export default coreFeature({
  id: 'menus',
  order: 5,
  setup(ctx) {
    const reg = ctx.registries.menus;
    const added = new Map<string, { def: MenuTabDef; off: () => void }>();
    const sync = () => {
      const ids = new Set(reg.ids());
      for (const [id, a] of added) if (!ids.has(id) || reg.get(id) !== a.def) { a.off(); added.delete(id); }
      for (const id of ids) {
        if (added.has(id)) continue;
        const def = reg.get(id)!;
        try { added.set(id, { def, off: ctx.uiApi.addTab(id, def) }); } catch (e) { console.error('[l3d] menu tab', id, e); }
      }
    };
    sync();
    const off = reg.onChange(sync);
    return () => { off(); for (const a of added.values()) a.off(); added.clear(); };
  },
});
