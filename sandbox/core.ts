/** Example sandbox: placeholder world + dragon with the real pipeline. Copy this pattern for module sandboxes. */
import * as THREE from 'three';
import { startSandbox } from '../src/core/sandbox';
import { createRenderPipeline } from '../src/render/post';
import { createGeoSystem } from '../src/world/geo';
import { createSkySystem } from '../src/render/sky';
import { createTerrainSystem } from '../src/world/terrain';
import { createWaterSystem } from '../src/world/water';
import { createDragonModelSystem } from '../src/dragon/model';
import { createFlightSystem } from '../src/dragon/flight';
import { createCameraSystem } from '../src/camera';

void startSandbox({
  pipeline: createRenderPipeline,
  systems: [
    createGeoSystem(),
    createSkySystem(),
    createTerrainSystem(),
    createWaterSystem(),
    createDragonModelSystem(),
    createFlightSystem(),
    createCameraSystem(),
  ],
  cameraPosition: new THREE.Vector3(0, 300, 500),
});
