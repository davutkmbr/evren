/**
 * A City Lines (Şehir Hatları) passenger ferry of the classic Kadıköy type (prop hero_ferry, c02 "a ferry with a
 * yellow funnel on the right"): a double-ended steel hull about 70 m long and 13 m wide, black boot topping and a
 * white hull, two decks of saloon windows in white superstructures, promenade rails, wheelhouses at both ends, a
 * yellow funnel with a black top amidships, two masts and life rafts. Built procedurally (no approved model).
 *
 * Prop frame: metres, the waterline at y 0, the long axis along +Z (either end is a bow), beam along X.
 * Night: the saloon glass is the lit hero glass (emissive at night); deck and mast lights come as the prop's lights.
 */
import type { PropDef, PropLight } from '../props';
import type { TileMesh, Vec3 } from '../mesh';
import { Builder } from './kit';

class Geo {
  private readonly b = new Map<string, Builder>();
  constructor(readonly mesh: TileMesh) {}
  of(m: string): Builder {
    let x = this.b.get(m);
    if (!x) {
      x = new Builder();
      this.b.set(m, x);
    }
    return x;
  }
  flush(): void {
    for (const [m, x] of this.b) {
      x.flush(this.mesh, m);
    }
    this.b.clear();
  }
}

const L = 35;
const B = 6.4;
/** Half-beam of the deck line at z (blunt double-ended plan). */
const halfBeam = (z: number): number => B * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(z) / L, 3.2)), 0.5);
const DECK = 2.3;

function box(b: Builder, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, bottom = false): void {
  b.flatQuad([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0]);
  if (bottom) {
    b.flatQuad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0]);
  }
  b.flatQuad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]);
  b.flatQuad([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [0, 0, -1]);
  b.flatQuad([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], [1, 0, 0]);
  b.flatQuad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0]);
}

/** A superstructure deck: rounded-end plan inset from the hull, from y0 to y1, with a band of windows each side. */
function deckhouse(g: Geo, half: number, inset: number, y0: number, y1: number, winY0: number, winY1: number, pitch: number, lit: boolean): void {
  const n = 24;
  const plan: [number, number][] = [];
  for (let k = 0; k <= n; k++) {
    const z = -half + (2 * half * k) / n;
    plan.push([Math.max(0.5, halfBeam(z * (L / (half + 3))) - inset), z]);
  }
  const white = g.of('hero_ferry_white');
  for (const side of [-1, 1]) {
    for (let k = 0; k < n; k++) {
      const [xa, za] = plan[k];
      const [xb, zb] = plan[k + 1];
      const nx = (zb - za) * side;
      const nz = -(xb - xa) * side;
      const l = Math.hypot(nx, nz) || 1;
      const nrm: Vec3 = [nx / l, 0, nz / l];
      white.flatQuad([[xa * side, y0, za], [xb * side, y0, zb], [xb * side, y1, zb], [xa * side, y1, za]], nrm);
    }
  }
  // Ends and roof.
  const ends = [plan[0], plan[n]];
  for (const [xe, ze] of ends) {
    const nz = ze < 0 ? -1 : 1;
    white.flatQuad([[-xe, y0, ze], [xe, y0, ze], [xe, y1, ze], [-xe, y1, ze]], [0, 0, nz]);
  }
  const roof = g.of('hero_ferry_deck');
  for (let k = 0; k < n; k++) {
    const [xa, za] = plan[k];
    const [xb, zb] = plan[k + 1];
    roof.flatQuad([[-xa, y1, za], [xa, y1, za], [xb, y1, zb], [-xb, y1, zb]], [0, 1, 0]);
  }
  // Window band: square windows every `pitch` along both sides, a hair proud of the wall.
  const glass = g.of(lit ? 'hero_glass_lit' : 'hero_glass');
  for (const side of [-1, 1]) {
    for (let z = -half + 2; z < half - 2; z += pitch) {
      const w = pitch * 0.62;
      const xa = (halfBeam(z * (L / (half + 3))) - inset) * side + side * 0.02;
      const xb = (halfBeam((z + w) * (L / (half + 3))) - inset) * side + side * 0.02;
      glass.flatQuad([[xa, winY0, z], [xb, winY0, z + w], [xb, winY1, z + w], [xa, winY1, z]], [side, 0, 0]);
    }
  }
}

function rail(g: Geo, half: number, inset: number, y: number): void {
  const b = g.of('hero_ferry_white');
  const n = 30;
  for (const side of [-1, 1]) {
    for (let k = 0; k < n; k++) {
      const z0 = -half + (2 * half * k) / n;
      const z1 = -half + (2 * half * (k + 1)) / n;
      const x0 = (halfBeam(z0) - inset) * side;
      const x1 = (halfBeam(z1) - inset) * side;
      b.flatQuad([[x0, y + 0.95, z0], [x1, y + 0.95, z1], [x1, y + 1.05, z1], [x0, y + 1.05, z0]], [side, 0, 0]);
      b.flatQuad([[x0, y + 0.95, z0], [x1, y + 0.95, z1], [x1, y + 1.05, z1], [x0, y + 1.05, z0]], [-side, 0, 0]);
      // Solid bulwark panel below (the promenade deck has white plating to 0.95 m).
      b.flatQuad([[x0, y, z0], [x1, y, z1], [x1, y + 0.95, z1], [x0, y + 0.95, z0]], [side, 0, 0]);
    }
  }
}

/** Builds the ferry into a prop mesh. */
export function buildFerry(mesh: TileMesh): void {
  const g = new Geo(mesh);
  // Hull: stations along z, sections from the keel (-2.2) to the deck line with a slight sheer.
  const st = 36;
  const ys = [-2.2, -1.2, 0, 0.7, 1.2, DECK];
  const width = [0.25, 0.75, 0.96, 0.99, 1.0, 1.0];
  const mats = ['hero_ferry_red', 'hero_ferry_red', 'hero_ferry_black', 'hero_ferry_white', 'hero_ferry_white'];
  for (const side of [-1, 1]) {
    for (let k = 0; k < st; k++) {
      const z0 = -L + (2 * L * k) / st;
      const z1 = -L + (2 * L * (k + 1)) / st;
      const sh0 = 0.7 * (z0 / L) ** 2;
      const sh1 = 0.7 * (z1 / L) ** 2;
      for (let j = 0; j + 1 < ys.length; j++) {
        const ya0 = ys[j];
        const yTop0 = ys[j + 1] + (j + 1 === ys.length - 1 ? sh0 : 0);
        const yTop1 = ys[j + 1] + (j + 1 === ys.length - 1 ? sh1 : 0);
        const p = (z: number, w: number, y: number): Vec3 => [side * halfBeam(z) * w, y, z];
        const b = g.of(mats[j]);
        const q = [p(z0, width[j], ya0), p(z1, width[j], ya0), p(z1, width[j + 1], yTop1), p(z0, width[j + 1], yTop0)];
        const nx = side;
        const nz = (halfBeam(z0) - halfBeam(z1)) / (z1 - z0);
        const l = Math.hypot(nx, nz);
        b.flatQuad(q, [nx / l, 0, (nz * side) / l]);
      }
    }
  }
  // Rubbing strake (black) at the deck edge and the main deck.
  const strake = g.of('hero_ferry_black');
  for (const side of [-1, 1]) {
    for (let k = 0; k < st; k++) {
      const z0 = -L + (2 * L * k) / st;
      const z1 = -L + (2 * L * (k + 1)) / st;
      const y0 = DECK + 0.7 * (z0 / L) ** 2;
      const y1 = DECK + 0.7 * (z1 / L) ** 2;
      strake.flatQuad([[side * (halfBeam(z0) + 0.12), y0 - 0.35, z0], [side * (halfBeam(z1) + 0.12), y1 - 0.35, z1], [side * (halfBeam(z1) + 0.12), y1 - 0.05, z1], [side * (halfBeam(z0) + 0.12), y0 - 0.05, z0]], [side, 0, 0]);
    }
  }
  const deck = g.of('hero_ferry_deck');
  for (let k = 0; k < st; k++) {
    const z0 = -L + (2 * L * k) / st;
    const z1 = -L + (2 * L * (k + 1)) / st;
    const y0 = DECK + 0.7 * (z0 / L) ** 2;
    const y1 = DECK + 0.7 * (z1 / L) ** 2;
    deck.flatQuad([[-halfBeam(z0), y0, z0], [halfBeam(z0), y0, z0], [halfBeam(z1), y1, z1], [-halfBeam(z1), y1, z1]], [0, 1, 0]);
  }
  // Main deck saloon (deck 1) and upper saloon (deck 2), promenade rails, the top deck.
  deckhouse(g, 30, 0.9, DECK, 4.75, 3.05, 4.1, 1.35, true);
  rail(g, 29, 0.9, 4.75);
  deckhouse(g, 24, 1.6, 4.75, 7.1, 5.5, 6.5, 1.5, true);
  rail(g, 23, 1.6, 7.1);
  // Wheelhouses at both ends of the top deck.
  const white = g.of('hero_ferry_white');
  const glass = g.of('hero_glass');
  for (const end of [-1, 1]) {
    const z0 = end * 19 - 2.2;
    const z1 = end * 19 + 2.2;
    box(white, -2.4, 2.4, 7.1, 9.3, z0, z1);
    const zf = end > 0 ? z1 + 0.02 : z0 - 0.02;
    glass.flatQuad([[-2.1, 8.2, zf], [2.1, 8.2, zf], [2.1, 9.0, zf], [-2.1, 9.0, zf]], [0, 0, end]);
    for (const side of [-1, 1]) {
      glass.flatQuad([[side * 2.42, 8.2, z0 + 0.3], [side * 2.42, 8.2, z1 - 0.3], [side * 2.42, 9.0, z1 - 0.3], [side * 2.42, 9.0, z0 + 0.3]], [side, 0, 0]);
    }
    box(g.of('hero_ferry_black'), -2.6, 2.6, 9.3, 9.45, z0 - 0.2, z1 + 0.2);
    // Mast with a crossbar and a light.
    const mz = end * 14;
    box(g.of('hero_ferry_white'), -0.12, 0.12, 7.1, 16.5, mz - 0.12, mz + 0.12);
    box(g.of('hero_ferry_white'), -1.4, 1.4, 14.2, 14.35, mz - 0.07, mz + 0.07);
    box(g.of('hero_glass_lit'), -0.14, 0.14, 16.5, 16.8, mz - 0.14, mz + 0.14);
  }
  // Funnel: oval, yellow with a black top band and a thin white line.
  const fn = 20;
  const ring = (y: number, rx: number, rz: number): Vec3[] => Array.from({ length: fn }, (_, k) => [Math.cos((k / fn) * Math.PI * 2) * rx, y, Math.sin((k / fn) * Math.PI * 2) * rz] as Vec3);
  const bands: [number, number, string][] = [
    [7.1, 10.6, 'hero_ferry_yellow'],
    [10.6, 10.75, 'hero_ferry_white'],
    [10.75, 11.8, 'hero_ferry_black'],
  ];
  for (const [y0, y1, m] of bands) {
    const a = ring(y0, 1.35, 2.0);
    const c = ring(y1, 1.3 - (y1 - 7.1) * 0.02, 1.95 - (y1 - 7.1) * 0.02);
    const b = g.of(m);
    for (let k = 0; k < fn; k++) {
      const k1 = (k + 1) % fn;
      const nx = Math.cos(((k + 0.5) / fn) * Math.PI * 2) / 1.35;
      const nz = Math.sin(((k + 0.5) / fn) * Math.PI * 2) / 2.0;
      const l = Math.hypot(nx, nz);
      b.flatQuad([a[k], a[k1], c[k1], c[k]], [nx / l, 0, nz / l]);
    }
  }
  const top = ring(11.8, 1.06, 1.71);
  const cap = g.of('hero_ferry_black');
  for (let k = 1; k + 1 < fn; k++) {
    cap.tri(cap.v(top[0], [0, 1, 0]), cap.v(top[k], [0, 1, 0]), cap.v(top[k + 1], [0, 1, 0]));
  }
  // Life rafts (white canisters) along the top-deck sides.
  const raft = g.of('hero_ferry_white');
  for (const side of [-1, 1]) {
    for (let z = -12; z <= 12; z += 4) {
      if (Math.abs(z) < 3) {
        continue;
      }
      box(raft, side * 3.2 - 0.35, side * 3.2 + 0.35, 7.3, 7.9, z - 0.7, z + 0.7);
    }
  }
  g.flush();
}

const LIGHTS: PropLight[] = [
  { type: 'point', position: [0, 16.6, 14], kelvin: 3500, lumens: 800, night: true, source: 'lamp' },
  { type: 'point', position: [0, 16.6, -14], kelvin: 3500, lumens: 800, night: true, source: 'lamp' },
  { type: 'point', position: [0, 6.0, 0], kelvin: 3000, lumens: 3000, night: true, source: 'window' },
];

export const FERRY_PROP: PropDef = { id: 'hero_ferry', drawDistance: 3000, castShadow: true, build: (b) => b.variant('kadikoy', (m) => buildFerry(m)), lights: LIGHTS };
