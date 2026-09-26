/**
 * The structure volumes of src/world/landmarks/structure-volumes.ts, computed from scratch: the real structures
 * builders run in Node (clearance-scene.ts) for every modelled landmark without a ground pad (bridges), and each
 * collider becomes a plan box with its height range relative to the visible ground under it (landmarks/visible-ground.ts,
 * the ground the builders stand on). scripts/data/structure-volumes.ts writes the file; check:map compares.
 */
import type { GeoQuery } from '../../src/core/contracts';
import { isModelled } from '../../src/world/landmarks/claims';
import { CapMode, STRUCTURE_STRIDE, type StructureVolumeFile } from '../../src/world/landmarks/structure-volumes';
import { visibleGround } from '../../src/world/landmarks/visible-ground';
import { buildStructure } from './clearance-scene';

const r2 = (v: number): number => Math.round(v * 100) / 100;
/** Length (m) of each end of a deck whose pieces cap the terrain only beside the axis. */
const END_ZONE = 60;
/** A deck piece: at most this deep (m), this long along the axis (half, m) and at least this wide (half, m). */
const DECK_MAX_DEPTH = 8;
const DECK_MAX_PIECE = 8;
const DECK_MIN_HALF_WIDTH = 5;

export function computeStructureVolumes(geo: GeoQuery): StructureVolumeFile {
  const ground = visibleGround(geo);
  const structures: StructureVolumeFile['structures'] = [];
  for (const l of geo.landmarks) {
    if (l.builder !== 'structures' || (l.footprint ?? 'pad') !== 'none' || !isModelled(l)) {
      continue;
    }
    // The bridge axis (build/bridge-frame.ts BridgeFrame.fromAnchors: the ends' baseline): every box is stored with
    // its local x along it, so the terrain cap widens a deck's cut sideways only (geo/build/height.ts).
    const a = l.anchors ?? [];
    const [p, q] = a.length >= 4 ? [a[2], a[3]] : a.length >= 2 ? [a[0], a[1]] : [{ x: 0, z: 0 }, { x: 1, z: 0 }];
    const axLen = Math.hypot(q.x - p.x, q.z - p.z) || 1;
    const ax = (q.x - p.x) / axLen;
    const az = (q.z - p.z) / axLen;
    const boxes: number[] = [];
    for (const c of buildStructure(geo, l.id).colliders) {
      let cx: number;
      let cz: number;
      let hx: number;
      let hz: number;
      let yaw = 0;
      let bottom: number;
      let top: number;
      if (c.kind === 'box') {
        cx = c.center.x;
        cz = c.center.z;
        hx = c.halfSize.x;
        hz = c.halfSize.z;
        yaw = c.yaw;
        bottom = c.center.y - c.halfSize.y;
        top = c.center.y + c.halfSize.y;
      } else if (c.kind === 'cylinder') {
        cx = c.base.x;
        cz = c.base.z;
        hx = hz = c.radius;
        bottom = c.base.y;
        top = c.base.y + c.height;
      } else if (c.kind === 'sphere') {
        cx = c.center.x;
        cz = c.center.z;
        hx = hz = c.radius;
        bottom = c.center.y - c.radius;
        top = c.center.y + c.radius;
      } else {
        // Prism: its plan bounds.
        let x0 = Infinity;
        let z0 = Infinity;
        let x1 = -Infinity;
        let z1 = -Infinity;
        for (const r of c.rings) {
          for (let i = 0; i < r.length; i += 2) {
            x0 = Math.min(x0, r[i]);
            x1 = Math.max(x1, r[i]);
            z0 = Math.min(z0, r[i + 1]);
            z1 = Math.max(z1, r[i + 1]);
          }
        }
        cx = (x0 + x1) / 2;
        cz = (z0 + z1) / 2;
        hx = (x1 - x0) / 2;
        hz = (z1 - z0) / 2;
        bottom = c.bottom;
        top = c.top;
      }
      // Local x (world direction (cos yaw, -sin yaw), core/collision.ts) along the axis: else turn the box a quarter.
      if (Math.abs(Math.cos(yaw) * ax - Math.sin(yaw) * az) < Math.abs(Math.sin(yaw) * ax + Math.cos(yaw) * az)) {
        yaw += Math.PI / 2;
        [hx, hz] = [hz, hx];
      }
      yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      // Ground under the box: its corners, edge midpoints and centre.
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      let gMin = Infinity;
      let gMax = -Infinity;
      for (const [u, v] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
        const lx = u * hx;
        const lz = v * hz;
        const g = ground(cx + lx * cos + lz * sin, cz - lx * sin + lz * cos);
        gMin = Math.min(gMin, g);
        gMax = Math.max(gMax, g);
      }
      // A deck piece: a flat slab, short along the axis and wide across (the builders cut decks into ~10 m pieces).
      const deck = top - bottom <= DECK_MAX_DEPTH && hx <= DECK_MAX_PIECE && hz >= DECK_MIN_HALF_WIDTH;
      boxes.push(r2(cx), r2(cz), r2(hx), r2(hz), Math.round(yaw * 1e4) / 1e4, r2(bottom - gMax), r2(top - gMin), r2(top), deck ? CapMode.Deck : CapMode.None);
    }
    // Deck pieces within END_ZONE of either end of the deck (along the axis) cap the ground beside the axis only.
    let sMin = Infinity;
    let sMax = -Infinity;
    for (let o = 0; o < boxes.length; o += STRUCTURE_STRIDE) {
      if (boxes[o + 8] === CapMode.Deck) {
        const sAlong = boxes[o] * ax + boxes[o + 1] * az;
        sMin = Math.min(sMin, sAlong);
        sMax = Math.max(sMax, sAlong);
      }
    }
    for (let o = 0; o < boxes.length; o += STRUCTURE_STRIDE) {
      const sAlong = boxes[o] * ax + boxes[o + 1] * az;
      if (boxes[o + 8] === CapMode.Deck && (sAlong - sMin < END_ZONE || sMax - sAlong < END_ZONE)) {
        boxes[o + 8] = CapMode.DeckEnd;
      }
    }
    structures.push({ id: l.id, boxes });
  }
  return { version: 1, structures };
}
