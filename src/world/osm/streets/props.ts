/**
 * Street furniture geometries (unit scale, base at y = 0, front / arm along local +X, low poly; `aGlow` marks
 * emissive parts: 1 lamp glass (colour from the instance's light type), 2 backlit panel, 3 / 4 / 5 signal
 * red / amber / green). Modelled after what lines Beyoğlu and Eminönü streets: grey LED mast lamps on the main roads,
 * black cast-iron lanterns and wall brackets in the historic lanes, retractable bollards, T1 stop canopies and masts.
 */
import * as THREE from 'three';
import { merge, part } from '../shared/props';
import type { PropKind } from './kinds';

const IRON = 0x1b1c1e;
const STEEL = 0x6d7275;
const STEEL_DARK = 0x3e4245;
const GLASS_WARM = 0xfff0d8;

function cyl(rTop: number, rBottom: number, h: number, y: number, seg = 8): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(rTop, rBottom, h, seg).translate(0, y + h / 2, 0);
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

/** Main-road LED mast: 8.5 m galvanised pole, gently raised arm reaching 1.8 m over the carriageway. */
function lampArm(): THREE.BufferGeometry {
  const pole = cyl(0.07, 0.12, 8.3, 0);
  const arm = box(1.9, 0.08, 0.08, 0.9, 8.32, 0).applyMatrix4(new THREE.Matrix4().makeRotationZ(0.08)).translate(0, 0.02, 0);
  const head = box(0.7, 0.12, 0.3, 1.75, 8.38, 0);
  const glass = box(0.6, 0.03, 0.24, 1.75, 8.31, 0);
  return merge([part(pole, STEEL), part(arm, STEEL), part(head, STEEL_DARK), part(glass, GLASS_WARM, 1)]);
}

/** Residential street lamp: 6.3 m pole, short arm. */
function lampArmLow(): THREE.BufferGeometry {
  const pole = cyl(0.055, 0.09, 6.3, 0);
  const arm = box(1.3, 0.06, 0.06, 0.6, 6.3, 0);
  const head = box(0.5, 0.11, 0.24, 1.2, 6.27, 0);
  const glass = box(0.42, 0.03, 0.18, 1.2, 6.21, 0);
  return merge([part(pole, STEEL), part(arm, STEEL), part(head, STEEL_DARK), part(glass, GLASS_WARM, 1)]);
}

/** Median mast with two arms (dual carriageways, squares). */
function lampDouble(): THREE.BufferGeometry {
  const pole = cyl(0.08, 0.14, 9.3, 0);
  const arm = box(4.0, 0.09, 0.09, 0, 9.33, 0);
  const headA = box(0.72, 0.13, 0.32, 1.9, 9.37, 0);
  const headB = box(0.72, 0.13, 0.32, -1.9, 9.37, 0);
  const glassA = box(0.62, 0.03, 0.26, 1.9, 9.3, 0);
  const glassB = box(0.62, 0.03, 0.26, -1.9, 9.3, 0);
  return merge([part(pole, STEEL), part(arm, STEEL), part(headA, STEEL_DARK), part(headB, STEEL_DARK), part(glassA, GLASS_WARM, 1), part(glassB, GLASS_WARM, 1)]);
}

/** Lantern head (cage, glass, crown) centred at height y. */
function lanternHead(y: number, x = 0): THREE.BufferGeometry[] {
  const cage = cyl(0.22, 0.14, 0.52, y - 0.26, 4).rotateY(Math.PI / 4).translate(x, 0, 0);
  const glass = cyl(0.19, 0.12, 0.44, y - 0.22, 4).rotateY(Math.PI / 4).translate(x, 0, 0);
  const crown = new THREE.ConeGeometry(0.28, 0.26, 4).rotateY(Math.PI / 4).translate(x, y + 0.39, 0);
  const finial = new THREE.SphereGeometry(0.05, 6, 4).translate(x, y + 0.56, 0);
  return [part(cage, IRON), part(glass, GLASS_WARM, 1), part(crown, IRON), part(finial, IRON)];
}

/** Black cast-iron post with a lantern (historic streets, İstiklal, squares, quays). */
function lampLantern(): THREE.BufferGeometry {
  const plinth = cyl(0.15, 0.2, 0.55, 0);
  const collar = cyl(0.1, 0.13, 0.2, 0.55);
  const pole = cyl(0.05, 0.075, 2.95, 0.75);
  const ring = cyl(0.09, 0.09, 0.08, 3.62);
  return merge([part(plinth, IRON), part(collar, IRON), part(pole, IRON), part(ring, IRON), ...lanternHead(3.95)]);
}

/** Wall bracket lantern (facade at x = 0, lantern 0.62 m out). */
function lampWall(): THREE.BufferGeometry {
  const plate = box(0.04, 0.34, 0.16, 0.02, 4.72, 0);
  const arm = box(0.62, 0.04, 0.04, 0.33, 4.86, 0);
  const brace = box(0.5, 0.03, 0.03, 0.27, 4.7, 0).applyMatrix4(new THREE.Matrix4().makeRotationZ(0.42)).translate(0.05, -0.1, 0);
  return merge([part(plate, IRON), part(arm, IRON), part(brace, IRON), ...lanternHead(4.55, 0.62)]);
}

/** Traffic signal: grey pole with a three-aspect head facing +X. */
function signal(): THREE.BufferGeometry {
  const pole = cyl(0.055, 0.07, 3.4, 0);
  const band = cyl(0.075, 0.075, 0.5, 0.4);
  const back = box(0.04, 1.12, 0.46, 0.13, 2.85, 0);
  const head = box(0.2, 0.96, 0.3, 0.25, 2.85, 0);
  const parts = [part(pole, STEEL), part(band, 0xc9a624), part(back, 0xe8e6de), part(head, IRON)];
  [3.15, 2.85, 2.55].forEach((y, i) => {
    parts.push(part(box(0.03, 0.2, 0.2, 0.365, y, 0), 0x202020, 3 + i));
    parts.push(part(box(0.14, 0.04, 0.24, 0.4, y + 0.13, 0), IRON));
  });
  return merge(parts);
}

/** Retractable steel bollard at a pedestrian street mouth (~0.8 m, red reflective band, flush ground ring). */
function bollard(): THREE.BufferGeometry {
  const ring = cyl(0.16, 0.16, 0.02, 0, 12);
  const shaft = cyl(0.1, 0.1, 0.78, 0.02, 12);
  const band = cyl(0.102, 0.102, 0.07, 0.62, 12);
  const cap = cyl(0.085, 0.1, 0.03, 0.8, 12);
  return merge([part(ring, 0x55595c), part(shaft, 0x8d9396), part(band, 0xb3261e), part(cap, 0x6d7275)]);
}

/** T1 / T5 stop canopy: 12.5 m steel roof on a row of posts at the back of the platform, glass screen, bench and a
 *  backlit stop name board; the open side faces +X (the track). */
function tramCanopy(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const roof = box(2.3, 0.12, 12.5, 0.2, 2.95, 0).applyMatrix4(new THREE.Matrix4().makeRotationZ(-0.05));
  parts.push(part(roof, 0x8c9296));
  parts.push(part(box(0.05, 0.28, 12.5, 1.36, 2.92, 0), 0x2f3336));
  parts.push(part(box(2.1, 0.02, 12.3, 0.2, 2.86, 0), 0xc9d0d4));
  for (const z of [-5.6, -1.9, 1.9, 5.6]) {
    parts.push(part(cyl(0.07, 0.08, 2.95, 0, 8).translate(-0.75, 0, z), 0x2f3336));
    parts.push(part(box(1.4, 0.08, 0.08, -0.05, 2.78, z), 0x2f3336));
  }
  parts.push(part(box(0.03, 1.9, 7.2, -0.82, 1.15, -1.5), 0x9fb4bd));
  parts.push(part(box(0.06, 0.08, 7.2, -0.82, 2.12, -1.5), 0x2f3336));
  parts.push(part(box(0.42, 0.05, 3.2, -0.5, 0.46, 1.5), 0x9aa0a4));
  parts.push(part(box(0.06, 0.44, 0.06, -0.5, 0.22, 0.1), 0x2f3336));
  parts.push(part(box(0.06, 0.44, 0.06, -0.5, 0.22, 2.9), 0x2f3336));
  parts.push(part(box(0.1, 0.42, 1.8, 0.9, 2.55, 4.4), 0x1f4f8c));
  parts.push(part(box(0.02, 0.34, 1.7, 0.96, 2.55, 4.4), 0xe9eef2, 2));
  parts.push(part(box(0.3, 1.9, 0.12, -0.55, 0.95, -5.0), 0x2f3336));
  parts.push(part(box(0.24, 1.2, 0.02, -0.55, 1.2, -4.93), 0xe9eef2, 2));
  return merge(parts);
}

/** Ticket gates across a tram platform: four stainless turnstile cabinets with glass flaps and lit validators
 *  (walking direction along local Z). */
function ticketGate(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const x of [-1.25, -0.42, 0.42, 1.25]) {
    parts.push(part(box(0.2, 0.92, 1.25, x, 0.46, 0), 0xa9b0b5));
    parts.push(part(box(0.22, 0.04, 1.27, x, 0.94, 0), 0x3a3f43));
    parts.push(part(box(0.14, 0.03, 0.16, x, 0.97, -0.42), 0x2a2e31, 2));
  }
  for (const x of [-0.835, 0, 0.835]) {
    parts.push(part(box(0.26, 0.5, 0.02, x - 0.17, 0.72, 0.1), 0x9fb4bd));
    parts.push(part(box(0.26, 0.5, 0.02, x + 0.17, 0.72, 0.1), 0x9fb4bd));
  }
  return merge(parts);
}

/** T1 centre mast between the tracks: arms along ±Z carry the contact wires at 5.8 m. */
function catenaryCentre(): THREE.BufferGeometry {
  const pole = cyl(0.09, 0.13, 7.2, 0, 8);
  const arm = box(0.07, 0.07, 4.2, 0, 6.6, 0);
  const tie = box(0.04, 0.04, 3.6, 0, 6.1, 0);
  const dropA = box(0.03, 0.8, 0.03, 0, 6.2, 1.75);
  const dropB = box(0.03, 0.8, 0.03, 0, 6.2, -1.75);
  return merge([part(pole, STEEL), part(arm, STEEL), part(tie, STEEL), part(dropA, STEEL_DARK), part(dropB, STEEL_DARK)]);
}

/** Side mast with one cantilever arm reaching +Z over the track. */
function catenarySide(): THREE.BufferGeometry {
  const pole = cyl(0.09, 0.13, 7.0, 0, 8);
  const arm = box(0.07, 0.07, 3.2, 0, 6.5, 1.55);
  const tie = box(0.035, 0.035, 3.2, 0, 6.0, 1.55).applyMatrix4(new THREE.Matrix4().makeRotationX(0.15)).translate(0, 0.25, 0);
  const drop = box(0.03, 0.7, 0.03, 0, 6.15, 2.9);
  return merge([part(pole, STEEL), part(arm, STEEL), part(tie, STEEL), part(drop, STEEL_DARK)]);
}

const BUILDERS: Record<PropKind, () => THREE.BufferGeometry> = {
  lampArm,
  lampArmLow,
  lampDouble,
  lampLantern,
  lampWall,
  signal,
  bollard,
  tramCanopy,
  ticketGate,
  catenaryCentre,
  catenarySide,
};

export function propGeometry(kind: PropKind): THREE.BufferGeometry {
  return BUILDERS[kind]();
}
