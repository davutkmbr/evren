/**
 * Viewpoints (phase 03): spots where the dragon can land and watch the city — bridge tower tops, the Galata cap,
 * the Süleymaniye dome, Kız Kulesi, Rumeli Hisarı, the Sapphire roof and the hills. Data + service layer only:
 * waits for 'geo', resolves every catalogue entry to a grip point and provides the 'perches' service.
 */
import type { EngineContext, System } from '../../core/contracts';
import { UpdateOrder } from '../../core/contracts';
import { buildPerchService } from './service';

export { PERCH_DATA } from './data';
export { buildPerchService, PerchServiceImpl } from './service';

/** Creates the perch system; provides the 'perches' service (PerchService) during init, once geo is ready. */
export function createPerchSystem(): System {
  let owner: EngineContext | null = null;
  return {
    name: 'perches',
    order: UpdateOrder.World,
    async init(ctx) {
      const geo = await ctx.services.when('geo');
      const service = buildPerchService(geo);
      ctx.services.provide('perches', service);
      owner = ctx;
      console.info(`[perches] ready (${service.points.length} viewpoints)`);
    },
    dispose() {
      owner?.services.withdraw('perches');
      owner = null;
    },
  };
}
