/** Expedition HUD (party, phase, what to type, vote/act buttons) — src/quest. */
import { mountQuestHud } from '../quest';
import { coreFeature } from './types';

export default coreFeature({
  id: 'quest',
  order: 80,
  setup(ctx) {
    const qhud = mountQuestHud(ctx.uiRoot, { store: ctx.store, actions: ctx.actions, toast: (t, bad) => ctx.ui.toast(t, bad) });
    ctx.dev.qhud = qhud;
    return () => qhud.dispose();
  },
});
