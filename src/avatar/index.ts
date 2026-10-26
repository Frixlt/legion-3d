/**
 * src/avatar — procedural 3D characters, first-person view-model, nameplates and chat bubbles.
 *
 * Conventions: model feet at y = 0, the character looks towards −Z at rotation.y = 0 (Walker.face);
 * the integrator owns root.position / root.rotation. View-model: add `vm.root` to the camera; camera.near = 0.03.
 */
import type { AvatarKit, Labels } from '../contracts/modules';
import type { Appearance } from '../contracts';
import { createAvatar } from './avatar';
import { createViewModel, RECOMMENDED_NEAR } from './viewmodel';
import { createLabels as makeLabels, type LabelsEx } from './labels';

export { appearanceFrom, nickDefaults, normColor, CATALOG, RARITY_COLOR, jhash } from './appearance';
export type { DefaultsFn, NickDefaults } from './appearance';
export { createAvatar, createViewModel, RECOMMENDED_NEAR };
export { clampText, wrapText } from './labels';
export type { ViewModelEx } from './viewmodel';
export type { LabelsEx } from './labels';

export function createAvatarKit(): AvatarKit {
  return {
    create: (app: Appearance) => createAvatar(app),
    viewModel: (app: Appearance) => createViewModel(app),
  };
}

export function createLabels(): LabelsEx { return makeLabels(); }
