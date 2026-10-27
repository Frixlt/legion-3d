/**
 * Chat. Two modes, same API for the UI (el, typing, focus, sync, update):
 *
 * 1. DOCK (live site): the site's own city chat (`#tab-city .cy-chat`, rendered and kept current by the site's
 *    window.LGChat — tabs Общий / Торговля / Достижения / Личные, unread counters, class icons, nick colours, ✉ DMs,
 *    ignore, nick menu, /commands, mute notices, moderation) is shown over our canvas, fixed bottom-left, restyled by
 *    SITE_CHAT_CSS. We only control it: Enter/T/'/' focus its input (gameplay off), Esc/blur gives gameplay back,
 *    a sent message blurs it, it fades when idle and hides while a menu is open or the HUD is off. Every site update
 *    of the chat reaches the player without a change here.
 * 2. FALLBACK (offline demo, site chat missing or switched off): our own panel with the site's tab logic ported
 *    (tabOf / chatVis of site-chat.js): Достижения under the trade flag (ct, else in Общий), Личные under cd with
 *    peers, ✉ on nicks, per-tab unread counters, class icons and per-nick colours.
 * Never sends anything by itself.
 */
import type { ChatMsg, Hero } from '../contracts';
import { type Ctx, h } from './ctx';
import { esc } from './data';
import { SITE_CHAT_CSS } from './styles';

/* ================================================================ pure logic (site-chat.js parity, tested) */

export type ChatTab = 'g' | 'tr' | 'ev' | 'dm';
export const CHAT_TABS: readonly ChatTab[] = ['g', 'tr', 'ev', 'dm'];
export const TAB_NAME: Record<ChatTab, string> = { g: 'Общий', tr: 'Торговля', ev: 'Достижения', dm: 'Личные' };
export interface ChatFlags { on: boolean; tr: boolean; dm: boolean; ev: boolean }

/** Hero chat flags as the site reads them: cc = chat, ct = Торговля (+ Достижения), cd = Личные. */
export function chatFlags(hero: Hero | null | undefined): ChatFlags {
  const x = (hero || {}) as Record<string, unknown>;
  const tr = !!x.ct;
  return { on: !!x.cc, tr, dm: !!x.cd, ev: tr };
}

/** Tab of a message — site: `m.tb || (m.ev ? (C.tr ? 'ev' : 'g') : m.k === 'tr' ? 'tr' : m.k === 'dm' ? 'dm' : 'g')`. */
export function tabOf(m: ChatMsg, f: ChatFlags): ChatTab {
  const k = m.kind || 'g';
  if (k === 'ev') return f.tr ? 'ev' : 'g';
  return k === 'tr' ? 'tr' : k === 'dm' ? 'dm' : 'g';
}

/** Tab available with these flags (else the site falls back to Общий). */
export const tabOk = (t: ChatTab, f: ChatFlags) => t === 'g' || ((t === 'tr' || t === 'ev') && f.tr) || (t === 'dm' && f.dm);

/** Lines of a tab — site chatVis(): own tab, not ignored, in Личные only the chosen peer (system lines always). */
export function chatVis(list: readonly ChatMsg[], tab: ChatTab, f: ChatFlags, peer: string | null, ign: ReadonlySet<string>): ChatMsg[] {
  const out: ChatMsg[] = [];
  for (const m of list) {
    if (tabOf(m, f) !== tab || ign.has(m.login)) continue;
    if (tab === 'dm' && peer && m.kind !== 'sys' && m.login !== peer && m.to !== peer) continue;
    out.push(m);
  }
  return out;
}

/** Recent DM partners (newest first, ≤ 8), the chosen peer always included — site chatTo(). */
export function dmPeers(list: readonly ChatMsg[], me: string, peer: string | null, ign: ReadonlySet<string>): string[] {
  const peers: string[] = [];
  for (let i = list.length - 1; i >= 0 && peers.length < 8; i--) {
    const m = list[i]; if (m.kind !== 'dm') continue;
    const p = m.login === me ? m.to : m.login;
    if (p && !peers.includes(p) && !ign.has(p)) peers.push(p);
  }
  if (peer && !peers.includes(peer)) peers.unshift(peer);
  return peers;
}

/** Class icon before a nick (site CLS_ICO; unknown class → ◆). */
export const CLS_ICO: Record<string, string> = { legionary: '⚔️', archer: '🏹', mage: '🔮', priest: '✨', rogue: '🗡️', necromancer: '💀', paladin: '☀️', recruit: '🌱' };
const NICK_COLORS = ['#ffc94d', '#ff8a80', '#ffab6e', '#f4ff81', '#b9f6ca', '#69f0ae', '#84ffff', '#80d8ff', '#9fa8ff', '#b388ff', '#ea80fc', '#ff80ab', '#ffd180', '#a7ffeb', '#ccff90', '#ffcdd2'];
/** Per-nick colour, same hash (FNV-1a) and palette as the site — a player has one colour on both. */
export function nickColor(l: string): string {
  let x = 2166136261; const t = String(l || '');
  for (let i = 0; i < t.length; i++) { x ^= t.charCodeAt(i); x = Math.imul(x, 16777619); }
  return NICK_COLORS[(x >>> 0) % NICK_COLORS.length];
}

const TAB_EMPTY: Record<ChatTab, string> = {
  g: 'Здесь пока тихо - напиши первым.', tr: 'Здесь объявления: куплю, продам, меняю. Ссылки нельзя.',
  dm: 'Личных пока нет. Нажми «✉» у ника в ленте, чтобы написать лично.', ev: 'Здесь - громкие события игры: заточки +7 и выше, полученные достижения.',
};
const TAB_PH: Record<ChatTab, string> = { g: 'Написать в чат… (Enter)', tr: 'Куплю / продам / меняю…', dm: 'Лично…', ev: '' };

/* ================================================================ local chat commands (never sent) */

/**
 * Local commands typed into any chat field we control (the docked site chat, the fallback panel, the «⛏ Шахта» tab):
 * a matching line is swallowed — the field is cleared, the handler runs, NOTHING reaches the site. Used for easter eggs
 * («!идея бум», src/features/boom.ts): «!идея …» is a real stream-bot command, sending it would spam the streamer.
 */
const COMMANDS: { re: RegExp; run: (text: string) => void }[] = [];
export function registerChatCommand(re: RegExp, run: (text: string) => void): () => void {
  const c = { re, run }; COMMANDS.push(c);
  return () => { const i = COMMANDS.indexOf(c); if (i >= 0) COMMANDS.splice(i, 1); };
}
/** The local command a typed line is, or null. */
export function chatCommand(text: string): ((text: string) => void) | null {
  const t = String(text ?? '').trim();
  if (!t) return null;
  for (const c of COMMANDS) { c.re.lastIndex = 0; if (c.re.test(t)) return c.run; }
  return null;
}
/** Run the local command of `text` if it is one (true = swallowed: the caller must not send it). */
export function runChatCommand(text: string): boolean {
  const fn = chatCommand(text);
  if (!fn) return false;
  try { fn(String(text).trim()); } catch (e) { console.error('[l3d] chat command', e); }
  return true;
}
/** A field with a local command in it: clear it and run the command (true = swallowed). */
function swallowField(inp: HTMLInputElement | null | undefined): boolean {
  if (!inp || !chatCommand(inp.value)) return false;
  const t = inp.value; inp.value = '';
  try { inp.dispatchEvent(new Event('input', { bubbles: true })); } catch { /* */ }
  return runChatCommand(t);
}

/* ================================================================ mine chat tab (⛏ Шахта) */

/** One line of the mine room's chat (the game's `mchat` format). */
export interface MineLine { id: string; l: string; n?: string; t: string; at?: number }
/** What the mine room hands to the chat dock (no import of rooms/ from ui/). Reading only; say() is called by the dock only when the player sends. */
export interface MineChatSource {
  lines(): readonly MineLine[];
  on(fn: (fresh: MineLine[]) => void): () => void;
  say(text: string): Promise<{ ok?: boolean; error?: string } | null | undefined | unknown>;
  me(): string;
}
const MINE_KEEP = 80;
export const MINE_PH = 'Написать в чат шахты…';
export const MINE_EMPTY = 'В шахте пока тихо — напиши первым.';

/**
 * State of the «Шахта» tab, DOM-free: selection (+ the tab to give back), unread counter, history + live lines without duplicates,
 * sending only on an explicit send(). The dock / fallback panel render from it.
 */
export class MineChatTab {
  selected = false;
  unread = 0;
  /** Tab that was active when the mine tab took over (restored on leave if the player did not choose another meanwhile). */
  prev: string | null = null;
  private seen = new Set<string>();
  private list: MineLine[] = [];
  constructor(readonly src: MineChatSource) { this.take(src.lines()); }
  private take(ls: readonly MineLine[]): MineLine[] {
    const fresh: MineLine[] = [];
    for (const l of ls) { if (!l || this.seen.has(l.id)) continue; this.seen.add(l.id); this.list.push(l); fresh.push(l); }
    if (this.list.length > MINE_KEEP) this.list = this.list.slice(-MINE_KEEP);
    if (this.seen.size > 1000) { const keep = new Set(this.list.map((x) => x.id)); for (const id of this.seen) if (!keep.has(id)) this.seen.delete(id); }
    return fresh;
  }
  lines(): readonly MineLine[] { return this.list; }
  /** Live lines: returns the new ones; counts unread (not own) while another tab is shown. */
  incoming(ls: readonly MineLine[]): MineLine[] {
    const fresh = this.take(ls), me = this.src.me();
    if (!this.selected) for (const l of fresh) if (String(l.l).toLowerCase() !== me) this.unread++;
    return fresh;
  }
  /** Mine entered: take the tab, remember the one it replaces. */
  enter(prev: string | null) { this.selected = true; this.unread = 0; this.prev = prev; }
  /** The player picked the tab. */
  choose() { this.selected = true; this.unread = 0; }
  /** The player picked another tab. */
  deselect() { this.selected = false; }
  /** Mine left: the tab to restore (null when the player already chose another one). */
  leave(): string | null { const r = this.selected ? this.prev : null; this.selected = false; return r; }
  /** Send what the player typed (blank → null, nothing posted). */
  async send(text: string): Promise<{ ok: boolean; error?: string } | null> {
    const t = String(text || '').trim(); if (!t) return null;
    if (runChatCommand(t)) return { ok: true };   // a local command: never posted
    const r = await this.src.say(t) as { ok?: boolean; error?: string } | null | undefined;
    return r && r.ok === false ? { ok: false, error: r.error } : { ok: true };
  }
}

let mineSrc: MineChatSource | null = null;
const mineSubs = new Set<() => void>();
/** The 3D mine room calls this on enter and the returned function on exit: the chat dock shows / removes the «⛏ Шахта» tab. */
export function attachMineChat(src: MineChatSource): () => void {
  mineSrc = src; for (const f of [...mineSubs]) f();
  return () => { if (mineSrc === src) { mineSrc = null; for (const f of [...mineSubs]) f(); } };
}

const hhmm = (at?: number) => { if (!at) return ''; const d = new Date(at); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const mineLi = (l: MineLine, me: string) =>
  `<li${String(l.l).toLowerCase() === me ? ' class="me"' : ''} title="${esc(hhmm(l.at))}"><b data-nick="${esc(l.l)}" style="color:${nickColor(l.l)}">${esc(l.n || l.l)}</b> <span>${esc(l.t)}</span></li>`;

/* ================================================================ controller */

const FADE_MS = 10000;     // fallback: an idle line fades after this
const SHOW = 6;            // fallback: lines when idle
const KEEP = 80;           // per tab (site CHAT_N)
const IDLE_MS = 9000;      // dock: no new lines for this long → faded
const DOCK_SEL = '#tab-city .cy-chat';
const DOC = typeof document !== 'undefined' ? document : null;

export class Chat {
  /** Fallback panel (inside the HUD). Hidden while the site's chat is docked. */
  el: HTMLElement;
  private c: Ctx;
  // fallback
  private log: HTMLElement; private input: HTMLInputElement; private cnt: HTMLElement; private tabsEl: HTMLElement; private toEl: HTMLElement; private form: HTMLElement;
  private tab: ChatTab = 'g';
  private peer: string | null = null;
  private un: Record<ChatTab, number> = { g: 0, tr: 0, ev: 0, dm: 0 };
  private seen = new Set<string>();
  private rendered = new Map<string, HTMLElement>();
  private focused = false; private sending = false;
  private fadeT = 0;
  private flagsKey = '';
  // dock
  private box: HTMLElement | null = null;
  private boxOff: (() => void) | null = null;
  private dockFocus = false;
  private lastAct = 0;
  private idle = false;
  private off = false;
  private scanT = 1;
  private sendWatch = 0;
  // mine tab
  private mine: MineChatTab | null = null;
  private mineOff: (() => void) | null = null;
  private mineBtn: HTMLButtonElement | null = null;       // fallback panel tab
  private dBtn: HTMLButtonElement | null = null;           // dock: tab button, list, form
  private dList: HTMLOListElement | null = null;
  private dForm: HTMLFormElement | null = null;
  private dInput: HTMLInputElement | null = null;
  private dTabsMo: MutationObserver | null = null;
  private dTabsEl: HTMLElement | null = null;
  private boxMo: MutationObserver | null = null;
  private mineSending = false;

  constructor(c: Ctx) {
    this.c = c;
    this.el = h('div', 'chat', `<div class="tabs" role="tablist" aria-label="Вкладки чата"></div>
      <div class="log" role="log" aria-live="polite"></div>
      <div class="to" hidden></div>
      <label class="in"><input type="text" maxlength="200" placeholder="${TAB_PH.g}" autocomplete="off" spellcheck="false" aria-label="Сообщение в чат"><span class="cnt"></span><i class="kc sm dk">Enter</i></label>`);
    this.log = this.el.querySelector('.log') as HTMLElement;
    this.input = this.el.querySelector('input') as HTMLInputElement;
    this.cnt = this.el.querySelector('.cnt') as HTMLElement;
    this.tabsEl = this.el.querySelector('.tabs') as HTMLElement;
    this.toEl = this.el.querySelector('.to') as HTMLElement;
    this.form = this.el.querySelector('.in') as HTMLElement;
    for (const t of CHAT_TABS) {
      const b = h('button', '', `${TAB_NAME[t]}<b class="tn" hidden></b>`); b.type = 'button'; b.dataset.t = t; b.setAttribute('role', 'tab');
      this.tabsEl.appendChild(b);
    }
    // keep focus in the input while clicking tabs / peers / nicks
    for (const x of [this.tabsEl, this.toEl, this.log]) x.addEventListener('mousedown', (e) => { if ((e.target as HTMLElement).closest('button,b[data-nick]')) e.preventDefault(); });
    this.tabsEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-t]'); if (!b) return;
      this.setTab(b.dataset.t as ChatTab);
      if (!this.focused) this.focus();
    });
    this.toEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-peer]'); if (!b) return;
      this.peer = b.dataset.peer || null; this.rerender();
    });
    this.log.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const dm = t.closest<HTMLElement>('[data-dm]');
      if (dm) { this.openPeer(dm.dataset.dm!); return; }
      const n = t.closest<HTMLElement>('b[data-nick]');
      if (n && n.dataset.nick && n.dataset.nick !== this.me()) {
        if (this.tab === 'dm') { this.openPeer(n.dataset.nick); return; }
        const rest = this.input.value.replace(/^@[\w]+\s*/, ''); this.input.value = `@${n.dataset.nick} ${rest}`;
        if (!this.focused) this.focus();
      }
    });
    this.log.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    // open while anything in the panel has focus (the input, or a tab button in read-only Достижения)
    this.el.addEventListener('focusin', () => { if (!this.focused) this.onFocus(true); });
    this.el.addEventListener('focusout', () => setTimeout(() => {
      const a = this.c.shadow.activeElement;
      if (this.focused && !(a && this.el.contains(a))) this.onFocus(false);
    }, 0));
    this.el.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation();
      (this.c.shadow.activeElement as HTMLElement | null)?.blur?.();
    });
    this.input.addEventListener('input', () => { const n = this.input.value.length; this.cnt.textContent = n > 150 ? `${n}/200` : ''; });
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();   // game keys must not fire while typing
      if (e.key === 'Escape') { e.preventDefault(); this.input.blur(); }
      else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); void this.send(); }
    });
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
    this.input.addEventListener('keypress', (e) => e.stopPropagation());
    this.renderTabs();
    mineSubs.add(() => this.mineSync());
    this.mineSync();
  }

  /** The site's chat is docked over the game (instead of our panel). */
  get docked() { return !!this.box; }
  get typing() { return this.box ? this.dockFocus : this.focused; }

  focus(prefill?: string) {
    try { document.exitPointerLock?.(); } catch { /* ignore */ }
    if (this.box) { this.dockFocusIn(prefill); return; }
    if (this.tab === 'ev' && !this.mineSel) this.setTab('g');
    if (prefill != null && !this.input.value) this.input.value = prefill;
    if (this.input.disabled) this.tabsEl.querySelector<HTMLElement>(`[data-t="${this.tab}"]`)?.focus();
    else this.input.focus();
  }

  /* ------------------------------------------------------------ fallback panel */

  private me() { return String(this.c.host.store.hero?.login || this.c.host.store.me?.login || '').toLowerCase(); }
  private flags() { return chatFlags(this.c.host.store.hero); }

  private get mineSel() { return !!this.mine && this.mine.selected && !this.box; }

  private setTab(t: ChatTab) {
    if (!tabOk(t, this.flags())) t = 'g';
    this.mine?.deselect();
    this.tab = t; this.un[t] = 0;
    this.rerender();
    if (this.focused) {   // stay in the chat: the field, or the tab itself where there is no field
      if (t === 'ev' || this.input.disabled) this.tabsEl.querySelector<HTMLElement>(`[data-t="${t}"]`)?.focus();
      else this.input.focus();
    }
  }
  private openPeer(nk: string) {
    if (!this.flags().dm || !nk || nk === this.me()) return;
    this.peer = nk; this.setTab('dm');
    if (!this.focused) this.focus();
  }

  private renderTabs() {
    const f = this.flags();
    if (!tabOk(this.tab, f)) this.tab = 'g';
    const ms = this.mineSel, hasMine = !!this.mine && !this.box;
    const any = f.tr || f.dm || hasMine;
    this.tabsEl.hidden = !any;
    for (const b of this.tabsEl.querySelectorAll<HTMLElement>('[data-t]')) {
      const t = b.dataset.t as ChatTab, u = this.un[t] || 0, bn = b.querySelector('.tn') as HTMLElement;
      const sel = t === this.tab && !ms;
      b.hidden = !tabOk(t, f);
      b.classList.toggle('on', sel); b.setAttribute('aria-selected', String(sel));
      bn.hidden = !u || sel; bn.textContent = u > 99 ? '99+' : String(u);
    }
    // «⛏ Шахта» (only in the mine)
    if (hasMine) {
      if (!this.mineBtn) {
        const b = h('button', '', '⛏ Шахта<b class="tn" hidden></b>'); b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.mine = '1';
        this.mineBtn = b;
        b.addEventListener('click', () => { this.mine?.choose(); this.rerender(); if (!this.focused) this.focus(); });
      }
      if (this.mineBtn.parentElement !== this.tabsEl) this.tabsEl.appendChild(this.mineBtn);
      const u = this.mine!.unread, bn = this.mineBtn.querySelector('.tn') as HTMLElement;
      this.mineBtn.classList.toggle('on', ms); this.mineBtn.setAttribute('aria-selected', String(ms));
      bn.hidden = !u || ms; bn.textContent = u > 99 ? '99+' : String(u);
    } else if (this.mineBtn) { this.mineBtn.remove(); this.mineBtn = null; }
    // «Кому» row in Личные
    const on = this.tab === 'dm' && !ms;
    this.toEl.hidden = !on;
    if (on) {
      const peers = dmPeers(this.c.host.store.chat, this.me(), this.peer, EMPTY_SET);
      this.toEl.innerHTML = (peers.length ? `<button type="button" data-peer="" aria-pressed="${!this.peer}">Все</button>` + peers.map((p) => `<button type="button" data-peer="${esc(p)}" aria-pressed="${this.peer === p}" style="color:${nickColor(p)}">${esc(p)}</button>`).join('') : '')
        + (this.peer ? `<span class="tw">Кому: <b>${esc(this.peer)}</b></span>` : peers.length ? '<span class="tw">Выбери, кому писать</span>' : '');
    }
    this.form.hidden = this.tab === 'ev' && !ms;   // Достижения: read only
    this.input.disabled = this.tab === 'dm' && !this.peer && !ms;
    this.input.placeholder = ms ? MINE_PH : this.tab === 'dm' ? (this.peer ? `Лично для ${this.peer}…` : 'Выбери собеседника: «✉» у ника') : TAB_PH[this.tab];
  }

  private onFocus(on: boolean) {
    this.focused = on;
    this.el.classList.toggle('open', on);
    this.gameplayFor(on);
    if (on) { this.fade(true); this.log.scrollTop = this.log.scrollHeight; }
  }

  private gameplayFor(on: boolean) {
    const inp = this.c.host.input;
    if (on) inp.setGameplay(false);
    else if (!this.c.opened()) inp.setGameplay(true);
    try { window.dispatchEvent(new CustomEvent('l3d:chat', { detail: { focus: on } })); } catch { /* */ }
  }

  private async send() {
    const t = this.input.value.trim();
    if (!t) { this.input.blur(); return; }
    if (this.sending) return;
    if (runChatCommand(t)) { this.input.value = ''; this.cnt.textContent = ''; this.input.blur(); return; }   // local command: never sent
    if (this.mineSel) { await this.mineSend(this.input, () => { this.cnt.textContent = ''; this.input.blur(); }); return; }
    if (this.tab === 'dm' && !this.peer) { this.c.toast('Кому? Нажми «✉» у ника в ленте', true); return; }
    this.sending = true;
    try {
      const o = this.tab === 'tr' ? { k: 'tr' as const } : this.tab === 'dm' && this.peer ? { to: this.peer } : undefined;
      const r = await this.c.host.actions.say(t, o);
      if (r && r.ok) { this.input.value = ''; this.cnt.textContent = ''; this.input.blur(); }
      else this.c.toast((r && r.error) || 'Сообщение не отправлено', true);
    } catch {
      this.c.toast('Нет связи с сайтом — сообщение не отправлено', true);
    } finally { this.sending = false; }
  }

  private line(m: ChatMsg): HTMLElement {
    const k = m.kind || 'g', me = this.me(), f = this.flags();
    const el = h('div', 'ln ' + k);
    if (k === 'sys') el.textContent = m.text;
    else if (k === 'ev') el.textContent = '📜 ' + m.text;
    else {
      const ico = m.role ? `<i class="cls emo" title="${esc(m.roleName || m.role)}">${CLS_ICO[m.role] || '◆'}</i>` : '';
      const to = k === 'dm' && m.login === me && m.to ? ` → <b data-nick="${esc(m.to)}" class="n" style="color:${nickColor(m.to)}">${esc(m.to)}</b>` : '';
      const dmB = f.dm && k !== 'dm' && m.login !== me ? `<button type="button" class="dmb" data-dm="${esc(m.login)}" title="Написать лично" aria-label="Написать лично: ${esc(m.name)}">✉</button>` : '';
      el.innerHTML = `${ico}<b class="n" data-nick="${esc(m.login)}" style="color:${nickColor(m.login)}">${esc(m.name)}</b>${to}${dmB} <span>${esc(m.text)}</span>`;
      if (m.login === me) el.classList.add('me');
    }
    (el as any)._at = m.at;
    return el;
  }

  private rerender() {
    this.log.textContent = ''; this.rendered.clear();
    this.renderTabs();
    this.syncList(true);
  }

  /** Store chat changed. */
  sync() {
    if (this.box) { this.lastAct = Date.now(); return; }   // the site renders its own chat
    const f = this.flags(), fk = `${f.tr}|${f.dm}`;
    if (fk !== this.flagsKey) { this.flagsKey = fk; this.renderTabs(); }
    // unread per tab (site: own lines and Достижения are not counted)
    const me = this.me(), all = this.c.host.store.chat;
    const first = this.seen.size === 0;
    let cnt = false;
    for (const m of all) {
      if (this.seen.has(m.id)) continue;
      this.seen.add(m.id);
      if (first) continue;
      const tb = tabOf(m, f);
      if (tb === 'ev' || m.login === me || m.kind === 'sys') continue;
      if (tb !== this.tab) { this.un[tb]++; cnt = true; }   // our panel always shows its tab: only the others count
    }
    if (this.seen.size > 2000) { const keep = new Set(all.map((m) => m.id)); for (const id of this.seen) if (!keep.has(id)) this.seen.delete(id); }
    if (cnt || this.tab === 'dm') this.renderTabs();
    this.syncList(false);
  }

  private syncList(toEnd: boolean) {
    if (this.mineSel) { this.syncMineList(toEnd); return; }
    const f = this.flags();
    let list = chatVis(this.c.host.store.chat, this.tab, f, this.tab === 'dm' ? this.peer : null, EMPTY_SET);
    if (list.length > KEEP) list = list.slice(list.length - KEEP);
    const ids = new Set(list.map((m) => m.id));
    for (const [id, el] of this.rendered) if (!ids.has(id)) { el.remove(); this.rendered.delete(id); }
    const empty = this.log.querySelector('.empty');
    if (list.length) empty?.remove();
    else if (!empty) { const e = h('div', 'ln empty'); e.textContent = TAB_EMPTY[this.tab]; this.log.appendChild(e); }
    for (const m of list) {
      if (this.rendered.has(m.id)) continue;
      const el = this.line(m);
      this.rendered.set(m.id, el);
      this.log.appendChild(el);
    }
    const stick = toEnd || !this.focused || this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 40;
    if (stick) this.log.scrollTop = this.log.scrollHeight;
    this.fade(true);
  }

  /** Idle: only the last SHOW lines, each for FADE_MS (relative to arrival). */
  private fade(force = false) {
    const now = Date.now();
    const kids = this.log.children, n = kids.length;
    for (let i = 0; i < n; i++) {
      const el = kids[i] as HTMLElement;
      const at = (el as any)._at as number ?? now;
      const recv = (el as any)._recv ?? ((el as any)._recv = now);
      const hide = n - i > SHOW || now - Math.max(recv, Math.min(at, now)) > FADE_MS;
      if (force || el.classList.contains('fade') !== hide) el.classList.toggle('fade', hide);
      el.style.display = !this.focused && n - i > SHOW ? 'none' : '';
    }
  }

  /* ------------------------------------------------------------ dock (the site's chat) */

  /** The site's chat element, when it is there, bound by LGChat and switched on for this hero. */
  private findBox(): HTMLElement | null {
    if (!DOC || !DOC.documentElement.classList.contains('l3d-on')) return null;
    const b = DOC.querySelector<HTMLElement>(DOCK_SEL);
    return b && b.dataset.bound && !b.hidden ? b : null;
  }

  private dock(b: HTMLElement) {
    this.undock();
    ensureCss();
    this.box = b;
    this.el.style.display = 'none';
    if (this.focused) this.input.blur();
    const inChat = (x: Element | null) => !!x && (b.contains(x) || !!x.closest?.('.cy-nm'));
    const onIn = () => { if (!this.dockFocus && DOC!.documentElement.classList.contains('l3d-on')) { this.dockFocus = true; this.gameplayFor(true); this.lastAct = Date.now(); this.setIdle(false); } };
    const onOut = () => {
      // the site re-renders its list (a focused nick may vanish) and opens the nick menu outside the box: decide later
      setTimeout(() => {
        if (!this.dockFocus || this.box !== b) return;
        if (inChat(document.activeElement)) return;
        this.dockFocus = false; this.lastAct = Date.now(); this.gameplayFor(false);
      }, 0);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!DOC!.documentElement.classList.contains('l3d-on')) return;
      const t = e.target as HTMLElement;
      if (e.key === 'Escape') {
        // 3D: Esc just leaves the chat (the site would also fold it)
        e.preventDefault(); e.stopPropagation();
        (document.activeElement as HTMLElement | null)?.blur?.();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing && t.matches?.('.cy-chat-f input')) {
        const inp = t as HTMLInputElement;
        if (!inp.value.trim()) { e.preventDefault(); e.stopPropagation(); inp.blur(); return; }
        this.watchSend(inp);   // the site sends; leave the field once it is cleared (sent / command done)
      }
    };
    // local chat commands: window capture runs before any handler of the site's chat (Enter, the send button, submit)
    const fieldOf = (e: Event): HTMLInputElement | null => {
      const t = (typeof e.composedPath === 'function' ? e.composedPath()[0] : e.target) as HTMLElement | null;
      if (!t || !b.contains(t)) return null;
      const f = (t.closest?.('.cy-chat-f') as HTMLElement | null);
      return f ? f.querySelector('input') : null;
    };
    const onCmd = (e: Event) => {
      if (e.type === 'keydown') {
        const k = e as KeyboardEvent;
        if ((k.key !== 'Enter' && k.code !== 'NumpadEnter') || k.isComposing || k.shiftKey) return;
      } else if (e.type === 'click' && !((e.target as HTMLElement | null)?.closest?.('.cy-chat-f button'))) return;
      const inp = fieldOf(e);
      if (!inp || !swallowField(inp)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      inp.blur();
    };
    window.addEventListener('keydown', onCmd, true);
    window.addEventListener('submit', onCmd, true);
    window.addEventListener('click', onCmd, true);
    const onLeave = () => { if (this.idle) { const l = this.curList(); if (l) l.scrollTop = l.scrollHeight; } };
    const onLock = () => { if (document.pointerLockElement && this.dockFocus) (document.activeElement as HTMLElement | null)?.blur?.(); };
    b.addEventListener('focusin', onIn);
    b.addEventListener('focusout', onOut);
    b.addEventListener('keydown', onKey, true);
    b.addEventListener('mouseleave', onLeave);
    document.addEventListener('pointerlockchange', onLock);
    // a new line in the shown tab (or a tab switch), an error / mute notice wakes it from idle; counters on other tabs do not
    const mo = typeof MutationObserver === 'function' ? new MutationObserver(() => { this.lastAct = Date.now(); if (this.idle) this.setIdle(false); }) : null;
    const lst = b.querySelector('.cy-chat-l'), err = b.querySelector('.cy-chat-e');
    if (lst) mo?.observe(lst, { childList: true });
    if (err) mo?.observe(err, { childList: true, characterData: true, subtree: true });
    DOC!.documentElement.classList.add('l3d-chat-dock');
    this.lastAct = Date.now();
    this.boxOff = () => {
      b.removeEventListener('focusin', onIn); b.removeEventListener('focusout', onOut); b.removeEventListener('keydown', onKey, true); b.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('keydown', onCmd, true); window.removeEventListener('submit', onCmd, true); window.removeEventListener('click', onCmd, true);
      document.removeEventListener('pointerlockchange', onLock);
      mo?.disconnect();
      this.dockMineDetach();
      b.classList.remove('l3d-idle', 'l3d-mine-on');
    };
    if (inChat(document.activeElement)) onIn();
    this.dockMineAttach();
  }

  private undock() {
    if (!this.box) return;
    this.boxOff?.(); this.boxOff = null; this.box = null;
    DOC?.documentElement.classList.remove('l3d-chat-dock', 'l3d-chat-off');
    if (this.dockFocus) { this.dockFocus = false; this.gameplayFor(false); }
    this.idle = false; this.off = false;
    this.el.style.display = '';
    this.rerender();
  }

  private dockFocusIn(prefill?: string) {
    const b = this.box!;
    if (!b.classList.contains('open')) b.querySelector<HTMLButtonElement>('.cy-chat-t')?.click();   // the site opens and focuses its field
    const mineSel = !!this.mine && this.mine.selected && !!this.dForm && this.dForm.isConnected;
    const inp = mineSel ? this.dInput : b.querySelector<HTMLInputElement>('.cy-chat-f:not(.l3d-mine-f) input');
    const form = mineSel ? this.dForm : b.querySelector<HTMLElement>('.cy-chat-f:not(.l3d-mine-f)');
    if (inp && !inp.disabled && form && !form.hidden) {
      if (prefill != null && !inp.value) inp.value = prefill;
      try { inp.focus({ preventScroll: true }); } catch { inp.focus(); }
      try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch { /* */ }
    } else {
      // read-only tab (Достижения), muted or Личные without a peer: focus the chosen tab — chat mode, the site's
      // own controls work with the mouse and the keyboard
      const t = b.querySelector<HTMLElement>('.cy-chat-tabs [aria-selected="true"]') || b.querySelector<HTMLElement>('.cy-chat-x') || b.querySelector<HTMLElement>('.cy-chat-t');
      try { t?.focus({ preventScroll: true }); } catch { /* */ }
    }
    this.setIdle(false);
  }

  private watchSend(inp: HTMLInputElement) {
    const t0 = performance.now();
    window.clearInterval(this.sendWatch);
    this.sendWatch = window.setInterval(() => {
      const gone = !inp.isConnected || document.activeElement !== inp;
      if (gone || performance.now() - t0 > 6000) { window.clearInterval(this.sendWatch); return; }
      if (!inp.value) { window.clearInterval(this.sendWatch); inp.blur(); }
    }, 120);
  }

  private setIdle(on: boolean) {
    if (on === this.idle || !this.box) return;
    this.idle = on; this.box.classList.toggle('l3d-idle', on);
    if (on) { const l = this.curList(); if (l) l.scrollTop = l.scrollHeight; }   // compact view shows the newest lines
  }

  /* ------------------------------------------------------------ «⛏ Шахта» tab */

  /** The mine room attached / detached its chat source. */
  private mineSync() {
    const src = mineSrc;
    if (src && (!this.mine || this.mine.src !== src)) {
      this.mineTeardown();
      const m = this.mine = new MineChatTab(src);
      m.enter(this.box ? this.siteTabName() : this.tab);   // selected on entering the mine; the previous tab stays as it was and comes back on exit
      this.mineOff = src.on((f) => this.mineLines(f));
      if (this.box) this.dockMineAttach(); else this.rerender();
    } else if (!src && this.mine) {
      this.mineTeardown();
    }
  }

  private mineTeardown() {
    const m = this.mine; if (!m) return;
    this.mineOff?.(); this.mineOff = null;
    const prev = m.leave();
    this.mine = null;
    this.dockMineDetach();
    this.box?.classList.remove('l3d-mine-on');
    if (this.mineBtn) { this.mineBtn.remove(); this.mineBtn = null; }
    if (prev && !this.box && tabOk(prev as ChatTab, this.flags())) this.tab = prev as ChatTab;
    this.rerender();
  }

  private siteTabName(): string {
    return this.box?.querySelector<HTMLElement>('.cy-chat-tabs [aria-selected="true"]:not(.l3d-mine-tab)')?.dataset.tab || 'g';
  }

  private mineLines(fresh: MineLine[]) {
    const m = this.mine; if (!m) return;
    if (!m.incoming(fresh).length) return;
    if (this.box) this.dockMineView(); else if (this.mineSel) this.syncMineList(false); else this.renderTabs();
  }

  private mineLine(l: MineLine): HTMLElement {
    const el = h('div', 'ln g' + (String(l.l).toLowerCase() === this.mine!.src.me() ? ' me' : ''));
    el.innerHTML = `<b class="n" data-nick="${esc(l.l)}" style="color:${nickColor(l.l)}">${esc(l.n || l.l)}</b> <span>${esc(l.t)}</span>`;
    el.title = hhmm(l.at); (el as any)._at = l.at;
    return el;
  }

  /** Fallback panel: show the mine lines (same as syncList for the city). */
  private syncMineList(toEnd: boolean) {
    const m = this.mine; if (!m) return;
    const list = m.lines(), ids = new Set(list.map((x) => x.id));
    for (const [id, el] of this.rendered) if (!ids.has(id)) { el.remove(); this.rendered.delete(id); }
    const empty = this.log.querySelector('.empty');
    if (list.length) empty?.remove();
    else if (!empty) { const e = h('div', 'ln empty'); e.textContent = MINE_EMPTY; this.log.appendChild(e); }
    for (const l of list) {
      if (this.rendered.has(l.id)) continue;
      const el = this.mineLine(l); this.rendered.set(l.id, el); this.log.appendChild(el);
    }
    const stick = toEnd || !this.focused || this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 40;
    if (stick) this.log.scrollTop = this.log.scrollHeight;
    this.fade(true);
  }

  /** The only place where the mine chat posts: the player pressed Enter / the send button. */
  private async mineSend(inp: HTMLInputElement, done: () => void) {
    const m = this.mine; if (!m || this.mineSending) return;
    this.mineSending = true;
    try {
      const r = await m.send(inp.value);
      if (!r) inp.blur();
      else if (r.ok) { inp.value = ''; done(); }
      else this.c.toast(r.error || 'Сообщение не отправлено', true);
    } catch { this.c.toast('Нет связи с сайтом — сообщение не отправлено', true); }
    finally { this.mineSending = false; }
  }

  /** The list currently shown in the docked chat. */
  private curList(): HTMLElement | null {
    const b = this.box; if (!b) return null;
    return this.mine?.selected && this.dList?.isConnected ? this.dList : b.querySelector<HTMLElement>('.cy-chat-l:not(.l3d-mine-l)');
  }

  /** Docked: put our tab, list and field into the site's chat (again after the site rebuilt its DOM). */
  private dockMineAttach() {
    const b = this.box, m = this.mine; if (!b || !m) return;
    const tabs = b.querySelector<HTMLElement>('.cy-chat-tabs'), sl = b.querySelector<HTMLElement>('.cy-chat-l:not(.l3d-mine-l)'), sf = b.querySelector<HTMLElement>('.cy-chat-f:not(.l3d-mine-f)');
    if (!tabs || !sl || !sf) return;
    if (!this.dBtn) {
      const btn = h('button', 'l3d-mine-tab', '⛏ Шахта<b class="cy-chat-tn" hidden></b>'); btn.type = 'button'; btn.setAttribute('role', 'tab');
      btn.addEventListener('click', () => { this.mine?.choose(); this.dockMineView(); });
      const ol = h('ol', 'cy-chat-l l3d-mine-l'); ol.setAttribute('role', 'log'); ol.setAttribute('aria-label', 'Сообщения шахты');
      const form = h('form', 'cy-chat-f l3d-mine-f', `<input type="text" maxlength="200" enterkeyhint="send" placeholder="${MINE_PH}" aria-label="Сообщение в чат шахты" autocomplete="off" spellcheck="false"><button type="submit" aria-label="Отправить">➤</button>`);
      form.autocomplete = 'off';
      const inp = form.querySelector('input') as HTMLInputElement;
      form.addEventListener('submit', (e) => { e.preventDefault(); void this.mineSend(inp, () => { /* the dock blurs once the field is empty */ }); });
      for (const t of ['keydown', 'keyup', 'keypress'] as const) inp.addEventListener(t, (e) => e.stopPropagation());   // game keys never fire while typing
      ol.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
      this.dBtn = btn; this.dList = ol; this.dForm = form; this.dInput = inp;
      if (typeof MutationObserver === 'function') {
        this.boxMo = new MutationObserver(() => { this.lastAct = Date.now(); if (this.idle) this.setIdle(false); });
        this.boxMo.observe(ol, { childList: true });
      }
    }
    if (this.dBtn.parentElement !== tabs) tabs.appendChild(this.dBtn);
    if (this.dList!.previousElementSibling !== sl || this.dList!.parentElement !== sl.parentElement) sl.after(this.dList!);
    if (this.dForm!.previousElementSibling !== sf || this.dForm!.parentElement !== sf.parentElement) sf.after(this.dForm!);
    if (this.dTabsEl !== tabs) {
      this.dTabsMo?.disconnect(); this.dTabsEl?.removeEventListener('click', this.onSiteTab);
      this.dTabsEl = tabs; tabs.addEventListener('click', this.onSiteTab);
      if (typeof MutationObserver === 'function') {
        this.dTabsMo = new MutationObserver(() => { if (this.mine && tabs.hidden && b.querySelector<HTMLElement>('.cy-chat-p')?.hidden !== false) tabs.hidden = false; });
        this.dTabsMo.observe(tabs, { attributes: true, attributeFilter: ['hidden'] });
      }
    }
    this.dockMineView();
  }

  /** A site tab was clicked: the site shows its own list again. */
  private onSiteTab = (e: Event) => {
    const t = (e.target as HTMLElement).closest?.('[data-tab]');
    if (t && this.mine?.selected) { this.mine.deselect(); this.dockMineView(); }
  };

  private dockMineView() {
    const b = this.box, m = this.mine, btn = this.dBtn, ol = this.dList; if (!b || !m || !btn || !ol) return;
    const sel = m.selected;
    b.classList.toggle('l3d-mine-on', sel);
    btn.classList.toggle('on', sel); btn.setAttribute('aria-selected', String(sel));
    const bn = btn.querySelector('.cy-chat-tn') as HTMLElement; bn.hidden = !m.unread || sel; bn.textContent = m.unread > 99 ? '99+' : String(m.unread);
    const tabs = this.dTabsEl; if (tabs && tabs.hidden && b.querySelector<HTMLElement>('.cy-chat-p')?.hidden !== false) tabs.hidden = false;
    const stick = ol.scrollHeight - ol.scrollTop - ol.clientHeight < 40;
    const me = m.src.me(), lines = m.lines();
    const html = lines.length ? lines.map((l) => mineLi(l, me)).join('') : `<li class="cy-chat-0">${MINE_EMPTY}</li>`;
    if ((ol as any)._k !== html) { (ol as any)._k = html; ol.innerHTML = html; if (stick || sel) ol.scrollTop = ol.scrollHeight; }
  }

  private dockMineDetach() {
    this.dBtn?.remove(); this.dList?.remove(); this.dForm?.remove();
    // we un-hid the tab row for a lone «Общий»: give it back (the site re-renders it with its own flags anyway)
    const tb = this.dTabsEl;
    if (tb && !tb.hidden && tb.querySelectorAll('button:not([hidden])').length < 2) tb.hidden = true;
    this.dBtn = this.dList = this.dForm = this.dInput = null;
    this.dTabsMo?.disconnect(); this.dTabsMo = null;
    this.dTabsEl?.removeEventListener('click', this.onSiteTab); this.dTabsEl = null;
    this.boxMo?.disconnect(); this.boxMo = null;
    this.box?.classList.remove('l3d-mine-on');
  }

  update(dt: number) {
    // hide the docked chat over our menus and with the HUD off (cheap: two flags per frame)
    if (this.box) {
      const off = !!this.c.opened() || this.c.ui.classList.contains('nohud');
      if (off !== this.off) {
        this.off = off; DOC!.documentElement.classList.toggle('l3d-chat-off', off);
        if (off && this.dockFocus) (document.activeElement as HTMLElement | null)?.blur?.();
      }
    }
    this.scanT += dt;
    if (this.scanT > 0.5) {
      this.scanT = 0;
      // the site rebuilds its City (re-enter, town change) → a new chat element; classic mode → back to our panel
      if (this.box && (!this.box.isConnected || this.box.hidden || !DOC!.documentElement.classList.contains('l3d-on'))) this.undock();
      if (!this.box) { const b = this.findBox(); if (b) this.dock(b); }
      if (this.box && this.mine) this.dockMineAttach();
      if (this.box) this.setIdle(!this.dockFocus && Date.now() - this.lastAct > IDLE_MS);
    }
    if (!this.box) {
      this.fadeT += dt;
      if (this.fadeT > 0.5) { this.fadeT = 0; if (!this.focused) this.fade(); }
    }
  }
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/** Our look for the docked site chat (light DOM, once per page). */
function ensureCss() {
  if (!DOC || DOC.getElementById('l3d-chat-css')) return;
  const s = DOC.createElement('style'); s.id = 'l3d-chat-css'; s.textContent = SITE_CHAT_CSS; DOC.head.appendChild(s);
}
