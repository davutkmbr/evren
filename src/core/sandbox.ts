import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PipelineFactory, System } from './contracts';
import { UpdateOrder } from './contracts';
import { Engine } from './engine';
import './style.css';

export interface SandboxOptions {
  /** Systems to run (in init order). */
  systems: System[];
  /** Optional pipeline (default: direct render with AgX). */
  pipeline?: PipelineFactory;
  /** Add OrbitControls on the camera (when no camera system is included). */
  orbit?: boolean;
  orbitTarget?: THREE.Vector3;
  cameraPosition?: THREE.Vector3;
  /** Add a hemisphere + directional light and a sky-blue background when no sky system is included. */
  basicLighting?: boolean;
  /** Add a 2 km ground grid for scale. */
  grid?: boolean;
}

/**
 * Module test harness used by sandbox/*.html pages. Screenshots: `npm run snap -- --url /sandbox/<name>.html`.
 */
export async function startSandbox(opts: SandboxOptions): Promise<Engine> {
  const container = document.getElementById('app')!;
  const engine = new Engine({ container, sandbox: true });
  const ctx = engine.ctx;
  if (opts.pipeline) {
    engine.setPipeline(opts.pipeline);
  }
  if (opts.basicLighting) {
    const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x6b5a45, 1.2);
    const sun = new THREE.DirectionalLight(0xfff1dd, 3.0);
    sun.position.set(300, 400, 200);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 60;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.far = 2000;
    ctx.scene.add(hemi, sun);
    ctx.scene.background = new THREE.Color(0x8fb4dc);
  }
  if (opts.grid) {
    const grid = new THREE.GridHelper(2000, 200, 0x444444, 0x666666);
    ctx.scene.add(grid);
  }
  if (opts.cameraPosition) {
    ctx.camera.position.copy(opts.cameraPosition);
  }
  for (const s of opts.systems) {
    engine.register(s);
  }
  if (opts.orbit) {
    const controls = new OrbitControls(ctx.camera, ctx.canvas);
    controls.target.copy(opts.orbitTarget ?? new THREE.Vector3());
    controls.enableDamping = true;
    controls.update();
    engine.register({ name: 'orbit', order: UpdateOrder.Camera, update: () => controls.update() });
  }
  await engine.start();
  return engine;
}
