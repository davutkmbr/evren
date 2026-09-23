/**
 * Low-poly instanced prop geometries of the OSM prototype (unit scale, base at y = 0, "front" along local +X):
 * street lamps, chimneys, rooftop water tanks, solar water heaters, satellite dishes and street trees.
 * Vertex colours carry the materials; `aGlow` marks emissive lamp glass.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function part(g: THREE.BufferGeometry, color: number, glow = 0): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const n = geo.getAttribute('position').count;
  const c = new THREE.Color(color);
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1));
  geo.deleteAttribute('uv');
  return geo;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) {
    throw new Error('[osm] prop merge failed');
  }
  g.computeBoundingSphere();
  return g;
}

const IRON = 0x1d1f21;

/** 7.5 m pole with a curved arm reaching 1.7 m over the carriageway (local +X). */
export function lampArmGeometry(): THREE.BufferGeometry {
  const pole = new THREE.CylinderGeometry(0.06, 0.1, 7.5, 8).translate(0, 3.75, 0);
  const arm = new THREE.BoxGeometry(1.8, 0.07, 0.07).translate(0.9, 7.45, 0);
  const head = new THREE.BoxGeometry(0.6, 0.12, 0.26).translate(1.65, 7.38, 0);
  const glass = new THREE.BoxGeometry(0.5, 0.03, 0.2).translate(1.65, 7.31, 0);
  return merge([part(pole, 0x55595c), part(arm, 0x55595c), part(head, 0x3c3f42), part(glass, 0xfff1d6, 1)]);
}

/** 3.8 m black cast-iron post with a lantern (historic streets). */
export function lampLanternGeometry(): THREE.BufferGeometry {
  const base = new THREE.CylinderGeometry(0.14, 0.18, 0.6, 8).translate(0, 0.3, 0);
  const pole = new THREE.CylinderGeometry(0.05, 0.07, 3.1, 8).translate(0, 2.1, 0);
  const cage = new THREE.CylinderGeometry(0.2, 0.13, 0.5, 6).translate(0, 3.9, 0);
  const glass = new THREE.CylinderGeometry(0.17, 0.11, 0.42, 6).translate(0, 3.9, 0);
  const cap = new THREE.ConeGeometry(0.26, 0.25, 6).translate(0, 4.27, 0);
  return merge([part(base, IRON), part(pole, IRON), part(cage, IRON), part(glass, 0xffe2b0, 1), part(cap, IRON)]);
}

export function chimneyGeometry(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const cap = new THREE.BoxGeometry(1.2, 0.12, 1.2).translate(0, 1.0, 0);
  return merge([part(body, 0xffffff), part(cap, 0x9a9a9a)]);
}

/** Upright plastic water tank on a small stand. */
export function tankGeometry(): THREE.BufferGeometry {
  const stand = new THREE.BoxGeometry(1.1, 0.25, 1.1).translate(0, 0.125, 0);
  const tank = new THREE.CylinderGeometry(0.55, 0.55, 1.25, 12).translate(0, 0.875, 0);
  const lid = new THREE.CylinderGeometry(0.2, 0.2, 0.08, 8).translate(0, 1.54, 0);
  return merge([part(stand, 0x6b6b6b), part(tank, 0xffffff), part(lid, 0xdddddd)]);
}

/** Thermosiphon solar water heater: collector tilted 40° towards local +X, storage cylinder along its top edge. */
export function solarGeometry(): THREE.BufferGeometry {
  const tilt = (40 * Math.PI) / 180;
  const panel = new THREE.BoxGeometry(2.0, 0.06, 1.9).rotateZ(-tilt).translate(0, 0.8, 0);
  const tank = new THREE.CylinderGeometry(0.25, 0.25, 1.9, 10).rotateX(Math.PI / 2).translate(-0.8, 1.55, 0);
  const legA = new THREE.BoxGeometry(0.05, 1.4, 0.05).translate(-0.75, 0.7, 0.85);
  const legB = new THREE.BoxGeometry(0.05, 1.4, 0.05).translate(-0.75, 0.7, -0.85);
  return merge([part(panel, 0x14202e), part(tank, 0xc9c9c6), part(legA, 0x777777), part(legB, 0x777777)]);
}

/** Satellite dish on a short mast, facing local +X. */
export function dishGeometry(): THREE.BufferGeometry {
  const mast = new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6).translate(0, 0.45, 0);
  const dish = new THREE.CylinderGeometry(0.42, 0.06, 0.16, 12, 1, true).rotateZ(Math.PI / 2 + 0.35).translate(0.1, 0.95, 0);
  const lnb = new THREE.BoxGeometry(0.4, 0.03, 0.03).translate(0.35, 0.95, 0);
  return merge([part(mast, 0x777777), part(dish, 0xffffff), part(lnb, 0x555555)]);
}

/** Broadleaf street tree (plane tree like): trunk + lumpy crown. */
export function treeGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.18, 0.26, 3.2, 7).translate(0, 1.6, 0);
  const crown = new THREE.IcosahedronGeometry(2.6, 1);
  const p = crown.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 1 + 0.18 * Math.sin(x * 2.1 + z * 1.3) * Math.cos(y * 1.7 - x);
    p.setXYZ(i, x * k, y * k * 0.85, z * k);
  }
  crown.translate(0, 5.4, 0);
  crown.computeVertexNormals();
  return merge([part(trunk, 0x6b5a48), part(crown, 0xffffff)]);
}
