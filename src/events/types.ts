/**
 * Seasonal events: a tiny framework. An event is a file in src/events/ that exports a SeasonalEvent and is added to
 * EVENTS in src/events/index.ts. The feature src/features/seasonal.ts decides which one runs (date window + the
 * «События» setting + the dev override), calls setup() with the city and disposes it when the event ends or is
 * switched off. Dispose must leave the scene exactly as it was before setup().
 */
import type * as THREE from 'three';
import type { CityLayout, QualityLevel, World3D } from '../contracts';
import type { World3DExt } from '../contracts/ext';

/** What an event can use. Everything it adds must go under `group` (or be reverted in the returned disposer). */
export interface EventContext {
  /** Parent of everything the event adds (a sibling of the world root; hidden by the host inside rooms). */
  group: THREE.Group;
  scene: THREE.Scene;
  world: World3D & Partial<World3DExt>;
  layout: CityLayout;
  /** City ground height (m) at a point in metres. */
  groundAt(X: number, Z: number): number;
  /** Per-frame hook; returns an unsubscribe. dt in seconds, t = game time in seconds. */
  onFrame(fn: (dt: number, t: number) => void): () => void;
  /** Current quality level (0..3). */
  quality(): QualityLevel;
  /** Called when the quality level changes. */
  onQuality(fn: (q: QualityLevel) => void): () => void;
  /** Renderer pixel height + camera (for point-size uniforms). */
  renderer: { domElement: { height: number } } | null;
  camera: THREE.PerspectiveCamera;
  /** Short message to the player (toast). */
  toast(text: string): void;
}

export type EventDispose = () => void;

export interface SeasonalEvent {
  id: string;
  /** Russian title for the settings sub-line / toast. */
  title: string;
  /** Is the event's date window open? Local time. */
  active(date: Date): boolean;
  /** Nearest day of the window to `date`, in days (0 inside); used to pick an event when the mode is «Всегда». */
  distance?(date: Date): number;
  /** Build the decorations. Must be reversible: the returned disposer restores everything. */
  setup(ctx: EventContext): EventDispose;
}

/** The «Праздничное оформление» setting. */
export type EventMode = 'auto' | 'on' | 'off';
