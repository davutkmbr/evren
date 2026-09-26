/**
 * Kız Kulesi (Maiden's Tower, present form 1763, restored 2021-2023): a small rocky islet 200 m off Salacak with a
 * masonry quay and terrace, the two-storey stone building with a hipped lead roof and the square tower carrying an
 * octagonal drum, the glazed lantern (once a lighthouse) and a lead cupola, ~23 m above the sea.
 */
import * as THREE from 'three';
import type { StructureBuild } from '../../build/context';
import type { MeshBuilder, SurfaceState } from '../../build/mesh-builder';
import { Emit, Surf } from '../../build/surfaces';
import { Color, mat, Pal, withEmit } from '../palette';
import { band, block, piercedWall, polygonMaps, quoins, shade, type Opening, type WallMap } from './masonry';
import { archWindow } from './openings';

const STONE = withEmit(mat(0xb9ad98, Surf.Ashlar, 0.82, 0, 0.38), Emit.Flood, 2.4, 1, 26);
const QUAY = withEmit(mat(0x9d948a, Surf.Ashlar, 0.85, 0, 0.55), Emit.Flood, 1.2, 1, 8);
const LEAD = withEmit(mat(0x737d7e, Surf.Lead, 0.45, 0.3, 0.5), Emit.Flood, 0.8, 1, 26);
const LIT = { ...Pal.window, emit: Emit.Windows, ea: 4, eb: 3, ec: 0.85 };
const TRIM = withEmit(mat(0xd3c9b5, Surf.Ashlar, 0.72, 0, 0.38), Emit.Flood, 2.4, 1, 26);
const REVEAL = shade(STONE, 0.66);
const DOOR = mat(0x4a3322, Surf.Plain, 0.6);

type ToWorld = (u: number, v: number, y: number) => THREE.Vector3;

/** Wall faces of a local (u, v) rectangle, each tagged with its outward local direction. */
function rectFaces(W: ToWorld, u0: number, u1: number, v0: number, v1: number): Array<{ map: WallMap; du: number; dv: number }> {
  const ring: Array<[number, number]> = [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ].map(([u, v]) => {
    const p = W(u, v, 0);
    return [p.x, p.z] as [number, number];
  });
  const o = W(0, 0, 0);
  const fu = W(1, 0, 0).sub(o);
  const fv = W(0, 1, 0).sub(o);
  return polygonMaps(ring).map((map) => {
    const n = map.normal(0);
    return { map, du: Math.round(n.dot(fu)), dv: Math.round(n.dot(fv)) };
  });
}

export function buildKizKulesi(b: StructureBuild): void {
  const { x, z } = b.def;
  const yaw = -(b.def.headingDeg * Math.PI) / 180;
  // local (u along heading, v to the right) -> world
  const fx = Math.sin(-yaw);
  const fz = -Math.cos(-yaw);
  const rx = -fz;
  const rz = fx;
  const W = (u: number, v: number, y: number): THREE.Vector3 => new THREE.Vector3(x + fx * u + rx * v, y, z + fz * u + rz * v);
  const boxYaw = Math.atan2(-fz, fx);
  const terraceY = 2.1;

  const terrace: Array<[number, number]> = [
    [-23, -7],
    [-19, -11],
    [13, -11.5],
    [21, -6],
    [21, 7],
    [13, 11.5],
    [-17, 11.5],
    [-23, 6],
  ];
  const rocks: Array<[number, number]> = [
    [-27, -8],
    [-22, -14],
    [0, -15.5],
    [16, -14.5],
    [25, -7],
    [26, 6],
    [16, 15],
    [-4, 15.5],
    [-20, 14],
    [-28, 5],
  ];

  b.opaque(
    (mb, lod) => {
      // rock apron around the quay
      mb.surface(Pal.rock);
      mb.vBase = -4;
      const rockRing = rocks.map(([u, v]) => {
        const p = W(u, v, 0);
        return [p.x, p.z] as [number, number];
      });
      mb.prismRing(rockRing, -4, 0.6, 0, false, true);
      // quay walls + terrace
      mb.surface(QUAY);
      const ring = terrace.map(([u, v]) => {
        const p = W(u, v, 0);
        return [p.x, p.z] as [number, number];
      });
      mb.vBase = -1;
      mb.prismRing(ring, -1, terraceY, 0, false, false);
      mb.surface(mat(0x8f877c, Surf.Paving, 0.8, 0, 0.7));
      mb.polygon(
        terrace.map(([u, v]) => W(u, v, terraceY)),
        new THREE.Vector3(0, 1, 0),
      );
      // parapet along the terrace edge
      mb.surface(QUAY);
      if (lod === 0) {
        for (let i = 0; i < terrace.length; i++) {
          const [u0, v0] = terrace[i];
          const [u1, v1] = terrace[(i + 1) % terrace.length];
          const a = W(u0, v0, 0);
          const c = W(u1, v1, 0);
          const mid = a.clone().add(c).multiplyScalar(0.5);
          const len = a.distanceTo(c);
          const segYaw = Math.atan2(-(c.z - a.z), c.x - a.x);
          const inward = new THREE.Vector3(x - mid.x, 0, z - mid.z).normalize().multiplyScalar(0.3);
          mb.box(mid.x + inward.x, terraceY + 0.5, mid.z + inward.z, len / 2, 0.5, 0.25, segYaw, true, false);
        }
      }
      mb.vBase = terraceY;
      building(mb, W, boxYaw, terraceY, lod);
      tower(mb, W, boxYaw, terraceY, lod);
      mb.vBase = 0;
    },
    { detailScale: 0.5 },
  );

  // railing round the tower balcony (slab top at 16.0 m, 4.1 m half width)
  const hb = 3.98;
  const rail = [
    [-hb, -hb],
    [hb, -hb],
    [hb, hb],
    [-hb, hb],
    [-hb, -hb],
  ].map(([du, dv]) => W(-6.75 + du, dv, terraceY + 17.0));
  b.wires.polyline(rail, 0.03, Color.railing, { fade: [600, 1200] });
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 8; k++) {
      const p = rail[i].clone().lerp(rail[i + 1], k / 8);
      b.wires.add(p.clone().setY(terraceY + 16.0), p, 0.022, Color.railing, { fade: [250, 500] });
    }
  }

  // lantern light (historic lighthouse) and terrace lamps
  const lantern = W(-6.75, 0, terraceY + 19.3);
  b.lights.add(lantern, [40, 30, 18], 0.5);
  for (const [u, v] of [
    [-21, -5],
    [-21, 5],
    [19, -5],
    [19, 5],
    [0, -10.5],
    [0, 10.5],
    [10, -10.5],
    [10, 10.5],
  ]) {
    b.lights.add(W(u, v, terraceY + 3.2), [16, 11, 6], 0.18);
  }
  const c = W(-6.75, 0, 0);
  b.cylinderCollider(c.x, terraceY, c.z, 5.3, 21.5);
  const bc = W(6, 0, 0);
  b.boxCollider(bc.x, terraceY + 4.5, bc.z, 10, 4.5, 8, boxYaw);
  const tc = W(-1, 0, 0);
  b.boxCollider(tc.x, 0, tc.z, 22, terraceY, 11, boxYaw); // sea floor side up to the terrace paving
}

function building(mb: MeshBuilder, W: (u: number, v: number, y: number) => THREE.Vector3, yaw: number, y0: number, lod: number): void {
  const c = W(6, 0, 0);
  const h = 7.2;
  mb.surface(STONE);
  if (lod > 0) {
    mb.box(c.x, y0 + h / 2, c.z, 10, h / 2, 8, yaw, true, false);
  }
  // cornice
  mb.box(c.x, y0 + h + 0.15, c.z, 10.35, 0.15, 8.35, yaw, true, false);
  // hipped roof
  mb.surface(LEAD);
  const ry = y0 + h + 0.3;
  const eave = [W(-4.6, -8.6, ry), W(16.6, -8.6, ry), W(16.6, 8.6, ry), W(-4.6, 8.6, ry)];
  const ridgeA = W(1.5, 0, ry + 3.2);
  const ridgeB = W(10.5, 0, ry + 3.2);
  const inside = W(6, 0, ry + 1);
  mb.polygonOutward([eave[0], eave[1], ridgeB, ridgeA], inside);
  mb.polygonOutward([eave[2], eave[3], ridgeA, ridgeB], inside);
  mb.polygonOutward([eave[1], eave[2], ridgeB], inside);
  mb.polygonOutward([eave[3], eave[0], ridgeA], inside);
  if (lod === 0) {
    detailedBuilding(mb, W, y0, h);
    return;
  }
  // distant LOD: two rows of window panels on the long sides and the sea side
  const wins: Array<{ u: number; v: number; n: [number, number] }> = [];
  for (let u = -1.5; u <= 13.5; u += 3.8) {
    wins.push({ u, v: 8, n: [0, 1] }, { u, v: -8, n: [0, -1] });
  }
  for (let v = -5; v <= 5; v += 3.4) {
    wins.push({ u: 16, v, n: [1, 0] });
  }
  for (const w of wins) {
    for (const [y, hgt, lit] of [
      [y0 + 1.0, 2.2, LIT],
      [y0 + 4.4, 2.0, LIT],
    ] as Array<[number, number, SurfaceState]>) {
      const p = W(w.u, w.v, 0);
      const nWorld = W(w.u + w.n[0], w.v + w.n[1], 0).sub(p).normalize();
      const angle = Math.atan2(nWorld.z, nWorld.x);
      archWindow(mb, { cx: p.x - nWorld.x * 50, cz: p.z - nWorld.z * 50, radius: 50, angle, y0: y, height: hgt, width: 1.1, shape: 'arch' }, STONE, lit);
    }
  }
}

function tower(mb: MeshBuilder, W: (u: number, v: number, y: number) => THREE.Vector3, yaw: number, y0: number, lod: number): void {
  const u0 = -6.75;
  const c = W(u0, 0, 0);
  const seg = lod === 0 ? 16 : 8;
  mb.surface(STONE);
  if (lod === 0) {
    detailedTower(mb, W, u0, y0);
  } else {
    mb.box(c.x, y0 + 7.8, c.z, 3.75, 7.8, 3.75, yaw, true, false);
  }
  mb.box(c.x, y0 + 15.8, c.z, 4.1, 0.2, 4.1, yaw, true, false);
  // octagonal drum
  if (lod === 0) {
    detailedDrum(mb, c, yaw, y0);
  } else {
    mb.lathe(
      [
        { r: 3.4, y: y0 + 16.0 },
        { r: 3.4, y: y0 + 18.4, crease: true },
        { r: 3.75, y: y0 + 18.6, crease: true },
        { r: 3.75, y: y0 + 18.8 },
      ],
      8,
      { cx: c.x, cz: c.z, phase: Math.PI / 8 - yaw, capTop: true },
    );
  }
  // glazed lantern with a warm glow
  if (lod === 0) {
    lanternFrame(mb, c, yaw, y0);
  }
  mb.surface(withEmit(mat(0xf4e3b8, Surf.Window, 0.1), Emit.Glow, 8));
  mb.lathe(
    [
      { r: 2.3, y: y0 + 18.8 },
      { r: 2.3, y: y0 + 20.6 },
    ],
    8,
    { cx: c.x, cz: c.z, phase: Math.PI / 8 - yaw },
  );
  // cupola + finial
  mb.surface(LEAD);
  const dome = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    dome.push({ r: 2.6 * Math.cos(a) + 0.05, y: y0 + 20.6 + 2.0 * Math.sin(a) });
  }
  mb.lathe(dome, seg, { cx: c.x, cz: c.z });
  mb.surface(mat(0xb09555, Surf.Steel, 0.35, 0.8, 0));
  mb.cylinder(c.x, y0 + 22.6, c.z, 0.12, 0.03, 1.4, 6, true, false);
  if (lod === 0) {
    // cut as real openings by detailedTower / detailedDrum
    return;
  }
  // distant LOD: window panels, one per face per storey, and the drum windows
  const faces: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [du, dv] of faces) {
    const p = W(u0 + du * 3.75, dv * 3.75, 0);
    const n = W(u0 + du * 4.75, dv * 4.75, 0).sub(p).normalize();
    const angle = Math.atan2(n.z, n.x);
    for (const y of [y0 + 8.5, y0 + 12.2]) {
      archWindow(mb, { cx: p.x - n.x * 40, cz: p.z - n.z * 40, radius: 40, angle, y0: y, height: 2.2, width: 1.0, shape: 'arch' }, STONE, LIT);
    }
  }
  for (let k = 0; k < 8; k++) {
    const angle = (k / 8) * Math.PI * 2 - yaw;
    archWindow(mb, { cx: c.x, cz: c.z, radius: 3.25, angle, y0: y0 + 16.4, height: 1.6, width: 0.9, shape: 'arch' }, null, LIT);
  }
}

/**
 * LOD0 main building: plinth, two storeys of recessed windows (segmental below, round-arched above) in dressed
 * surrounds with sills, a string course at the upper floor, quoined corners and the entrance on the long side.
 */
function detailedBuilding(mb: MeshBuilder, W: ToWorld, y0: number, h: number): void {
  const floor = y0 + 3.5;
  for (const { map, du, dv } of rectFaces(W, -4, 16, -8, 8)) {
    const ops: Opening[] = [];
    const n = Math.max(1, Math.round(map.len / 3.8));
    const bay = map.len / n;
    for (let i = 0; i < n; i++) {
      const s = bay * (i + 0.5);
      // the tower stands against the -u end: that face only keeps the openings clear of it
      if (du < 0 && Math.abs(s - map.len / 2) < 5.2) {
        continue;
      }
      const door = dv < 0 && i === Math.floor(n / 2);
      if (door) {
        ops.push({ s, sill: y0 + 0.05, h: 3.0, w: 1.6, shape: 'segmental', depth: 0.7, back: DOOR, frame: 0.28, keystone: true });
      } else {
        ops.push({ s, sill: y0 + 0.95, h: 1.95, w: 1.05, shape: 'segmental', depth: 0.55, back: LIT, frame: 0.16, sillOut: 0.12, keystone: true });
      }
      ops.push({ s, sill: floor + 0.8, h: 2.15, w: 1.05, shape: 'arch', depth: 0.55, back: LIT, frame: 0.16, sillOut: 0.12, keystone: true });
    }
    piercedWall(mb, map, y0, y0 + h, ops, { wall: STONE, trim: TRIM, reveal: REVEAL });
    mb.surface(TRIM);
    band(mb, map, y0, y0 + 0.45, 0.12);
    band(mb, map, floor + 0.05, floor + 0.35, 0.1);
    quoins(mb, map, 0, y0 + 0.45, y0 + h, 0.42, 0.75, 0.45);
    quoins(mb, map, map.len, y0 + 0.45, y0 + h, 0.42, 0.75, 0.45);
  }
}

/** LOD0 tower shaft: quoins, two string courses and one recessed arched window per face and storey. */
function detailedTower(mb: MeshBuilder, W: ToWorld, u0: number, y0: number): void {
  const hs = 3.75;
  for (const { map, du } of rectFaces(W, u0 - hs, u0 + hs, -hs, hs)) {
    // the face toward the building rises from its roof
    const base = du > 0 ? y0 + 7.2 : y0;
    const ops: Opening[] = [];
    for (const y of du > 0 ? [y0 + 12.2] : [y0 + 4.2, y0 + 8.5, y0 + 12.2]) {
      ops.push({ s: map.len / 2, sill: y, h: 2.2, w: 1.0, shape: 'arch', depth: 0.8, back: LIT, frame: 0.17, sillOut: 0.12, keystone: true });
    }
    piercedWall(mb, map, base, y0 + 15.6, ops, { wall: STONE, trim: TRIM, reveal: REVEAL });
    mb.surface(TRIM);
    for (const y of [y0 + 7.4, y0 + 11.3]) {
      if (y > base) {
        band(mb, map, y, y + 0.3, 0.1);
      }
    }
    band(mb, map, y0 + 15.2, y0 + 15.6, 0.16);
    quoins(mb, map, 0, base, y0 + 15.2, 0.42, 0.8, 0.5);
    quoins(mb, map, map.len, base, y0 + 15.2, 0.42, 0.8, 0.5);
  }
}

/** Corners of the octagonal drum / lantern (circumradius r) in world xz. */
function octagon(c: THREE.Vector3, yaw: number, r: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let k = 0; k < 8; k++) {
    const a = Math.PI / 8 - yaw + (k / 8) * Math.PI * 2;
    out.push([c.x + Math.cos(a) * r, c.z + Math.sin(a) * r]);
  }
  return out;
}

/** LOD0 octagonal drum: one recessed arched window per face, a moulded cornice and small corner pilasters. */
function detailedDrum(mb: MeshBuilder, c: THREE.Vector3, yaw: number, y0: number): void {
  for (const map of polygonMaps(octagon(c, yaw, 3.4))) {
    const ops: Opening[] = [{ s: map.len / 2, sill: y0 + 16.45, h: 1.6, w: 0.9, shape: 'arch', depth: 0.45, back: LIT, frame: 0.12, keystone: true }];
    piercedWall(mb, map, y0 + 16.0, y0 + 18.4, ops, { wall: STONE, trim: TRIM, reveal: REVEAL, archSeg: 6 });
    mb.surface(TRIM);
    block(mb, map, -0.02, 0.28, y0 + 16.0, y0 + 18.4, 0.02, -0.08);
    block(mb, map, map.len - 0.28, map.len + 0.02, y0 + 16.0, y0 + 18.4, 0.02, -0.08);
  }
  mb.surface(TRIM);
  mb.lathe(
    [
      { r: 3.4, y: y0 + 18.4 },
      { r: 3.6, y: y0 + 18.5, crease: true },
      { r: 3.8, y: y0 + 18.62, crease: true },
      { r: 3.8, y: y0 + 18.8, crease: true },
      { r: 2.3, y: y0 + 18.8, crease: true },
    ],
    8,
    { cx: c.x, cz: c.z, phase: Math.PI / 8 - yaw },
  );
}

/** Lantern posts between the glazed panes and the ring beam under the cupola. */
function lanternFrame(mb: MeshBuilder, c: THREE.Vector3, yaw: number, y0: number): void {
  mb.surface(TRIM);
  for (const [px, pz] of octagon(c, yaw, 2.36)) {
    mb.cylinder(px, y0 + 18.8, pz, 0.11, 0.11, 1.8, 6, false, false);
  }
  mb.lathe(
    [
      { r: 2.3, y: y0 + 20.45 },
      { r: 2.75, y: y0 + 20.5, crease: true },
      { r: 2.75, y: y0 + 20.65, crease: true },
      { r: 2.4, y: y0 + 20.7, crease: true },
    ],
    8,
    { cx: c.x, cz: c.z, phase: Math.PI / 8 - yaw },
  );
}
