/** In-memory orbit screenshots: no upload, no persistence, no account action. */
import { coreFeature } from './types';
export default coreFeature({ id:'snapshot',order:121,setup(ctx){
  const shadow=ctx.uiRoot.querySelector('.l3d-ui')?.shadowRoot;
  const ui=shadow?.querySelector<HTMLElement>('.ui');
  if (!shadow || !ui) return;
  let first:HTMLCanvasElement|null=null,after:HTMLCanvasElement|null=null,version='';let panel:HTMLElement|null=null;
  const gearSignature=()=>JSON.stringify(ctx.store.hero?.items.filter((it)=>it.on).map((it)=>it.uid).sort()||[]);
  const close=()=>{panel?.remove();panel=null;};
  const capture=()=>{
    if(ctx.state.menu!=='gear')return;
    const source=ctx.engine.renderer.domElement;
    const cv=document.createElement('canvas');cv.width=Math.min(source.width,800);cv.height=Math.round(source.height*cv.width/source.width);
    const g=cv.getContext('2d');if(!g)return;
    try{g.drawImage(source,0,0,cv.width,cv.height);}catch{return;}
    const sig=gearSignature();
    if(!first||sig===version){first=cv;after=null;version=sig;ctx.ui.toast('Снимок «до» готов. Смените экипировку и снимите ещё раз.');close();return;}
    after=cv;close();panel=document.createElement('div');panel.className='compare-panel';panel.style.cssText='position:absolute;left:15%;top:15%;width:min(650px,70vw);padding:16px;background:#241a2df5;border:1px solid #ffcf6a;border-radius:16px;pointer-events:auto;z-index:90;color:#ffe5bb;box-shadow:0 12px 45px #000a;';
    const title=document.createElement('div');title.textContent='До / после · только в этом сеансе';title.style.cssText='font-weight:800;margin-bottom:10px;';
    const frame=document.createElement('div');frame.style.cssText='position:relative;width:100%;aspect-ratio:'+cv.width+'/'+cv.height+';overflow:hidden;';
    const a=document.createElement('img'),b=document.createElement('img');a.src=first.toDataURL('image/png');b.src=after.toDataURL('image/png');
    for(const im of [a,b])im.style.cssText='position:absolute;width:100%;height:100%;inset:0;object-fit:contain;';
    b.style.clipPath='inset(0 50% 0 0)';frame.append(a,b);
    for (const [label,side] of [['До','left'],['После','right']] as const) { const tag=document.createElement('span');tag.textContent=label;tag.style.cssText='position:absolute;top:8px;'+side+':8px;background:#211829dc;padding:3px 8px;border-radius:6px;color:#ffe6af;font-weight:bold;';frame.append(tag); }
    const slider=document.createElement('input');slider.type='range';slider.min='0';slider.max='100';slider.value='50';slider.setAttribute('aria-label','Сравнение до и после');slider.style.width='100%';slider.oninput=()=>{b.style.clipPath='inset(0 '+(100-Number(slider.value))+'% 0 0)';};
    const x=document.createElement('button');x.type='button';x.textContent='Закрыть';x.style.cssText='background:#5e3b53;color:white;border:0;border-radius:8px;padding:7px 12px;cursor:pointer;';x.onclick=close;
    panel.append(title,frame,slider,x);ui.append(panel);
  };
  const onClick=(event:Event)=>{if((event.target as Element)?.closest('[data-gear-snapshot]'))capture();};
  shadow.addEventListener('click',onClick);
  const unsub=ctx.onMenu((id)=>{if(id!=='gear'){close();first=null;after=null;}});
  return ()=>{shadow.removeEventListener('click',onClick);unsub();close();first=null;after=null;};
} });
