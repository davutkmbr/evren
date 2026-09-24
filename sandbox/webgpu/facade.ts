/**
 * WebGPU spike: the OSM facade material (src/world/osm/buildings/materials.ts + facade-glsl.ts) as a
 * MeshStandardNodeMaterial built with TSL.
 *
 * Mapping of the GLSL patch points:
 *   <color_fragment> + FACADE_MAIN      -> colorNode (one Fn that also writes the other outputs into PropertyNodes)
 *   <roughnessmap_fragment>             -> roughnessNode (fRough property)
 *   <normal_fragment_maps> FACADE_NORMAL -> normalNode (view space)
 *   <emissivemap_fragment>              -> emissiveNode (fEmis property)
 *   <lights_fragment_end> FACADE_LIGHT  -> receivedShadowNode (recess shadow on the shadowed key light) + aoNode
 *                                          (the GLSL scales reflectedLight after all lights; see the spike report)
 *
 * Ported: texture-array layers (plinth, almaşık bands, clapboard), all weathering, the four flat-roof finishes, trim,
 * blank party walls (with bare brick), window layout (storeys, bays, balcony sills), painted dressings, rustication and
 * quoins, spandrels, roller boxes, arched / flat openings, the ray-box recess with reveal normals and the key-light
 * recess shadow, window glass with frames, transoms, tulle / drapes / blinds, roller shutters, louvred shutters,
 * interior-mapped rooms with occupancy and lamp colours, glass reflections, shop fronts with kepenk / Han iron doors,
 * fascias, doors with lamps, ground-floor grilles, the far-field window average and the night wash.
 * Skipped: the interior-mapped shop (fShop: merchandise, mannequins, café tables) - shops show a flat lit interior.
 */
import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  abs,
  attribute,
  cameraPosition,
  cameraViewMatrix,
  clamp,
  cos,
  cross,
  exp,
  float,
  floor,
  fract,
  fwidth,
  int,
  length,
  max,
  min,
  mix,
  mod,
  normalWorldGeometry,
  normalize,
  positionWorld,
  pow,
  property,
  reflect,
  select,
  sign,
  sin,
  step,
  texture,
  uniformArray,
  uv,
  vec2,
  vec3,
  vec4,
  mat3,
} from 'three/tsl';
import { Arch, ARCHETYPES, Flag } from '../../src/world/osm/buildings/archetypes';
import { U } from './atmosphere';
import { type N, fBit, fBox, fLine, fbm2, hash12, hash13, osmBalconyAt, osmGroundRow, osmTopRow, smooth, vnoise2 } from './tsl-common';

const inv = (x: N): N => float(1).sub(x);
const eq = (x: N, v: number): N => step(abs(x.sub(v)), 0.1);

/** Opening test: rect below the springing line, ellipse above it (rise 0 = flat head). */
const fOpen = Fn(([p, halfW, bottom, spring, rise, fw]: N[]) => {
  const inX = fBox(p.x, halfW.negate(), halfW, fw);
  const rect = inX.mul(fBox(p.y, bottom, spring, fw));
  const q = vec2(p.x.div(halfW), p.y.sub(spring).div(max(rise, 1e-3)));
  const e = inv(smooth(float(1).sub(fw.mul(3).div(halfW)), float(1).add(fw.mul(3).div(halfW)), length(q)));
  return select(rise.lessThan(0.01), rect, max(rect, e.mul(step(spring, p.y)).mul(inX)));
}).setLayout({
  name: 'fOpen',
  type: 'float',
  inputs: [
    { name: 'p', type: 'vec2' },
    { name: 'halfW', type: 'float' },
    { name: 'bottom', type: 'float' },
    { name: 'spring', type: 'float' },
    { name: 'rise', type: 'float' },
    { name: 'fw', type: 'float' },
  ],
}) as N;

/** Ray-box recess. Returns (x, y, depth, face): face 0 glass plane, 1 side reveal, 2 soffit, 3 sill floor. */
const fRecess = Fn(([p0, d, halfW, bottom, top, depth]: N[]) => {
  const dz = max(d.z.negate(), 0.02);
  const tb = depth.div(dz);
  const tx = max(select(d.x.greaterThan(1e-4), halfW.sub(p0.x).div(d.x), select(d.x.lessThan(-1e-4), halfW.negate().sub(p0.x).div(d.x), float(1e9))), 0).toVar();
  const ty = max(select(d.y.greaterThan(1e-4), top.sub(p0.y).div(d.y), select(d.y.lessThan(-1e-4), bottom.sub(p0.y).div(d.y), float(1e9))), 0).toVar();
  const t = min(tb, min(tx, ty)).toVar();
  const face = select(t.equal(tb), float(0), select(t.equal(tx), float(1), select(d.y.greaterThan(0), float(2), float(3))));
  return vec4(p0.add(d.xy.mul(t)), dz.mul(t), face);
}).setLayout({
  name: 'fRecess',
  type: 'vec4',
  inputs: [
    { name: 'p0', type: 'vec2' },
    { name: 'd', type: 'vec3' },
    { name: 'halfW', type: 'float' },
    { name: 'bottom', type: 'float' },
    { name: 'top', type: 'float' },
    { name: 'depth', type: 'float' },
  ],
}) as N;

/** Interior-mapped room behind the glass: albedo-ish colour and the lamp falloff in .a. */
const fRoom = Fn(([g, d, halfBay, floorH, roomD, h]: N[]) => {
  const dz = max(d.z.negate(), 0.02);
  const tb = roomD.div(dz);
  const tx = select(d.x.greaterThan(1e-4), halfBay.sub(g.x).div(d.x), select(d.x.lessThan(-1e-4), halfBay.negate().sub(g.x).div(d.x), float(1e9)));
  const ty = select(d.y.greaterThan(1e-4), floorH.sub(0.1).sub(g.y).div(d.y), select(d.y.lessThan(-1e-4), float(0.05).sub(g.y).div(d.y), float(1e9))).toVar();
  const t = min(tb, min(max(tx, 0), max(ty, 0))).toVar();
  const hit = vec3(g.add(d.xy.mul(t)), dz.mul(t)).toVar();
  const wallpaper = mix(vec3(0.62, 0.55, 0.45), vec3(0.72, 0.7, 0.66), h).mul(fract(h.mul(7.3)).mul(0.2).add(0.8)).toVar();
  const col = vec3(wallpaper).toVar();
  If(t.equal(max(ty, 0)), () => {
    col.assign(select(d.y.greaterThan(0), vec3(0.8, 0.79, 0.76), mix(vec3(0.32, 0.2, 0.12), vec3(0.45, 0.4, 0.36), fract(h.mul(3.1)))));
  })
    .ElseIf(t.equal(tb), () => {
      col.assign(wallpaper.mul(0.95));
      const furn = fBox(hit.x, halfBay.mul(-0.6).add(h), halfBay.mul(0.1).add(h), float(0.02)).mul(step(hit.y, h.add(1.9)));
      col.assign(mix(col, vec3(0.25, 0.18, 0.12).mul(h.add(0.7)), furn.mul(step(0.35, h))));
    })
    .Else(() => {
      col.assign(wallpaper.mul(0.85));
    });
  const lamp = vec3(0, floorH.sub(0.35), roomD.mul(0.45));
  const dist = length(hit.sub(lamp));
  return vec4(col, float(1).div(dist.mul(dist).mul(0.22).add(1)));
}).setLayout({
  name: 'fRoom',
  type: 'vec4',
  inputs: [
    { name: 'g', type: 'vec2' },
    { name: 'd', type: 'vec3' },
    { name: 'halfBay', type: 'float' },
    { name: 'floorH', type: 'float' },
    { name: 'roomD', type: 'float' },
    { name: 'h', type: 'float' },
  ],
}) as N;

const fGoods = (h: N): N => {
  const c = cos(h.add(vec3(0, 0.33, 0.67)).mul(6.2832)).mul(0.5).add(0.5);
  return mix(vec3(0.4), c, 0.62).mul(fract(h.mul(7.13)).mul(0.5).add(0.45));
};

/** Environment seen in window glass: sky above the horizon, facades / street below; per-pane tilt. */
const fGlassEnv = Fn(([R, tilt]: N[]) => {
  const day = inv(U.night.mul(0.94));
  const ry = R.y.add(tilt);
  const sky = mix(vec3(U.fogColor as N), vec3(0.32, 0.46, 0.72), smooth(0.05, 0.7, ry)).mul(day);
  const street = mix(vec3(0.07, 0.07, 0.075), vec3(U.fogColor as N).mul(0.35), smooth(-0.4, 0.05, ry)).mul(day);
  return mix(street, sky, smooth(-0.02, 0.12, ry));
}) as N;

export interface FacadeTextures {
  albedo: THREE.DataArrayTexture;
  normal: THREE.DataArrayTexture;
  layerNorm: number[];
  layerRep: number[];
  layerNrm: number[];
}

export function createFacadeNodeMaterial(tex: FacadeTextures): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ name: 'osm-facade-node', roughness: 1, metalness: 0 });

  const uLayerNorm = uniformArray(tex.layerNorm, 'float');
  const uLayerRep = uniformArray(tex.layerRep, 'float');
  const uLayerNrm = uniformArray(tex.layerNrm, 'float');
  const F_DEPTH = uniformArray(
    Object.values(ARCHETYPES).map((a) => a.depth),
    'float',
  );

  // Outputs shared between the material slots (declared once in the fragment main(), like three's DiffuseColor).
  const fSurfN = property('vec3', 'fSurfN');
  const fT = property('vec3', 'fT');
  const fB = property('vec3', 'fB');
  const fTN = property('vec3', 'fTN');
  const fFlat = property('float', 'fFlat');
  const fRough = property('float', 'fRough');
  const fEmis = property('vec3', 'fEmis');
  const fShadow = property('float', 'fShadow');
  const fAO = property('float', 'fAO');

  /** Texture array sample: albedo * layer normalisation (a = roughness) and the tangent-space normal. */
  const fTex = (layer: N, uvIn: N): { a: N; tn: N } => {
    const li = int(layer.add(0.5));
    const t = uvIn.div(uLayerRep.element(li));
    const a: N = texture(tex.albedo, t).depth(li);
    const nrm: N = texture(tex.normal, t).depth(li).xyz.mul(2).sub(1);
    return { a: vec4(a.rgb.mul(uLayerNorm.element(li)), a.a), tn: vec3(nrm.xy.mul(uLayerNrm.element(li)), nrm.z) };
  };

  const main = Fn(() => {
    const vFac = attribute('aFac', 'vec4');
    const vGnd = attribute('aGnd', 'vec2');
    const vSty = attribute('aSty', 'vec4');
    const vWin = attribute('aWin', 'vec4');
    const vUv = uv();
    const tint = attribute('color', 'vec3');

    const wn = normalize(normalWorldGeometry).toVar();
    const wp = positionWorld;
    fSurfN.assign(wn);
    fT.assign(vec3(1, 0, 0));
    fB.assign(vec3(0, 1, 0));
    fTN.assign(vec3(0, 0, 1));
    fFlat.assign(0);
    fRough.assign(-1);
    fEmis.assign(vec3(0));
    fShadow.assign(0);
    fAO.assign(1);

    const FH = vSty.x;
    const code = floor(vSty.y.add(0.5)).toVar();
    const arch = mod(code, 8).toVar();
    const wallLayer = mod(floor(code.div(8)), 8).toVar();
    const plinthLayer = floor(code.div(64)).toVar();
    const flags = floor(vSty.z.add(0.5)).toVar();
    const kind = mod(flags, 4).toVar();
    const street = fBit(flags, Flag.Street).toVar();
    const shop = fBit(flags, Flag.Shop).toVar();
    const shutters = fBit(flags, Flag.Shutters);
    const headType = mod(floor(flags.div(Flag.HeadShift)), 4).toVar();
    const roller = fBit(flags, Flag.Roller).toVar();
    const court = fBit(flags, Flag.Court).toVar();
    const office = fBit(flags, Flag.Office).toVar();
    const plinthOn = fBit(flags, Flag.Plinth).toVar();
    const balMode = mod(floor(flags.div(Flag.BalconyShift)), 8);
    const banded = fBit(flags, Flag.Banded);
    const clap = fBit(flags, Flag.Clapboard).toVar();
    const busy = fBit(flags, Flag.Busy).toVar();
    const L = vFac.x.toVar();
    const wallTopV = vFac.y.toVar();
    const seed = vFac.z.toVar();
    const wear = vFac.w.toVar();
    const u = vUv.x.toVar();
    const v = vUv.y.toVar();
    const lightsOn = smooth(0.06, 0.5, U.night).toVar();
    const hour = select(U.timeOfDay.lessThan(12), U.timeOfDay.add(24), U.timeOfDay);
    const occupancy = mix(0.5, 0.08, smooth(23, 26.5, hour)).toVar();
    const horiz = abs(wn.y).greaterThan(0.5).toVar();

    const mirror = select(fract(seed.mul(23.17)).lessThan(0.5), float(1), float(-1)).toVar();
    If(horiz.not(), () => {
      fT.assign(normalize(cross(wn, vec3(0, 1, 0))).mul(mirror));
    }).Else(() => {
      fT.assign(vec3(1, 0, 0));
      fB.assign(vec3(0, 0, -1).mul(sign(wn.y)));
    });
    const tuv = select(horiz, vec2(wp.x, wp.z.negate()), vec2(u.mul(mirror).add(seed.mul(41)), v.add(fract(seed.mul(71.3)).mul(7)))).toVar();
    const fwu = max(fwidth(u), 1e-3).toVar();
    const fwv = max(fwidth(v), 1e-3).toVar();
    const det = inv(smooth(0.05, 0.22, max(fwu, fwv))).toVar();

    // ---- Wall layout (shared with facade.ts / archetypes.ts).
    const nb = max(1, vWin.x).toVar();
    const halfW = vWin.y.toVar();
    const sillH = vWin.z.toVar();
    const headH = vWin.w.toVar();
    const bw = L.div(nb).toVar();
    const cu = clamp(floor(u.div(bw)), 0, nb.sub(1)).toVar();
    const wu = u.sub(cu.add(0.5).mul(bw)).toVar();
    const gHere = mix(vGnd.x, vGnd.y, clamp(u.div(max(L, 1e-3)), 0, 1)).toVar();
    const gBay = mix(vGnd.x, vGnd.y, clamp(cu.add(0.5).mul(bw).div(max(L, 1e-3)), 0, 1));
    const gRow = osmGroundRow(gBay, FH).toVar();
    const row = floor(v.div(FH)).toVar();
    const wv = v.sub(row.mul(FH)).toVar();
    const topRow = osmTopRow(wallTopV, vSty.w, headH, FH);
    const sv = v.sub(gHere).toVar();
    const shopLine = gRow.add(1).mul(FH).toVar();
    const streetFloor = step(v, shopLine).mul(step(0, sv)).toVar();
    const upper = step(gRow.add(0.5), row).mul(step(row, topRow.add(0.5))).toVar();

    // ---- Base material: texture layer (plinth, almaşık bands, clapboard) and tint.
    const layer = wallLayer.toVar();
    const wall = kind.lessThan(0.5).or(kind.greaterThan(1.5).and(kind.lessThan(2.5)));
    If(kind.greaterThan(2.5), () => {
      layer.assign(3);
    })
      .ElseIf(wall.and(plinthOn.greaterThan(0.5)).and(v.lessThan(shopLine.sub(0.05))).and(arch.notEqual(Arch.Modern)), () => {
        layer.assign(plinthLayer);
      })
      .ElseIf(banded.greaterThan(0.5).and(horiz.not()).and(fract(v.div(1.25)).greaterThan(0.7)), () => {
        layer.assign(4);
      });
    const t0 = fTex(layer, tuv);
    const texA = t0.a.toVar();
    const base = texA.rgb.mul(select(layer.greaterThan(3.5), mix(vec3(1), tint, 0.25), tint)).toVar();
    const rough = texA.a.toVar();
    fTN.assign(t0.tn);
    If(layer.notEqual(wallLayer).and(layer.equal(plinthLayer)), () => {
      base.assign(texA.rgb.mul(mix(vec3(0.93, 0.9, 0.85), tint, 0.3)));
    });
    If(clap.greaterThan(0.5).and(horiz.not()).and(layer.equal(wallLayer)), () => {
      const bv = fract(v.div(0.19));
      base.mulAssign(smooth(0, 0.25, bv).mul(0.2).add(0.82).sub(inv(smooth(0, 0.06, bv)).mul(0.18).mul(det)));
      fTN.assign(normalize(vec3(t0.tn.x.mul(0.3), bv.sub(0.5).mul(0.6), 1)));
      base.mulAssign(vnoise2(vec2(u.mul(0.7), floor(v.div(0.19))).mul(3)).mul(0.12).add(0.94));
    });

    // ---- Weathering.
    const n1 = vnoise2(vec2(u.mul(0.35).add(seed.mul(13)), v.mul(0.3))).toVar();
    const n2 = vnoise2(vec2(u.mul(3.1).add(seed.mul(7)), v.mul(0.22))).toVar();
    base.mulAssign(vnoise2(wp.xz.mul(0.05).add(v.mul(0.04)).add(seed.mul(17))).mul(0.14).add(0.93));
    If(horiz.not(), () => {
      base.mulAssign(mix(0.58, 1, smooth(0, wear.add(1.4), sv.add(n1.mul(0.4)))));
      const damp = inv(smooth(0.3, 1.1, sv.sub(n2.mul(0.35)))).mul(wear).mul(step(0, sv.add(0.3)));
      base.assign(mix(base, base.mul(vec3(0.72, 0.72, 0.7)), damp));
      const fromTop = wallTopV.sub(v);
      base.mulAssign(inv(wear.mul(0.28).mul(smooth(0.45, 0.8, n2)).mul(exp(fromTop.mul(-0.35)))));
      If(layer.equal(0).or(layer.equal(1)).and(clap.lessThan(0.5)).and(kind.notEqual(1)), () => {
        const zone = max(inv(smooth(0.5, 3.5, sv)), smooth(3, 0.5, fromTop)).mul(0.5).add(n1.mul(0.5));
        const flake = smooth(0.73, 0.76, fbm2(vec2(u, v).mul(1.6).add(seed.mul(31)), 4).add(wear.sub(0.5).mul(0.25)).add(zone.sub(0.5).mul(0.2)));
        const under = mix(vec3(0.55, 0.53, 0.5), base, 0.5).mul(n2.mul(0.3).add(0.85));
        base.assign(mix(base, under, flake.mul(step(0.4, wear)).mul(0.85)));
      });
      If(layer.equal(2), () => {
        base.mulAssign(inv(wear.mul(0.3).mul(smooth(0.4, 0.9, vnoise2(vec2(u.mul(0.8), v.mul(0.25)).add(seed.mul(5)))))));
      });
    }).Else(() => {
      base.mulAssign(vnoise2(wp.xz.mul(0.4)).mul(0.14).add(0.88).sub(smooth(0.6, 0.85, vnoise2(wp.xz.mul(1.3).add(3))).mul(0.08)));
    });

    const c = vec3(base).toVar();

    If(kind.greaterThan(2.5), () => {
      // ---- Flat roof slab: membrane, terrace tiles, screed, gravel.
      const fin = floor(vSty.w.add(0.5)).toVar();
      const p = wp.xz.toVar();
      const grime = vnoise2(p.mul(0.22).add(seed.mul(9))).toVar();
      const stain = smooth(0.45, 0.8, fbm2(p.mul(0.09).add(seed.mul(5)), 3)).toVar();
      If(fin.lessThan(0.5), () => {
        const silver = step(0.55, fract(seed.mul(4.1)));
        const q = vec2(p.x.mul(0.8).add(p.y.mul(0.6)), p.x.mul(-0.6).add(p.y.mul(0.8))).add(seed.mul(20));
        const seam = fLine(fract(q.x).sub(0.5), float(0.485), float(0.01));
        const mem = mix(vec3(0.11, 0.105, 0.1), vec3(0.5, 0.51, 0.52), silver);
        c.assign(mem.mul(grime.mul(0.12).add(0.92)).mul(inv(seam.mul(0.18).mul(det))));
        c.assign(mix(c, c.mul(mix(0.75, 0.85, silver)), stain.mul(0.6)));
        rough.assign(mix(0.85, 0.55, silver));
      })
        .ElseIf(fin.lessThan(1.5), () => {
          const tp = p.div(0.33);
          const fr = fract(tp);
          const grout = inv(fBox(fr.x, float(0.04), float(0.96), float(0.02)).mul(fBox(fr.y, float(0.04), float(0.96), float(0.02))));
          const tileA = select(step(0.5, fract(seed.mul(7.3))).greaterThan(0.5), vec3(0.5, 0.3, 0.2), vec3(0.6, 0.55, 0.47));
          const tile = tileA.mul(hash12(floor(tp).add(seed)).mul(0.12).add(0.9));
          c.assign(mix(tile, vec3(0.42, 0.4, 0.37), grout.mul(det).mul(0.8)).mul(grime.mul(0.12).add(0.9)));
          c.assign(mix(c, c.mul(0.8), stain.mul(0.5)));
          rough.assign(0.7);
        })
        .ElseIf(fin.lessThan(2.5), () => {
          const crack = fLine(vnoise2(p.mul(0.5).add(seed)).sub(0.5), float(0.012), float(0.01)).mul(det);
          c.assign(vec3(0.5, 0.49, 0.47).mul(grime.mul(0.16).add(0.88)).mul(inv(crack.mul(0.3))));
          c.assign(mix(c, c.mul(0.78), stain.mul(0.6)));
          rough.assign(0.9);
        })
        .Else(() => {
          const speck = hash12(floor(p.mul(18)));
          c.assign(mix(vec3(0.36, 0.35, 0.33), vec3(0.55, 0.53, 0.5), speck).mul(grime.mul(0.16).add(0.88)));
          c.assign(mix(c, c.mul(0.8), stain.mul(0.5)));
          rough.assign(0.95);
        });
      fFlat.assign(0.4);
    })
      .ElseIf(kind.greaterThan(0.5).and(kind.lessThan(1.5)), () => {
        // ---- Trim.
        If(wn.y.greaterThan(0.5), () => {
          c.mulAssign(n1.mul(0.2).add(0.72));
        });
        If(wn.y.lessThan(-0.5), () => {
          c.mulAssign(0.9);
        });
      })
      .ElseIf(kind.greaterThan(1.5).and(kind.lessThan(2.5)), () => {
        // ---- Blank party wall.
        const bare0 = step(0.45, fract(seed.mul(6.7)));
        c.assign(mix(c, vec3(0.6, 0.58, 0.55).mul(n1.mul(0.2).add(0.9)), bare0.mul(0.45).add(0.15)));
        const slabLine = fBox(fract(v.div(FH)).mul(FH), float(0), float(0.22), fwv);
        c.mulAssign(inv(slabLine.mul(0.1).mul(det)));
        const streak = smooth(0.35, 0.85, vnoise2(vec2(u.mul(2.2).add(seed.mul(9)), v.mul(0.06))));
        c.mulAssign(inv(wear.mul(0.22).add(0.12).mul(streak).mul(exp(wallTopV.sub(v).mul(-0.12)))));
        const pc = floor(vec2(u.div(2.3), v.div(1.7)));
        const repair = step(0.86, hash12(pc.add(seed.mul(13))));
        c.assign(mix(c, c.mul(vec3(1.12, 1.1, 1.06)), repair.mul(0.8)));
        const tar = step(0.94, hash12(pc.mul(1.7).add(seed.mul(3)))).mul(smooth(0.5, 0.6, vnoise2(vec2(u, v).mul(1.3).add(seed))));
        c.assign(mix(c, vec3(0.08), tar.mul(0.7)));
        If(wear.greaterThan(0.35), () => {
          const brick = fTex(float(4), tuv);
          const bare = smooth(0.76, 0.79, fbm2(vec2(u, v).mul(0.45).add(seed.mul(9)), 3).add(wear.sub(0.5).mul(0.15)));
          c.assign(mix(c, brick.a.rgb.mul(vec3(0.9, 0.8, 0.74)), bare));
          fTN.assign(mix(fTN, brick.tn, bare));
        });
      })
      .Else(() => {
        // ---- Windowed wall.
        const isLev = eq(arch, Arch.Levantine);
        const isHan = eq(arch, Arch.Han).toVar();
        const isModern = eq(arch, Arch.Modern).toVar();
        const isCivic = max(eq(arch, Arch.Civic), eq(arch, Arch.Mosque));
        const classical = max(isLev, max(isHan, isCivic)).toVar();
        const hWin = hash13(vec3(cu, row, seed.mul(97))).toVar();
        const hWin2 = hash13(vec3(cu.add(17), row, seed.mul(13))).toVar();
        const k = row.sub(gRow).sub(1).toVar();
        const bal = osmBalconyAt(balMode, cu, nb, k, float(99)).mul(upper).mul(inv(court));
        const bottom = mix(sillH, 0.04, bal).toVar();
        const rise = select(headType.greaterThan(2.5), halfW, select(headType.greaterThan(1.5), halfW.mul(0.38), float(0))).toVar();
        const spring = headH.sub(rise).toVar();
        const V = normalize(wp.sub(cameraPosition)).toVar();
        const Tn = normalize(cross(wn, vec3(0, 1, 0))).toVar();
        const d = vec3(V.dot(Tn), V.y, V.dot(wn)).toVar();
        const Ls = U.keyLightDir;
        const Ld = vec3(Ls.dot(Tn), Ls.y, Ls.dot(wn)).toVar();
        const depth: N = F_DEPTH.element(int(arch.add(0.5))).toVar();

        // Painted dressings (far LOD; near LOD adds real geometry on top).
        const dress = upper.mul(inv(court)).mul(classical);
        const surround = dress.mul(
          max(
            fBox(wu, halfW.negate().sub(0.14), halfW.add(0.14), fwu)
              .mul(fBox(wv, bottom.sub(0.02), headH.add(0.14), fwv))
              .sub(fBox(wu, halfW.negate(), halfW, fwu).mul(fBox(wv, bottom, headH, fwv))),
            0,
          ),
        );
        const capBand = dress.mul(inv(step(1.5, headType))).mul(fBox(wu, halfW.negate().sub(0.24), halfW.add(0.24), fwu)).mul(fBox(wv, headH.add(0.14), headH.add(0.36), fwv));
        const sillBand = upper.mul(inv(bal)).mul(fBox(wu, halfW.negate().sub(0.1), halfW.add(0.1), fwu)).mul(fBox(wv, bottom.sub(0.12), bottom, fwv));
        c.assign(mix(c, base.mul(1.12).add(0.02), surround.add(capBand).mul(0.8)));
        c.assign(mix(c, base.mul(1.08), sillBand.mul(0.7)));
        c.mulAssign(inv(dress.mul(0.3).mul(fBox(wu, halfW.negate().sub(0.24), halfW.add(0.24), fwu)).mul(fBox(wv, headH.add(0.08), headH.add(0.14), fwv)).mul(det)));
        const under = upper.mul(fBox(wu, halfW.negate().add(0.05), halfW.sub(0.05), fwu)).mul(step(wv, bottom.sub(0.12))).mul(exp(bottom.sub(0.12).sub(wv).mul(-0.9)));
        c.mulAssign(inv(wear.mul(0.3).mul(under).mul(smooth(0.35, 0.75, vnoise2(vec2(u.mul(6), v.mul(0.35)))))));
        If(isLev.add(isCivic).greaterThan(0.5), () => {
          const plinth = streetFloor.mul(plinthOn);
          const groove = fLine(fract(v.div(0.42)).sub(0.5), float(0.47), fwv.mul(2.4 / 0.42)).add(fLine(fract(u.div(1.1).add(floor(v.div(0.42)).mul(0.5))).sub(0.5), float(0.485), fwu.mul(2.4 / 1.1)));
          c.mulAssign(inv(plinth.mul(0.32).mul(clamp(groove, 0, 1)).mul(det)));
          const edgeU = min(u, L.sub(u));
          const quoin = inv(streetFloor)
            .mul(step(edgeU, mix(0.55, 0.8, step(0.5, fract(v.div(0.9))))))
            .mul(step(1.6, L))
            .mul(step(fract(seed.mul(5.7)), 0.6))
            .mul(step(wallLayer, 1.5));
          c.assign(mix(c, base.mul(1.18).add(0.03), quoin.mul(0.9)));
          c.mulAssign(inv(quoin.mul(0.25).mul(fLine(fract(v.div(0.45)).sub(0.5), float(0.47), fwv.mul(2))).mul(det)));
        });
        If(isModern.greaterThan(0.5), () => {
          const spand = upper.mul(inv(fBox(wv, bottom.sub(0.05), headH.add(0.05), fwv)));
          c.assign(mix(c, c.mul(mix(0.85, 1.12, step(0.5, fract(seed.mul(3.3))))), spand.mul(0.6)));
        });
        const rbox = roller.mul(upper).mul(fBox(wu, halfW.negate().sub(0.03), halfW.add(0.03), fwu)).mul(fBox(wv, headH, headH.add(0.22), fwv));
        const rollCol = mix(vec3(0.82, 0.8, 0.74), vec3(0.45, 0.33, 0.24), step(0.72, fract(seed.mul(9.1)))).toVar();
        c.assign(mix(c, rollCol.mul(0.9), rbox));

        // ---- Upper-floor openings.
        const usable = upper.mul(step(1.5, L));
        const inWin = usable.mul(fOpen(vec2(wu, wv), halfW, bottom, spring, rise, fwu)).toVar();
        // ---- Street floor: shops, Han arcades, doors, grilled windows.
        const base0 = gRow.mul(FH).toVar();
        const inShop = float(0).toVar();
        const fascia = float(0).toVar();
        const door = float(0).toVar();
        const gWin = float(0).toVar();
        const gHalf = halfW.toVar();
        const gBottom = gHere.add(0.03).sub(base0).toVar();
        const gTop = FH.sub(0.95).toVar();
        const gSpring = gTop.toVar();
        const gRise = float(0).toVar();
        const gSill = max(gHere.add(1.35), base0.add(sillH)).sub(base0).toVar();
        If(streetFloor.greaterThan(0.5).and(court.lessThan(0.5)), () => {
          If(shop.greaterThan(0.5), () => {
            If(isHan.greaterThan(0.5), () => {
              gHalf.assign(bw.mul(0.5).sub(0.42));
              gRise.assign(gHalf);
              gTop.assign(FH.sub(0.45));
              gSpring.assign(gTop.sub(gRise));
            }).Else(() => {
              gHalf.assign(bw.mul(0.5).sub(0.22));
              fascia.assign(fBox(wu, bw.mul(-0.5).add(0.1), bw.mul(0.5).sub(0.1), fwu).mul(fBox(v, shopLine.sub(0.9), shopLine.sub(0.22), fwv)));
            });
            inShop.assign(fOpen(vec2(wu, v.sub(base0)), gHalf, gBottom, gSpring, gRise, fwu));
          }).ElseIf(street.greaterThan(0.5).or(classical.greaterThan(0.5)), () => {
            const isDoor = step(abs(cu.sub(floor(nb.mul(0.5)))), 0.1).mul(street);
            door.assign(isDoor.mul(fBox(wu, float(-0.72), float(0.72), fwu)).mul(fBox(sv, float(-0.2), float(2.75), fwv)));
            gWin.assign(inv(isDoor).mul(fOpen(vec2(wu, v.sub(base0)), halfW, gSill, spring, rise, fwu)).mul(step(gSill.add(0.6), headH)));
          });
        });

        // ---- Recess (ray-box) for windows and shop fronts.
        const opening = max(inWin, max(inShop, gWin)).toVar();
        If(opening.greaterThan(0.01), () => {
          const p0 = vec2(wu, wv).toVar();
          const ob = bottom.toVar();
          const ot = headH.toVar();
          const oh = halfW.toVar();
          const od = depth.toVar();
          const isShopHit = step(0.5, inShop).toVar();
          If(isShopHit.greaterThan(0.5), () => {
            p0.assign(vec2(wu, v.sub(base0)));
            ob.assign(gBottom);
            ot.assign(gTop);
            oh.assign(gHalf);
            od.assign(select(isHan.greaterThan(0.5), float(0.45), float(0.18)));
          }).ElseIf(gWin.greaterThan(0.5), () => {
            p0.assign(vec2(wu, v.sub(base0)));
            ob.assign(gSill);
          });
          const hit = fRecess(p0, d, oh, ob, ot, od).toVar();
          const face = hit.w;
          const dep = hit.z;
          // Key-light shadow: trace from the hit point back out of the opening.
          const lz = max(Ld.z, 1e-3);
          const ex = hit.xy.add(Ld.xy.mul(dep.div(lz)));
          const lit = fBox(ex.x, oh.negate(), oh, float(0.03)).mul(fBox(ex.y, ob, ot, float(0.03)));
          fShadow.assign(opening.mul(inv(lit)).mul(step(0, Ld.z)).mul(0.92));
          fAO.assign(mix(float(1), inv(dep.div(max(od, 1e-3))).mul(0.3).add(0.55) as N, opening));
          const revealCol = mix(base, vec3(0.8, 0.78, 0.74), 0.25).mul(0.9);
          If(face.greaterThan(0.5), () => {
            const rn = select(face.lessThan(1.5), Tn.mul(sign(d.x).negate()), select(face.lessThan(2.5), vec3(0, -1, 0), vec3(0, 1, 0)));
            fSurfN.assign(normalize(mix(fSurfN, rn, opening)));
            c.assign(mix(c, revealCol.mul(select(face.greaterThan(2.5), float(0.85), float(1))), opening));
            fFlat.assign(opening);
          }).Else(() => {
            const g = hit.xy.toVar();
            fFlat.assign(opening);
            const hA = hash13(vec3(floor(cu.div(floor(fract(seed.mul(3.9)).mul(2.5)).add(1))), row, seed.mul(31))).toVar();
            const emis = vec3(0).toVar();
            const frameW = 0.055;
            const fr = float(0).toVar();
            If(isShopHit.greaterThan(0.5), () => {
              // Shop window: mullions, glass door, flat lit interior (fShop skipped), kepenk / Han iron doors.
              const hShop = hash13(vec3(cu, 7, seed.mul(5))).toVar();
              const closedDay = step(hShop, 0.1);
              const closedNight = step(hShop, select(busy.greaterThan(0.5), float(0.2), float(0.7)));
              const closed = mix(closedDay, closedNight, smooth(0.3, 0.7, U.night)).toVar();
              const mull = fract(hShop.mul(13)).mul(0.5).add(1.25);
              fr.assign(max(fLine(g.x.sub(floor(g.x.div(mull).add(0.5)).mul(mull)), float(0.03), fwu), inv(fBox(g.x, oh.negate().add(0.06), oh.sub(0.06), fwu))));
              fr.assign(max(fr, inv(fBox(g.y, ob.add(0.2), ot.sub(0.06), fwv))));
              const doorU = step(fract(hShop.mul(5.3)), 0.4).mul(fBox(g.x, float(-0.55), float(0.55), fwu));
              fr.assign(max(fr, doorU.mul(max(fLine(g.y.sub(ob.add(2.2)), float(0.035), fwv), fLine(g.y.sub(ob.add(1.05)), float(0.02), fwv).mul(fBox(g.x, float(-0.4), float(0.4), fwu))))));
              fr.assign(max(fr, doorU.mul(fLine(abs(g.x).sub(0.55), float(0.03), fwu))));
              fr.mulAssign(det);
              const shopLight = mix(vec3(1, 0.84, 0.64), vec3(0.95, 0.97, 1), step(0.55, fract(hShop.mul(2.9))));
              const level = mix(0.1, 0.38, lightsOn);
              const roomCol = fGoods(fract(hShop.mul(7.7))).mul(0.6).add(0.25);
              emis.assign(roomCol.mul(level).add(mix(0.3, 0.8, lightsOn).mul(0.5)).mul(shopLight));
              const cosV = abs(d.z);
              const fres = pow(inv(cosV), 5).mul(0.95).add(0.05);
              emis.assign(mix(emis, fGlassEnv(reflect(V, wn), float(0)), fres.mul(0.9)));
              c.assign(mix(vec3(0.015), vec3(0.08, 0.08, 0.085), fr));
              If(isHan.greaterThan(0.5), () => {
                const ironClosed = max(closed, step(hShop, 0.3));
                const iron = mix(vec3(0.07, 0.12, 0.09), vec3(0.06), step(0.5, fract(seed.mul(4.3))));
                const panel = fLine(fract(g.x.div(0.6)).sub(0.5), float(0.47), fwu.mul(2)).add(fLine(fract(g.y.div(0.9)).sub(0.5), float(0.47), fwv.mul(2)));
                c.assign(mix(c, iron.mul(inv(clamp(panel, 0, 1).mul(0.3).mul(det))), ironClosed));
                emis.mulAssign(inv(ironClosed));
              }).Else(() => {
                const ribs = step(0.5, fract(g.y.div(0.09))).mul(0.2).add(0.8);
                const kep = mix(vec3(0.42, 0.43, 0.44), vec3(0.5, 0.47, 0.42), step(0.6, fract(hShop.mul(17))))
                  .mul(ribs)
                  .mul(vnoise2(g.mul(2).add(seed)).mul(0.2).add(0.85))
                  .toVar();
                kep.assign(mix(kep, fGoods(hash12(vec2(cu, seed))).mul(0.8), step(0.72, vnoise2(g.mul(vec2(1.6, 3)).add(seed.mul(9)))).mul(step(g.y, ob.add(1.8))).mul(step(0.5, wear))));
                c.assign(mix(c, kep, closed));
                emis.mulAssign(inv(closed));
              });
              emis.mulAssign(inv(fr));
              fRough.assign(mix(0.05, 0.6, max(closed, fr)));
            }).Else(() => {
              // Window: casement frame, transom, curtains / blinds / roller / shutters, interior-mapped room.
              const frameDark = step(fract(seed.mul(3.7)), select(classical.greaterThan(0.5), float(0.55), float(0.2)));
              const frameCol = select(
                isModern.greaterThan(0.5),
                mix(vec3(0.08), vec3(0.75), step(0.5, fract(seed.mul(6.1)))),
                mix(vec3(0.86, 0.85, 0.82), mix(vec3(0.24, 0.15, 0.09), vec3(0.12), isHan), frameDark),
              );
              const transom = select(oh.greaterThan(0.4).and(classical.greaterThan(0.5)), select(rise.greaterThan(0.01), spring, headH.sub(0.55)), float(99));
              fr.assign(inv(fBox(g.x, oh.negate().add(frameW), oh.sub(frameW), fwu).mul(fBox(g.y, ob.add(frameW), ot.sub(frameW * 0.5), fwv))));
              fr.assign(max(fr, step(0.42, oh).mul(fLine(g.x, float(0.035), fwu))));
              fr.assign(max(fr, fLine(g.y.sub(transom), float(0.035), fwv).mul(inv(isModern))));
              fr.mulAssign(det);
              const curtainK = select(office.greaterThan(0.5), float(3), select(hA.lessThan(0.42), float(1), select(hA.lessThan(0.58), float(2), select(hA.lessThan(0.7), float(4), float(0))))).toVar();
              const room = fRoom(g, d, bw.mul(0.5), FH, hWin.mul(1.5).add(4.2), hWin2).toVar();
              const onP = max(select(office.greaterThan(0.5), float(0.12), occupancy), busy.mul(street).mul(select(k.lessThan(1.5), float(0.62), float(0.3))));
              const litRoom = step(hA, onP).mul(step(0.18, hWin));
              const flatH = fract(hA.mul(13.7).add(seed.mul(5.1))).toVar();
              const tv = step(0.9, flatH).mul(litRoom);
              const lampCol0 = select(flatH.lessThan(0.45), vec3(1, 0.56, 0.26), select(flatH.lessThan(0.7), vec3(1, 0.72, 0.46), vec3(0.84, 0.9, 1)));
              const flick = sin(U.time.mul(7).add(hWin.mul(40))).mul(sin(U.time.mul(2.3).add(hWin2.mul(13)))).mul(0.25).add(0.75);
              const lampCol = mix(lampCol0, vec3(0.45, 0.6, 1).mul(flick), tv).toVar();
              const lampI = mix(0.3, 2.1, flatH.mul(flatH)).mul(hWin.mul(0.5).add(0.75)).mul(mix(1, 0.35, tv)).mul(litRoom).mul(lightsOn).toVar();
              emis.assign(room.rgb.mul(inv(U.night).mul(0.035).add(lampCol.mul(lampI).mul(room.a.mul(1.4).add(0.2)))));
              c.assign(vec3(0.02, 0.024, 0.028));
              const cover = float(0).toVar();
              const outer = float(0).toVar();
              If(curtainK.greaterThan(0.5).and(curtainK.lessThan(1.5)), () => {
                const fold = sin(g.x.mul(38).add(hWin.mul(9))).mul(0.15).mul(det).add(0.85);
                cover.assign(0.78);
                c.assign(mix(c, vec3(0.62, 0.61, 0.58).mul(fold), cover));
                emis.assign(emis.mul(0.45).add(lampCol.mul(lampI).mul(0.32).mul(fold)));
              })
                .ElseIf(curtainK.lessThan(2.5).and(curtainK.greaterThan(1.5)), () => {
                  const side = smooth(oh.mul(0.35), oh.mul(0.5), abs(g.x));
                  const drape = mix(vec3(0.45, 0.2, 0.15), vec3(0.55, 0.5, 0.38), hWin2).mul(sin(g.x.mul(30)).mul(0.2).add(0.8));
                  c.assign(mix(c, drape, side));
                  emis.mulAssign(inv(side.mul(0.8)));
                  cover.assign(side);
                })
                .ElseIf(curtainK.greaterThan(2.5).and(curtainK.lessThan(3.5)), () => {
                  const slat = step(0.5, fract(g.y.div(0.07))).mul(0.3).add(0.7);
                  const blindDown = step(hWin, 0.6).mul(step(g.y, ot.sub(ot.sub(ob).mul(hWin2))));
                  c.assign(mix(c, vec3(0.6, 0.6, 0.58).mul(slat), blindDown.mul(0.9)));
                  emis.mulAssign(inv(blindDown.mul(0.6)));
                  cover.assign(blindDown);
                });
              If(roller.greaterThan(0.5), () => {
                const amount0 = select(hWin2.lessThan(0.3), float(0), select(hWin2.lessThan(0.75), hWin.mul(0.55).add(0.15), select(hWin2.lessThan(0.92), float(1), float(0.35))));
                const amount = mix(amount0, max(amount0, step(0.5, hWin).mul(0.8)), U.night.mul(0.6));
                const rolled = step(ot.sub(ot.sub(ob).mul(amount)), g.y);
                const slats = rollCol.mul(step(0.5, fract(g.y.div(0.05))).mul(0.2).add(0.8));
                c.assign(mix(c, slats, rolled));
                emis.mulAssign(inv(rolled.mul(0.95)));
                fr.mulAssign(inv(rolled));
                cover.assign(max(cover, rolled));
                outer.assign(rolled);
              });
              If(shutters.greaterThan(0.5).and(hWin.lessThan(0.14)), () => {
                const sc = mix(vec3(0.16, 0.26, 0.19), vec3(0.3, 0.19, 0.11), step(0.5, fract(seed.mul(5.3))));
                c.assign(sc.mul(step(0.45, fract(g.y.div(0.07))).mul(0.28).add(0.72)));
                emis.mulAssign(0.05);
                fr.assign(fLine(g.x, float(0.02), fwu));
                cover.assign(1);
                outer.assign(1);
              });
              c.assign(mix(c, frameCol, fr));
              emis.mulAssign(inv(fr));
              const fres = pow(inv(abs(d.z)), 5).mul(0.96).add(0.04);
              emis.addAssign(fGlassEnv(reflect(V, wn), hWin.sub(0.5).mul(0.16)).mul(fres).mul(inv(fr)).mul(inv(outer)));
              fRough.assign(mix(0.06, 0.7, clamp(fr.add(cover), 0, 1)));
            });
            fEmis.addAssign(emis.mul(opening));
            c.assign(mix(base, c, opening));
          });
        });
        // Shop fascia and a lamp over apartment doors.
        If(fascia.greaterThan(0.01), () => {
          const fcol = mix(vec3(0.12, 0.12, 0.13), vec3(0.55, 0.12, 0.1), step(0.6, hash12(vec2(cu, seed.mul(3)))));
          c.assign(mix(c, fcol, fascia));
          fEmis.addAssign(fcol.mul(fascia).mul(lightsOn).mul(1.2));
        });
        If(door.greaterThan(0.01), () => {
          const dx = wu;
          const dy = sv;
          const glassPanel = fBox(dx, float(-0.5), float(0.5), fwu).mul(fBox(dy, float(0.9), float(2.1), fwv));
          const bars = fLine(fract(dx.div(0.14)).sub(0.5), float(0.42), fwu.mul(2 / 0.14)).mul(glassPanel).mul(det);
          const doorCol = mix(vec3(0.2, 0.13, 0.08), vec3(0.09, 0.09, 0.1), step(0.5, fract(seed.mul(8.3))));
          const dc = mix(doorCol, vec3(0.03), glassPanel.mul(inv(bars)));
          c.assign(mix(c, dc.mul(n1.mul(0.1).add(0.9)), door));
          fFlat.assign(max(fFlat, door));
          fShadow.assign(max(fShadow, door.mul(0.4)));
          const lampSpot = exp(length(vec2(dx, dy.sub(2.95))).mul(-3));
          fEmis.addAssign(vec3(1, 0.7, 0.4).mul(lampSpot).mul(lightsOn).mul(1.5).mul(street));
          fEmis.addAssign(vec3(1, 0.75, 0.45).mul(0.4).mul(lightsOn).mul(glassPanel).mul(inv(bars)).mul(door).mul(step(0.5, hash12(vec2(seed, 3)))));
        });
        If(gWin.greaterThan(0.01), () => {
          const grille = max(fLine(fract(wu.div(0.12)).sub(0.5), float(0.42), fwu.mul(2 / 0.12)), fLine(fract(sv.div(0.9)).sub(0.5), float(0.46), fwv.mul(2 / 0.9))).mul(det);
          c.assign(mix(c, vec3(0.04), grille.mul(gWin)));
          fShadow.assign(max(fShadow, grille.mul(gWin).mul(0.5)));
        });
        // Far field: windows converge to their average once a bay spans only a few pixels.
        const farMix = smooth(0.22, 0.6, max(fwu.div(bw), fwv.div(FH))).mul(upper).mul(step(1.5, L)).toVar();
        If(farMix.greaterThan(0.001), () => {
          const wf = clamp(halfW.mul(2).mul(headH.sub(bottom)).div(bw.mul(FH)), 0.05, 0.6);
          const hCell = hash13(vec3(floor(cu.div(floor(fract(seed.mul(3.9)).mul(2.5)).add(1))), row, seed.mul(31)));
          const cellLit = step(hCell, max(select(office.greaterThan(0.5), float(0.12), occupancy), busy.mul(street).mul(select(k.lessThan(1.5), float(0.62), float(0.3)))));
          const cellH = fract(hCell.mul(13.7).add(seed.mul(5.1)));
          const cellCol = select(cellH.lessThan(0.45), vec3(1, 0.56, 0.26), select(cellH.lessThan(0.7), vec3(1, 0.72, 0.46), vec3(0.84, 0.9, 1)));
          const farC = mix(base, vec3(0.045, 0.05, 0.055), wf.mul(0.85));
          const farE = cellCol.mul(mix(0.35, 2.2, cellH.mul(cellH))).mul(wf).mul(cellLit).mul(lightsOn);
          c.assign(mix(c, farC, farMix));
          fEmis.assign(mix(fEmis, farE, farMix));
          fShadow.mulAssign(inv(farMix));
        });
      });
    If(horiz.not().and(kind.lessThan(1.5)), () => {
      const lampWash = street.mul(exp(max(sv, 0).div(-5))).mul(0.08);
      const spill = shop.mul(inv(court)).mul(step(shopLine, v)).mul(exp(v.sub(shopLine).negate().div(mix(2.6, 4.5, busy)))).mul(mix(0.12, 0.42, busy));
      fEmis.addAssign(base.mul(vec3(1, 0.8, 0.55)).mul(lampWash.add(spill)).mul(lightsOn));
    });
    If(fRough.lessThan(0), () => {
      fRough.assign(rough);
    });
    fTN.assign(vec3(fTN.xy.mul(mix(0.6, 1, det)), fTN.z));
    return c;
  });

  m.colorNode = main();
  m.roughnessNode = fRough;
  m.emissiveNode = fEmis;
  // FACADE_NORMAL: tangent frame (fT, fB, visible-surface normal) -> view space.
  m.normalNode = Fn(() => {
    const nv = normalize(cameraViewMatrix.mul(vec4(fSurfN, 0)).xyz);
    const tv = normalize(cameraViewMatrix.mul(vec4(fT, 0)).xyz);
    const bv = normalize(cameraViewMatrix.mul(vec4(fB, 0)).xyz);
    const tn = vec3((fTN as N).xy.mul(inv(fFlat).mul(0.8)), (fTN as N).z);
    return normalize(mat3(tv, bv, nv).mul(normalize(tn)));
  })();
  // FACADE_LIGHT: the recess shadow only darkens the shadow-casting key light; AO scales indirect light.
  m.receivedShadowNode = Fn(([shadow]: N[]) => shadow.mul(inv(fShadow)));
  m.aoNode = fAO;
  return m;
}
