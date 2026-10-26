/** Built-in features get the CoreContext (GameContext + the game's own services); external ones only GameContext. */
import type { Feature } from '../contracts/ext';
import type { CoreContext } from '../core/context';

export interface CoreFeature extends Omit<Feature, 'setup'> {
  setup(ctx: CoreContext): ReturnType<Feature['setup']>;
}
/** Helper for typing a built-in feature. */
export const coreFeature = (f: CoreFeature): CoreFeature => f;
