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
  | 'crane'
  | 'fuelCanopy'
  | 'fuelPump'
  | 'fuelShop'
  | 'fuelSign'
  | 'goal'
  | 'basketHoop'
  | 'swing'
  | 'slide'
  | 'climber'
  | 'shrub'
  | 'flowers'
  | 'rock'
  | 'awning'
  | 'pharmacySign'
  | 'cesme'
  | 'fountainBasin'
  | 'statue'
  | 'hydrant'
  | 'tombstone'
  | 'marketStall'
  | 'fitness'
  | 'hedge'
  | 'atm'
  | 'telescope'
  | 'recycling'
  | 'bikeRack'
  | 'metroEntrance'
  | 'taxiStand'
  | 'gsmMast'
  | 'latticeTower';

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

/* ------------------------------------------------------------------ feature kits (OSM place types) */

/**
 * Fuel station canopy, 16 x 10 m, 5.4 m clear: slab roof on four columns, the fascia band white so it takes the
 * brand colour (tint), a lit underside. Front (+Z) faces the road.
 */
function fuelCanopy(): THREE.BufferGeometry {
  const parts = [
    part(box(16, 0.55, 10, 0, 5.95, 0), 0xe4e4e0),
    part(box(16.1, 0.75, 10.1, 0, 6.05, 0).scale(1, 1, 1), 0xffffff),
    part(box(15.6, 0.05, 9.6, 0, 5.66, 0), 0xf6f3e8, 1),
  ];
  for (const x of [-4.5, 4.5]) {
    for (const z of [-2.5, 2.5]) {
      parts.push(part(box(0.45, 5.7, 0.45, x, 2.85, z), 0xcfd1d2));
    }
  }
  return merge(parts);
}

/** Pump island: kerbed island with a dispenser (lit display) and bollards at its ends; runs along x. */
function fuelPump(): THREE.BufferGeometry {
  return merge([
    part(box(4.2, 0.18, 1.1, 0, 0.09, 0), 0xb9b6ad),
    part(box(1.0, 1.9, 0.55, 0, 1.13, 0), 0xe8e8e4),
    part(box(0.8, 0.4, 0.58, 0, 1.55, 0), 0x1d2a33, 0.9),
    part(box(1.02, 0.25, 0.57, 0, 2.2, 0), 0xffffff),
    part(cyl(0.09, 0.09, 1.0, -1.85, 0.68, 0, 6), 0xd8b020),
    part(cyl(0.09, 0.09, 1.0, 1.85, 0.68, 0, 6), 0xd8b020),
  ]);
}

/** Station shop: 12 x 7 m box, glazed front (+Z) lit at night, white brand band. */
function fuelShop(): THREE.BufferGeometry {
  return merge([
    part(box(12, 3.6, 7, 0, 1.8, 0), 0xe2dfd6),
    part(box(8, 2.4, 0.05, 0, 1.3, 3.52), 0x93b3bf, 0.7),
    part(box(12.1, 0.7, 7.1, 0, 3.65, 0), 0xffffff),
    part(box(12.4, 0.12, 7.4, 0, 4.06, 0), 0x6f7478),
  ]);
}

/** Price pylon, 7.5 m: white panel takes the brand colour, the lit price board below it. */
function fuelSign(): THREE.BufferGeometry {
  return merge([
    part(box(0.5, 7.5, 0.5, 0, 3.75, 0), 0x8f9397),
    part(box(1.9, 1.9, 0.35, 0, 6.5, 0), 0xffffff, 0.35),
    part(box(1.7, 2.3, 0.3, 0, 4.2, 0), 0x16191c, 0.8),
    part(box(1.9, 0.4, 0.4, 0, 0.2, 0), 0x6f7478),
  ]);
}

/** Football goal, 7.32 x 2.44 m, net depth 2 m (the net as a dark translucent-looking back frame). */
function goal(): THREE.BufferGeometry {
  const w = 0xf4f4f0;
  return merge([
    part(box(0.12, 2.44, 0.12, -3.66, 1.22, 0), w),
    part(box(0.12, 2.44, 0.12, 3.66, 1.22, 0), w),
    part(box(7.44, 0.12, 0.12, 0, 2.44, 0), w),
    part(box(7.3, 2.3, 0.02, 0, 1.2, -1.9), 0x9aa2a6),
    part(box(7.3, 0.02, 1.9, 0, 2.38, -0.95), 0x9aa2a6),
  ]);
}

/** Basketball post with board and hoop (the court is +Z). */
function basketHoop(): THREE.BufferGeometry {
  return merge([
    part(box(0.2, 3.3, 0.2, 0, 1.65, -1.2), 0x3a5a78),
    part(box(0.12, 0.12, 1.2, 0, 3.2, -0.6), 0x3a5a78),
    part(box(1.8, 1.05, 0.05, 0, 3.4, 0), 0xf2f2f0),
    part(new THREE.TorusGeometry(0.23, 0.02, 4, 12).rotateX(Math.PI / 2).translate(0, 3.05, 0.28), 0xd2561c),
  ]);
}

/** Playground swing frame with two seats. */
function swing(): THREE.BufferGeometry {
  const parts = [part(box(3.4, 0.1, 0.1, 0, 2.3, 0), 0xc8342b)];
  for (const x of [-1.6, 1.6]) {
    for (const s of [-1, 1]) {
      parts.push(part(box(0.08, 2.4, 0.08, x, 1.15, s * 0.55).rotateX(s * 0.24), 0xc8342b));
    }
  }
  for (const x of [-0.7, 0.7]) {
    parts.push(part(box(0.02, 1.8, 0.02, x - 0.2, 1.35, 0), 0x777777), part(box(0.02, 1.8, 0.02, x + 0.2, 1.35, 0), 0x777777), part(box(0.5, 0.05, 0.22, x, 0.45, 0), 0x2b2b2b));
  }
  return merge(parts);
}

/** Slide tower: platform with roof and a slide down along +Z. */
function slide(): THREE.BufferGeometry {
  const parts = [part(box(1.3, 0.1, 1.3, 0, 1.5, -1), 0x7c5a3a), part(new THREE.ConeGeometry(1.0, 0.9, 4).rotateY(Math.PI / 4).translate(0, 3.05, -1), 0x2f6fb0)];
  for (const [x, z] of [
    [-0.6, -0.4],
    [0.6, -0.4],
    [-0.6, -1.6],
    [0.6, -1.6],
  ]) {
    parts.push(part(box(0.1, 2.6, 0.1, x, 1.3, z), 0x7c5a3a));
  }
  parts.push(part(box(0.6, 0.08, 2.8, 0, 0.8, 0.95).rotateX(0.5).translate(0, 0.05, 0.35), 0xe3b21c));
  return merge(parts);
}

/** Climbing frame: a cube of bars. */
function climber(): THREE.BufferGeometry {
  const parts = [];
  const c = 0x3f8f4a;
  for (const x of [-1, 0, 1]) {
    for (const z of [-1, 1]) {
      parts.push(part(box(0.07, 2, 0.07, x, 1, z), c));
    }
  }
  for (const y of [0.7, 1.35, 2]) {
    parts.push(part(box(2.1, 0.06, 0.06, 0, y, -1), c), part(box(2.1, 0.06, 0.06, 0, y, 1), c));
    for (const x of [-1, 0, 1]) {
      parts.push(part(box(0.06, 0.06, 2.1, x, y, 0), c));
    }
  }
  return merge(parts);
}

/** Shrub: three low-poly clumps, 1.2 m across; white so it takes a green tint per instance. */
function shrub(): THREE.BufferGeometry {
  return merge([
    part(new THREE.IcosahedronGeometry(0.62, 0).scale(1, 0.75, 1).translate(0, 0.5, 0), 0xffffff),
    part(new THREE.IcosahedronGeometry(0.45, 0).scale(1, 0.8, 1).translate(0.45, 0.38, 0.2), 0xffffff),
    part(new THREE.IcosahedronGeometry(0.4, 0).scale(1, 0.8, 1).translate(-0.35, 0.34, -0.3), 0xffffff),
  ]);
}

/** Flower bed clump: low green cushion with coloured tops (white, tinted per instance). */
function flowers(): THREE.BufferGeometry {
  return merge([part(new THREE.IcosahedronGeometry(0.5, 0).scale(1.3, 0.35, 1).translate(0, 0.16, 0), 0x3e6a2c), part(new THREE.IcosahedronGeometry(0.42, 0).scale(1.2, 0.25, 0.9).translate(0, 0.3, 0), 0xffffff)]);
}

/** Field stone / boulder, about 1 m. */
function rock(): THREE.BufferGeometry {
  return merge([part(new THREE.DodecahedronGeometry(0.55, 0).scale(1.2, 0.6, 0.9).translate(0, 0.2, 0), 0x8b867c)]);
}

/**
 * Shopfront awning (tente), 3.2 m wide, reaching 1.4 m out from the facade at 2.7 m: the canvas is white so it takes
 * the shop's tint, with a scalloped valance. The facade is at z = 0, the street +Z.
 */
function awning(): THREE.BufferGeometry {
  const canvas = doubleSided(new THREE.PlaneGeometry(3.2, 1.55).rotateX(-Math.PI / 2 + 0.45).translate(0, 2.95, 0.7));
  return merge([part(canvas, 0xffffff), part(box(3.2, 0.25, 0.02, 0, 2.55, 1.4), 0xffffff), part(box(3.25, 0.06, 0.08, 0, 3.3, 0.04), 0x55595c)]);
}

/** Pharmacy sign: green lit box with the red "E" of Turkish pharmacies, on a wall bracket at 3.2 m. */
function pharmacySign(): THREE.BufferGeometry {
  return merge([part(box(0.05, 0.05, 0.6, 0, 3.4, 0.3), 0x444444), part(box(0.9, 0.9, 0.18, 0, 3.2, 0.62), 0x1f9d4a, 1), part(box(0.35, 0.5, 0.2, 0, 3.2, 0.62), 0xd02828, 1)]);
}

const MARBLE = 0xd9d4c8;

/** Ottoman street fountain (çeşme) against a wall: marble slab with an arched niche, spout, trough; back at z = 0. */
function cesme(): THREE.BufferGeometry {
  return merge([
    part(box(2.2, 2.8, 0.5, 0, 1.4, 0.25), MARBLE),
    part(box(2.5, 0.25, 0.7, 0, 2.9, 0.33), 0xcfc9ba),
    part(box(1.2, 1.5, 0.08, 0, 1.25, 0.52), 0xb8b1a1),
    part(new THREE.CylinderGeometry(0.6, 0.6, 0.08, 12, 1, false, 0, Math.PI).rotateX(Math.PI / 2).translate(0, 2.0, 0.53), 0xb8b1a1),
    part(cyl(0.03, 0.03, 0.2, 0, 1.2, 0.62, 5).rotateX(Math.PI / 2).translate(0, -0.4, 0.2), 0xa88a3c),
    part(box(1.6, 0.5, 0.55, 0, 0.25, 0.78), MARBLE),
  ]);
}

/** Round fountain basin with a central column and a water surface. */
function fountainBasin(): THREE.BufferGeometry {
  return merge([
    part(cyl(2.2, 2.3, 0.6, 0, 0.3, 0, 16), MARBLE),
    part(cyl(2.0, 2.0, 0.05, 0, 0.55, 0, 16), 0x5f7f8c, 0.1),
    part(cyl(0.35, 0.45, 1.3, 0, 0.9, 0, 10), MARBLE),
    part(cyl(0.8, 0.5, 0.2, 0, 1.6, 0, 12), MARBLE),
  ]);
}

/** Statue / memorial: stone plinth and a bronze figure (about 5 m in all). */
function statue(): THREE.BufferGeometry {
  return merge([
    part(box(1.8, 0.4, 1.8, 0, 0.2, 0), 0xa7a196),
    part(box(1.3, 2.0, 1.3, 0, 1.4, 0), 0xc2bcae),
    part(box(1.5, 0.2, 1.5, 0, 2.5, 0), 0xa7a196),
    part(cyl(0.22, 0.3, 1.1, 0, 3.15, 0, 8), 0x3c4a3c),
    part(cyl(0.3, 0.22, 0.8, 0, 4.1, 0, 8), 0x3c4a3c),
    part(new THREE.SphereGeometry(0.19, 8, 6).translate(0, 4.72, 0), 0x3c4a3c),
    part(box(0.1, 0.7, 0.1, 0.3, 4.1, 0.05).rotateZ(-0.3), 0x3c4a3c),
  ]);
}

function hydrant(): THREE.BufferGeometry {
  return merge([part(cyl(0.13, 0.15, 0.7, 0, 0.35, 0, 8), 0xb3261e), part(new THREE.SphereGeometry(0.14, 8, 5).translate(0, 0.72, 0), 0xb3261e), part(cyl(0.05, 0.05, 0.36, 0, 0.5, 0, 6).rotateZ(Math.PI / 2).translate(0, 0.0, 0), 0x8a1c16)]);
}

/** Ottoman headstone: slender marble stele, some with a turban top (white takes a weathered stone tint). */
function tombstone(): THREE.BufferGeometry {
  return merge([part(box(0.42, 1.2, 0.1, 0, 0.6, 0), 0xffffff), part(cyl(0.13, 0.17, 0.22, 0, 1.31, 0, 6), 0xffffff)]);
}

/** Market stall (tezgâh), 3 x 1.6 m, canvas roof white for a tint, crates of produce on the table. */
function marketStall(): THREE.BufferGeometry {
  const parts = [
    part(box(3, 0.08, 1.4, 0, 0.9, 0), 0x8a6a45),
    part(doubleSided(new THREE.PlaneGeometry(3.3, 1.9).rotateX(-Math.PI / 2 + 0.2).translate(0, 2.35, 0.1)), 0xffffff),
  ];
  for (const x of [-1.45, 1.45]) {
    for (const z of [-0.65, 0.65]) {
      parts.push(part(box(0.05, 2.3, 0.05, x, 1.15, z), 0x55595c));
    }
  }
  const produce = [0xc8341e, 0xe0a019, 0x6aa33a, 0xd66a1f, 0x8e2d5a];
  for (let k = 0; k < 5; k++) {
    parts.push(part(box(0.5, 0.18, 0.4, -1.2 + k * 0.6, 1.03, 0.3), 0x9b7a50), part(box(0.44, 0.1, 0.34, -1.2 + k * 0.6, 1.16, 0.3), produce[k]));
  }
  return merge(parts);
}

/** Outdoor fitness station: a double bar and a sit-up bench in the municipal yellow and green. */
function fitness(): THREE.BufferGeometry {
  return merge([
    part(box(0.12, 2.2, 0.12, -1, 1.1, 0), 0x2f7a3c),
    part(box(0.12, 2.2, 0.12, 1, 1.1, 0), 0x2f7a3c),
    part(cyl(0.04, 0.04, 2, 0, 2.1, 0, 6).rotateZ(Math.PI / 2).translate(0, 0, 0), 0xe3b21c),
    part(cyl(0.04, 0.04, 2, 0, 1.4, 0, 6).rotateZ(Math.PI / 2).translate(0, 0, 0), 0xe3b21c),
    part(box(0.4, 0.08, 1.4, 0, 0.55, 1.2).rotateX(-0.25), 0xe3b21c),
    part(box(0.1, 0.5, 0.1, 0, 0.25, 1.7), 0x2f7a3c),
  ]);
}

/** Clipped hedge segment, 2 m long, 1.1 m tall (runs along x). */
function hedge(): THREE.BufferGeometry {
  return merge([part(box(2.05, 1.1, 0.8, 0, 0.55, 0), 0x2f4a22)]);
}

/** Wall ATM: lit screen box on the facade (back at z = 0). */
function atm(): THREE.BufferGeometry {
  return merge([part(box(0.8, 1.6, 0.25, 0, 0.8, 0.12), 0x3a3d40), part(box(0.55, 0.4, 0.05, 0, 1.3, 0.26), 0x5fa0d0, 1), part(box(0.8, 0.25, 0.28, 0, 1.75, 0.12), 0x1a4f8f, 0.8)]);
}

/** Coin telescope at a viewpoint. */
function telescope(): THREE.BufferGeometry {
  return merge([part(cyl(0.06, 0.08, 1.2, 0, 0.6, 0, 6), 0x4a5560), part(box(0.3, 0.35, 0.5, 0, 1.3, 0), 0x2f6f9a), part(cyl(0.08, 0.1, 0.35, 0, 1.35, 0.35, 8).rotateX(Math.PI / 2).translate(0, -0.35, 0.05), 0x2f6f9a)]);
}

/** Recycling containers: three wheeled bins (blue paper, yellow plastic, green glass). */
function recycling(): THREE.BufferGeometry {
  const parts = [];
  const cols = [0x1e5aa8, 0xe3b21c, 0x2f8a3c];
  for (let k = 0; k < 3; k++) {
    parts.push(part(box(1.1, 1.3, 1.0, (k - 1) * 1.2, 0.65, 0), cols[k]), part(box(1.15, 0.08, 1.05, (k - 1) * 1.2, 1.34, 0), 0x2a2a2a));
  }
  return merge(parts);
}

/** Bicycle rack: five hoops. */
function bikeRack(): THREE.BufferGeometry {
  const parts = [];
  for (let k = 0; k < 5; k++) {
    parts.push(part(new THREE.TorusGeometry(0.4, 0.025, 4, 10, Math.PI).translate((k - 2) * 0.8, 0.45, 0), 0x8f9499));
  }
  return merge(parts);
}

/** Metro entrance: glass canopy over the stair well (going down along -Z) and the red "M" totem at the front. */
function metroEntrance(): THREE.BufferGeometry {
  return merge([
    part(box(2.8, 0.9, 5.2, 0, 0.45, -1.8), 0x8f9397),
    part(box(2.4, 0.05, 4.6, 0, 0.92, -1.8), 0x2a2d30),
    part(box(3.0, 0.12, 5.4, 0, 3.0, -1.8), 0x5f666c),
    part(box(3.0, 2.0, 0.04, 0, 2.0, -4.45), 0x9fb6bf, 0.2),
    part(box(0.04, 2.0, 5.4, -1.48, 2.0, -1.8), 0x9fb6bf, 0.2),
    part(box(0.04, 2.0, 5.4, 1.48, 2.0, -1.8), 0x9fb6bf, 0.2),
    part(box(0.18, 2.6, 0.18, 1.9, 1.3, 0.6), 0x3a3d40),
    part(box(0.7, 0.7, 0.2, 1.9, 2.9, 0.6), 0xc8231c, 1),
    part(box(0.5, 0.12, 0.22, 1.9, 2.95, 0.6), 0xf2f2f2, 1),
  ]);
}

/** Taksi durağı: the small yellow booth with its lit roof sign and a bench. */
function taxiStand(): THREE.BufferGeometry {
  return merge([
    part(box(2.0, 2.3, 1.6, 0, 1.15, 0), 0xe8c21a),
    part(box(1.4, 0.9, 0.04, 0, 1.5, 0.81), 0x9fb6bf, 0.6),
    part(box(2.2, 0.1, 1.8, 0, 2.35, 0), 0x3a3d40),
    part(box(1.4, 0.35, 0.2, 0, 2.6, 0), 0xf2f2f2, 1),
    part(box(1.6, 0.06, 0.4, 0, 0.45, 1.2), WOOD),
  ]);
}

/** GSM mast (about 25 m): tapered steel pole with three antenna panel sectors and a red-white tip. */
function gsmMast(): THREE.BufferGeometry {
  const parts = [part(box(2.4, 0.5, 2.4, 0, 0.25, 0), 0x9a968e), part(cyl(0.22, 0.4, 24, 0, 12.5, 0, 8), 0xb7bcbf), part(cyl(0.12, 0.12, 1.2, 0, 25.1, 0, 6), 0xc8342b)];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    parts.push(part(box(0.35, 1.8, 0.12, Math.sin(a) * 0.6, 22.6, Math.cos(a) * 0.6).rotateY(a), 0xe8e8e4));
    parts.push(part(box(0.35, 1.8, 0.12, Math.sin(a) * 0.6, 20.4, Math.cos(a) * 0.6).rotateY(a), 0xe8e8e4));
  }
  parts.push(part(cyl(0.9, 0.9, 0.1, 0, 21.4, 0, 10), 0x8f9397));
  return merge(parts);
}

/** Lattice tower (radio / observation, about 30 m): four tapered legs, a platform and a red-white top section. */
function latticeTower(): THREE.BufferGeometry {
  const parts = [];
  const legs: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  for (const [sx, sz] of legs) {
    const g = new THREE.CylinderGeometry(0.1, 0.14, 28, 5);
    const lean = 0.07;
    g.rotateX(-sz * lean).rotateZ(sx * lean).translate(sx * 1.4, 14, sz * 1.4);
    parts.push(part(g, 0x9aa0a4));
  }
  for (let y = 4; y < 27; y += 4.5) {
    const w = 3.8 - y * 0.1;
    parts.push(part(box(w, 0.08, 0.08, 0, y, w / 2), 0x9aa0a4), part(box(w, 0.08, 0.08, 0, y, -w / 2), 0x9aa0a4), part(box(0.08, 0.08, w, w / 2, y, 0), 0x9aa0a4), part(box(0.08, 0.08, w, -w / 2, y, 0), 0x9aa0a4));
  }
  parts.push(part(box(2.4, 0.15, 2.4, 0, 27.5, 0), 0x6f7478), part(cyl(0.18, 0.18, 4, 0, 29.6, 0, 6), 0xc8342b), part(cyl(0.18, 0.18, 1.5, 0, 32.3, 0, 6), 0xf2f2f2));
  return merge(parts);
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
    fuelCanopy: fuelCanopy(),
    fuelPump: fuelPump(),
    fuelShop: fuelShop(),
    fuelSign: fuelSign(),
    goal: goal(),
    basketHoop: basketHoop(),
    swing: swing(),
    slide: slide(),
    climber: climber(),
    shrub: shrub(),
    flowers: flowers(),
    rock: rock(),
    awning: awning(),
    pharmacySign: pharmacySign(),
    cesme: cesme(),
    fountainBasin: fountainBasin(),
    statue: statue(),
    hydrant: hydrant(),
    tombstone: tombstone(),
    marketStall: marketStall(),
    fitness: fitness(),
    hedge: hedge(),
    atm: atm(),
    telescope: telescope(),
    recycling: recycling(),
    bikeRack: bikeRack(),
    metroEntrance: metroEntrance(),
    taxiStand: taxiStand(),
    gsmMast: gsmMast(),
    latticeTower: latticeTower(),
  };
}
