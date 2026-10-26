/**
 * Labels: nameplates and chat bubbles over heads. Bubbles follow store walkers' `bubble` (setting 'l3d.bubbles');
 * in a 3D room only the own plate/bubble is drawn (others are on the street).
 */
import type { Walker } from '../contracts';
import { SET } from '../core/settings';
import { coreFeature } from './types';

export default coreFeature({
  id: 'labels',
  order: 30,
  setup(ctx) {
    const { labels, store, anchors, engine } = ctx;
    const bubbleIds = new Map<string, string>();
    const bubble = (w: Walker) => {
      const b = w.bubble;
      if (b && SET.bubbles && bubbleIds.get(w.login) !== b.id) { bubbleIds.set(w.login, b.id); labels.bubble(w.login, b.text, Math.max(500, b.until - Date.now())); }
    };
    const offW = store.on('walkers', () => { for (const l of bubbleIds.keys()) if (!store.walkers.has(l) && l !== ctx.me.login) bubbleIds.delete(l); });
    const offF = ctx.onFrame((dt) => {
      labels.root.visible = SET.names !== 'off';
      if (store.me) bubble(store.me);
      if (!ctx.state.inRoom) for (const w of store.walkers.values()) if (w.bubble) bubble(w);
      labels.update(anchors, engine.camera, dt);
    });
    return () => { offW(); offF(); };
  },
});
