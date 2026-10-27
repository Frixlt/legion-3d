/** SSE health is advisory; this never triggers a request or retries on behalf of the site. */
import { coreFeature } from './types';
export type LinkState = 'healthy' | 'fallback' | 'offline';
export function linkState(open: boolean, lastHeartbeat: number, now: number): LinkState {
  if (open && now - lastHeartbeat < 30000) return 'healthy';
  return now - lastHeartbeat < 30000 ? 'fallback' : 'offline';
}
export default coreFeature({ id: 'netstatus', order: 123, setup(ctx) {
  const e=document.createElement('div');e.className='l3d-netstatus';e.setAttribute('role','status');e.setAttribute('aria-live','polite');
  e.style.cssText='position:absolute;top:58px;right:14px;z-index:30;padding:5px 9px;background:#271d2beb;border:1px solid #fbd49b66;border-radius:12px;color:#ffdfad;font:700 11px sans-serif;pointer-events:none;';
  const ui=ctx.uiRoot.querySelector('.l3d-ui')?.shadowRoot?.querySelector<HTMLElement>('.ui');
  if (!ui) return; ui.append(e);
  let open = false, pulse=Date.now();
  const bus=window.__L3D_BUS;
  const onOpen=()=>{open=true;pulse=Date.now();update();};
  const onError=()=>{open=false;update();};
  const onBeat=()=>{pulse=Date.now();update();};
  const unsub=[bus?.on('sse:open',onOpen),bus?.on('sse:error',onError),bus?.on('sse:city',onBeat),ctx.store.on('hero',onBeat),ctx.store.on('walkers',onBeat)];
  const update=()=>{const state=linkState(open,pulse,Date.now());e.hidden=state==='healthy';e.textContent=state==='fallback'?'резерв':'нет связи';};
  update();const timer=window.setInterval(update,5000);
  return ()=>{clearInterval(timer);unsub.forEach((u)=>u?.());e.remove();};
} });
