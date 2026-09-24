/**
 * WebGPU spike: TSL ports of the shared GLSL helpers (src/render/shaders/common.glsl.ts) and of LAYOUT_GLSL
 * (src/world/osm/buildings/archetypes.ts). Functions with a layout compile to real WGSL/GLSL functions instead of
 * being inlined at every call site.
 *
 * TSL nodes are typed `N = any` in the spike: @types/three types every node generically (Node<'vec3'> etc.) and the
 * swizzle / operator overloads fight strict TypeScript at almost every line of a port this size.
 */
import { Fn, Loop, If, dot, float, floor, fract, mat2, max, mix, mod, step, vec2, vec3 } from 'three/tsl';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type N = any;

export const hash12 = Fn(([p]: N[]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'hash12', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] }) as N;

export const hash13 = Fn(([pIn]: N[]) => {
  const p3: N = fract(pIn.mul(0.1031) as N).toVar();
  p3.addAssign(dot(p3, p3.zyx.add(31.32)));
  return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'hash13', type: 'float', inputs: [{ name: 'p3', type: 'vec3' }] }) as N;

export const vnoise2 = Fn(([p]: N[]) => {
  const i: N = floor(p as N);
  const f: N = fract(p as N);
  const u = f.mul(f).mul(f.mul(-2).add(3));
  const a = hash12(i);
  const b = hash12(i.add(vec2(1, 0)));
  const c = hash12(i.add(vec2(0, 1)));
  const d = hash12(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}).setLayout({ name: 'vnoise2', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] }) as N;

/** fbm2 with a compile-time octave count (the GLSL version breaks out of an 8-iteration loop at runtime). */
function makeFbm2(oct: number): N {
  return Fn(([pIn]: N[]) => {
    const p = vec2(pIn).toVar();
    const s = float(0).toVar();
    const a = float(0.5).toVar();
    const m = mat2(1.6, 1.2, -1.2, 1.6);
    Loop(oct, () => {
      s.addAssign(a.mul(vnoise2(p)));
      p.assign(m.mul(p));
      a.mulAssign(0.5);
    });
    return s;
  }).setLayout({ name: `fbm2_${oct}`, type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });
}
const FBM: Record<number, N> = {};
export function fbm2(p: N, oct: number): N {
  FBM[oct] ??= makeFbm2(oct);
  return FBM[oct](p);
}

export const fBit = (flags: N, b: number): N => mod(floor(flags.div(b)), 2);
export const smooth = (a: N, b: N, x: N): N => x.smoothstep(a, b);
export const fBox = Fn(([x, a, b, w]: N[]) => smooth(a.sub(w), a.add(w), x).sub(smooth(b.sub(w), b.add(w), x))).setLayout({
  name: 'fBox',
  type: 'float',
  inputs: [
    { name: 'x', type: 'float' },
    { name: 'a', type: 'float' },
    { name: 'b', type: 'float' },
    { name: 'w', type: 'float' },
  ],
}) as N;
export const fLine = Fn(([x, w, fw]: N[]) => float(1).sub(smooth(w.sub(fw), w.add(fw), x.abs()))).setLayout({
  name: 'fLine',
  type: 'float',
  inputs: [
    { name: 'x', type: 'float' },
    { name: 'w', type: 'float' },
    { name: 'fw', type: 'float' },
  ],
}) as N;

// ---- LAYOUT_GLSL (archetypes.ts), kept in lock-step with the worker.
export const osmTopRow = (wallTopV: N, clearance: N, head: N, fh: N): N => floor(wallTopV.sub(clearance).sub(head).div(fh).add(1e-4));
export const osmGroundRow = Fn(([g, fh]: N[]) => {
  const r = floor(g.add(0.9).div(fh));
  return r.add(step(r.add(1).mul(fh).sub(g), 2.6 - 1e-4));
}).setLayout({
  name: 'osmGroundRow',
  type: 'float',
  inputs: [
    { name: 'g', type: 'float' },
    { name: 'fh', type: 'float' },
  ],
}) as N;
export const osmBalconyAt = Fn(([mode, bay, nb, k, topK]: N[]) => {
  const r = float(0).toVar();
  If(mode.lessThan(0.5), () => {
    r.assign(0);
  })
    .ElseIf(mode.lessThan(1.5), () => {
      r.assign(step(2.5, nb).mul(float(1).sub(step(0.5, bay.sub(floor(nb.mul(0.5))).abs()))).mul(step(k, topK.add(0.5))));
    })
    .ElseIf(mode.lessThan(2.5), () => {
      r.assign(float(1).sub(step(0.5, k)).mul(step(1.5, nb)).mul(step(bay.add(0.5).sub(nb.mul(0.5)).abs(), max(1.5, nb.mul(0.32)).sub(1e-3))));
    })
    .ElseIf(mode.lessThan(3.5), () => {
      r.assign(1);
    })
    .ElseIf(mode.lessThan(4.5), () => {
      const odd = mod(nb, 2).greaterThan(0.5).select(1, 0);
      r.assign(max(float(1).sub(step(0.5, mod(bay, 2).sub(odd).abs())), step(nb, 2.5)));
    })
    .Else(() => {
      r.assign(step(3.5, nb).mul(max(float(1).sub(step(0.5, bay)), float(1).sub(step(0.5, bay.sub(nb.sub(1)).abs())))));
    });
  return r;
}).setLayout({
  name: 'osmBalconyAt',
  type: 'float',
  inputs: [
    { name: 'mode', type: 'float' },
    { name: 'bay', type: 'float' },
    { name: 'nb', type: 'float' },
    { name: 'k', type: 'float' },
    { name: 'topK', type: 'float' },
  ],
}) as N;
