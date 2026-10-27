/**
 * Seasonal events registry. A new holiday = one file in src/events/<id>.ts (a SeasonalEvent) + one line in EVENTS.
 * See src/events/README.md.
 */
import type { SeasonalEvent } from './types';
import halloween from './halloween';
import newyear from './newyear';
import summer from './summer';
import aprilfools from './aprilfools';

export * from './types';
export { inWindow, windowDistance, pickEvent, parseMode } from './calendar';

/** Registered events, in priority order (the first with an open window wins). */
export const EVENTS: SeasonalEvent[] = [halloween, newyear, summer, aprilfools];

/** Setting key of the «Праздничное оформление» row (values 'auto' | 'on' | 'off'). */
export const EVENT_SETTING = 'l3d.event.mode';
/** Setting key of «Какое событие» (used with «Всегда»): 'near' or an event id. */
export const EVENT_PICK_SETTING = 'l3d.event.pick';
