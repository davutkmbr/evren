import * as THREE from 'three';
import type { GeoQuery } from '../../../core/contracts';
import type { Collider } from '../../../core/collision';
import { Detail, Emit, MeshBuilder, surf } from '../util/mesh-builder';
import { inflate, prism, rect, slab, windowsOnPolygon } from '../vessels/parts';
import type { Berth } from '../vessels/routes';

export interface PierLamp {
  x: number;
  y: number;
  z: number;
}

export interface PierBuild {
  geometry: THREE.BufferGeometry;
  colliders: Collider[];
  lamps: PierLamp[];
}

const CREAM = 0xe4d9bf;
const TRIM = 0x5b4a3a;
const ROOF = 0x6e7478;
const STEEL = 0x8d9396;
const SIGN_BLUE = 0x1d4f8c;

const DECK_Y = 1.7;

/** Gable (pitched) roof over a rectangle centred at (cx, cz), ridge along X. */
function gableRoof(b: MeshBuilder, cx: number, y0: number, cz: number, w: number, d: number, rise: number, roofS: ReturnType<typeof surf>, wallS: ReturnType<typeof surf>): void {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const z0 = cz - d / 2;
  const z1 = cz + d / 2;
  const yr = y0 + rise;
  b.quadXYZ(x0, y0, z1, x1, y0, z1, x1, yr, cz, x0, yr, cz, roofS);
  b.quadXYZ(x1, y0, z0, x0, y0, z0, x0, yr, cz, x1, yr, cz, roofS);
  const g0 = b.vertex(x0, y0, z0, -1, 0, 0, wallS);
  const g1 = b.vertex(x0, y0, z1, -1, 0, 0, wallS);
  const g2 = b.vertex(x0, yr, cz, -1, 0, 0, wallS);
  b.tri(g0, g1, g2);
  const h0 = b.vertex(x1, y0, z1, 1, 0, 0, wallS);
  const h1 = b.vertex(x1, y0, z0, 1, 0, 0, wallS);
  const h2 = b.vertex(x1, yr, cz, 1, 0, 0, wallS);
  b.tri(h0, h1, h2);
}

/** Hipped roof (pyramid-ish) over a rectangle. */
function hipRoof(b: MeshBuilder, cx: number, y0: number, cz: number, w: number, d: number, rise: number, s: ReturnType<typeof surf>): void {
  const ridge = Math.max(w - d, 0) / 2;
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const z0 = cz - d / 2;
  const z1 = cz + d / 2;
  const yr = y0 + rise;
  const ra = new THREE.Vector3(cx - ridge, yr, cz);
  const rb = new THREE.Vector3(cx + ridge, yr, cz);
  const up = new THREE.Vector3(0, 1, 0);
  b.quadFacing(new THREE.Vector3(x0, y0, z1), new THREE.Vector3(x1, y0, z1), rb, ra, new THREE.Vector3(0, 1, 1), s);
  b.quadFacing(new THREE.Vector3(x1, y0, z0), new THREE.Vector3(x0, y0, z0), ra, rb, new THREE.Vector3(0, 1, -1), s);
  b.quadFacing(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x0, y0, z1), ra, ra.clone().add(up.clone().multiplyScalar(0)), new THREE.Vector3(-1, 1, 0), s);
  b.quadFacing(new THREE.Vector3(x1, y0, z1), new THREE.Vector3(x1, y0, z0), rb, rb.clone(), new THREE.Vector3(1, 1, 0), s);
}

/** Lamp post; returns the lamp head position (local). */
function lampPost(b: MeshBuilder, x: number, y: number, z: number, h: number): PierLamp {
  const pole = surf(0x2b2f31, { roughness: 0.5, metalness: 0.6 });
  b.cylinder(x, y, z, 0.09, 0.06, h, 6, pole, true);
  b.box(x, y + h + 0.12, z, 0.35, 0.25, 0.35, surf(0xfff1d6, { roughness: 0.3, emit: Emit.Lamp }));
  b.box(x, y + h + 0.3, z, 0.5, 0.1, 0.5, pole);
  return { x, y: y + h + 0.1, z };
}

/**
 * One ferry pier (iskele) in a local frame: x along the shore, z seaward (0 = shoreline), y up. Platform on piles,
 * fendered mooring face, a style-dependent waiting hall and lamp posts.
 */
function buildLocal(b: MeshBuilder, berth: Berth, depthAtFace: number): PierLamp[] {
  const p = berth.pier;
  const F = p.frontage;
  const R = p.reach;
  const lamps: PierLamp[] = [];
  const concrete = surf(0x9c9890, { roughness: 0.9, detail: Detail.Deck });
  const deckS = surf(0x7d7465, { roughness: 0.85, detail: Detail.Deck });
  const pileS = surf(0x4b4a45, { roughness: 0.9 });
  const fender = surf(0x161616, { roughness: 0.8 });
  const cream = surf(CREAM, { roughness: 0.8, detail: Detail.Super });
  const trim = surf(TRIM, { roughness: 0.7 });
  const roof = surf(ROOF, { roughness: 0.55, metalness: 0.5, detail: Detail.Deck });
  const glass = surf(0x1a2229, { roughness: 0.08, emit: Emit.Cabin, detail: Detail.Glass });

  // Platform slab (overlapping the shore) on piles.
  const zBack = -8;
  slab(b, rect(0, (zBack + R) / 2, F, R - zBack), DECK_Y, 0.55, deckS, concrete, concrete);
  const pileBottom = -Math.min(Math.max(depthAtFace, 3), 9);
  for (let x = -F / 2 + 1.2; x <= F / 2 - 1.2; x += 4.2) {
    for (let z = 3; z <= R - 1; z += 4.5) b.cylinder(x, pileBottom, z, 0.32, 0.32, DECK_Y - 0.5 - pileBottom, 8, pileS, false);
  }
  // Fenders along the mooring face.
  b.box(0, DECK_Y - 0.9, R + 0.2, F, 0.5, 0.4, fender);
  for (let x = -F / 2 + 2; x <= F / 2 - 2; x += 3.5) b.box(x, DECK_Y - 1.1, R + 0.35, 0.45, 2.2, 0.45, fender);
  // Bollards.
  for (let x = -F / 2 + 3; x <= F / 2 - 3; x += 9) b.cylinder(x, DECK_Y, R - 0.8, 0.2, 0.2, 0.55, 8, surf(0x222222, { roughness: 0.5, metalness: 0.5 }), true);

  const hallD = Math.min(R * 0.6, 16);
  const hallZ = 1.5 + hallD / 2;
  const style = p.style;
  if (style === 'terminal' || style === 'kadikoy' || style === 'uskudar') {
    const floors = style === 'kadikoy' ? 2 : 1;
    const hallW = F * 0.82;
    const h = floors === 2 ? 8.6 : 5.6;
    const hall = rect(0, hallZ, hallW, hallD);
    prism(b, hall, DECK_Y, h, cream, null);
    b.block(0, DECK_Y, hallZ, hallW + 0.2, 0.7, hallD + 0.2, trim, 1 | 2 | 16 | 32);
    for (let f = 0; f < floors; f++) {
      windowsOnPolygon(b, hall, DECK_Y + f * 4.2, { surf: glass, sill: 1.1, height: 2.2, width: 1.4, pitch: 2.6 });
      b.block(0, DECK_Y + f * 4.2 + 3.7, hallZ, hallW + 0.15, 0.25, hallD + 0.15, trim, 1 | 2 | 4 | 16 | 32);
    }
    slab(b, inflate(hall, 0.6), DECK_Y + h + 0.3, 0.3, roof, trim, trim);
    if (style === 'uskudar') hipRoof(b, 0, DECK_Y + h + 0.3, hallZ, hallW + 1.2, hallD + 1.2, 3.2, roof);
    else gableRoof(b, 0, DECK_Y + h + 0.3, hallZ, hallW + 1.2, hallD + 1.2, 3.0, roof, cream);
    // Covered boarding area on the seaward side.
    const cz0 = hallZ + hallD / 2;
    const canopy = rect(0, (cz0 + R - 0.5) / 2, hallW, R - 0.5 - cz0);
    if (R - 0.5 - cz0 > 2) {
      slab(b, canopy, DECK_Y + 4.3, 0.3, roof, surf(STEEL, { roughness: 0.5, metalness: 0.6 }), surf(0xb5b0a4, { roughness: 0.8 }));
      for (let x = -hallW / 2 + 0.5; x <= hallW / 2 - 0.5; x += hallW / 4) b.cylinder(x, DECK_Y, R - 1.0, 0.12, 0.12, 4.0, 8, surf(STEEL, { roughness: 0.5, metalness: 0.6 }), false);
    }
    // Name board (blue Şehir Hatları sign, lit at night) on the seaward face.
    const signY = DECK_Y + (floors === 2 ? 5.0 : 4.6) + (R - 0.5 - cz0 > 2 ? 0.1 : 0);
    b.box(0, signY + 0.6, R - 0.3, Math.min(hallW * 0.6, 14), 1.1, 0.2, surf(SIGN_BLUE, { roughness: 0.4, emit: Emit.Sign }));
    if (style === 'kadikoy') {
      // Clock tower at the landward end.
      const tz = hallZ - hallD / 2 + 2.5;
      prism(b, rect(0, tz, 4.4, 4.4), DECK_Y + h + 0.3, 7.5, cream, null);
      for (const [nx, nz] of [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
      ]) {
        b.pushTRS(nx * 2.23, DECK_Y + h + 5.6, tz + nz * 2.23, Math.atan2(nx, nz));
        b.cylinder(0, 0, 0, 0.95, 0.95, 0.06, 14, surf(0xf3efe3, { roughness: 0.5, emit: Emit.Sign }), true);
        b.pop();
      }
      hipRoof(b, 0, DECK_Y + h + 7.8, tz, 5.2, 5.2, 4.2, surf(0x4e5357, { roughness: 0.45, metalness: 0.6 }));
    }
  } else if (style === 'modern') {
    const hallW = F * 0.85;
    const h = 5.2;
    const hall = rect(0, hallZ, hallW, hallD);
    prism(b, hall, DECK_Y, h, surf(0x2a3238, { roughness: 0.2, metalness: 0.6 }), null);
    windowsOnPolygon(b, hall, DECK_Y, { surf: glass, sill: 0.25, height: h - 0.6, width: 2.2, pitch: 2.4, margin: 0.2 });
    const roofPoly = rect(0, (hallZ - hallD / 2 + R) / 2, hallW + 3, R - (hallZ - hallD / 2) + 1);
    slab(b, roofPoly, DECK_Y + h + 0.5, 0.55, surf(0xcfd2d2, { roughness: 0.6, metalness: 0.3 }), surf(0xdadcdc, { roughness: 0.4, metalness: 0.5 }), surf(0xbfc3c3, { roughness: 0.7 }));
    for (let x = -hallW / 2; x <= hallW / 2 + 0.1; x += hallW / 3) b.cylinder(x, DECK_Y, R - 0.8, 0.18, 0.18, h + 0.1, 8, surf(STEEL, { roughness: 0.4, metalness: 0.7 }), false);
    b.box(0, DECK_Y + h - 0.4, R + 0.2, Math.min(hallW * 0.55, 13), 0.9, 0.2, surf(SIGN_BLUE, { roughness: 0.4, emit: Emit.Sign }));
    for (let x = -hallW / 2 + 2; x < hallW / 2; x += 4) b.box(x, DECK_Y + h - 0.05, (hallZ + R) / 2 + 2, 0.6, 0.08, 0.6, surf(0xfff1d6, { roughness: 0.3, emit: Emit.Lamp }));
  } else {
    // Small island / village pier: timber hut with a hipped roof.
    const hut = rect(-F * 0.18, 4.5, 6, 5);
    prism(b, hut, DECK_Y, 3.1, surf(0xd9ccb0, { roughness: 0.8, detail: Detail.Wood }), null);
    windowsOnPolygon(b, hut, DECK_Y, { surf: glass, sill: 1.0, height: 1.1, width: 1.0, pitch: 2.0 });
    hipRoof(b, -F * 0.18, DECK_Y + 3.1, 4.5, 6.8, 5.8, 1.8, surf(0x8a4b35, { roughness: 0.7 }));
    b.box(-F * 0.18, DECK_Y + 2.6, 7.1, 3.2, 0.6, 0.12, surf(SIGN_BLUE, { roughness: 0.4, emit: Emit.Sign }));
    // Railings along the sides.
    for (const side of [-1, 1]) b.block(side * (F / 2 - 0.1), DECK_Y, R / 2, 0.08, 1.0, R - 1, surf(0x3a3f42, { roughness: 0.5, metalness: 0.5 }), 1 | 2 | 4);
  }
  for (const x of [-F / 2 + 1.2, F / 2 - 1.2]) lamps.push(lampPost(b, x, DECK_Y, R - 1.5, style === 'small' ? 3.6 : 4.6));
  if (F > 30) lamps.push(lampPost(b, 0, DECK_Y, R - 1.5, 4.6));
  return lamps;
}

/** Builds every pier (merged, world space) with colliders and lamp positions. */
export function buildPiers(geo: GeoQuery, berths: Map<string, Berth[]>): PierBuild {
  const b = new MeshBuilder();
  const colliders: Collider[] = [];
  const lamps: PierLamp[] = [];
  const m = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (const list of berths.values()) {
    for (const berth of list) {
      const xAxis = new THREE.Vector3(-berth.t.x, 0, -berth.t.z);
      const zAxis = new THREE.Vector3(berth.n.x, 0, berth.n.z);
      m.makeBasis(xAxis, up, zAxis).setPosition(berth.shore.x, 0, berth.shore.z);
      const depth = -geo.heightAt(berth.face.x, berth.face.z);
      b.push(m);
      const local = buildLocal(b, berth, depth);
      b.pop();
      for (const l of local) {
        const p = new THREE.Vector3(l.x, l.y, l.z).applyMatrix4(m);
        lamps.push({ x: p.x, y: p.y, z: p.z });
      }
      q.setFromRotationMatrix(m);
      e.setFromQuaternion(q, 'YXZ');
      const R = berth.pier.reach;
      const F = berth.pier.frontage;
      const c = new THREE.Vector3(0, 0, (R - 8) / 2).applyMatrix4(m);
      colliders.push({ kind: 'box', center: new THREE.Vector3(c.x, 4, c.z), halfSize: new THREE.Vector3(F / 2, 4.5, (R + 8) / 2), yaw: e.y });
    }
  }
  return { geometry: b.build(), colliders, lamps };
}
