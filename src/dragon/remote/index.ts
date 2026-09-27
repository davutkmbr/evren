/**
 * Remote dragons (phase 26 stage 1): other players' dragons drawn from network snapshots. Provides the
 * 'remoteDragons' service; the network client (later) pushes what the server relays. The shared kit (geometry,
 * textures) is built on the first dragon, so a single-player game pays nothing.
 *
 * Local test without a server (DEV_TOOLS only): `?bots=N` flies N dragons that replay the local dragon's own
 * snapshots a few seconds later in formation, through the binary codec and the interpolation buffer (./bots.ts).
 */
import * as THREE from 'three';
import { UpdateOrder, type RemoteDragonService, type System } from '../../core/contracts';
import { devParams, exposeDebug } from '../../core/dev-tools';
import { RemoteDragonKit } from './kit';
import { LOD_BANDS, RemoteDragon } from './remote-dragon';
import { SnapshotBots } from './bots';

const _eye = new THREE.Vector3();
const _light = new THREE.Vector3();

export function createRemoteDragonSystem(): System {
  const dragons = new Map<string, RemoteDragon>();
  let kit: RemoteDragonKit | undefined;
  let scene: THREE.Scene | undefined;
  let renderer: THREE.WebGLRenderer | undefined;
  let bots: SnapshotBots | undefined;
  let frame = 0;

  const service: RemoteDragonService = {
    push(id, data, offset = 0) {
      let d = dragons.get(id);
      if (!d) {
        if (!scene || !renderer) {
          return;
        }
        kit ??= new RemoteDragonKit(renderer);
        d = new RemoteDragon(id, kit);
        dragons.set(id, d);
        scene.add(d.object);
      }
      d.pushBytes(data, offset);
    },
    remove(id) {
      dragons.get(id)?.dispose();
      dragons.delete(id);
    },
    get count() {
      return dragons.size;
    },
    forEach(fn) {
      for (const [id, d] of dragons) {
        fn(id, d.object.position, d.object.visible);
      }
    },
  };

  return {
    name: 'remote-dragons',
    order: UpdateOrder.Animation + 10,
    init(ctx) {
      scene = ctx.scene;
      renderer = ctx.renderer;
      ctx.services.provide('remoteDragons', service);
      const n = Math.min(64, Math.max(0, Math.floor(Number(devParams().get('bots') ?? 0)) || 0));
      if (n > 0) {
        bots = new SnapshotBots(n, service);
        console.info(`[remote] ${n} snapshot bots`);
      }
      exposeDebug('__remoteDragons', {
        service,
        stats: () => ({
          dragons: dragons.size,
          visible: [...dragons.values()].filter((d) => d.object.visible).length,
          bands: LOD_BANDS.map((_, i) => [...dragons.values()].filter((d) => d.band === i).length),
          late: [...dragons.values()].reduce((a, d) => a + d.buffer.late, 0),
          kitTriangles: kit?.triangles ?? 0,
        }),
      });
    },
    update(dt, ctx) {
      frame++;
      if (bots) {
        const state = ctx.services.tryGet('dragon');
        const rig = ctx.services.tryGet('rig');
        if (state && rig) {
          bots.update(state, rig.getPose(), performance.now());
        }
      }
      if (!dragons.size) {
        return;
      }
      ctx.camera.getWorldPosition(_eye);
      const env = ctx.services.tryGet('env');
      if (env) {
        _light.copy(env.sunDirection);
      }
      let i = 0;
      for (const d of dragons.values()) {
        d.update(dt, _eye, frame, i++);
        if (env) {
          d.setKeyLight(_light);
        }
      }
    },
    dispose() {
      for (const d of dragons.values()) {
        d.dispose();
      }
      dragons.clear();
      kit?.dispose();
    },
  };
}
