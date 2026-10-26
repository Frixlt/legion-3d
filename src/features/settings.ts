/** Settings: re-read gameplay settings on 'l3d:settings' (FOV, names, bubbles, mouse). */
import { SET, readSettings } from '../core/settings';
import { coreFeature } from './types';

export default coreFeature({
  id: 'settings',
  order: 0,
  setup(ctx) {
    const apply = () => {
      readSettings();
      ctx.rig.fov = SET.fov;
      ctx.labels.configure({ range: SET.names === 'near' ? 'near' : 'all' });
      ctx.labels.root.visible = SET.names !== 'off' && !ctx.state.inRoom;
    };
    ctx.labels.configure({ range: SET.names === 'near' ? 'near' : 'all', showMe: true, max: 20 });
    apply();
    window.addEventListener('l3d:settings', apply);
    return () => window.removeEventListener('l3d:settings', apply);
  },
});
