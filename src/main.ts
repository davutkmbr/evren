import './core/style.css';
import { Engine } from './core/engine';
import type { PipelineFactory, System } from './core/contracts';

/**
 * Systems are imported dynamically and independently: a module that fails to load (for example while it is being
 * edited during development) is skipped with a console error instead of leaving the whole game on a blank page.
 * Registration order = init order (UI first so it can show the loading screen); update order comes from `order`.
 */
const SYSTEMS: readonly { name: string; load: () => Promise<() => System> }[] = [
  { name: 'ui', load: () => import('./ui').then((m) => m.createUiSystem) },
  { name: 'geo', load: () => import('./world/geo').then((m) => m.createGeoSystem) },
  { name: 'sky', load: () => import('./render/sky').then((m) => m.createSkySystem) },
  { name: 'weather', load: () => import('./render/weather').then((m) => m.createWeatherSystem) },
  { name: 'terrain', load: () => import('./world/terrain').then((m) => m.createTerrainSystem) },
  { name: 'water', load: () => import('./world/water').then((m) => m.createWaterSystem) },
  { name: 'city', load: () => import('./world/city').then((m) => m.createCitySystem) },
  { name: 'osm', load: () => import('./world/osm').then((m) => m.createOsmSystem) },
  { name: 'street-layer', load: () => import('./world/street').then((m) => m.createStreetLayerSystem) },
  { name: 'vegetation', load: () => import('./world/vegetation').then((m) => m.createVegetationSystem) },
  { name: 'mosques', load: () => import('./world/landmarks/mosques').then((m) => m.createMosqueSystem) },
  { name: 'structures', load: () => import('./world/landmarks/structures').then((m) => m.createStructureSystem) },
  { name: 'heritage', load: () => import('./world/landmarks/heritage').then((m) => m.createHeritageSystem) },
  { name: 'perches', load: () => import('./world/perches').then((m) => m.createPerchSystem) },
  { name: 'clouds', load: () => import('./render/clouds').then((m) => m.createCloudSystem) },
  { name: 'dragon-model', load: () => import('./dragon/model').then((m) => m.createDragonModelSystem) },
  { name: 'flight', load: () => import('./dragon/flight').then((m) => m.createFlightSystem) },
  { name: 'camera', load: () => import('./camera').then((m) => m.createCameraSystem) },
  { name: 'life', load: () => import('./world/life').then((m) => m.createLifeSystem) },
  { name: 'activities', load: () => import('./activities').then((m) => m.createActivitySystem) },
  { name: 'moments', load: () => import('./moments/system').then((m) => m.createMomentSystem) },
  { name: 'fx', load: () => import('./fx').then((m) => m.createFxSystem) },
  { name: 'audio', load: () => import('./audio').then((m) => m.createAudioSystem) },
  { name: 'collider-overlay', load: () => import('./core/collider-overlay').then((m) => m.createColliderOverlaySystem) },
];

async function boot(): Promise<void> {
  const engine = new Engine({ container: document.getElementById('app')! });

  const [pipeline, ...factories] = await Promise.all([
    import('./render/post')
      .then((m): PipelineFactory => m.createRenderPipeline)
      .catch((e: unknown) => {
        console.error('[boot] render pipeline failed to load, using the direct pipeline', e);
        return null;
      }),
    ...SYSTEMS.map((s) =>
      s.load().catch((e: unknown) => {
        console.error(`[boot] system "${s.name}" failed to load, skipping it`, e);
        return null;
      }),
    ),
  ]);

  if (pipeline) {
    engine.setPipeline(pipeline);
  }
  factories.forEach((factory, i) => {
    if (!factory) {
      return;
    }
    try {
      engine.register(factory());
    } catch (e) {
      console.error(`[boot] system "${SYSTEMS[i].name}" failed to construct, skipping it`, e);
    }
  });

  await engine.start();
}

void boot();
