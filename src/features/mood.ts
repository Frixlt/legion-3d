/**
 * «Настроение реплики» (IDEAS #1): a short public chat line with a clear mood («ура!», «😹», «?», «!!!», «хаха»…)
 * changes the speaker's face and the look of their bubble for ~2 s; a laugh adds a little laugh pose.
 * Only lines that got a public bubble over their author (src/net bubbleFor: no DMs, no «Достижения», no ignored
 * players, not without the hero's chat flag) and only fresh ones; deduped by message id, rate-limited per speaker and
 * overall. Text is never changed. Setting: Настройки → Забавы → «Настроение реплик».
 */
import type { ChatMsg, Walker } from '../contracts';
import type { AvatarSocial } from '../avatar/avatar';
import type { Avatar } from '../contracts/modules';
import { moodFor, RateGate, SeenIds, MOOD_SEC, type Mood } from '../social/mood';
import { funToggle } from '../social/toggle';
import { coreFeature } from './types';

const KEY = 'l3d.fun.mood';

export default coreFeature({
  id: 'mood',
  order: 31,   // after the labels feature (30) — runs from store events, not per frame
  setup(ctx) {
    const { store, labels } = ctx;
    const tg = funToggle(KEY, 'Настроение реплик', 'Мордочка и пузырь на 2 с меняются от «ура!», «хаха», «?», смайликов. Только общий чат', 20);
    const seen = new SeenIds(600);
    const gate = new RateGate(4, 6, 10);
    for (const m of store.chat) seen.add(m.id);   // history never plays
    const avatars = () => ctx.dev.avatars as Map<string, { av: Avatar }> | undefined;
    const ragdolled = (id: string) => !!(ctx.dev.combat as { ragdolls?: Map<string, unknown> } | undefined)?.ragdolls?.has(id);

    const walkerOf = (login: string): Walker | undefined => {
      if (login.toLowerCase() === ctx.me.login.toLowerCase()) return store.me ?? undefined;
      return store.walkers.get(login) ?? store.walkers.get(login.toLowerCase());
    };
    /** Show a mood over `login` now (also the dev hook). */
    const show = (login: string, mood: Mood) => {
      const own = login.toLowerCase() === ctx.me.login.toLowerCase();
      const w = walkerOf(login);
      const key = own ? ctx.me.login : (w?.login ?? login);
      const av = (own ? ctx.meAv : avatars()?.get(key)?.av) as (Avatar & Partial<AvatarSocial>) | undefined;
      labels.bubbleStyle(key, mood, MOOD_SEC * 1000);
      if (!av || ragdolled(key)) return;
      av.setMood?.(mood, MOOD_SEC);
      if (mood === 'laugh') av.play('laugh');
    };
    const consider = (m: ChatMsg) => {
      if (!tg.on || Date.now() - m.at > 60000) return;
      const mood = moodFor(m);
      if (!mood) return;
      const w = walkerOf(m.login);
      if (!w || w.bubble?.id !== m.id) return;   // no public bubble for it → not ours to decorate
      if (!gate.take(m.login.toLowerCase(), performance.now() / 1000)) return;
      show(m.login, mood);
    };
    let queued = false;
    const scan = () => {
      queued = false;
      const list = store.chat;
      // only the tail can be new (sorted by time); stop at the first id already seen after a few
      let old = 0;
      for (let i = list.length - 1; i >= 0 && old < 8; i--) {
        const m = list[i];
        if (!seen.add(m.id)) { old++; continue; }
        consider(m);
      }
    };
    // the site adapter sets the bubbles right after pushing the chat → look once the batch is done
    const offChat = store.on('chat', () => { if (!queued) { queued = true; queueMicrotask(scan); } });
    ctx.dev.mood = { show, scan };
    return () => { offChat(); tg.dispose(); delete ctx.dev.mood; };
  },
});
