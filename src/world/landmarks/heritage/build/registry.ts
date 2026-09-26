import type { SiteBuilder } from './site';
import { buildAqueduct } from './sites/aqueduct';
import { buildBeylerbeyi } from './sites/beylerbeyi';

/** Site builders by landmark id (geo.landmarks entries with builder === 'heritage'). */
export const SITE_BUILDERS: Record<string, SiteBuilder> = {
  'beylerbeyi-sarayi': buildBeylerbeyi,
  'bozdogan-kemeri': buildAqueduct,
};
