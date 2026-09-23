/**
 * Flight sandbox.
 *   /sandbox/flight.html                  geo + sky + terrain + water + dragon + flight + camera (real pipeline)
 *   ?lite=1                               geo + flight only, basic lighting, debug dragon proxy (physics tuning)
 *   ?boxes=1                              add a few tall box colliders (buildings) around the spawn
 *   ?view=<preset>&t=<hours>&autopilot=1  as in the full app
 *   ?hud=0                                hide the telemetry overlay
 * Drive it with window.__flightTest (see src/dragon/flight/test-hook.ts).
 */
import * as THREE from 'three';
import type { DragonState, System } from '../src/core/contracts';
import { UpdateOrder } from '../src/core/contracts';
import { startSandbox } from '../src/core/sandbox';
import { createGeoSystem } from '../src/world/geo';
import { createFlightSystem } from '../src/dragon/flight';

const params = new URLSearchParams(location.search);
const lite = params.get('lite') === '1';

function telemetryOverlay(): System {
  let el: HTMLDivElement | null = null;
  let timer = 0;
  return {
    name: 'flight-hud',
    order: UpdateOrder.UI,
    init(ctx) {
      if (params.get('hud') === '0') {
        return;
      }
      el = document.createElement('div');
      el.style.cssText =
        'position:absolute;left:12px;top:12px;padding:10px 12px;background:rgba(8,10,14,.62);color:#dfe6ee;font:12px/1.45 ui-monospace,Menlo,monospace;border-radius:8px;white-space:pre;min-width:250px';
      ctx.uiRoot.appendChild(el);
    },
    update(dt, ctx) {
      timer -= ctx.time.realDt;
      if (!el || timer > 0) {
        return;
      }
      timer = 0.1;
      const t = (window as unknown as { __flightTest?: { state(): Record<string, unknown> } }).__flightTest?.state();
      const d = ctx.services.tryGet('dragon') as DragonState | undefined;
      if (!t || !d) {
        return;
      }
      const n = (k: string, digits = 1) => Number(t[k]).toFixed(digits);
      el.textContent = [
        `mode      ${t.mode}`,
        `airspeed  ${n('airspeed')} m/s   gs ${n('groundSpeed')}`,
        `alt       ${d.altitude.toFixed(0)} m   agl ${d.agl.toFixed(1)} m`,
        `vs        ${n('vy')} m/s   γ ${n('gammaDeg')}°`,
        `α / β     ${n('alphaDeg')}° / ${n('betaDeg')}°   attach ${n('attachment', 2)}`,
        `bank      ${n('bankDeg')}°   pitch ${n('pitchDeg')}°   hdg ${n('headingDeg', 0)}`,
        `load      ${d.gForce.toFixed(2)} g`,
        `effort    ${n('effort', 2)}  amp ${n('amplitude', 2)}  f ${n('frequency', 2)} Hz`,
        `wing      spread ${n('spread', 2)} sweep ${n('sweep', 2)} brake ${n('brake', 2)}`,
        `legs/hov  ${n('legsOut', 2)} / ${n('hover', 2)}   updraft ${n('updraft', 2)}`,
        `stamina   ${(Number(t.stamina) * 100).toFixed(0)}%${t.tired ? ' TIRED' : ''}${t.firing ? '  FIRE' : ''}`,
        `cpu       ${((window as unknown as { __evren?: { stats(): { cpuBySystem: Record<string, number> } } }).__evren?.stats().cpuBySystem.flight ?? 0).toFixed(3)} ms`,
      ].join('\n');
      void dt;
    },
  };
}

/** Lightweight stand-in so the physics can be judged without the full rig/world stack. */
function debugDragon(): System {
  return {
    name: 'flight-debug-proxy',
    order: UpdateOrder.Animation,
    init(ctx) {
      const root = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0x4a5a48, roughness: 0.7 });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.3, 11, 6, 12).rotateX(Math.PI / 2), mat);
      const wingGeo = new THREE.BoxGeometry(11, 0.15, 4).translate(5.5, 0, 0);
      const wl = new THREE.Mesh(wingGeo, mat);
      const wr = new THREE.Mesh(wingGeo, mat);
      wl.scale.x = -1;
      root.add(body, wl, wr);
      const pose = { flapPhase: 0, flapAmplitude: 0, wingSpread: 1 } as Record<string, number>;
      ctx.services.provide('rig', {
        root,
        riderHead: new THREE.Object3D(),
        mouth: new THREE.Object3D(),
        wingTipLeft: new THREE.Object3D(),
        wingTipRight: new THREE.Object3D(),
        dimensions: { length: 18, wingspan: 24, height: 4 },
        setPose(p) {
          Object.assign(pose, p);
          const a = Math.cos(pose.flapPhase) * pose.flapAmplitude * 0.8;
          wr.rotation.z = a;
          wl.rotation.z = -a;
          wl.scale.x = -Math.max(pose.wingSpread, 0.1);
          wr.scale.x = Math.max(pose.wingSpread, 0.1);
        },
        getPose() {
          return pose as never;
        },
        setFirstPerson() {},
      });
    },
  };
}

function chaseCamera(): System {
  const offset = new THREE.Vector3(0, 6, 34);
  const target = new THREE.Vector3();
  const look = new THREE.Vector3();
  const euler = new THREE.Euler();
  const up = new THREE.Vector3(0, 1, 0);
  return {
    name: 'flight-chase-cam',
    order: UpdateOrder.Camera,
    update(dt, ctx) {
      const d = ctx.services.tryGet('dragon');
      if (!d) {
        return;
      }
      const yaw = euler.setFromQuaternion(d.quaternion, 'YXZ').y;
      target.copy(offset).applyAxisAngle(up, yaw).add(d.position);
      ctx.camera.position.lerp(target, dt > 0 ? 1 - Math.exp(-5 * dt) : 1);
      look.copy(d.position);
      ctx.camera.lookAt(look);
    },
  };
}

function testBoxes(): System {
  return {
    name: 'flight-test-boxes',
    order: UpdateOrder.World,
    init(ctx) {
      const d = ctx.services.get('dragon');
      const col = ctx.services.get('collision');
      const mat = new THREE.MeshStandardMaterial({ color: 0x9a8f80, roughness: 0.9 });
      const yaw = new THREE.Euler().setFromQuaternion(d.quaternion, 'YXZ').y;
      const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = new THREE.Vector3(fwd.z * -1, 0, fwd.x);
      for (let i = 0; i < 6; i++) {
        const p = d.position.clone().addScaledVector(fwd, 250 + i * 140).addScaledVector(right, (i % 2 ? 1 : -1) * 25);
        const ground = col.groundHeight(p.x, p.z);
        const hgt = 60 + i * 40;
        const half = new THREE.Vector3(18, hgt / 2, 18);
        const center = new THREE.Vector3(p.x, ground + hgt / 2, p.z);
        col.add({ kind: 'box', center, halfSize: half, yaw }, 'building');
        const m = new THREE.Mesh(new THREE.BoxGeometry(36, hgt, 36), mat);
        m.position.copy(center);
        m.rotation.y = yaw;
        ctx.scene.add(m);
      }
    },
  };
}

async function main(): Promise<void> {
  const systems: System[] = [];
  if (lite) {
    systems.push(createGeoSystem(), debugDragon(), createFlightSystem(), chaseCamera(), telemetryOverlay());
    if (params.get('boxes') === '1') {
      systems.push(testBoxes());
    }
    await startSandbox({ systems, basicLighting: true, grid: false });
    return;
  }
  const [{ createRenderPipeline }, { createSkySystem }, { createTerrainSystem }, { createWaterSystem }, { createDragonModelSystem }, { createCameraSystem }] =
    await Promise.all([
      import('../src/render/post'),
      import('../src/render/sky'),
      import('../src/world/terrain'),
      import('../src/world/water'),
      import('../src/dragon/model'),
      import('../src/camera'),
    ]);
  systems.push(
    createGeoSystem(),
    createSkySystem(),
    createTerrainSystem(),
    createWaterSystem(),
    createDragonModelSystem(),
    createFlightSystem(),
    createCameraSystem(),
    telemetryOverlay(),
  );
  if (params.get('boxes') === '1') {
    systems.push(testBoxes());
  }
  await startSandbox({ pipeline: createRenderPipeline, systems });
}

void main();
