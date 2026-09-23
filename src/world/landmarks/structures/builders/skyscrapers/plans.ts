/**
 * Skyscraper floor plans (local metres, centred, counter-clockwise when seen from above in x/z with +z = right of
 * +x). Curved plans are tessellated finely enough for smooth reflections.
 */
export type Plan = Array<[number, number]>;

export type PlanShape =
  | { kind: 'rect'; w: number; d: number; chamfer?: number }
  | { kind: 'rounded'; w: number; d: number; r: number }
  | { kind: 'triangle'; side: number; r: number; bulge?: number }
  | { kind: 'lens'; w: number; d: number; tip?: number }
  | { kind: 'ellipse'; w: number; d: number }
  | { kind: 'L'; w: number; d: number; t: number };

function arc(out: Plan, cx: number, cz: number, r: number, a0: number, a1: number, steps: number): void {
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
}

export function makePlan(shape: PlanShape, detail: number): Plan {
  const q = Math.max(2, Math.round(6 * detail));
  switch (shape.kind) {
    case 'rect': {
      const hw = shape.w / 2;
      const hd = shape.d / 2;
      const c = shape.chamfer ?? 0;
      if (c <= 0) {
        return [
          [hw, -hd],
          [hw, hd],
          [-hw, hd],
          [-hw, -hd],
        ];
      }
      return [
        [hw, -hd + c],
        [hw, hd - c],
        [hw - c, hd],
        [-hw + c, hd],
        [-hw, hd - c],
        [-hw, -hd + c],
        [-hw + c, -hd],
        [hw - c, -hd],
      ];
    }
    case 'rounded': {
      const hw = shape.w / 2;
      const hd = shape.d / 2;
      const r = Math.min(shape.r, hw * 0.99, hd * 0.99);
      const out: Plan = [];
      arc(out, hw - r, hd - r, r, 0, Math.PI / 2, q);
      arc(out, -hw + r, hd - r, r, Math.PI / 2, Math.PI, q);
      arc(out, -hw + r, -hd + r, r, Math.PI, Math.PI * 1.5, q);
      arc(out, hw - r, -hd + r, r, Math.PI * 1.5, Math.PI * 2, q);
      return out;
    }
    case 'triangle': {
      const R = shape.side / Math.sqrt(3);
      const r = shape.r;
      const out: Plan = [];
      const bulge = shape.bulge ?? 0;
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        const cx = Math.cos(a) * (R - r * 2);
        const cz = Math.sin(a) * (R - r * 2);
        arc(out, cx, cz, r, a - Math.PI / 3, a + Math.PI / 3, q);
        if (bulge > 0) {
          // convex side between corner k and k+1
          const an = ((k + 1) / 3) * Math.PI * 2;
          const p0 = out[out.length - 1];
          const nx = Math.cos(an) * (R - r * 2) + Math.cos(an - Math.PI / 3) * r;
          const nz = Math.sin(an) * (R - r * 2) + Math.sin(an - Math.PI / 3) * r;
          const mid = (a + an) / 2;
          for (let i = 1; i < q * 2; i++) {
            const t = i / (q * 2);
            const bx = p0[0] + (nx - p0[0]) * t + Math.cos(mid) * bulge * Math.sin(Math.PI * t);
            const bz = p0[1] + (nz - p0[1]) * t + Math.sin(mid) * bulge * Math.sin(Math.PI * t);
            out.push([bx, bz]);
          }
        }
      }
      return out;
    }
    case 'lens': {
      const hw = shape.w / 2;
      const hd = shape.d / 2;
      const tip = shape.tip ?? 0.25;
      const out: Plan = [];
      const n = q * 4;
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        const c = Math.cos(t);
        const s = Math.sin(t);
        // superellipse-like body with sharpened ends along x
        const x = Math.sign(c) * Math.pow(Math.abs(c), 0.6 + tip) * hw;
        const z = Math.sign(s) * Math.pow(Math.abs(s), 0.55) * hd;
        out.push([x, z]);
      }
      return out;
    }
    case 'ellipse': {
      const out: Plan = [];
      const n = q * 5;
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        out.push([(Math.cos(t) * shape.w) / 2, (Math.sin(t) * shape.d) / 2]);
      }
      return out;
    }
    case 'L': {
      const hw = shape.w / 2;
      const hd = shape.d / 2;
      const t = shape.t;
      return [
        [hw, -hd],
        [hw, -hd + t],
        [-hw + t, -hd + t],
        [-hw + t, hd],
        [-hw, hd],
        [-hw, -hd],
      ];
    }
  }
}

/** Uniformly scaled copy. */
export function scalePlan(p: Plan, s: number): Plan {
  return p.map(([x, z]) => [x * s, z * s]);
}

export function planExtent(p: Plan): number {
  let r = 0;
  for (const [x, z] of p) {
    r = Math.max(r, Math.hypot(x, z));
  }
  return r;
}
