import { describe, it, expect } from 'vitest';
import { presentSelection } from '../src/collect/showcase';
import { earnedMedals } from '../src/collect/medals';
import { milestones } from '../src/collect/milestones';
import type { Item } from '../src/contracts';
const item = (uid:string,on=false):Item => ({uid,id:uid,name:uid,slot:'weapon',rarity:'rare',stats:{},on});
describe('collection visuals',()=>{
  it('keeps at most 3 bag items, discards vanished/equipped and duplicate uids',()=>expect(presentSelection(['x','x','y','z','w','u'],[item('x'),item('y',true),item('z'),item('w'),item('u')])).toEqual(['x','z','w']));
  it('does not hallucinate awards and caps labels in UI',()=>{expect(earnedMedals(null)).toEqual([]);expect(earnedMedals({aw:[{n:'Награда',i:'🏅'}, {name:'Не добыта',earned:false}]})).toEqual([{name:'Награда',icon:'🏅'}]);});
  it('deduplicates journal ids and marks only the earliest loaded win per day',()=>{const d=Date.UTC(2025,0,1);expect(milestones([{id:'a',at:d+1000,k:'fight',r:'win',t:'fight'},{id:'a',at:d+1000,k:'fight',r:'win',t:'fight'},{id:'b',at:d+2000,k:'fight',r:'win',t:'fight'},{id:'c',at:d+3000,k:'find',t:'Редкая вещь'}]).map((x)=>x.id)).toEqual(['c','a']);});
});
