/**
 * Street furniture and small waterfront models of the details layer (metres, base at y = 0, front along +Z).
 * Built with three.js primitives in the worker and stamped into one merged, vertex-coloured mesh (props/stamp.ts);
 * `aGlow` marks surfaces that light up at night (ad panels, kiosk windows, cart lamps).
 */
import * as THREE from 'three';
import { merge, part } from '../../shared/props';

export type PropKind =
  | 'bench'
  | 'bin'
  | 'bollard'
  | 'simitCart'
  | 'chestnutCart'
  | 'busShelter'
  | 'busSign'
  | 'kiosk'
  | 'cafeTable'
  | 'parasol'
  | 'planter'
  | 'mooring'
  | 'flagPole'
  | 'lifebuoy'
  | 'hoarding'
  | 'crane';

const box = (w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const cyl = (r0: number, r1: number, h: number, x: number, y: number, z: number, seg = 8): THREE.BufferGeometry => new THREE.CylinderGeometry(r0, r1, h, seg).translate(x, y, z);

/** Wheel of radius r with its axle along x, centred at (x, y, z). */
const wheel = (r: number, x: number, y: number, z: number): THREE.BufferGeometry => new THREE.CylinderGeometry(r, r, 0.05, 12).rotateZ(Math.PI / 2).translate(x, y, z);

/** Adds the reversed-winding copy of every triangle (thin open surfaces seen from both sides). */
function doubleSided(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const src = g.index ? g.toNonIndexed() : g;
  src.computeVertexNormals();
  const back = src.clone();
  const p = back.getAttribute('position') as THREE.BufferAttribute;
  const n = back.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i += 3) {
    for (const a of [p, n]) {
      const x = a.getX(i + 1);
      const y = a.getY(i + 1);
      const z = a.getZ(i + 1);
      a.setXYZ(i + 1, a.getX(i + 2), a.getY(i + 2), a.getZ(i + 2));
      a.setXYZ(i + 2, x, y, z);
    }
  }
  for (let i = 0; i < n.count; i++) {
    n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  }
  back.deleteAttribute('uv');
  src.deleteAttribute('uv');
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute([...(src.getAttribute('position').array as Float32Array), ...(p.array as Float32Array)], 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute([...(src.getAttribute('normal').array as Float32Array), ...(n.array as Float32Array)], 3));
  return merged;
}

const IRON = 0x24262a;
const WOOD = 0x7b5433;

function bench(): THREE.BufferGeometry {
  const parts = [];
  for (let k = 0; k < 4; k++) {
    parts.push(part(box(1.8, 0.035, 0.09, 0, 0.45, -0.17 + k * 0.11), WOOD));
  }
  for (let k = 0; k < 3; k++) {
    parts.push(part(box(1.8, 0.09, 0.03, 0, 0.62 + k * 0.12, -0.25 - k * 0.025).rotateX(-0.12), WOOD));
  }
  for (const x of [-0.78, 0.78]) {
    parts.push(part(box(0.06, 0.45, 0.07, x, 0.225, 0.14), IRON));
    parts.push(part(box(0.06, 0.8, 0.07, x, 0.4, -0.2), IRON));
    parts.push(part(box(0.06, 0.05, 0.45, x, 0.42, -0.03), IRON));
  }
  return merge(parts);
}

function bin(): THREE.BufferGeometry {
  return merge([part(cyl(0.2, 0.18, 0.82, 0, 0.41, 0, 10), 0x46524c), part(cyl(0.22, 0.22, 0.06, 0, 0.85, 0, 10), 0x2a2f2c), part(box(0.12, 0.02, 0.05, 0, 0.72, 0.19), 0x1a1a1a)]);
}

function bollard(): THREE.BufferGeometry {
  return merge([part(cyl(0.065, 0.075, 0.78, 0, 0.39, 0, 7), 0x1f2124), part(new THREE.SphereGeometry(0.08, 7, 5).translate(0, 0.8, 0), 0x1f2124), part(cyl(0.085, 0.085, 0.05, 0, 0.62, 0, 7), 0x8a7a45)]);
}

/** Red simit cart with its glass display case full of simits. */
function simitCart(): THREE.BufferGeometry {
  const parts = [
    part(box(1.15, 0.5, 0.62, 0, 0.72, 0), 0xb2231c),
    part(box(1.2, 0.05, 0.66, 0, 0.99, 0), 0xd8d2c4),
    part(box(1.05, 0.46, 0.55, 0, 1.24, 0), 0xcfe2e6, 0.25),
    part(box(0.95, 0.16, 0.45, 0, 1.12, 0), 0xb97a3a),
    part(box(1.14, 0.04, 0.62, 0, 1.49, 0), 0xb2231c),
    part(box(0.5, 0.14, 0.02, 0, 1.6, 0.0), 0xf1e6c8, 0.6),
    part(wheel(0.26, -0.62, 0.26, 0.18), IRON),
    part(wheel(0.26, 0.62, 0.26, 0.18), IRON),
    part(box(0.04, 0.04, 0.6, -0.5, 0.85, -0.55), 0x8f8f8f),
    part(box(0.04, 0.04, 0.6, 0.5, 0.85, -0.55), 0x8f8f8f),
    part(box(0.05, 0.47, 0.05, -0.5, 0.235, -0.2), IRON),
    part(box(0.05, 0.47, 0.05, 0.5, 0.235, -0.2), IRON),
  ];
  return merge(parts);
}

/** Roasted chestnut / corn cart: red and white body, charcoal grill and a small chimney. */
function chestnutCart(): THREE.BufferGeometry {
  return merge([
    part(box(1.2, 0.6, 0.7, 0, 0.7, 0), 0xd4d0c8),
    part(box(1.22, 0.14, 0.72, 0, 0.5, 0), 0xb3241d),
    part(box(1.0, 0.12, 0.55, 0, 1.06, 0), 0x2b2522, 0.35),
    part(box(0.9, 0.06, 0.45, 0, 1.14, 0), 0x6d4526),
    part(cyl(0.05, 0.05, 0.7, 0.45, 1.45, -0.2, 6), 0x5a5a5a),
    part(box(1.3, 0.04, 0.8, 0, 1.95, 0), 0xb3241d),
    part(box(0.04, 0.8, 0.04, -0.6, 1.55, 0.35), 0x8f8f8f),
    part(box(0.04, 0.8, 0.04, 0.6, 1.55, 0.35), 0x8f8f8f),
    part(wheel(0.22, 0.62, 0.22, 0), IRON),
    part(wheel(0.22, -0.62, 0.22, 0), IRON),
  ]);
}

/** İETT bus shelter: glass back, lit advert panel on one end, bench, flat roof; the road side is +Z. */
function busShelter(): THREE.BufferGeometry {
  const parts = [
    part(box(4.2, 0.1, 1.6, 0, 2.45, 0.05), 0x3b4046),
    part(box(4.0, 2.1, 0.03, 0, 1.25, -0.68), 0x7f98a3, 0.05),
    part(box(0.12, 1.8, 1.25, 2.02, 1.2, -0.05), 0xf2efe4, 1),
    part(box(2.2, 0.05, 0.36, -0.4, 0.47, -0.45), 0x8a8f94),
    part(box(4.2, 0.3, 0.05, 0, 2.28, 0.84), 0x1d4e8f, 0.4),
  ];
  for (const x of [-2.02, -0.6, 0.8]) {
    parts.push(part(box(0.07, 2.4, 0.07, x, 1.2, -0.7), 0x5b6066));
  }
  return merge(parts);
}

/** Stop pole with the blue İETT sign. */
function busSign(): THREE.BufferGeometry {
  return merge([part(cyl(0.04, 0.04, 2.6, 0, 1.3, 0, 6), 0x8f9499), part(box(0.5, 0.36, 0.03, 0, 2.45, 0), 0x1d4e8f, 0.3), part(box(0.36, 0.5, 0.03, 0, 1.9, 0.0), 0xf2f2f2)]);
}

/** Büfe / newspaper kiosk. */
function kiosk(): THREE.BufferGeometry {
  return merge([
    part(box(2.2, 2.3, 1.7, 0, 1.15, 0), 0xe7e2d6),
    part(box(1.9, 1.0, 0.03, 0, 1.45, 0.86), 0xa9c4c9, 0.8),
    part(box(2.5, 0.08, 2.1, 0, 2.38, 0.1), 0x2f5a3a),
    part(box(2.3, 0.35, 0.04, 0, 2.15, 0.9), 0xc8352b, 0.6),
    part(box(2.0, 0.08, 0.35, 0, 0.95, 1.02), 0x6b4a2f),
  ]);
}

/** Bistro table with two chairs facing each other across x (seats at x = ±0.62, facing the table). */
function cafeTable(): THREE.BufferGeometry {
  const parts = [part(cyl(0.36, 0.36, 0.03, 0, 0.74, 0, 12), 0xd9d3c6), part(cyl(0.03, 0.03, 0.72, 0, 0.36, 0, 6), 0x3a3a3a), part(cyl(0.2, 0.22, 0.03, 0, 0.015, 0, 10), 0x3a3a3a)];
  for (const s of [-1, 1]) {
    const x = s * 0.62;
    parts.push(part(box(0.4, 0.04, 0.4, x, 0.45, 0), 0x5a3f2a));
    parts.push(part(box(0.04, 0.45, 0.38, x + s * 0.2, 0.68, 0), 0x5a3f2a));
    for (const [dx, dz] of [
      [-0.17, -0.17],
      [0.17, -0.17],
      [-0.17, 0.17],
      [0.17, 0.17],
    ]) {
      parts.push(part(box(0.03, 0.45, 0.03, x + dx, 0.225, dz), 0x2c2c2c));
    }
  }
  return merge(parts);
}

/** Café parasol (canopy takes the instance colour via white vertex colour; see stamp tint). */
function parasol(): THREE.BufferGeometry {
  const canopy = doubleSided(new THREE.ConeGeometry(1.35, 0.45, 8, 1, true).translate(0, 2.3, 0));
  return merge([part(cyl(0.025, 0.025, 2.5, 0, 1.25, 0, 5), 0xd0d0d0), part(canopy, 0xffffff), part(cyl(0.18, 0.18, 0.08, 0, 0.04, 0, 8), 0x444444)]);
}

/** Large concrete planter with a clipped shrub. */
function planter(): THREE.BufferGeometry {
  const shrub = new THREE.IcosahedronGeometry(0.55, 1).scale(1, 0.8, 1).translate(0, 0.95, 0);
  return merge([part(cyl(0.55, 0.45, 0.6, 0, 0.3, 0, 10), 0x9c978d), part(shrub, 0x3d5a2c)]);
}

/** Cast-iron mooring bollard on the quay edge. */
function mooring(): THREE.BufferGeometry {
  return merge([part(cyl(0.16, 0.2, 0.42, 0, 0.21, 0, 9), 0x1c1d1f), part(cyl(0.24, 0.24, 0.07, 0, 0.44, 0, 9), 0x1c1d1f)]);
}

/** Flag pole (the cloth is drawn by the animated flag mesh). Height 1 m, scaled per instance. */
function flagPole(): THREE.BufferGeometry {
  return merge([part(cyl(0.012, 0.018, 1, 0, 0.5, 0, 6), 0xd8d8d8), part(new THREE.SphereGeometry(0.025, 6, 4).translate(0, 1.01, 0), 0xd4b24a)]);
}

/** Orange lifebuoy on a post (quays and piers). */
function lifebuoy(): THREE.BufferGeometry {
  return merge([part(box(0.08, 1.4, 0.08, 0, 0.7, 0), 0xdcdcdc), part(new THREE.TorusGeometry(0.3, 0.07, 6, 12).translate(0, 1.2, 0.07), 0xe0521d)]);
}

/**
 * Construction site hoarding: one 2 m panel on its post (front +Z, the panel runs along x). White panel faces take
 * the site's tint (the blue, green or white şantiye boards of the city).
 */
function hoarding(): THREE.BufferGeometry {
  return merge([
    part(box(2.0, 2.1, 0.06, 0, 1.15, 0), 0xffffff),
    part(box(2.0, 0.12, 0.08, 0, 2.2, 0), 0x9aa0a4),
    part(box(0.08, 2.3, 0.08, 1.0, 1.15, -0.05), 0x6b7075),
  ]);
}

/** Tower crane (~42 m): lattice mast as a slim box, slewing unit and cab, long jib and counter-jib with ballast. */
function crane(): THREE.BufferGeometry {
  const yellow = 0xe0b020;
  return merge([
    part(box(3.2, 0.8, 3.2, 0, 0.4, 0), 0x8a8a86),
    part(box(1.5, 40, 1.5, 0, 20.8, 0), yellow),
    part(box(2.2, 1.6, 2.2, 0, 41.6, 0), yellow),
    part(box(1.3, 1.4, 1.5, 1.2, 41.3, 1.2), 0xd8d4c8),
    part(box(0.9, 1.1, 44, 0, 42.9, 16), yellow),
    part(box(0.9, 1.0, 14, 0, 42.9, -8), yellow),
    part(box(2.0, 2.2, 3.0, 0, 41.9, -13), 0x9a9a96),
    part(box(0.5, 6, 0.5, 0, 46, 0), yellow),
    part(box(0.05, 12, 0.05, 0, 36.4, 26), 0x303030),
    part(box(0.6, 0.5, 0.6, 0, 30.2, 26), 0x303030),
  ]);
}

export function propTemplates(): Record<PropKind, THREE.BufferGeometry> {
  return {
    bench: bench(),
    bin: bin(),
    bollard: bollard(),
    simitCart: simitCart(),
    chestnutCart: chestnutCart(),
    busShelter: busShelter(),
    busSign: busSign(),
    kiosk: kiosk(),
    cafeTable: cafeTable(),
    parasol: parasol(),
    planter: planter(),
    mooring: mooring(),
    flagPole: flagPole(),
    lifebuoy: lifebuoy(),
    hoarding: hoarding(),
    crane: crane(),
  };
}
