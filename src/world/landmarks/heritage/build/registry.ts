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
