/**
 * Per-vertex material ids stored in aData.x of the body mesh (flat per triangle). Surfaces that change material
 * across the mesh (skin to mouth on the head and jaw lofts) stay MAT.skin and carry a continuous mouth field in
 * -aData.w instead (see mouthField), so the boundary is smooth at any triangle size.
 */
export const MAT = {
  skin: 0,
  horn: 1,
  tooth: 2,
  eye: 3,
  mouth: 4,
  claw: 5,
  tongue: 6,
} as const;

/** Per-vertex material ids stored in aData.x of the rider mesh. */
export const RIDER_MAT = {
  wool: 0,
  leather: 1,
  metal: 2,
  skin: 3,
  darkLeather: 4,
  linen: 5,
  fur: 6,
  cloak: 7,
  glass: 8,
  brass: 9,
} as const;

/**
 * Continuous mouth coverage for a loft vertex: 0.5 exactly on the region boundary, ramping to 0 / 1 over one grid
 * cell to either side, so linear interpolation across the triangles puts the 0.5 contour on the true boundary.
 * Arguments are signed distances to each edge of the region (positive inside), already divided by the grid
 * spacing in that direction.
 */
export function mouthField(...cells: number[]): number {
  return Math.min(1, Math.max(0, 0.5 + 0.5 * Math.min(...cells)));
}
