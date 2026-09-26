import type { SiteBuilder } from './site';
import { buildAqueduct } from './sites/aqueduct';
import { buildBeylerbeyi } from './sites/beylerbeyi';
import { buildCiragan } from './sites/ciragan';
import { buildDolmabahce } from './sites/dolmabahce';
import { buildAnadoluHisari, buildYedikule } from './sites/fortress-towers';
import { buildHaydarpasa } from './sites/haydarpasa';
import { buildHipodrom } from './sites/hipodrom';
import { buildKuleli } from './sites/kuleli';
import { buildRumeliHisari } from './sites/rumeli-hisari';
import { buildSelimiye } from './sites/selimiye';
import { buildSirkeci } from './sites/sirkeci';
import { buildTopkapi } from './sites/topkapi';

/** Site builders by landmark id (geo.landmarks entries with builder === 'heritage'). */
export const SITE_BUILDERS: Record<string, SiteBuilder> = {
  'beylerbeyi-sarayi': buildBeylerbeyi,
  'anadolu-hisari': buildAnadoluHisari,
  'bozdogan-kemeri': buildAqueduct,
  'ciragan-sarayi': buildCiragan,
  'dolmabahce-sarayi': buildDolmabahce,
  'haydarpasa-gari': buildHaydarpasa,
  hipodrom: buildHipodrom,
  kuleli: buildKuleli,
  'rumeli-hisari': buildRumeliHisari,
  'selimiye-kislasi': buildSelimiye,
  'sirkeci-gari': buildSirkeci,
  'topkapi-sarayi': buildTopkapi,
  yedikule: buildYedikule,
};

/**
 * Sites drawn with the city-wall kit's material (walls/render/material.ts: the approved CC0 stone, brick and rubble
 * texture sets) instead of the procedural heritage material: the Roman and fortress masonry, so it matches the city
 * walls. Their builders write no floodlight (that channel is the lost-facing field in the wall material).
 */
export const WALL_MATERIAL_SITES: ReadonlySet<string> = new Set(['bozdogan-kemeri', 'rumeli-hisari', 'yedikule', 'anadolu-hisari']);
