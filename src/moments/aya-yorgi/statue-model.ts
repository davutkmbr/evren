/**
 * The knight statue of "Aya Yorgi'nin Meydan Okuması" (actor 'moments/aya-yorgi-knight-statue'): an original prop, a
 * weathered bronze knight with a spear and a shield on a stepped stone plinth, built from primitives with vertex colours
 * (verdigris bronze, darker in the folds, rust on the spear head). It is a little taller than the standing dragon.
 *
 * Joints (THREE.Group pivots) for the three animations (./pose.ts): the spear arm at the right shoulder, the shield arm
 * at the left, the shoulders (shrug) and the head (it follows the dragon). Model space: +Z is the statue's front (so its
 * right hand is at -X), the origin is the plinth's foot on the ground.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Plinth height and the figure's scale (a 1.8-unit figure → about 6.5 m). */
export const PLINTH_H = 2.6;
export const FIGURE_SCALE = 3.6;
export const STATUE_HEIGHT = PLINTH_H + FIGURE_SCALE * 1.9;

const BRONZE = new THREE.Color('#5d8a78');
const BRONZE_DARK = new THREE.Color('#3b5c50');
const BRONZE_WORN = new THREE.Color('#8a7a52');
const RUST = new THREE.Color('#7a4a2a');
const STONE = new THREE.Color('#a8a296');
const STONE_DARK = new THREE.Color('#8a857a');

export interface KnightStatue {
  root: THREE.Group;
  /** Right shoulder pivot: rotation.x > 0 swings the arm up and tips the spear forward toward the challenger. */
  spearArm: THREE.Group;
  /** Left shoulder pivot (shield arm): rotation.z > 0 opens it outward in the shrug. */
  shieldArm: THREE.Group;
  /** Shoulders: position.y raises them in the shrug. */
  shoulders: THREE.Group;
  head: THREE.Group;
  materials: THREE.Material[];
  dispose(): void;
}

function part(g: THREE.BufferGeometry, color: THREE.Color, at: [number, number, number], rot: [number, number, number] = [0, 0, 0], shade = 0): THREE.BufferGeometry {
  const geo = g;
  geo.rotateX(rot[0]).rotateY(rot[1]).rotateZ(rot[2]);
  geo.translate(at[0], at[1], at[2]);
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    // Verdigris gathers in the downward-facing folds; upward faces stay a little browner (rain-washed).
    const ny = nrm.getY(i);
    c.copy(color);
    if (shade > 0) {
      c.lerp(ny < 0 ? BRONZE_DARK : BRONZE_WORN, shade * Math.abs(ny) * 0.6);
    }
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.deleteAttribute('uv');
  return geo;
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) {
    p.dispose();
  }
  g.computeBoundingSphere();
  return g;
}

const cyl = (rt: number, rb: number, h: number, seg = 12): THREE.BufferGeometry => new THREE.CylinderGeometry(rt, rb, h, seg);
const box = (w: number, h: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d);
const ball = (r: number, w = 12, h = 8): THREE.BufferGeometry => new THREE.SphereGeometry(r, w, h);

/** The plinth: a stepped base, the shaft and a cornice (world metres). */
function plinthGeometry(): THREE.BufferGeometry {
  return merged([
    part(box(4.2, 0.45, 4.2), STONE_DARK, [0, 0.225, 0]),
    part(box(3.5, 0.35, 3.5), STONE, [0, 0.625, 0]),
    part(box(2.9, 1.35, 2.9), STONE, [0, 1.475, 0]),
    part(box(3.2, 0.3, 3.2), STONE_DARK, [0, 2.3, 0]),
    part(box(3.0, 0.15, 3.0), STONE, [0, 2.525, 0]),
  ]);
}

/** Legs, hips, torso and skirt of mail (figure units, 1.8 ≈ a person; feet at y = 0). */
function bodyGeometry(): THREE.BufferGeometry {
  const s = 0.9;
  return merged([
    // Feet and greaves, the right foot a half step forward.
    part(box(0.13, 0.08, 0.28), BRONZE, [0.12, 0.04, 0.05], [0, 0, 0], s),
    part(box(0.13, 0.08, 0.28), BRONZE, [-0.12, 0.04, 0.12], [0, 0, 0], s),
    part(cyl(0.075, 0.065, 0.48), BRONZE, [0.12, 0.32, 0.0], [0, 0, 0], s),
    part(cyl(0.075, 0.065, 0.48), BRONZE, [-0.12, 0.32, 0.06], [0.08, 0, 0], s),
    part(cyl(0.095, 0.08, 0.42), BRONZE, [0.12, 0.76, 0.0], [0, 0, 0], s),
    part(cyl(0.095, 0.08, 0.42), BRONZE, [-0.12, 0.76, 0.04], [0.06, 0, 0], s),
    // Skirt of mail, belt, breastplate.
    part(cyl(0.2, 0.3, 0.34, 16), BRONZE, [0, 0.9, 0], [0, 0, 0], s),
    part(cyl(0.205, 0.205, 0.05, 16), BRONZE_WORN, [0, 1.08, 0], [0, 0, 0], s),
    part(cyl(0.23, 0.2, 0.38, 16), BRONZE, [0, 1.28, 0], [0, 0, 0], s),
    part(box(0.2, 0.26, 0.08), BRONZE_WORN, [0, 1.3, 0.17], [0, 0, 0], s),
    // A cloak falling down the back.
    part(box(0.46, 0.9, 0.05), BRONZE_DARK, [0, 1.02, -0.2], [-0.1, 0, 0], s),
  ]);
}

/** Pauldrons and the gorget (moves with the shoulders), in the shoulders' frame (origin at y = 1.47). */
function shoulderGeometry(): THREE.BufferGeometry {
  return merged([
    part(ball(0.11, 10, 6), BRONZE, [-0.25, 0, 0], [0, 0, 0], 0.9),
    part(ball(0.11, 10, 6), BRONZE, [0.25, 0, 0], [0, 0, 0], 0.9),
    part(cyl(0.12, 0.2, 0.08, 16), BRONZE_WORN, [0, 0.02, 0], [0, 0, 0], 0.9),
  ]);
}

/** Helmet with a crest, visor slit and nose guard, in the head's frame (origin at the neck). */
function headGeometry(): THREE.BufferGeometry {
  return merged([
    part(cyl(0.06, 0.07, 0.08), BRONZE_DARK, [0, 0.04, 0]),
    part(ball(0.12, 14, 10), BRONZE, [0, 0.18, 0], [0, 0, 0], 0.9),
    part(cyl(0.125, 0.13, 0.12, 14), BRONZE, [0, 0.15, 0], [0, 0, 0], 0.9),
    part(box(0.2, 0.02, 0.03), BRONZE_DARK, [0, 0.17, 0.115]),
    part(box(0.025, 0.1, 0.02), BRONZE_WORN, [0, 0.13, 0.13]),
    part(box(0.03, 0.08, 0.24), BRONZE_WORN, [0, 0.33, -0.01], [0, 0, 0], 0.9),
  ]);
}

/** The spear arm and the spear, in the right shoulder's frame: arm down, spear upright in the fist. */
function spearArmGeometry(): THREE.BufferGeometry {
  return merged([
    part(cyl(0.055, 0.05, 0.3), BRONZE, [0, -0.16, 0], [0, 0, 0], 0.9),
    part(cyl(0.05, 0.045, 0.28), BRONZE, [0, -0.36, 0.1], [-0.9, 0, 0], 0.9),
    part(ball(0.06, 8, 6), BRONZE_WORN, [0, -0.44, 0.22]),
    // The spear: shaft, collar and a rusty leaf-shaped head.
    part(cyl(0.022, 0.022, 2.3, 8), BRONZE_DARK, [0, -0.2, 0.22]),
    part(cyl(0.035, 0.035, 0.05, 8), BRONZE_WORN, [0, 0.96, 0.22]),
    part(new THREE.ConeGeometry(0.05, 0.24, 8), RUST, [0, 1.1, 0.22]),
  ]);
}

/** The shield arm and a kite shield with a cross in relief, in the left shoulder's frame. */
function shieldArmGeometry(): THREE.BufferGeometry {
  return merged([
    part(cyl(0.055, 0.05, 0.3), BRONZE, [0, -0.16, 0], [0, 0, 0], 0.9),
    part(cyl(0.05, 0.045, 0.28), BRONZE, [0, -0.36, 0.08], [-0.6, 0, 0], 0.9),
    part(cyl(0.26, 0.26, 0.04, 20), BRONZE, [0.07, -0.36, 0.12], [0, 0, Math.PI / 2], 0.9),
    part(box(0.03, 0.4, 0.06), BRONZE_WORN, [0.1, -0.36, 0.12]),
    part(box(0.03, 0.06, 0.34), BRONZE_WORN, [0.1, -0.33, 0.12]),
  ]);
}

/** Builds the statue (one merged mesh per joint, two materials). */
export function buildKnightStatue(): KnightStatue {
  const bronze = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.45, roughness: 0.62 });
  const stone = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0, roughness: 0.92 });
  const root = new THREE.Group();
  root.name = 'moment-aya-yorgi-statue';
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, name: string): THREE.Mesh => {
    const x = new THREE.Mesh(g, m);
    x.name = name;
    x.castShadow = true;
    x.receiveShadow = true;
    return x;
  };
  root.add(mesh(plinthGeometry(), stone, 'plinth'));
  const figure = new THREE.Group();
  figure.position.y = PLINTH_H;
  figure.scale.setScalar(FIGURE_SCALE);
  root.add(figure);
  figure.add(mesh(bodyGeometry(), bronze, 'body'));
  const shoulders = new THREE.Group();
  shoulders.position.y = 1.47;
  figure.add(shoulders);
  shoulders.add(mesh(shoulderGeometry(), bronze, 'shoulders'));
  const head = new THREE.Group();
  head.position.y = 0.06;
  shoulders.add(head);
  head.add(mesh(headGeometry(), bronze, 'head'));
  const spearArm = new THREE.Group();
  spearArm.position.set(-0.27, -0.02, 0);
  shoulders.add(spearArm);
  spearArm.add(mesh(spearArmGeometry(), bronze, 'spear-arm'));
  const shieldArm = new THREE.Group();
  shieldArm.position.set(0.27, -0.02, 0);
  shoulders.add(shieldArm);
  shieldArm.add(mesh(shieldArmGeometry(), bronze, 'shield-arm'));
  const materials = [bronze, stone];
  return {
    root,
    spearArm,
    shieldArm,
    shoulders,
    head,
    materials,
    dispose() {
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
        }
      });
      for (const m of materials) {
        m.dispose();
      }
    },
  };
}
