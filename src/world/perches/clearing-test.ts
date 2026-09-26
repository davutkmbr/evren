/** The perch clearing test (clearings.ts), free of imports so the tree placement workers can use it. */

/** True when a tree standing at (x, z) with its crown top at `top` breaks a clearing. */
export function inClearing(clearings: ArrayLike<number>, x: number, z: number, top: number): boolean {
  for (let k = 0; k < clearings.length; k += 4) {
    const dx = x - clearings[k];
    const dz = z - clearings[k + 1];
    const r = clearings[k + 2];
    if (dx * dx + dz * dz < r * r && top > clearings[k + 3]) {
      return true;
    }
  }
  return false;
}
