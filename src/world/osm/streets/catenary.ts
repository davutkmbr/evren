/**
 * Tram overhead line: masts every ~30 m along the surface tram tracks (a centre mast between two parallel tracks,
 * otherwise a side mast on the kerb / median side) and the contact wire 5.9 m above every track, as thin crossed
 * ribbons (they vanish with distance, like real wires). The İstiklal heritage tram hangs its wire from span wires
 * between the facades instead of masts.
 */
import type { OsmData } from '../data';
import { MeshBuf } from '../shared/buffers';
import type { FootprintIndex } from '../shared/footprints';
import { segDist } from '../shared/geometry';
import { streetTramTracks } from '../shared/street-field';
import type { StreetSurface } from '../shared/street-surface';
import { type PropSink, Spacing, walkLine, yawTowards } from './sink';

const WIRE_H = 5.9;
const WIRE_W = 0.018;

export function wireMesh(): MeshBuf {
  return new MeshBuf({ position: 3 });
}

/** Wire between two 3D points as two crossed ribbons (horizontal + vertical). */
function wire(m: MeshBuf, a: number[], b: number[]): void {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const l = Math.hypot(dx, dz) || 1;
  const rx = (-dz / l) * WIRE_W;
  const rz = (dx / l) * WIRE_W;
  const h0 = m.vertex(a[0] - rx, a[1], a[2] - rz);
  const h1 = m.vertex(a[0] + rx, a[1], a[2] + rz);
  const h2 = m.vertex(b[0] + rx, b[1], b[2] + rz);
  const h3 = m.vertex(b[0] - rx, b[1], b[2] - rz);
  m.quad(h0, h1, h2, h3);
  m.quad(h0, h3, h2, h1);
  const v0 = m.vertex(a[0], a[1] - WIRE_W, a[2]);
  const v1 = m.vertex(a[0], a[1] + WIRE_W, a[2]);
  const v2 = m.vertex(b[0], b[1] + WIRE_W, b[2]);
  const v3 = m.vertex(b[0], b[1] - WIRE_W, b[2]);
  m.quad(v0, v1, v2, v3);
  m.quad(v0, v3, v2, v1);
}

export function buildCatenary(data: Pick<OsmData, 'rails'>, surface: StreetSurface, footprints: FootprintIndex, sink: PropSink): { wires: MeshBuf; masts: number } {
  const wires = wireMesh();
  const tracks = streetTramTracks(data);
  const masts = new Spacing(16);
  let count = 0;
  const wireAt = (x: number, z: number): number[] => [x, surface.heightAt(x, z) + WIRE_H, z];

  tracks.forEach((t, ti) => {
    const heritage = t.gauge < 1.2;
    // Contact wire in ~10 m chords.
    let prev: number[] | null = null;
    walkLine(t.pts, 10, 0, (x, z) => {
      const p = wireAt(x, z);
      if (prev) {
        wire(wires, prev, p);
      }
      prev = p;
    });
    const n = t.pts.length;
    if (prev && n >= 4) {
      wire(wires, prev, wireAt(t.pts[n - 2], t.pts[n - 1]));
    }
    walkLine(t.pts, 30, 8, (x, z, tx, tz) => {
      const rx = -tz;
      const rz = tx;
      if (heritage) {
        // Span wire between the facades on both sides.
        const ends: number[][] = [];
        for (const side of [1, -1]) {
          let hit: number[] | null = null;
          for (let o = 2; o < 12; o += 0.5) {
            const px = x + rx * side * o;
            const pz = z + rz * side * o;
            if (footprints.inside(px, pz)) {
              hit = [px, surface.heightAt(x, z) + WIRE_H + 0.6, pz];
              break;
            }
          }
          if (!hit) {
            return;
          }
          ends.push(hit);
        }
        wire(wires, ends[0], ends[1]);
        return;
      }
      // Parallel partner track within 2.5..5 m: centre mast between them.
      let partner = 0;
      tracks.forEach((u, ui) => {
        if (ui === ti || partner) {
          return;
        }
        for (let k = 2; k < u.pts.length; k += 2) {
          const d = segDist(x, z, u.pts[k - 2], u.pts[k - 1], u.pts[k], u.pts[k + 1]);
          if (d > 2.4 && d < 5) {
            const mx = (u.pts[k - 2] + u.pts[k]) / 2 - x;
            const mz = (u.pts[k - 1] + u.pts[k + 1]) / 2 - z;
            partner = (mx * rx + mz * rz > 0 ? 1 : -1) * d;
            return;
          }
        }
      });
      if (partner) {
        const cx = x + rx * partner * 0.5;
        const cz = z + rz * partner * 0.5;
        if (!footprints.inside(cx, cz) && masts.claim(cx, cz, 14)) {
          sink.add('catenaryCentre', cx, surface.heightAt(cx, cz) - 0.05, cz, yawTowards(tx, tz));
          count++;
        }
        return;
      }
      // Single track: side mast on the side farther from the carriageway.
      const off = 2.9;
      const lx = x - rx * off;
      const lz = z - rz * off;
      const qx = x + rx * off;
      const qz = z + rz * off;
      const side = surface.distance(qx, qz) >= surface.distance(lx, lz) ? 1 : -1;
      const px = x + rx * off * side;
      const pz = z + rz * off * side;
      if (footprints.inside(px, pz) || surface.geo.isWater(px, pz) || !masts.claim(px, pz, 14)) {
        return;
      }
      // catenarySide reaches local +Z: turn it towards the track.
      sink.add('catenarySide', px, surface.heightAt(px, pz) - 0.05, pz, Math.atan2(-rx * side, -rz * side));
      count++;
    });
  });
  return { wires, masts: count };
}
