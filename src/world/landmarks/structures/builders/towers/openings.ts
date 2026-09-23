/**
 * Openings on curved / faceted masonry walls: arched windows and round oculi as flat panels tangent to the wall
 * (dark glazing in a lighter stone surround), plus helpers for ring layouts.
 */
import * as THREE from 'three';
import type { MeshBuilder, SurfaceState } from '../../build/mesh-builder';

export interface ArchWindow {
  /** Centre of the wall (tower axis) and the wall radius at the window. */
  cx: number;
  cz: number;
  radius: number;
  /** Azimuth (radians, measured from +X toward +Z). */
  angle: number;
  /** Sill height and total height (to the arch apex), width. */
  y0: number;
  height: number;
  width: number;
  /** 'arch' = round arch top, 'round' = oculus (circle of diameter `width`), 'rect'. */
  shape: 'arch' | 'round' | 'rect';
}

function outline(w: ArchWindow, grow: number): Array<[number, number]> {
  const hw = w.width / 2 + grow;
  const pts: Array<[number, number]> = [];
  if (w.shape === 'round') {
    const r = w.width / 2 + grow;
    const cy = w.y0 + w.width / 2;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      pts.push([Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return pts;
  }
  const top = w.y0 + w.height + grow;
  const bottom = w.y0 - grow;
  if (w.shape === 'rect') {
    return [
      [-hw, bottom],
      [hw, bottom],
      [hw, top],
      [-hw, top],
    ];
  }
  const springing = top - hw;
  pts.push([-hw, bottom], [hw, bottom], [hw, springing]);
  const seg = 7;
  for (let k = 1; k < seg; k++) {
    const a = (k / seg) * Math.PI;
    pts.push([Math.cos(a) * hw, springing + Math.sin(a) * hw]);
  }
  pts.push([-hw, springing]);
  return pts;
}

/** Emits the surround (stone) and the glazing panel of one window. */
export function archWindow(mb: MeshBuilder, w: ArchWindow, surround: SurfaceState | null, glass: SurfaceState): void {
  const nx = Math.cos(w.angle);
  const nz = Math.sin(w.angle);
  const tx = -nz;
  const tz = nx;
  const n = new THREE.Vector3(nx, 0, nz);
  const place = (pts: Array<[number, number]>, off: number): THREE.Vector3[] =>
    pts.map(([u, y]) => new THREE.Vector3(w.cx + nx * (w.radius + off) + tx * u, y, w.cz + nz * (w.radius + off) + tz * u));
  const sag = (w.width * w.width) / (8 * Math.max(w.radius, 1));
  if (surround) {
    mb.surface(surround);
    mb.polygon(place(outline(w, Math.min(0.35, w.width * 0.2)), sag + 0.03), n);
  }
  mb.surface(glass);
  mb.polygon(place(outline(w, 0), sag + 0.06), n);
}

/** Evenly spaced windows around a ring. */
export function windowRing(
  mb: MeshBuilder,
  base: Omit<ArchWindow, 'angle'>,
  count: number,
  phase: number,
  surround: SurfaceState | null,
  glass: SurfaceState,
): void {
  for (let k = 0; k < count; k++) {
    archWindow(mb, { ...base, angle: phase + (k / count) * Math.PI * 2 }, surround, glass);
  }
}
