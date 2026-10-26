/**
 * Mine HUD (DOM, our own), styled like src/ui (dark plum glass, gold hairlines, Nunito / Comfortaa, pill chips):
 *  - one compact card top-right (under the «онлайн» chip): mine · floor · nature · 👥/⛏, «Сейчас» (the stone being
 *    dug with its bar, «Стоп»), earnings (coins + ore, «Скупщик»), today's time and mastery as two hairline meters.
 *    The card collapses to its header line (button or [L]+Shift… no: the ▾ button; state kept in localStorage).
 *  - the journal is hidden behind [L] / the «Журнал» button: a drawer with tabs «Журнал» (hero stats + mine log)
 *    and «Чат шахты» (the mine room's chat: lines + input; incoming lines are also bubbles over the miners).
 *  - tips, «+руда» popups over the dug stone, the «other tab» / «dark» notices, and the NPC cards: buyer «Скупщик
 *    Гром», supplier «Снабженец Кремень» / «Фонарщик», board «Поручения».
 * Re-renders only the parts whose HTML changed (buttons are not recreated under the cursor).
 */
import { moneyCompact } from '../../ui/money';
import type { MineClient } from './net';
import { TX, BIO_RU, stars, mmss, leftTxt, resName, qty, resList, blockTitle, stoneProgress, type Quest, type ChatLine } from './state';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const COIN: Record<string, string> = { g: '#f2c14e', s: '#c8ccd8', b: '#c07a44' };
export const coinsHtml = (n: number) => moneyCompact(Math.max(0, Math.floor(n))).map(([k, v]) => `<span class="l3m-coin"><i class="${k}"></i>${v}</span>`).join(' ');
/** Site coins(): whole coins as money; under 10 with tenths (a crowd stone pays 0.1–0.5). */
export const coinsFrac = (x: number) => { const v = Math.max(0, +x || 0), n = Math.floor(v + 1e-9); if (v - n < 0.05 || n >= 10) return coinsHtml(n); const t = v.toFixed(v < 1 ? 2 : 1).replace('.', ','); return `<span class="l3m-coin"><i class="b"></i>${t}</span>`; };
const pcs = (q: number) => { const v = Math.floor(q) / 100; return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, '')).replace('.', ','); };
/** Minutes, short: «45 мин», «2 ч», «2 ч 5 м». */
const hm = (min: number) => { const m = Math.max(0, Math.round(min)); return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч${m % 60 ? ` ${m % 60} м` : ''}`; };
const val = (x: number) => String(Math.round(x * 10) / 10).replace('.', ',');
void COIN;

const CSS = `
.l3m{--bg:rgba(29,22,32,.8);--bg2:rgba(42,32,48,.94);--ink:#f7eadf;--mute:#bfaab7;--gold:#ffcf6a;--goldd:#b8862a;--acc:#ff8fa3;--up:#8fe39a;--dn:#ff8f8f;
  --line:rgba(255,207,106,.28);--hd:'Comfortaa','Nunito','Trebuchet MS',sans-serif;--tx:'Nunito','Golos Text','Segoe UI',sans-serif;--num:'Dela Gothic One','Russo One','Comfortaa','Arial Black',sans-serif;
  position:absolute;inset:0;pointer-events:none;font:500 13px/1.35 var(--tx);color:var(--ink);z-index:5;-webkit-font-smoothing:antialiased}
.l3m *{box-sizing:border-box}.l3m [hidden]{display:none!important}
.l3m button{font:inherit;color:inherit}
.l3m-box{background:var(--bg);box-shadow:0 0 0 1.5px var(--line),0 6px 18px #0006;border-radius:16px;backdrop-filter:blur(6px)}
.l3m-hud{position:absolute;right:16px;top:50px;width:272px;pointer-events:auto;overflow:hidden}
.l3m-hd{display:flex;align-items:center;gap:8px;padding:8px 8px 8px 12px;cursor:pointer}
.l3m-hd .t{font:700 13px/1.15 var(--hd);color:var(--gold);white-space:nowrap}
.l3m-hd .s{font-size:11px;color:var(--mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.l3m-hd .g{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.l3m-tg{width:24px;height:24px;border-radius:999px;border:0;background:#ffffff10;cursor:pointer;display:grid;place-items:center;transition:transform .2s;flex:none}
.l3m-hud.min .l3m-tg{transform:rotate(-90deg)}
.l3m-bd{padding:0 12px 10px;display:flex;flex-direction:column;gap:7px}
.l3m-hud.min .l3m-bd{display:none}
.l3m-mbar{height:3px;margin:0 12px 8px;border-radius:3px;background:#0006;overflow:hidden}.l3m-mbar i{display:block;height:100%}
.l3m-hud:not(.min) .l3m-mbar{display:none}
.l3m-sec{border-top:1px solid #ffffff14;padding-top:7px}
.l3m-bd>.l3m-sec:first-child{border-top:0;padding-top:0}
.l3m .nw{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.l3m-k{font:800 10px/1 var(--tx);letter-spacing:.09em;text-transform:uppercase;color:var(--mute);margin-bottom:5px;display:flex;justify-content:space-between;gap:6px;align-items:center}
.l3m-k small{text-transform:none;letter-spacing:0;font-weight:600}
.l3m-t{font-weight:700;margin:0}.l3m-t b{color:var(--gold)}.l3m-mut{color:var(--mute);margin:0;font-size:12px}
.l3m-bar{height:7px;border-radius:999px;background:#0007;overflow:hidden;margin:6px 0 5px;box-shadow:inset 0 0 0 1px #ffffff10}.l3m-bar i{display:block;height:100%;border-radius:999px;transition:width .4s linear}
.l3m-row{display:flex;justify-content:space-between;gap:8px;align-items:center}
.l3m-meters{display:grid;grid-template-columns:1fr 1fr;gap:10px;line-height:1.2}
.l3m .lb{font-size:11px;color:var(--mute);margin-right:4px}.l3m-meters .v{font-weight:800;font-size:12px}
.l3m-mini{height:3px;border-radius:3px;background:#0007;overflow:hidden;margin-top:4px}.l3m-mini i{display:block;height:100%;background:var(--up)}.l3m-mini.xp i{background:#b9a2ff}
.l3m-btn{pointer-events:auto;font:800 12px/1 var(--tx)!important;cursor:pointer;border:0;border-radius:999px;padding:7px 12px;background:linear-gradient(#ffe08a,#ffcf6a 55%,#e8ad3c);color:#2a1d18!important;box-shadow:0 2px 0 var(--goldd),inset 0 1px 0 #fff8;white-space:nowrap}
.l3m-btn:hover{filter:brightness(1.07)}.l3m-btn:active{transform:translateY(1px);box-shadow:0 1px 0 var(--goldd)}
.l3m-btn.ghost{background:#ffffff14;color:var(--ink)!important;box-shadow:0 0 0 1px var(--line)}.l3m-btn.ghost:hover{background:#ffffff22}
.l3m-btn.sm{padding:5px 9px;font-size:11px!important}.l3m-btn[disabled]{opacity:.5;cursor:default;filter:none}
.l3m-btns{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.l3m-jb{display:inline-flex;gap:4px;align-items:center;padding:3px 5px!important;flex:none}
.l3m-kc{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;border-radius:6px;font:400 10px/1 var(--num);color:var(--ink);background:linear-gradient(#4a3a54,#33263b);box-shadow:0 2px 0 #160f1a,inset 0 1px 0 #ffffff22}
.l3m-btn:not(.ghost) .l3m-kc{background:#2a1d18;color:var(--gold)}
.l3m-dot{display:inline-block;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--acc);color:#2a1d18;font:800 10px/16px var(--tx);text-align:center}
.l3m-coin{display:inline-flex;align-items:center;gap:3px;font-weight:800}.l3m-coin i{width:12px;height:12px;border-radius:50%;display:inline-block;box-shadow:inset 0 -2px 0 #0004,0 0 0 1.5px #2a2236}
.l3m-coin i.g{background:radial-gradient(circle at 35% 30%,#fff1b0,#f2c14e 60%,#b8862a)}.l3m-coin i.s{background:radial-gradient(circle at 35% 30%,#fff,#c8ccd8 60%,#8a90a4)}.l3m-coin i.b{background:radial-gradient(circle at 35% 30%,#f3c39a,#c07a44 60%,#7a4420)}
.l3m-jr{position:absolute;right:16px;top:50px;width:300px;max-height:min(440px,calc(100% - 200px));display:flex;flex-direction:column;pointer-events:auto;overflow:hidden}
.l3m-jr .tabs{display:flex;gap:4px;padding:8px 8px 6px;align-items:center}
.l3m-jr .tabs button{border:0;cursor:pointer;padding:6px 11px;border-radius:999px;font:800 11px/1 var(--tx);background:#ffffff10;color:var(--mute);display:inline-flex;gap:5px;align-items:center}
.l3m-jr .tabs button[aria-selected="true"]{background:var(--gold);color:#2a1d18}
.l3m-jr .tabs .x{margin-left:auto;width:26px;height:26px;padding:0;justify-content:center}
.l3m-jr .body{overflow:auto;padding:0 12px 10px;scrollbar-width:thin;flex:1;min-height:0}
.l3m-stats{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:0 0 8px}
.l3m-stats>div{background:#ffffff0c;border-radius:10px;padding:6px 8px}
.l3m-stats dt{font-size:11px;color:var(--mute)}.l3m-stats dd{margin:0;font-weight:800}.l3m-stats .ok{color:var(--up)}
.l3m-log{list-style:none;margin:0;padding:0;font-size:12px;display:flex;flex-direction:column;gap:3px}
.l3m-log li{padding:4px 0;border-bottom:1px solid #ffffff0d;color:#e9dcd2}
.l3m-chat{display:flex;flex-direction:column;gap:4px;font-size:12.5px}
.l3m-chat .ln b{font-weight:800;margin-right:4px}.l3m-chat .ln.me b{color:var(--gold)}
.l3m-chat .empty{color:var(--mute)}
.l3m-in{display:flex;gap:6px;padding:0 10px 10px}
.l3m-in input{flex:1;min-width:0;pointer-events:auto;border:0;border-radius:999px;padding:7px 12px;background:#0006;color:var(--ink);font:600 12.5px/1.2 var(--tx);box-shadow:0 0 0 1px var(--line);outline:none}
.l3m-in input:focus{box-shadow:0 0 0 1.5px var(--gold)}
.l3m-tip{position:absolute;left:50%;bottom:150px;transform:translateX(-50%);max-width:min(560px,90%);background:var(--bg2);box-shadow:0 0 0 1.5px var(--line),0 6px 18px #0006;border-radius:999px;padding:8px 18px;font-weight:700;text-align:center;transition:opacity .25s}
.l3m-tip.bad{box-shadow:0 0 0 1.5px var(--dn),0 6px 18px #0006;color:#ffd6d6}
.l3m-pop{position:absolute;transform:translate(-50%,-100%);font:800 17px/1 var(--tx);color:#ffe27a;text-shadow:0 2px 0 #2a1d18,0 0 8px rgba(0,0,0,.6);white-space:nowrap;transition:opacity .3s}
.l3m-other,.l3m-dark{position:absolute;left:50%;top:72px;transform:translateX(-50%);border-radius:999px;padding:7px 8px 7px 16px;display:flex;gap:10px;align-items:center;font-weight:700}
.l3m-other{pointer-events:auto;background:rgba(110,28,40,.92);box-shadow:0 0 0 1.5px var(--dn)}
.l3m-dark{background:rgba(10,8,20,.88);box-shadow:0 0 0 1.5px var(--line);padding-right:16px}
.l3m-modal{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(14,9,18,.5);pointer-events:auto}
.l3m-win{width:min(460px,94%);max-height:86%;overflow:auto;background:linear-gradient(#2a2030,#221a28);box-shadow:0 0 0 1.5px var(--line),0 16px 40px #000a;border-radius:20px;padding:16px 18px}
.l3m-win h3{margin:0 0 4px;font:700 18px/1.2 var(--hd);color:var(--gold)}.l3m-say{font-style:italic;margin:4px 0 10px;color:#e9dcd2}
.l3m-list{list-style:none;margin:8px 0;padding:0;display:flex;flex-direction:column;gap:5px}
.l3m-list li{display:flex;justify-content:space-between;gap:8px;background:#ffffff0c;border-radius:10px;padding:6px 9px;align-items:center}
.l3m-list li.done{box-shadow:0 0 0 1.5px var(--up)}.l3m-list li.cl{opacity:.55}.l3m-list li.no b{color:var(--dn)}.l3m-list li.ok b{color:var(--up)}
.l3m-tabs{display:flex;gap:6px;margin:8px 0}.l3m-tabs button[aria-selected="true"]{background:var(--gold);color:#2a1d18!important}
.l3m-offer{display:flex;justify-content:space-between;align-items:center;background:#ffcf6a1c;border-radius:12px;padding:8px 11px;margin-top:6px;font-weight:800}
@media (max-width:700px){.l3m-hud{width:224px}.l3m-jr{width:240px}}
`;

export interface MineHudHandlers {
  stop(): void;
  toBuyer(): void;
  exit(): void;
  /** Card opened/closed (the room releases / restores pointer lock and gameplay keys). */
  modal(on: boolean): void;
  /** The journal drawer opened / closed (a modal: the cursor is needed for its tabs). */
  journal?(on: boolean): void;
  /** The mine chat input got / lost focus (the room turns gameplay keys off while typing). */
  typing?(on: boolean): void;
}
export type CardKind = 'buy' | 'lamp' | 'quests' | null;
type JTab = 'log' | 'chat';
const LS_MIN = 'l3d.mineHudMin';
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* */ } };

export class MineHud {
  readonly el: HTMLElement;
  private parts: Record<string, string> = {};
  private tipT = 0;
  card: CardKind = null;
  private supTab: 'pick' | 'bag' | 'lamp' = 'pick';
  private noUse = new Set<string>();
  private pops: { el: HTMLElement; x: number; y: number; z: number; t: number }[] = [];
  /** Card collapsed to its header line. */
  min = lsGet(LS_MIN) === '1';
  /** Journal drawer: closed / log / chat. */
  jr: JTab | null = null;
  private unread = 0;
  private input: HTMLInputElement;
  private typingOn = false;
  /** The idle hint shows for the first 90 s in the mine or until the first stone. */
  private born = Date.now(); private dug = false;
  constructor(host: HTMLElement, private client: MineClient, private h: MineHudHandlers) {
    this.el = document.createElement('div'); this.el.className = 'l3m'; this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = `<style>${CSS}</style>`
      + `<section class="l3m-box l3m-hud" data-p0="hud" aria-label="Шахта"><div data-p="hd"></div><div class="l3m-mbar" data-p="mbar"></div><div class="l3m-bd" data-p="bd"></div></section>`
      + `<section class="l3m-box l3m-jr" data-p0="jr" hidden aria-label="Журнал шахты"><div class="tabs" data-p="jtabs"></div><div class="body" data-p="jbody"></div>`
      + `<form class="l3m-in" data-p0="jin" hidden><input type="text" maxlength="200" placeholder="Написать в чат шахты…" autocomplete="off" spellcheck="false" aria-label="Сообщение в чат шахты"><button type="submit" class="l3m-btn sm">Отпр.</button></form></section>`
      + `<div class="l3m-other" data-p="other" hidden><span>Шахта открыта в другой вкладке — копать можно только в одной.</span><button type="button" class="l3m-btn sm" data-a="here">Копать здесь</button></div>`
      + `<div class="l3m-dark" data-p="dark" hidden>${esc(TX.dark)}</div>`
      + `<div class="l3m-tip" data-p="tip" hidden></div><div class="l3m-pops" data-p="pops"></div><div data-p="modal"></div>`;
    host.appendChild(this.el);
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('change', (e) => { const t = e.target as HTMLInputElement; if (t && t.dataset.use) { if (t.checked) this.noUse.delete(t.dataset.use); else this.noUse.add(t.dataset.use); this.render(); } });
    // the wheel over our panels scrolls them, not the camera
    this.el.addEventListener('wheel', (e) => { if ((e.target as HTMLElement).closest('.l3m-jr,.l3m-win')) e.stopPropagation(); }, { passive: true });
    // mine chat input: game keys never fire while typing; Esc / Enter leave it
    this.input = this.el.querySelector('.l3m-in input') as HTMLInputElement;
    const form = this.el.querySelector('.l3m-in') as HTMLFormElement;
    form.addEventListener('submit', (e) => { e.preventDefault(); void this.send(); });
    for (const t of ['keydown', 'keyup', 'keypress'] as const) this.input.addEventListener(t, (e) => {
      e.stopPropagation();
      if (t === 'keydown' && (e as KeyboardEvent).key === 'Escape') { e.preventDefault(); this.input.blur(); }
    });
    this.input.addEventListener('focus', () => this.setTyping(true));
    this.input.addEventListener('blur', () => this.setTyping(false));
  }
  private q<T extends HTMLElement = HTMLElement>(p: string): T { return this.el.querySelector(`[data-p="${p}"]`) as T; }
  private q0<T extends HTMLElement = HTMLElement>(p: string): T { return this.el.querySelector(`[data-p0="${p}"]`) as T; }
  private set(p: string, html: string): void { if (this.parts[p] === html) return; this.parts[p] = html; this.q(p).innerHTML = html; }
  private setTyping(on: boolean): void { if (on === this.typingOn) return; this.typingOn = on; this.h.typing?.(on); }
  get typing(): boolean { return this.typingOn; }

  tip(text: string, bad = false): void {
    const el = this.q('tip'); el.textContent = text; el.hidden = false; el.classList.toggle('bad', bad);
    clearTimeout(this.tipT); this.tipT = window.setTimeout(() => { el.hidden = true; }, 4200);
  }
  /** Floating text over a world point (room metres), projected each frame by update(). */
  popup(text: string, x: number, y: number, z: number): void {
    const el = document.createElement('div'); el.className = 'l3m-pop'; el.textContent = text;
    this.q('pops').appendChild(el); this.pops.push({ el, x, y, z, t: 0 });
  }
  /** Project popups: project(x,y,z) → [sx, sy] in CSS px or null (behind the camera). */
  update(dt: number, project: (x: number, y: number, z: number) => [number, number] | null): void {
    for (let k = this.pops.length - 1; k >= 0; k--) {
      const p = this.pops[k]; p.t += dt;
      const s = project(p.x, p.y + p.t * 0.6, p.z);
      if (s) { p.el.style.left = s[0].toFixed(0) + 'px'; p.el.style.top = s[1].toFixed(0) + 'px'; p.el.style.display = ''; } else p.el.style.display = 'none';
      p.el.style.opacity = String(Math.max(0, Math.min(1, 2.2 - p.t)));
      if (p.t > 2.4) { p.el.remove(); this.pops.splice(k, 1); }
    }
  }

  open(kind: CardKind): void { const was = !!this.card; this.card = kind; if (!!kind !== was) this.h.modal(!!kind); this.parts.modal = '\u0000'; this.render(); }   // sentinel: always redraw (closing too — '' would match the cleared slot and leave the card on screen)
  close(): void { this.open(null); }
  /** Collapse / expand the card. */
  toggleMin(on = !this.min): void { this.min = on; lsSet(LS_MIN, on ? '1' : '0'); this.render(); }
  /** Journal drawer ([L]): closed → log → (same key) closed; tab = open that tab. */
  journal(tab: JTab | null | 'toggle' = 'toggle'): void {
    const was = !!this.jr;
    this.jr = tab === 'toggle' ? (this.jr ? null : 'log') : tab;
    if (!!this.jr !== was) this.h.journal?.(!!this.jr);
    if (this.jr === 'chat') this.unread = 0;
    if (!this.jr && this.typingOn) this.input.blur();
    this.render();
  }
  /** Focus the mine chat input (opens the chat tab). */
  focusChat(): void { this.journal('chat'); setTimeout(() => this.input.focus(), 0); }
  /** New mine chat lines arrived (the room also shows them as bubbles). */
  chatIn(lines: ChatLine[]): void { if (this.jr !== 'chat') this.unread = Math.min(99, this.unread + lines.length); this.render(); }
  private async send(): Promise<void> {
    const t = this.input.value.trim(); if (!t) { this.input.blur(); return; }
    this.input.value = '';
    try { const r = await this.client.say(t); if (r && r.ok === false) this.tip(r.error || 'Сообщение не отправлено', true); } catch { this.tip('Сообщение не отправлено', true); }
  }

  /** Re-render from the client state (cheap: compares strings). */
  render(): void {
    const c = this.client, M = c.model, st = M.st; if (!st) return;
    const now = Date.now(), me = M.me || { i: -1, day: 0, cap: 480, bag: { c: 0, r: {} }, mx: { lv: 1, xp: 0, need: 60 }, wk: 0 };
    const left = (st.reset || 0) - now, dd = Math.floor(left / 864e5), hh = Math.floor((left % 864e5) / 36e5);
    const w = M.hw != null ? M.hw : st.working || 0, all = M.here != null ? Math.max(M.here, w) : w + (M.nOthers || 0);
    const hud = this.q0('hud'), jrOpen = !!this.jr;
    hud.hidden = jrOpen; hud.classList.toggle('min', this.min);
    // header: mine · floor · nature, counters, collapse
    const name = st.name && st.id !== 'home' ? `Шахта · ${st.name}` : 'Шахта';
    this.set('hd', `<div class="l3m-hd" data-a="min" title="${this.min ? 'Развернуть' : 'Свернуть'}"><div class="g"><span class="t">⛏ ${esc(name)} · этаж ${st.n}</span>`
      + `<span class="s" title="${left > 0 ? `Новая шахта через ${dd ? dd + ' д ' : ''}${hh} ч` : ''}">${stars(st.danger || 1)} ${esc(BIO_RU[st.biome || ''] || '')}${(st.rec || 0) > st.n ? ` · рекорд ${st.rec}` : ''}`
      + ` · <span title="${M.hm ? `Были в шахте за последние ${M.hm} мин` : 'Сейчас в шахте'}">👥 ${all}</span> · <span title="Сейчас копают">⛏ ${w}</span></span></div>`
      + `<button type="button" class="l3m-btn ghost sm l3m-jb" data-a="jr" title="Журнал и чат шахты [L]"><span class="l3m-kc">L</span>${this.unread ? `<span class="l3m-dot">${this.unread}</span>` : ''}</button>`
      + `<button type="button" class="l3m-tg" data-a="min" aria-label="${this.min ? 'Развернуть' : 'Свернуть'}" aria-expanded="${!this.min}">▾</button></div>`);
    // Сейчас
    const dig = M.myI >= 0 && M.F ? M.F.cells[M.myI] : null;
    const pr = dig ? stoneProgress(st, M.myI, now) : null, rem = pr ? 1 - pr.p : 1;
    const barCol = rem > 0.5 ? '#8fe39a' : rem > 0.2 ? '#ffcf6a' : '#ff8f6a';
    this.set('mbar', dig ? `<i style="width:${(rem * 100).toFixed(1)}%;background:${barCol}"></i>` : '');
    let nowH: string;
    if (dig) {
      nowH = `<div><div class="l3m-k">Сейчас<small>${pr && pr.n > 1 ? `копают: ${pr.n}` : ''}</small></div><p class="l3m-t">${TX.doing}: <b>${esc(blockTitle(dig))}</b></p>`
        + `<div class="l3m-bar"><i style="width:${(rem * 100).toFixed(1)}%;background:${barCol}"></i></div>`
        + `<div class="l3m-row"><span class="l3m-mut">${esc(leftTxt((pr ? pr.eta : 0) * 1000))}</span><button type="button" class="l3m-btn ghost sm" data-a="stop">Стоп</button></div></div>`;
    } else if (!this.dug && now - this.born < 90000) nowH = `<p class="l3m-mut" title="Подойди к камню, наведи прицел и нажми E — герой докопает сам, даже если закрыть сайт">Копай камни с <b style="color:var(--gold)">жёлтым кругом</b> — <span class="l3m-kc">E</span></p>`;
    else nowH = '';
    if (dig) this.dug = true;
    // Заработок
    const bag = me.bag || { c: 0, r: {} }, res = resList(bag);
    const ore = c.oreItems();
    const orePcs = ore.reduce((a, it) => a + (+it.q || 0), 0);
    const earnL = M.buyerOn ? `${coinsFrac(bag.cx != null ? bag.cx : bag.c)}<span class="l3m-mut" title="${esc(ore.map((it) => `${resName(it.res)} ${qty(Math.floor(it.q / 100), it.q % 100)}`).join(', ') || 'Руды в сумке нет')}"> · руда ${pcs(orePcs)}</span>`
      : `${coinsFrac(bag.c)}<span class="l3m-mut"> · ${res.length ? res.map(([k, n]) => `${esc(resName(k))} ${n}`).slice(0, 2).join(', ') : 'сумка пуста'}</span>`;
    const q = me.q || { d: [], w: [] };
    const canClaim = !(c.claimed && now - c.claimed < 60000) && [...q.d, ...q.w].some((x) => x.done && !x.cl);
    const earnH = `<div class="l3m-sec l3m-row" title="${M.buyerOn ? 'Оплата за работу — сразу в кошелёк; руду купит скупщик' : 'Всё выдаст скупщик'}"><span class="nw"><span class="lb">Доход</span> ${earnL}</span><button type="button" class="l3m-btn sm" data-a="buyer">${M.buyerOn ? 'Скупщик' : 'Сдать'}</button></div>`;
    const mxx = me.mx || { lv: 1, xp: 0, need: 60 }, dayP = me.cap ? Math.min(100, me.day / me.cap * 100) : 0;
    const metH = `<div class="l3m-sec l3m-meters"><div><div class="lb">Сегодня</div><div class="v">${hm(me.day)}${me.cap > 0 ? ` <span class="l3m-mut">/ ${hm(me.cap)}</span>` : ''}</div>${me.cap > 0 ? `<div class="l3m-mini"><i style="width:${dayP.toFixed(1)}%"></i></div>` : ''}</div>`
      + `<div><div class="lb">${TX.mast}</div><div class="v">ур. ${mxx.lv}</div><div class="l3m-mini xp"><i style="width:${mxx.need ? Math.min(100, mxx.xp / mxx.need * 100).toFixed(1) : 100}%"></i></div></div></div>`;
    const ftH = `<div class="l3m-row"><span class="l3m-mut">${canClaim ? '<b style="color:var(--gold)">Награда готова!</b>' : `Поручения: ${[...q.d, ...q.w].filter((x) => x.done).length} / ${q.d.length + q.w.length}`}</span><button type="button" class="l3m-btn ghost sm" data-a="quests">Поручения${canClaim ? ' <span class="l3m-dot">★</span>' : ''}</button></div>`;
    this.set('bd', nowH + earnH + metH + ftH);
    // journal drawer
    const jr = this.q0('jr'); jr.hidden = !jrOpen;
    (this.q0('jin') as HTMLElement).hidden = this.jr !== 'chat';
    if (jrOpen) {
      this.set('jtabs', `<button type="button" role="tab" data-a="jtab" data-tab="log" aria-selected="${this.jr === 'log'}">Журнал</button>`
        + `<button type="button" role="tab" data-a="jtab" data-tab="chat" aria-selected="${this.jr === 'chat'}">Чат шахты${this.unread ? ` <span class="l3m-dot">${this.unread}</span>` : ''}</button>`
        + `<button type="button" class="x" data-a="jr" aria-label="Закрыть журнал" title="Закрыть [L]">✕</button>`);
      if (this.jr === 'log') {
        const lamp = M.lampOn() ? 'надета' : M.lampHave() ? 'в сумке' : 'нет';
        this.set('jbody', `<dl class="l3m-stats">`
          + `<div><dt>Вклад за неделю</dt><dd>${me.wk || 0}</dd></div>`
          + `<div><dt>Каска шахтёра</dt><dd class="${M.lampOn() ? 'ok' : ''}">${lamp}</dd></div>`
          + `<div><dt>${TX.mast}</dt><dd>ур. ${mxx.lv} <small class="l3m-mut">${mxx.xp} / ${mxx.need}</small></dd></div>`
          + `<div><dt>Сегодня</dt><dd>${mmss(me.day)}${me.cap > 0 ? ` <small class="l3m-mut">из ${mmss(me.cap)}</small>` : ''}</dd></div>`
          + (st.gem ? `<div style="grid-column:1/3"><dt>Самоцвет этих мест</dt><dd>${esc(resName(st.gem))}</dd></div>` : '')
          + (ore.length ? `<div style="grid-column:1/3"><dt>Руда в сумке</dt><dd>${ore.map((it) => `${esc(resName(it.res))} ${esc(qty(Math.floor(it.q / 100), it.q % 100))}`).join(', ')}</dd></div>` : '')
          + `</dl><div class="l3m-k">Журнал шахты</div><ul class="l3m-log">${(st.log || []).slice(0, 12).map((e) => `<li>${esc(e.t)}</li>`).join('') || '<li>Пока тихо</li>'}</ul>`);
      } else {
        const lines = c.chat.lines.slice(-40), meL = c.login;
        const body = this.q('jbody'), stick = body.scrollHeight - body.scrollTop - body.clientHeight < 30;
        this.set('jbody', `<div class="l3m-chat">${lines.map((l) => `<div class="ln${String(l.l).toLowerCase() === meL ? ' me' : ''}"><b style="color:${nick(l.l)}">${esc(l.n || l.l)}</b>${esc(l.t)}</div>`).join('') || `<div class="empty">${c.chat.on ? 'В шахте пока тихо — напиши первым.' : 'Чат шахты недоступен.'}</div>`}</div>`);
        if (stick) body.scrollTop = body.scrollHeight;
      }
    }
    this.q('other').hidden = !c.other;
    this.q('dark').hidden = !M.dark;
    this.renderModal();
  }

  /* ---------------------------------------------------------------- cards */
  private renderModal(): void {
    if (!this.card) { this.set('modal', ''); return; }
    const body = this.card === 'buy' ? this.buyerHtml() : this.card === 'lamp' ? this.supHtml() : this.questsHtml();
    this.set('modal', `<div class="l3m-modal" data-a="bg"><div class="l3m-win" role="dialog" aria-modal="true">${body}<div class="l3m-btns"><button type="button" class="l3m-btn ghost" data-a="back">Назад</button></div></div></div>`);
  }
  private buyerHtml(): string {
    const c = this.client, M = c.model, st = M.st!;
    if (!M.buyerOn) {
      const me = M.me, res = resList((me && me.bag) || undefined);
      return `<h3>${TX.seller}</h3><p class="l3m-say">«${esc(TX.hello)}»</p>${res.length ? `<ul class="l3m-list">${res.map(([k, n, p]) => `<li><span>${esc(resName(k))}</span><b>${esc(qty(n, p))}</b></li>`).join('')}</ul>` : `<p class="l3m-mut">${TX.bagEmpty}</p>`}`
        + `<div class="l3m-btns"><button type="button" class="l3m-btn" data-a="sell">Сдать всё</button></div>`;
    }
    const P = st.bp || {}, its = c.oreItems(), price = c.priceOf(c.allLines()), wait = !!c.buyWait;
    const thx = c.buySaid && Date.now() - c.buySaid.at < 120000 ? c.buySaid : null;
    const say = thx ? esc(thx.t).replace(/\{coins\}/g, String(thx.c)) : !its.length ? 'Клади руду на прилавок — скажу, сколько дам.' : price > 0 ? `Дам за всё ${price}.` : 'За это и медяка не дам — добавь ещё.';
    return `<h3>${TX.seller}</h3><p class="l3m-say">«${say}»</p>`
      + (its.length ? `<ul class="l3m-list">${its.map((it) => `<li><span>${esc(it.name || resName(it.res))}<br><small class="l3m-mut">${esc(qty(Math.floor(it.q / 100), it.q % 100))}</small></span><b>≈ ${val(it.q * (+P[it.res] || 0) / 100)}</b></li>`).join('')}</ul>` : '<p class="l3m-mut">Руды в сумке нет — накопай в шахте или забери со склада.</p>')
      + `<div class="l3m-offer"><span>Скупщик даст</span><b>${coinsHtml(price)}</b></div>`
      + `<div class="l3m-btns"><button type="button" class="l3m-btn" data-a="sell"${!(price > 0) || wait ? ' disabled' : ''}>${wait ? 'Скупщик считает…' : 'Сдать скупщику'}</button></div>`
      + `<p class="l3m-mut">Купленное скупщик отправит в казну Ратуши — на развитие города.</p>`;
  }
  private questsHtml(): string {
    const c = this.client, M = c.model, me = M.me, q = (me && me.q) || { d: [], w: [] };
    const li = (x: Quest) => `<li class="${x.done ? 'done' : ''}${x.cl ? ' cl' : ''}"><span>${esc(x.t)}${x.h ? `<br><small class="l3m-mut">Где: ${esc(x.h)}</small>` : ''}</span><b>${x.cl ? 'получено' : x.done ? 'готово' : `${x.p} / ${x.g}`} · +${x.c}</b></li>`;
    const canClaim = !(c.claimed && Date.now() - c.claimed < 60000) && [...q.d, ...q.w].some((x) => x.done && !x.cl);
    return `<h3>Поручения скупщика</h3><p class="l3m-mut">Награду выдаёт ${TX.seller} — кнопка «Забрать награду», когда поручение готово.</p>`
      + `<div class="l3m-k" style="margin-top:8px">Поручения на сегодня</div><ul class="l3m-list">${q.d.map(li).join('') || '<li>Нет</li>'}</ul>`
      + `<div class="l3m-k">Поручения недели</div><ul class="l3m-list">${q.w.map(li).join('') || '<li>Нет</li>'}</ul>`
      + `<div class="l3m-btns"><button type="button" class="l3m-btn" data-a="claim"${canClaim && !c.busyOp ? '' : ' disabled'}>Забрать награду</button></div>`;
  }
  private supHtml(): string {
    const c = this.client, M = c.model, st = M.st!;
    const lampBody = () => M.lampOn() ? '<p>«Каска шахтёра» на тебе — фонарь светит на любом этаже.</p>'
      : !M.lampHave() && c.lampBought && Date.now() - c.lampBought < 60000 ? '<p>Каска куплена — несу в сумку, через пару секунд появится.</p>'
      : M.lampHave() ? `<p>«Каска шахтёра» у тебя в сумке — надень её, и фонарь загорится.</p><div class="l3m-btns"><button type="button" class="l3m-btn" data-a="wear" data-uid="${esc(M.lampHave()!.uid)}">Надеть каску</button></div>`
      : `<p>С ${st.darkFrom || 5}-го этажа без света ничего не видно и копать нельзя. «Каска шахтёра» — обычная вещь в сумку: надел — светит.</p><div class="l3m-btns"><button type="button" class="l3m-btn" data-a="lamp"${c.busyOp ? ' disabled' : ''}>Купить каску${st.lampPrice ? ` · ${st.lampPrice}` : ''}</button></div>`;
    if (!M.pickOn) return `<h3>${TX.lampNpc}</h3>${lampBody()}`;
    const x = M.me && M.me.pkx, mx = (M.me && M.me.mx) || { lv: 1, xp: 0, need: 0 }, money = c.heroMoney();
    const tab = this.supTab, wait = !!c.supWait;
    const tabs = `<div class="l3m-tabs" role="tablist">${([['pick', 'Кирка'], ['bag', 'Рудная сумка'], ['lamp', 'Каска']] as const).map(([k, t]) => `<button type="button" role="tab" class="l3m-btn ghost sm" data-a="tab" data-tab="${k}" aria-selected="${tab === k}">${t}</button>`).join('')}</div>`;
    const say = c.supSay && Date.now() - c.supSay.at < 60000 ? c.supSay.t : 'Снаряжение для шахты: кирки, рудные сумки, каски. Хорошая кирка — полдела.';
    let body = '';
    if (tab === 'pick') {
      if (!x) body = '<p class="l3m-mut">Снабженец раскладывает товар — загляни через пару секунд.</p>';
      else {
        const T = x.t || [], lv = x.lv, nx = lv + 1 < T.length ? lv + 1 : -1, cur = T[lv] || ['Кирка', 1];
        body = `<p>Твоя кирка: <b>${esc(cur[0])}</b> · сила удара ×${val(+cur[1])}</p>`;
        if (nx < 0) body += '<p>Лучше кирки не бывает — у тебя адамантитовая.</p>';
        else {
          const N = T[nx], hv = this.oreHave(), reqs: string[] = []; let ok = true;
          const mOk = (mx.lv || 1) >= N[2]; ok = ok && mOk;
          reqs.push(`<li class="${mOk ? 'ok' : 'no'}"><span>Горное дело</span><b>ур. ${mx.lv || 1} / ${N[2]}</b></li>`);
          const cOk = money >= N[3]; ok = ok && cOk;
          if (N[3] > 0) reqs.push(`<li class="${cOk ? 'ok' : 'no'}"><span>Монеты</span><b>${coinsHtml(money)} / ${coinsHtml(N[3])}</b></li>`);
          const opt = N[5] || {}, can = Object.keys(opt).filter((r) => (hv[r] || 0) > 0), use = can.filter((r) => !this.noUse.has(r)), pay = pickPay(N[4] || {}, opt, hv, use);
          for (const [r, need] of Object.entries(pay.s)) { const got = hv[r] || 0, o2 = got >= need; ok = ok && o2; reqs.push(`<li class="${o2 ? 'ok' : 'no'}"><span>${esc(resName(r))}${pay.used[r] ? ' <small>(скидка)</small>' : ''}</span><b>${pcs(got)} / ${pcs(need)}</b></li>`); }
          body += `<div class="l3m-k">Следующая: ${esc(N[0])} <small>+${Math.round((N[1] - 1) * 100)}% к силе удара</small></div><ul class="l3m-list">${reqs.join('')}</ul>`
            + (can.length ? `<div class="l3m-k">Можно дешевле</div>${can.map((r) => `<label class="l3m-row" style="justify-content:flex-start"><input type="checkbox" data-use="${esc(r)}"${use.includes(r) ? ' checked' : ''}${wait ? ' disabled' : ''}> ${esc(resName(r))}: 1 шт. вместо ${val(+opt[r][1])} шт. ${esc(resName(opt[r][0]))}</label>`).join('')}` : '')
            + `<p class="l3m-mut">Руда — из сумки героя (и рудной сумки), 100 осколков = 1 шт.</p>`
            + `<div class="l3m-btns"><button type="button" class="l3m-btn" data-a="pick" data-to="${nx}" data-use2="${esc(use.join(','))}"${!ok || wait ? ' disabled' : ''}>${wait ? 'Снабженец работает…' : 'Улучшить'}</button></div>`;
        }
      }
    } else if (tab === 'bag') {
      const ob = x && x.ob;
      if (ob) body = `<p>Рудная сумка у тебя: <b>${ob.used} / ${ob.cap}</b> ячеек. Новая руда кладётся в неё и не занимает места в сумке героя.</p>`;
      else if (x) {
        const mOk = (mx.lv || 1) >= x.obL, cOk = money >= x.obP;
        body = `<p><b>Рудная сумка</b> — ${x.obC} ячеек для руды, навсегда и только твоя.</p><ul class="l3m-list"><li class="${mOk ? 'ok' : 'no'}"><span>Горное дело</span><b>ур. ${mx.lv || 1} / ${x.obL}</b></li>${x.obP > 0 ? `<li class="${cOk ? 'ok' : 'no'}"><span>Монеты</span><b>${coinsHtml(money)} / ${coinsHtml(x.obP)}</b></li>` : ''}</ul>`
          + `<div class="l3m-btns"><button type="button" class="l3m-btn" data-a="orebag"${!mOk || !cOk || wait ? ' disabled' : ''}>${wait ? 'Снабженец работает…' : 'Купить'}</button></div>`;
      } else body = '<p class="l3m-mut">Снабженец раскладывает товар — загляни через пару секунд.</p>';
    } else body = lampBody();
    return `<h3>${TX.sup}</h3><p class="l3m-mut">Торговец снаряжением</p><p class="l3m-say">«${esc(say)}»</p>${tabs}${body}`;
  }
  private oreHave(): Record<string, number> { const o: Record<string, number> = {}; for (const it of this.client.oreItems()) o[it.res] = (o[it.res] || 0) + (+it.q || 0); return o; }

  private onClick(e: MouseEvent): void {
    const t = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null; if (!t) return;
    const a = t.dataset.a, c = this.client;
    if ((t as HTMLButtonElement).disabled) return;
    if (a === 'bg') { if (e.target === t) this.close(); return; }
    e.stopPropagation();
    switch (a) {
      case 'stop': (t as HTMLButtonElement).disabled = true; this.h.stop(); break;
      case 'buyer': this.h.toBuyer(); break;
      case 'quests': this.open('quests'); break;
      case 'min': this.toggleMin(); break;
      case 'jr': this.journal('toggle'); break;
      case 'jtab': this.journal((t.dataset.tab as JTab) || 'log'); break;
      case 'back': this.close(); break;
      case 'here': c.takeOver(); break;
      case 'sell': void c.sell().then(() => this.render()); this.render(); break;
      case 'claim': void c.claim().then(() => this.render()); break;
      case 'lamp': void c.lamp().then(() => this.render()); break;
      case 'wear': void c.wear(t.dataset.uid || '').then(() => this.render()); break;
      case 'tab': this.supTab = (t.dataset.tab as 'pick') || 'pick'; this.render(); break;
      case 'pick': void c.pick(+(t.dataset.to || 0), (t.dataset.use2 || '').split(',').filter(Boolean)).then(() => this.render()); this.render(); break;
      case 'orebag': void c.oreBag().then(() => this.render()); this.render(); break;
    }
  }
  dispose(): void { clearTimeout(this.tipT); if (this.card) this.h.modal(false); if (this.jr) this.h.journal?.(false); if (this.typingOn) this.setTyping(false); this.el.remove(); }
}

/** Price with discounts — as minecore.pickPay (the game computes the same). */
export function pickPay(s: Record<string, number>, opt: Record<string, [string, number]>, have: Record<string, number>, use: string[]) {
  const out: Record<string, number> = { ...(s || {}) }, used: Record<string, number> = {};
  for (const [r, a] of Object.entries(opt || {})) {
    if (!use.includes(r)) continue;
    const t = a[0], k = +a[1] || 1, need = out[t] || 0, u = Math.min(Math.max(0, Math.floor(+have[r] || 0)), Math.ceil(need / k));
    if (!(u > 0)) continue;
    out[t] = Math.max(0, need - u * k); if (!out[t]) delete out[t]; out[r] = (out[r] || 0) + u; used[r] = u;
  }
  return { s: out, used };
}

/** Per-nick colour (same FNV-1a + palette as the site chat / src/ui chat). */
const NICK = ['#ffc94d', '#ff8a80', '#ffab6e', '#f4ff81', '#b9f6ca', '#69f0ae', '#84ffff', '#80d8ff', '#9fa8ff', '#b388ff', '#ea80fc', '#ff80ab', '#ffd180', '#a7ffeb', '#ccff90', '#ffcdd2'];
function nick(l: string): string { let x = 2166136261; const t = String(l || ''); for (let i = 0; i < t.length; i++) { x ^= t.charCodeAt(i); x = Math.imul(x, 16777619); } return NICK[(x >>> 0) % NICK.length]; }
