/**
 * WebGPU spike: OSM roof material (materials.ts makeRoofMaterial / ROOF_MAIN) as a MeshStandardNodeMaterial.
 * Full port of the cover logic (clay tiles, lead, metal, slate); the flattening of the tile normal map on lead /
 * metal / slate covers is a mix of the normal-mapped and the geometric view normal.
 */
import * as THREE from 'three/webgpu';
import { Fn, If, attribute, float, floor, fract, max, mix, normalMap, normalViewGeometry, normalize, positionWorld, property, step, texture, uv, vec2, vec3, cos } from 'three/tsl';
import { RoofCover } from '../../src/world/osm/buildings/plan';
import { RoofPart } from '../../src/world/osm/buildings/roofs';
import { type N, fbm2, hash12, smooth, vnoise2 } from './tsl-common';

const inv = (x: N): N => float(1).sub(x);
const isCover = (cover: N, v: number): N => cover.greaterThan(v - 0.5).and(cover.lessThan(v + 0.5));

export function createRoofNodeMaterial(maps: { albedo: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture }): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ name: 'osm-roof-node', roughness: 1, metalness: 0, side: THREE.DoubleSide });
  const rRough = property('float', 'rRough');
  const rMetal = property('float', 'rMetal');
  const rFlat = property('float', 'rFlat');
  const rep = 1 / 2.5;

  m.colorNode = Fn(() => {
    const vRoof = attribute('aRoof', 'vec4');
    const uvm = uv().toVar();
    const wp = positionWorld;
    const tex = texture(maps.albedo, uvm.mul(rep));
    const col = tex.rgb.mul(attribute('color', 'vec3')).toVar();
    rRough.assign(-1);
    rMetal.assign(0);
    rFlat.assign(0);
    const cover = floor(vRoof.x.add(0.5)).toVar();
    const seed = vRoof.y.toVar();
    const wear = vRoof.z.toVar();
    const part = floor(vRoof.w.add(0.5)).toVar();
    const n1 = vnoise2(wp.xz.mul(0.35).add(seed.mul(11))).toVar();
    const n2 = vnoise2(wp.xz.mul(1.9).add(seed.mul(3))).toVar();
    If(isCover(cover, RoofCover.Lead), () => {
      const seam = mix(fract(wp.x.div(0.8)), fract(uvm.x.div(0.75)), isCover(part, RoofPart.Dome).select(float(1), float(0)));
      const ridge = inv(smooth(0, 0.06, seam.min(inv(seam))));
      const lead = mix(vec3(0.36, 0.37, 0.37), vec3(0.47, 0.48, 0.47), n1).toVar();
      lead.assign(mix(lead, vec3(0.6, 0.6, 0.57), smooth(0.55, 0.85, vnoise2(vec2(uvm.x.mul(2), uvm.y.mul(0.3)).add(seed))).mul(0.45)));
      col.assign(lead.mul(ridge.mul(0.2).add(1)));
      rRough.assign(0.68);
      rMetal.assign(0.12);
      rFlat.assign(0.9);
    })
      .ElseIf(isCover(cover, RoofCover.Metal), () => {
        const rib = cos(uvm.x.mul(6.2832 / 0.2)).mul(0.5).add(0.5);
        const sheet = mix(vec3(0.46, 0.48, 0.5), vec3(0.42, 0.25, 0.16), smooth(0.5, 0.8, n1).mul(wear));
        col.assign(sheet.mul(rib.mul(0.2).add(0.85)));
        rRough.assign(0.55);
        rMetal.assign(0.4);
        rFlat.assign(0.8);
      })
      .ElseIf(cover.greaterThan(RoofCover.Slate - 0.5), () => {
        const t = vec2(uvm.x.div(0.4), uvm.y.div(0.3));
        const course = floor(t.y);
        const edge = inv(smooth(0, 0.08, fract(t.y))).add(inv(smooth(0, 0.05, fract(t.x.add(course.mul(0.5))).sub(0.5).abs().mul(2).sub(0.95))));
        col.assign(mix(vec3(0.3, 0.31, 0.32), vec3(0.42, 0.42, 0.41), hash12(vec2(floor(t.x.add(course.mul(0.5))), course).add(seed))).mul(inv(edge.clamp(0, 1).mul(0.3))));
        rRough.assign(0.75);
        rFlat.assign(0.7);
      })
      .Else(() => {
        const tile = floor(vec2(uvm.x.div(0.24), uvm.y.div(0.4)));
        const jitter = hash12(tile.add(seed.mul(7)));
        col.mulAssign(jitter.mul(0.28).add(0.86));
        col.assign(mix(col, col.mul(vec3(1.15, 1.02, 0.85)), step(0.965, jitter)));
        const lichen = smooth(0.62, 0.9, fbm2(wp.xz.mul(0.5).add(seed.mul(5)), 3).add(wear.sub(0.5).mul(0.3)));
        col.assign(mix(col, col.mul(vec3(0.55, 0.52, 0.45)).mul(n2.mul(0.4).add(0.8)), lichen.mul(0.45)));
        col.mulAssign(mix(0.72, 1, smooth(0, 1.6, uvm.y)));
        col.mulAssign(inv(wear.mul(0.25).mul(smooth(0.4, 0.8, vnoise2(vec2(uvm.x.mul(1.5), uvm.y.mul(0.2)).add(seed))))));
        If(part.greaterThan(0.5).and(part.lessThan(1.5)), () => {
          col.mulAssign(0.78);
          rFlat.assign(0.6);
        });
      });
    return col;
  })();
  m.roughnessNode = Fn(() => {
    const r = texture(maps.rough, uv().mul(rep)).g;
    return rRough.greaterThan(0).select(rRough, r);
  })();
  m.metalnessNode = max(float(0), rMetal);
  m.normalNode = Fn(() => normalize(mix(normalMap(texture(maps.normal, uv().mul(rep))) as N, normalViewGeometry, rFlat)))();
  return m;
}
