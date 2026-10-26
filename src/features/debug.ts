/**
 * Debug: F3 also lists drift (site ids we do not support yet, see src/core/drift.ts) in a small panel at the
 * top-left, next to the UI's frame counter. Hidden when there is nothing to show.
 */
import { driftList } from '../core/drift';
import { coreFeature } from './types';

export default coreFeature({
  id: 'debug',
  order: 90,
  setup(ctx) {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:12px;top:64px;z-index:116;max-width:360px;max-height:40vh;overflow:auto;padding:8px 10px;border-radius:10px;'
      + "background:rgba(13,11,34,.82);color:#d8d0f5;font:12px/1.35 ui-monospace,Consolas,monospace;pointer-events:auto;white-space:pre-wrap";
    el.hidden = true;
    ctx.uiRoot.appendChild(el);
    let on = false;
    const render = () => {
      const l = driftList();
      el.hidden = !on || l.length === 0;
      if (el.hidden) return;
      el.textContent = `Не поддерживается (${l.length}):\n` + l.map((d) => `· ${d.kind}: ${d.id}`).join('\n');
    };
    const offK = ctx.registries.keys.register('debug.drift', {
      code: 'F3', label: 'Отладка', when: 'always',
      run: () => { on = !on; render(); return false; },   // false: the UI toggles its frame counter too
    });
    window.addEventListener('l3d:drift', render);
    return () => { offK(); window.removeEventListener('l3d:drift', render); el.remove(); };
  },
});
