/**
 * Kız Kulesi (Maiden's Tower, present form 1763, restored 2021-2023): a small rocky islet 200 m off Salacak with a
 * masonry quay and terrace, the two-storey stone building with a hipped lead roof and the square tower carrying an
 * octagonal drum, the glazed lantern (once a lighthouse) and a lead cupola, ~23 m above the sea.
 */
import * as THREE from 'three';
import type { StructureBuild } from '../../build/context';
import type { MeshBuilder, SurfaceState } from '../../build/mesh-builder';
import { Emit, Surf } from '../../build/surfaces';
import { mat, Pal, withEmit } from '../palette';
import { archWindow } from './openings';

const STONE = withEmit(mat(0xb9ad98, Surf.Ashlar, 0.82, 0, 0.38), Emit.Flood, 2.4, 1, 26);
const QUAY = withEmit(mat(0x9d948a, Surf.Ashlar, 0.85, 0, 0.55), Emit.Flood, 1.2, 1, 8);
const LEAD = withEmit(mat(0x737d7e, Surf.Lead, 0.45, 0.3, 0.5), Emit.Flood, 0.8, 1, 26);
const LIT = { ...Pal.window, emit: Emit.Windows, ea: 4, eb: 3, ec: 0.85 };

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
  b.boxCollider(tc.x, 0.5, tc.z, 22, terraceY - 0.5 + 1, 11, boxYaw);
}

function building(mb: MeshBuilder, W: (u: number, v: number, y: number) => THREE.Vector3, yaw: number, y0: number, lod: number): void {
  const c = W(6, 0, 0);
  const h = 7.2;
  mb.surface(STONE);
  mb.box(c.x, y0 + h / 2, c.z, 10, h / 2, 8, yaw, true, false);
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
  if (lod > 0) {
    return;
  }
  // two rows of windows on the long sides and the sea side
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
  mb.box(c.x, y0 + 7.8, c.z, 3.75, 7.8, 3.75, yaw, true, false);
  mb.box(c.x, y0 + 15.8, c.z, 4.1, 0.2, 4.1, yaw, true, false);
  // octagonal drum
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
  // glazed lantern with a warm glow
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
  if (lod > 0) {
    return;
  }
  // tower windows (one per face per storey) and drum windows
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
