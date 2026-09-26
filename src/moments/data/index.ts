import type { Moment } from '../types';
import { CITY_LIFE } from './city-life';
import { LEGENDS } from './legends';
import { LITERATURE } from './literature';
import { POEMS } from './poems';

/** Every moment record, in backlog order. */
export const ALL_MOMENTS: readonly Moment[] = [...LEGENDS, ...CITY_LIFE, ...POEMS, ...LITERATURE].sort((a, b) => a.backlog - b.backlog || (a.id < b.id ? -1 : 1));
