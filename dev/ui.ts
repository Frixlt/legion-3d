/**
 * Dev page for src/ui: mounts the game UI over a static background with a fake Store (test/fixtures/me.json),
 * fake chat traffic, fake Actions (equip/unequip/use applied locally after 300 ms) and a fake Input with real key listeners.
 * Exposes window.__ui (the Ui) and window.__dev (helpers) for screenshots.
 */
import type { Store, Actions, Hero, ChatMsg, Walker, ApiResult, Unsub, CameraMode, QualityLevel, Item } from '../src/contracts';
import type { Input, UiHost } from '../src/contracts/modules';
import { mountUi, type GameUi } from '../src/ui';
import { fixtureLayout } from './fixtures';
import me from '../test/fixtures/me.json';

// Dev stand-in for the site's style parts (cats style): stat labels + coin words/art, like MDDoodle.part() on the site.
if (!new URLSearchParams(location.search).has('nostyle')) (window as any).MDDoodle = {
  part(n: string) {
    if (n === 'hero') return { stats: { hp: { label: '💗 Мур-ХП' }, def: { label: '🧶 Пушистость' }, atk: { label: '🐾 Царапки' }, mag: { label: '✨ Мяу-магия' } } };
    if (n === 'coins') return { b: { forms: ['чешуйка', 'чешуйки', 'чешуек'] }, s: { forms: ['серебряная рыбка', 'серебряные рыбки', 'серебряных рыбок'] }, g: { forms: ['золотая рыбка', 'золотые рыбки', 'золотых рыбок'] } };
    return null;
  },
};

type Ev = 'hero' | 'walkers' | 'chat' | 'quest' | 'layout' | 'online';
const subs = new Map<Ev, Set<() => void>>();
const emit = (ev: Ev) => { for (const f of subs.get(ev) || []) f(); };
const hero: Hero = JSON.parse(JSON.stringify((me as any).hero));
(hero as any).sg = { cap: 40, used: hero.items.filter((x) => !x.on).length };
(hero as any).ac = { n: 23, t: 120 };
let chat: ChatMsg[] = [];
let online = 37;
const layout = fixtureLayout();
const meW: Walker = { login: hero.login, app: {} as any, x: 2382, y: 1000, face: 0, speed: 0, alpha: 1, me: true };
// a few other players for the map / minimap
const walkers = new Map<string, Walker>();
for (let i = 0; i < 24; i++) {
  const [x, y] = layout.nearest(200 + ((i * 1777) % 5100), 820 + ((i * 397) % 1060));
  walkers.set('w' + i, { login: 'w' + i, app: {} as any, x, y, face: 0, speed: 0, alpha: 1 });
}

const store: Store = {
  get hero() { return hero; }, get me() { return meW; }, walkers, get chat() { return chat; }, get online() { return online; },
  quest: null, layout,
  on(ev: Ev, fn: () => void): Unsub { let s = subs.get(ev); if (!s) subs.set(ev, (s = new Set())); s.add(fn); return () => s!.delete(fn); },
};

const later = <T>(v: T, ms = 300) => new Promise<T>((r) => setTimeout(() => r(v), ms));
function recalcGear() {
  const g: any = {};
  const k: Record<string, [string, string]> = { weapon: ['w', 'weapon'], shield: ['s', 'shield'], armor: ['a', 'armor'], helmet: ['h', 'hat'], trinket: ['t', 'charm'] };
  for (const it of hero.items) if (it.on && k[it.slot as string]) { const [a, lk] = k[it.slot as string]; g[a] = (it.look as any)?.[lk] || it.id; g[a + 'r'] = it.rarity; }
  hero.gear = g;
  (hero as any).sg.used = hero.items.filter((x) => !x.on).length;
  // recompute stats roughly: base + worn
  const base = { hp: 45, atk: 3, mag: 3, def: 1 } as Record<string, number>;
  for (const it of hero.items) if (it.on) for (const [s, v] of Object.entries(it.stats)) if (s in base) base[s] += v;
  Object.assign(hero.stats, base); hero.hpNow = Math.min(hero.hpNow, hero.stats.hp);
}
const JOURNAL = (() => {
  const now = Date.now(), H = 3600e3;
  const rows: [number, string, string, string?, number?, number?][] = [
    [0.1, 'fight', 'Победа над стаей крыс у Старой мельницы', 'win', 12, 8], [0.4, 'loot', 'Нашёл: Бубенчик стрелка'], [0.9, 'shop', 'Купил «Сыр с дырками» в Лавке', 'win', -35],
    [1.6, 'fight', 'Поражение в бою с Пыльным големом', 'lose', 0, 3], [2.2, 'coins', 'Награда за поход', undefined, 140], [3.5, 'ench', 'Заточка «Рогатка из вилки» до +2', 'win', -120],
    [5, 'dice', 'Кости со Звездочётом', 'lose', -20], [7, 'hero', 'Новый уровень: 6'], [26, 'fight', 'Победа над волками', 'win', 12, 8], [27, 'trap', 'Ловушка с иглами', 'lose', 0, 2],
    [29, 'ach', 'Достижение: «Первая кровь»', 'win'], [30, 'find', 'Нашёл: Счастливая звезда'], [52, 'event', 'Помог путнику', 'win', 30, 5], [55, 'fight', 'Победа над Болотной жабой', 'win', 25, 12],
  ];
  return rows.map(([h, k, t, r, c, x], i) => ({ id: 'j' + i, at: now - h * H, k, t, r, c, x }));
})();

const actions: Actions = {
  async equip(uid) {
    const it = hero.items.find((x) => x.uid === uid);
    if (!it || !it.wearable) return later({ ok: false, error: 'Эту вещь нельзя надеть' });
    if (hero.busy) return later({ ok: false, error: 'Идёт бой на стриме' });
    for (const o of hero.items) if (o.on && o.slot === it.slot) { o.on = false; o.no = 99; }
    it.on = true; delete (it as any).no; recalcGear();
    await later(0); emit('hero'); return { ok: true, hero };
  },
  async unequip(slot) {
    const it = hero.items.find((x) => x.on && x.slot === slot);
    if (!it) return later({ ok: false, error: 'Слот пуст' });
    it.on = false; it.no = 98; recalcGear();
    await later(0); emit('hero'); return { ok: true, hero };
  },
  async use(uid) {
    const i = hero.items.findIndex((x) => x.uid === uid);
    if (i < 0) return later({ ok: false, error: 'Нет такой вещи' });
    const it = hero.items[i] as Item;
    hero.items.splice(i, 1); hero.hpNow = Math.min(hero.stats.hp, hero.hpNow + (((it.effect as any)?.heal) || 0));
    (hero as any).eatUntil = Date.now() + 180000; recalcGear();
    await later(0); emit('hero'); ui.toast(`Съедено: ${it.name}`); return { ok: true, hero };
  },
  async wear() { return later({ ok: true }); },
  async say(text, opts) {
    if (/ошибка/i.test(text)) return later({ ok: false, error: 'Слишком часто — подожди пару секунд' });
    pushChat({ id: 'm' + Date.now(), login: hero.login, name: hero.name, text, at: Date.now(), kind: opts?.k === 'tr' ? 'tr' : 'g', role: hero.role });
    return later({ ok: true });
  },
  async get<T>(path: string): Promise<T> {
    if (path.startsWith('/api/journal')) {
      const tab = /tab=(\w+)/.exec(path)?.[1] || 'all';
      const G: Record<string, string[]> = { fight: ['fight', 'boss', 'trap', 'hero'], shop: ['shop', 'look', 'ench', 'auc', 'store', 'trade'], find: ['loot', 'find'], coins: ['coins', 'dice', 'event'], ach: ['ach'] };
      const list = tab === 'all' ? JOURNAL : JOURNAL.filter((e) => G[tab]?.includes(e.k));
      return later({ ok: true, list, next: null } as any, 500);
    }
    if (path === '/api/legion') return later({ ok: true, total: { heroes: 16753, avgLevel: 4.2, ghosts: 312 }, groups: [{ id: 'phys', name: 'Бойцы', n: 9800 }, { id: 'mage', name: 'Маги', n: 3900 }, { id: 'heal', name: 'Лекари', n: 2100 }, { id: 'recruit', name: 'Новобранцы', n: 953 }], top: Array.from({ length: 8 }, (_, i) => ({ name: 'player' + (i + 2), level: 40 - i * 3, role: ['legionary', 'mage', 'archer', 'priest'][i % 4] })) } as any);
    if (path === '/api/news') return later({ ok: true, list: [{ title: 'Открылась Мурчародейня', at: Date.now() - 864e5 }, { title: 'Заточка до +15', at: Date.now() - 3 * 864e5 }, { title: 'Новые острова в Походе', at: Date.now() - 6 * 864e5 }] } as any);
    return later({ ok: false } as any);
  },
  async post<T>(path: string): Promise<T> {
    if (path === '/api/stSort') { hero.items.sort((a, b) => String(a.slot).localeCompare(String(b.slot))); emit('hero'); }
    return later({ ok: true } as any);
  },
  openBuilding(id) { ui.toast('openBuilding: ' + id); },
  openSitePanel(tab) { ui.toast('Классический вид: ' + tab); },
};

// ------------------------------------------------------------ fake Input (real keyboard)
const keyFns = new Set<(code: string, e: KeyboardEvent) => boolean | void>();
let gameplay = true; let locked = false;
const input: Input = {
  move: { x: 0, y: 0 }, run: false,
  consumeLook: () => ({ dx: 0, dy: 0 }), consumeWheel: () => 0,
  onKey(fn) { keyFns.add(fn); return () => keyFns.delete(fn); },
  lock() { locked = true; }, unlock() { locked = false; },
  get locked() { return locked; },
  setGameplay(on) { gameplay = on; log('setGameplay', on); },
  get gameplay() { return gameplay; },
  dispose() {},
};
window.addEventListener('keydown', (e) => {
  const a = document.activeElement as HTMLElement | null;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
  if (!gameplay && e.code !== 'Escape' && e.code !== 'Enter') return;
  for (const f of keyFns) if (f(e.code, e)) break;
});

let cam: CameraMode = 'fp';
let yaw = 0;
const doors = layout.buildings;
const host: UiHost & { yaw(): number; menuChanged(id: string | null): void; pauseOnUnlock: boolean; walkTo(x: number, y: number): void; mapImage?: typeof fakeMapImage } = {
  store, actions, input,
  onMenu: () => () => {},
  setCameraMode(m) { cam = m; }, getCameraMode: () => cam,
  setQuality(q: QualityLevel | 'auto') { log('quality', q); },
  exitToClassic() { ui.toast('exitToClassic()'); },
  focusTarget() { const b = doors.find((d) => d.id === 'forge')!; return Math.abs(Math.sin(yaw)) < 0.3 ? { id: b.id, title: b.title, icon: b.icon } : null; },
  stats: () => ({ fps: 58 + Math.random() * 3, ms: 7.2, calls: 312, tris: 184000, scale: 1 } as any),
  yaw: () => yaw,
  menuChanged(id) { log('menuChanged', id); },
  pauseOnUnlock: false,
  // map extras: walkTo teleports the fake player (main wires player.walkTo); ?mapimg=1 fakes world.mapImage with a gradient
  walkTo(x: number, y: number) { log('walkTo', x, y); meW.x = x; meW.y = y; },
  ...(new URLSearchParams(location.search).has('mapimg') ? { mapImage: fakeMapImage } : {}),
};
async function fakeMapImage() {
  const cv = document.createElement('canvas'); cv.width = 1100; cv.height = 600;
  const g = cv.getContext('2d')!; const gr = g.createLinearGradient(0, 0, 1100, 600); gr.addColorStop(0, '#355'); gr.addColorStop(1, '#533'); g.fillStyle = gr; g.fillRect(0, 0, 1100, 600);
  g.fillStyle = '#fff'; g.font = '40px sans-serif'; g.fillText('host mapImage', 400, 300);
  return { url: cv.toDataURL(), width: 1100, height: 600, x0: 0, z0: -5, x1: 55, z1: 23 };
}
function log(...a: unknown[]) { console.log('[dev-ui]', ...a); }

const ui = mountUi(document.getElementById('game')!, host) as GameUi;
(window as any).__ui = ui;
window.addEventListener('l3d:menu', (e) => log('l3d:menu', (e as CustomEvent).detail));

function pushChat(m: ChatMsg) { chat = chat.concat(m).slice(-200); emit('chat'); }
const NAMES: [string, string][] = [['player2', 'legionary'], ['player3', 'mage'], ['player4', 'priest'], ['player5', 'archer'], ['player6', 'rogue']];
const LINES = ['всем мур!', 'кто в поход вечером?', 'продам Сыр с дырками за 30 чешуек', 'у кузни очередь опять', 'ура, заточил до +5!', 'где найти Лавку звездочёта?', 'го на шахту', 'спасибо за помощь в бою 🐾'];
let ci = 0;
const now0 = Date.now();
for (let i = 0; i < 6; i++) { const [l, r] = NAMES[i % NAMES.length]; chat.push({ id: 'c' + i, login: l, name: l[0].toUpperCase() + l.slice(1), text: LINES[i], at: now0 - (6 - i) * 2000, kind: i === 2 ? 'tr' : 'g', role: r }); }
chat.push({ id: 'sys1', login: '', name: '', text: 'Стример запустил Поход через 5 минут', at: now0, kind: 'ev' });
emit('chat');
setInterval(() => {
  const [l, r] = NAMES[ci % NAMES.length]; ci++;
  pushChat({ id: 'c' + Date.now(), login: l, name: l[0].toUpperCase() + l.slice(1), text: LINES[ci % LINES.length], at: Date.now(), kind: ci % 5 === 0 ? 'tr' : ci % 7 === 0 ? 'dm' : 'g', role: r, to: ci % 7 === 0 ? hero.name : undefined });
  online = 30 + Math.floor(Math.random() * 15); emit('online');
}, 4000);

let last = performance.now();
const frame = (t: number) => { const dt = Math.min(0.1, (t - last) / 1000); last = t; yaw += dt * 0.15; ui.update(dt); requestAnimationFrame(frame); };
requestAnimationFrame(frame);

(window as any).__dev = {
  hero, emit, setYaw: (y: number) => { yaw = y; }, setCam: (m: CameraMode) => { cam = m; },
  damage: (n: number) => { hero.hpNow = Math.max(0, hero.hpNow - n); emit('hero'); },
  money: (d: number) => { hero.money += d; emit('hero'); },
  tip: (sel: string) => { const root = (ui.el.shadowRoot as ShadowRoot); const el = root.querySelector(sel) as HTMLElement; el?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return !!el; },
  click: (sel: string) => { const el = (ui.el.shadowRoot as ShadowRoot).querySelector(sel) as HTMLElement; el?.click(); return !!el; },
  focusChat: () => ui.focusChat(),
  prompt: (t: string | null) => ui.prompt(t),
  // feature tab demo: __dev.demoTab() adds «Задания» to the World group (hotkey G), __dev.demoTab(false) removes it
  demoTab(on = true) {
    if (!on) return ui.removeTab('quests');
    return ui.addTab('quests', { title: 'Задания', group: 'world', hotkey: 'KeyG', order: 125,
      render(el) { el.innerHTML = '<p style="margin:0;font-weight:700">Вкладка из фичи: ui.addTab()</p>'; const t = setInterval(() => { el.dataset.t = String(Date.now()); }, 1000); return () => clearInterval(t); } });
  },
};
void ({} as ApiResult);
