/** Personal local-only shelf: displaying an item never invokes actions.equip. */
import * as THREE from 'three';
import { buildItemModel } from '../avatar/items';
import { readSelection, writeSelection } from '../collect/showcase';
import { registerSettingRow, settingValue } from '../ui/settings-ext';
import { coreFeature } from './types';

export default coreFeature({
  id: 'showcase', order: 115,
  setup(ctx) {
    const offSetting = registerSettingRow({ key: 'l3d.showcase.motion', label: 'Витрина: вращение', sub: 'при выключении вещи стоят неподвижно', kind: 'seg', def: 'on', options: [['on', 'Вкл'], ['off', 'Выкл']], group: 'Витрина', order: 10 });
    const offTab = ctx.uiApi.addTab('showcase', { title: 'Витрина', group: 'character', order: 65,
      render(el) {
        let closed = false, raf = 0;
        const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', 'Три объёмных предмета на полке');
        canvas.style.cssText = 'display:block;width:100%;height:210px;border-radius:16px;background:radial-gradient(ellipse at 50% 38%,#51426b,#201827 76%);';
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(30, 3, .1, 30); camera.position.set(0, 2.2, 9); camera.lookAt(0,.5,0);
        const lamp = new THREE.HemisphereLight(0xffedce, 0x3c385b, 2.4); scene.add(lamp);
        const shelf = new THREE.Mesh(new THREE.BoxGeometry(6.8,.15,1.5), new THREE.MeshStandardMaterial({ color: 0x785358, roughness: .82 })); shelf.position.y = -.55; scene.add(shelf);
        let models: THREE.Object3D[] = [];
        let renderer: THREE.WebGLRenderer | null = null;
        const draw = () => {
          const h = ctx.store.hero;
          const ids = h ? readSelection(h.login, h.items) : [];
          if (h) { try { const old = JSON.parse(localStorage.getItem('l3d.showcase.' + encodeURIComponent(h.login)) || '[]'); if (JSON.stringify(old) !== JSON.stringify(ids)) writeSelection(h.login,ids); } catch { /* storage disabled */ } }
          const slots = h?.items.filter((i) => !i.on) || [];
          const host = document.createElement('div'); host.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0 18px;';
          for (let j=0;j<3;j++) { const item = slots.find((i) => i.uid === ids[j]); const e = document.createElement('div'); e.style.cssText = 'min-width:0;text-align:center;background:#291d31;border:1px solid #ffcf6a55;border-radius:10px;padding:8px;color:#ffddab;'; e.textContent = item?.name || 'Свободное место'; host.appendChild(e); }
          const list = document.createElement('div'); list.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
          for (const item of slots) { const btn = document.createElement('button'); btn.type='button'; btn.textContent=(ids.includes(item.uid) ? '★ ' : '☆ ') + item.name; btn.setAttribute('aria-pressed',String(ids.includes(item.uid))); btn.style.cssText='cursor:pointer;color:#ffe8c5;background:#342439;border:1px solid #b58d6b;border-radius:16px;padding:7px 12px;'; btn.onclick=()=>{ if (!h) return; const next = ids.includes(item.uid) ? ids.filter((id)=>id!==item.uid) : ids.length < 3 ? [...ids,item.uid] : ids; if (next === ids && !ids.includes(item.uid)) ctx.ui.toast('На полке не больше трёх вещей.'); writeSelection(h.login,next); draw(); }; list.appendChild(btn); }
          el.replaceChildren(canvas,host,list);
          models.forEach((o) => scene.remove(o)); models=[];
          if (ctx.quality() === 0) { canvas.style.display='none'; return; } canvas.style.display='block';
          ids.forEach((id,j)=> { const item = slots.find((i)=>i.uid===id); if (!item) return; try { const model=buildItemModel(ctx.registries.itemModels,item); const box=new THREE.Box3().setFromObject(model); const size=box.getSize(new THREE.Vector3()); const scale=1.05 / Math.max(size.x,size.y,size.z,.1); model.scale.multiplyScalar(scale); const center=box.getCenter(new THREE.Vector3()).multiplyScalar(scale); model.position.set((j-1)*2.1-center.x,.16-center.y,-center.z); scene.add(model); models.push(model); } catch { /* unsupported item model */ } });
          if (!renderer) { try { renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:false}); renderer.setPixelRatio(Math.min(devicePixelRatio,1.5)); renderer.setSize(630,210,false); } catch { canvas.style.display='none'; } }
        };
        draw();
        const tick=(t:number)=> { if(closed) return; if(renderer && ctx.quality()>0 && !document.hidden){ if(settingValue('l3d.showcase.motion','on')==='on' && !matchMedia('(prefers-reduced-motion: reduce)').matches) for(const model of models) model.rotation.y=t*.00035; renderer.render(scene,camera); } raf=requestAnimationFrame(tick); }; raf=requestAnimationFrame(tick);
        const offHero=ctx.store.on('hero',draw);
        return ()=> { closed=true;cancelAnimationFrame(raf);offHero();renderer?.dispose();shelf.geometry.dispose();(shelf.material as THREE.Material).dispose(); };
      },
    });
    return ()=>{ offTab();offSetting(); };
  },
});
