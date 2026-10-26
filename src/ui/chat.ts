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
  }

  /** The site's chat is docked over the game (instead of our panel). */
  get docked() { return !!this.box; }
  get typing() { return this.box ? this.dockFocus : this.focused; }

  focus(prefill?: string) {
    try { document.exitPointerLock?.(); } catch { /* ignore */ }
    if (this.box) { this.dockFocusIn(prefill); return; }
    if (this.tab === 'ev') this.setTab('g');
    if (prefill != null && !this.input.value) this.input.value = prefill;
    if (this.input.disabled) this.tabsEl.querySelector<HTMLElement>(`[data-t="${this.tab}"]`)?.focus();
    else this.input.focus();
  }

  /* ------------------------------------------------------------ fallback panel */

  private me() { return String(this.c.host.store.hero?.login || this.c.host.store.me?.login || '').toLowerCase(); }
  private flags() { return chatFlags(this.c.host.store.hero); }

  private setTab(t: ChatTab) {
    if (!tabOk(t, this.flags())) t = 'g';
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
    const any = f.tr || f.dm;
    this.tabsEl.hidden = !any;
    for (const b of this.tabsEl.querySelectorAll<HTMLElement>('[data-t]')) {
      const t = b.dataset.t as ChatTab, u = this.un[t] || 0, bn = b.querySelector('.tn') as HTMLElement;
      b.hidden = !tabOk(t, f);
      b.classList.toggle('on', t === this.tab); b.setAttribute('aria-selected', String(t === this.tab));
      bn.hidden = !u || t === this.tab; bn.textContent = u > 99 ? '99+' : String(u);
    }
    // «Кому» row in Личные
    const on = this.tab === 'dm';
    this.toEl.hidden = !on;
    if (on) {
      const peers = dmPeers(this.c.host.store.chat, this.me(), this.peer, EMPTY_SET);
      this.toEl.innerHTML = (peers.length ? `<button type="button" data-peer="" aria-pressed="${!this.peer}">Все</button>` + peers.map((p) => `<button type="button" data-peer="${esc(p)}" aria-pressed="${this.peer === p}" style="color:${nickColor(p)}">${esc(p)}</button>`).join('') : '')
        + (this.peer ? `<span class="tw">Кому: <b>${esc(this.peer)}</b></span>` : peers.length ? '<span class="tw">Выбери, кому писать</span>' : '');
    }
    this.form.hidden = this.tab === 'ev';   // Достижения: read only
    this.input.disabled = this.tab === 'dm' && !this.peer;
    this.input.placeholder = this.tab === 'dm' ? (this.peer ? `Лично для ${this.peer}…` : 'Выбери собеседника: «✉» у ника') : TAB_PH[this.tab];
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
    const onLeave = () => { if (this.idle) { const l = b.querySelector<HTMLElement>('.cy-chat-l'); if (l) l.scrollTop = l.scrollHeight; } };
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
      document.removeEventListener('pointerlockchange', onLock);
      mo?.disconnect();
      b.classList.remove('l3d-idle');
    };
    if (inChat(document.activeElement)) onIn();
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
    const inp = b.querySelector<HTMLInputElement>('.cy-chat-f input');
    const form = b.querySelector<HTMLElement>('.cy-chat-f');
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
    if (on) { const l = this.box.querySelector<HTMLElement>('.cy-chat-l'); if (l) l.scrollTop = l.scrollHeight; }   // compact view shows the newest lines
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
