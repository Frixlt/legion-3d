/** Current (local) graphics setting, with the actual engine preset gates. */
import { registerSettingRow } from '../ui/settings-ext';
import { coreFeature } from './types';
export const qualityDescription = (level: number, auto: boolean): string =>
  `Сейчас: ${['Картошка','Низкое','Среднее','Высокое'][level] || 'неизвестно'} (q${level})${auto ? ' · Авто' : ''}.\n` +
  'q0–1: без теней и постобработки; малое разрешение. q2: постобработка, без теней. q3: тени и постобработка.';
export default coreFeature({ id:'quality-info',order:118,setup(ctx){
  return registerSettingRow({key:'l3d.info.quality',kind:'info',label:'Что меняет качество',group:'Графика',order:1,
    text:()=>{let raw='auto';try{raw=localStorage.getItem('l3d.quality') || 'auto';}catch{ /* local storage denied */ }
      return qualityDescription(ctx.quality(),raw==='auto');},
  });
} });
