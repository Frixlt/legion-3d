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
  /**
   * Game services for interactive events (keys, the crowd's avatars, combat). Filled by src/features/seasonal.ts in
   * the game; absent on the dev page and in tests — an event must work without it (decorations only).
   */
  game?: EventGame;
}

/** A character an event may decorate or hit (structural subset of the avatar contract + its combat hooks). */
export interface EventAvatar {
  readonly root: THREE.Object3D;
  readonly headTop: number;
  /** src/avatar AvatarCombat.combatRig(): bones (index 1 = body, the head is skinned to it), rest pose, head top. */
  combatRig?(): { bones: THREE.Bone[]; rest: THREE.Vector3[]; top: number; headTop: number; w: number } | null;
}

export interface EventGame {
  /** Register a key binding (gameplay keys: skipped while a menu is open); returns the unregister function. */
  key(id: string, code: string, label: string, run: () => boolean): () => void;
  /**
   * May the player do a street action now? Pointer locked in gameplay, on the street (not in a room or scene mode),
   * no menu / modal / text field / photo mode, and the crosshair is not on an interactable (door, goods, stone).
   */
  canAct(): boolean;
  /** Visit the other cats on the street that are shown now (id = login). Must not allocate. */
  forEachCat(fn: (id: string, av: EventAvatar) => void): void;
  /** The own character, and whether its head is on screen (third person on the street). */
  me(): { av: EventAvatar; visible: boolean } | null;
  /** A small knock-back through the combat system (client-only); false when combat is off or unavailable. */
  knock?(id: string, av: EventAvatar, vx: number, vy: number, vz: number, px: number, py: number, pz: number): boolean;
  /** Play the own throw / swing animation (FP view-model + TP avatar). */
  swing?(): void;
  /** prefers-reduced-motion. */
  reducedMotion: boolean;
}

export type EventDispose = () => void;

export interface SeasonalEvent {
  id: string;
  /** Russian title for the settings sub-line / toast. */
  title: string;
  /** Short label for the «Какое событие» setting (default: title). */
  short?: string;
  /** Toast shown the first time the event starts on a day in «Авто» mode. */
  greeting?: string;
  /** Is the event's date window open? Local time. */
  active(date: Date): boolean;
  /** Nearest day of the window to `date`, in days (0 inside); used to pick an event when the mode is «Всегда». */
  distance?(date: Date): number;
  /** Build the decorations. Must be reversible: the returned disposer restores everything. */
  setup(ctx: EventContext): EventDispose;
}

/** The «Праздничное оформление» setting. */
export type EventMode = 'auto' | 'on' | 'off';
