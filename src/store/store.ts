/** Reactive game state. Readers get plain objects; writers use the returned mutators (net layer only). */
import type { Store, Hero, Walker, ChatMsg, QuestView, CityLayout, Unsub } from '../contracts';

type Ev = 'hero' | 'walkers' | 'chat' | 'quest' | 'layout' | 'online';
const CHAT_MAX = 200;

export interface StoreWriter extends Store {
  setHero(h: Hero | null): void;
  setMe(w: Walker | null): void;
  upsertWalker(w: Walker): void;
  removeWalker(login: string): void;
  clearWalkers(): void;
  /** Walkers mutated in place (positions) — no event needed per frame. */
  pushChat(list: ChatMsg[]): ChatMsg[];   // returns the ones that were new
  deleteChat(ids: string[]): void;
  setOnline(n: number): void;
  setQuest(q: QuestView | null): void;
  setLayout(l: CityLayout | null): void;
  emit(ev: Ev): void;
}

export function createStore(): StoreWriter {
  const subs = new Map<Ev, Set<() => void>>();
  const pending = new Set<Ev>();
  let flushing = false;
  const walkers = new Map<string, Walker>();
  let chat: ChatMsg[] = [];
  const chatIds = new Set<string>();
  const st = {
    hero: null as Hero | null, me: null as Walker | null, online: 0,
    quest: null as QuestView | null, layout: null as CityLayout | null,
  };
  const flush = () => {
    flushing = false;
    const evs = [...pending]; pending.clear();
    for (const ev of evs) for (const fn of subs.get(ev) || []) { try { fn(); } catch (e) { console.warn('[legion-3d] store listener', ev, e); } }
  };
  const emit = (ev: Ev) => { pending.add(ev); if (!flushing) { flushing = true; queueMicrotask(flush); } };

  const S: StoreWriter = {
    get hero() { return st.hero; },
    get me() { return st.me; },
    get walkers() { return walkers; },
    get chat() { return chat; },
    get online() { return st.online; },
    get quest() { return st.quest; },
    get layout() { return st.layout; },
    on(ev: Ev, fn: () => void): Unsub {
      let s = subs.get(ev); if (!s) subs.set(ev, (s = new Set()));
      s.add(fn); return () => { s!.delete(fn); };
    },
    setHero(h) { st.hero = h; emit('hero'); },
    setMe(w) { st.me = w; emit('walkers'); },
    upsertWalker(w) { walkers.set(w.login, w); emit('walkers'); },
    removeWalker(l) { if (walkers.delete(l)) emit('walkers'); },
    clearWalkers() { if (walkers.size) { walkers.clear(); emit('walkers'); } },
    pushChat(list) {
      const fresh: ChatMsg[] = [];
      for (const m of list) { if (!m || chatIds.has(m.id)) continue; chatIds.add(m.id); chat.push(m); fresh.push(m); }
      if (fresh.length) {
        chat.sort((a, b) => a.at - b.at);
        if (chat.length > CHAT_MAX) { for (const m of chat.splice(0, chat.length - CHAT_MAX)) chatIds.delete(m.id); }
        chat = chat.slice();
        emit('chat');
      }
      return fresh;
    },
    deleteChat(ids) {
      const set = new Set(ids); const n = chat.length;
      chat = chat.filter((m) => !set.has(m.id));
      for (const id of ids) chatIds.delete(id);
      if (chat.length !== n) emit('chat');
    },
    setOnline(n) { if (st.online !== n) { st.online = n; emit('online'); } },
    setQuest(q) { st.quest = q; emit('quest'); },
    setLayout(l) { st.layout = l; emit('layout'); },
    emit,
  };
  return S;
}
