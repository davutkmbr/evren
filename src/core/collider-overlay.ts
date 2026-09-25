/**
 * ?colliders=1: outlines of every registered collider around the dragon (or camera), drawn through geometry so
 * invisible walls show up. Colours by tag: buildings red, landmarks / structures orange, heritage and mosques purple,
 * piers blue, trees green. ?colliders=<metres> sets the radius (default 160).
 *
 * window.__colliders (with the flag, or on the dev server): probe(x, y, z, r) lists the colliders a sphere penetrates,
 * near(x, z, r) every collider around a point, both with id, tag, source, shape and bounds.
 */
import * as THREE from 'three';
import type { CollisionWorld, ColliderInfo } from './collision';
import { type System, UpdateOrder } from './contracts';

const COLOURS: Record<string, number> = {
  building: 0xff3355,
  structure: 0xff9922,
  heritage: 0xbb55ff,
  mosque: 0xbb55ff,
  pier: 0x33aaff,
  tree: 0x44dd66,
};

function colourOf(tag: string): THREE.Color {
  return new THREE.Color(COLOURS[tag] ?? COLOURS[tag.split(':')[0]] ?? 0xffff33);
}

export function createColliderOverlaySystem(): System {
  let collision: CollisionWorld | null = null;
  let lines: THREE.LineSegments | null = null;
  let radius = 160;
  let enabled = false;
  let timer = 0;
  const last = new THREE.Vector3(Infinity, 0, 0);
  let lastCount = -1;

  const rebuild = (center: THREE.Vector3): void => {
    const col = collision!;
    const pos: number[] = [];
    const colour: number[] = [];
    const seg = (c: THREE.Color, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void => {
      pos.push(ax, ay, az, bx, by, bz);
      colour.push(c.r, c.g, c.b, c.r, c.g, c.b);
    };
    const circle = (c: THREE.Color, x: number, y: number, z: number, r: number, axis: 'y' | 'x' | 'z' = 'y'): void => {
      const n = 20;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        const p = (a: number): [number, number, number] =>
          axis === 'y' ? [x + Math.cos(a) * r, y, z + Math.sin(a) * r] : axis === 'x' ? [x, y + Math.cos(a) * r, z + Math.sin(a) * r] : [x + Math.cos(a) * r, y + Math.sin(a) * r, z];
        seg(c, ...p(a0), ...p(a1));
      }
    };
    for (const info of col.debugEntries(center.x - radius, center.z - radius, center.x + radius, center.z + radius)) {
      const rec = col.debugCollider(info.id);
      if (!rec) {
        continue;
      }
      const c = colourOf(info.tag);
      const k = rec.collider;
      if (k.kind === 'prism') {
        for (const ring of k.rings) {
          const n = ring.length;
          for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
            seg(c, ring[j], k.top, ring[j + 1], ring[i], k.top, ring[i + 1]);
            seg(c, ring[j], k.bottom, ring[j + 1], ring[i], k.bottom, ring[i + 1]);
            seg(c, ring[i], k.bottom, ring[i + 1], ring[i], k.top, ring[i + 1]);
          }
        }
      } else if (k.kind === 'box') {
        const cos = Math.cos(k.yaw);
        const sin = Math.sin(k.yaw);
        const h = k.halfSize;
        const corner = (sx: number, sy: number, sz: number): [number, number, number] => {
          const lx = sx * h.x;
          const lz = sz * h.z;
          return [k.center.x + lx * cos + lz * sin, k.center.y + sy * h.y, k.center.z - lx * sin + lz * cos];
        };
        const sq = [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ];
        for (let i = 0; i < 4; i++) {
          const [ax, az] = sq[i];
          const [bx, bz] = sq[(i + 1) % 4];
          seg(c, ...corner(ax, -1, az), ...corner(bx, -1, bz));
          seg(c, ...corner(ax, 1, az), ...corner(bx, 1, bz));
          seg(c, ...corner(ax, -1, az), ...corner(ax, 1, az));
        }
      } else if (k.kind === 'cylinder') {
        circle(c, k.base.x, k.base.y, k.base.z, k.radius);
        circle(c, k.base.x, k.base.y + k.height, k.base.z, k.radius);
        seg(c, k.base.x + k.radius, k.base.y, k.base.z, k.base.x + k.radius, k.base.y + k.height, k.base.z);
        seg(c, k.base.x - k.radius, k.base.y, k.base.z, k.base.x - k.radius, k.base.y + k.height, k.base.z);
      } else {
        circle(c, k.center.x, k.center.y, k.center.z, k.radius, 'y');
        circle(c, k.center.x, k.center.y, k.center.z, k.radius, 'x');
        circle(c, k.center.x, k.center.y, k.center.z, k.radius, 'z');
      }
    }
    const g = lines!.geometry;
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colour, 3));
    g.computeBoundingSphere();
  };

  return {
    name: 'collider-overlay',
    order: UpdateOrder.UI,

    init(ctx) {
      collision = ctx.services.get('collision');
      const param = ctx.debug.params.get('colliders');
      enabled = param !== null && param !== '0';
      if (enabled && Number(param) > 1) {
        radius = Number(param);
      }
      if (enabled || import.meta.env.DEV) {
        const col = collision;
        const v = new THREE.Vector3();
        (window as unknown as { __colliders?: unknown }).__colliders = {
          probe: (x: number, y: number, z: number, r = 1): ReturnType<CollisionWorld['debugSphere']> => col.debugSphere(v.set(x, y, z), r),
          near: (x: number, z: number, r = 10): ColliderInfo[] => col.debugEntries(x - r, z - r, x + r, z + r),
          collider: (id: number) => col.debugCollider(id),
          surfaceSource: (x: number, z: number) => col.debugCollider(col.surfaceSource(x, z))?.info ?? null,
        };
      }
      if (!enabled) {
        return;
      }
      const mat = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.85, fog: false, toneMapped: false });
      lines = new THREE.LineSegments(new THREE.BufferGeometry(), mat);
      lines.name = 'collider-overlay';
      lines.frustumCulled = false;
      lines.renderOrder = 10000;
      ctx.scene.add(lines);
    },

    update(_dt, ctx) {
      if (!enabled || !lines || !collision) {
        return;
      }
      timer -= ctx.time.realDt;
      const center = ctx.services.tryGet('dragon')?.position ?? ctx.camera.position;
      if (timer > 0 && center.distanceTo(last) < radius * 0.25 && collision.colliderCount === lastCount) {
        return;
      }
      timer = 1;
      last.copy(center);
      lastCount = collision.colliderCount;
      rebuild(center);
    },

    dispose() {
      lines?.removeFromParent();
      lines?.geometry.dispose();
      (lines?.material as THREE.Material | undefined)?.dispose();
      lines = null;
    },
  };
}
