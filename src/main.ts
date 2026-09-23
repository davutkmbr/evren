import './core/style.css';
import { Engine } from './core/engine';
import { createRenderPipeline } from './render/post';
import { createGeoSystem } from './world/geo';
import { createSkySystem } from './render/sky';
import { createCloudSystem } from './render/clouds';
import { createTerrainSystem } from './world/terrain';
import { createWaterSystem } from './world/water';
import { createCitySystem } from './world/city';
import { createVegetationSystem } from './world/vegetation';
import { createMosqueSystem } from './world/landmarks/mosques';
import { createStructureSystem } from './world/landmarks/structures';
import { createHeritageSystem } from './world/landmarks/heritage';
import { createLifeSystem } from './world/life';
import { createDragonModelSystem } from './dragon/model';
import { createFlightSystem } from './dragon/flight';
import { createCameraSystem } from './camera';
import { createFxSystem } from './fx';
import { createAudioSystem } from './audio';
import { createUiSystem } from './ui';

async function boot(): Promise<void> {
  const engine = new Engine({ container: document.getElementById('app')! });
  engine.setPipeline(createRenderPipeline);

  // Registration order = init order (UI first so it can show the loading screen).
  // Update order is controlled by each system's `order`.
  engine
    .register(createUiSystem())
    .register(createGeoSystem())
    .register(createSkySystem())
    .register(createTerrainSystem())
    .register(createWaterSystem())
    .register(createCitySystem())
    .register(createVegetationSystem())
    .register(createMosqueSystem())
    .register(createStructureSystem())
    .register(createHeritageSystem())
    .register(createCloudSystem())
    .register(createDragonModelSystem())
    .register(createFlightSystem())
    .register(createCameraSystem())
    .register(createLifeSystem())
    .register(createFxSystem())
    .register(createAudioSystem());

  await engine.start();
}

void boot();
