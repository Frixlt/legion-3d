export type Filter = 'none' | 'warm' | 'cold' | 'sepia' | 'night';
export interface PhotoOptions { pose: 'idle' | 'wave' | 'cheer' | 'sit' | 'sleep'; filter: Filter; vignette: number; names: boolean; hud: boolean; watermark: boolean; }
export function photoPanel(options: PhotoOptions, change: () => void, capture: () => void, exit: () => void, reset: () => void, fly: () => void): HTMLElement {
  const panel = document.createElement('section'); panel.className = 'l3d-photo';
  panel.setAttribute('aria-label', 'Фоторежим');
  const style = document.createElement('style');
  style.textContent = `.l3d-photo{--gold:var(--l3d-gold,#ffcf6a);position:fixed;z-index:170;right:18px;top:50%;transform:translateY(-50%);width:228px;box-sizing:border-box;padding:19px;border:1px solid #e5ae6977;border-radius:14px;background:linear-gradient(150deg,#302534f5,#17131ff2);box-shadow:0 16px 55px #08040bd9,inset 0 1px #fff2;color:#f6e8d9;font:600 12px/1.4 var(--l3d-tx,'Nunito',sans-serif);pointer-events:auto}.l3d-photo h2{font:800 19px var(--l3d-hd,'Comfortaa',sans-serif);color:var(--gold);margin:0 0 2px}.l3d-photo p{color:#b9a9b9;font-size:10px;margin:0 0 14px}.l3d-photo label{display:block;color:#d3bfbe;margin:10px 0 3px}.l3d-photo select,.l3d-photo button{font:inherit;background:#3b3041;color:#f7e9da;border:1px solid #b38e7866;border-radius:7px;padding:7px;width:100%;box-sizing:border-box}.l3d-photo select:focus-visible,.l3d-photo button:focus-visible{outline:2px solid var(--gold)}.l3d-photo input[type=range]{width:100%;accent-color:var(--gold)}.l3d-photo .check{display:flex;gap:8px;align-items:center}.l3d-photo .check input{accent-color:var(--gold)}.l3d-photo .actions{display:flex;gap:6px;margin-top:15px}.l3d-photo .actions button:first-child{background:#ad7847;color:#18111b;font-weight:800}.l3d-photo .actions button{cursor:pointer}.l3d-photo .fly{margin-top:9px;cursor:pointer}`;
  panel.append(style);
  const h = document.createElement('h2'); h.textContent = '✦ Фоторежим'; panel.append(h);
  const hint = document.createElement('p'); hint.textContent = 'WASD / Q E — полёт · Shift — медленно · колесо — зум'; panel.append(hint);
  function select(label: string, values: [string,string][], value: string, set: (s:string)=>void) {
    const l=document.createElement('label'); l.textContent=label; const s=document.createElement('select');
    for (const [v,t] of values) {const o=document.createElement('option');o.value=v;o.textContent=t;s.append(o);} s.value=value;
    s.addEventListener('change',()=>{set(s.value);change();});panel.append(l,s);
  }
  select('Поза героя', [['idle','Обычная'],['wave','Приветствие'],['cheer','Радость'],['sit','Сидит'],['sleep','Спит']], options.pose, s=>options.pose=s as PhotoOptions['pose']);
  select('Фильтр', [['none','Без фильтра'],['warm','Тёплый'],['cold','Холодный'],['sepia','Сепия'],['night','Ночное зрение']], options.filter,s=>options.filter=s as Filter);
  const l=document.createElement('label'); l.textContent='Виньетка';const range=document.createElement('input');range.type='range';range.min='0';range.max='100';range.value=String(options.vignette);range.addEventListener('input',()=>{options.vignette=Number(range.value);change();});panel.append(l,range);
  for(const [key,text] of [['names','Скрыть имена и пузыри'],['hud','Скрыть интерфейс'],['watermark','Подпись Legion 3D']] as const){const label=document.createElement('label');label.className='check';const input=document.createElement('input');input.type='checkbox';input.checked=options[key];input.addEventListener('change',()=>{options[key]=input.checked;change();});label.append(input,document.createTextNode(text));panel.append(label);}
  const actions=document.createElement('div');actions.className='actions';for(const [text,fn] of [['Снимок ↵',capture],['Выход Esc',exit]] as const){const b=document.createElement('button');b.textContent=text;b.type='button';b.addEventListener('click',fn);actions.append(b);}panel.append(actions);
  const resetButton=document.createElement('button');resetButton.className='fly';resetButton.textContent='Сброс камеры R';resetButton.addEventListener('click',reset);panel.append(resetButton);
  const f=document.createElement('button');f.className='fly';f.textContent='Полёт с мышью';f.addEventListener('click',fly);panel.append(f);
  return panel;
}

export function composePhoto(source: HTMLCanvasElement, options: PhotoOptions): HTMLCanvasElement {
  const out=document.createElement('canvas');out.width=source.width;out.height=source.height;
  const c=out.getContext('2d')!;
  const filters: Record<Filter,string>={none:'none',warm:'sepia(.2) saturate(1.17) brightness(1.04)',cold:'saturate(.8) hue-rotate(12deg) contrast(1.06)',sepia:'sepia(.78) contrast(1.05)',night:'grayscale(1) sepia(1) hue-rotate(65deg) saturate(3) contrast(1.3)'};
  c.filter=filters[options.filter];c.drawImage(source,0,0);c.filter='none';
  if(options.vignette){const r=Math.max(out.width,out.height);const g=c.createRadialGradient(out.width/2,out.height/2,r*.13,out.width/2,out.height/2,r*.75);g.addColorStop(0,'#0000');g.addColorStop(1,`rgba(14,8,22,${options.vignette/135})`);c.fillStyle=g;c.fillRect(0,0,out.width,out.height);}
  if(options.watermark){const size=Math.round(Math.max(14,out.width*.014));c.font=`600 ${size}px sans-serif`;c.textAlign='right';c.shadowColor='#000';c.shadowBlur=8;c.fillStyle='rgba(255,234,203,.76)';c.fillText('✦ Legion 3D',out.width-size,out.height-size);}
  return out;
}
