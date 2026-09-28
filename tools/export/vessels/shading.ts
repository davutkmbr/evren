/**
 * The web vessel material (src/world/life/render/life-material.glsl.ts, props/material.ts for the moored boats) as
 * data for other runtimes: per material slot the detail maps and the shader's rules, the emissive classes, the accent
 * palette and the instance data. Rules are the shader's formulas in plain notation; `sourceHash` changes whenever the
 * web shader does, so an importer can tell its port is stale.
 */
import { createHash } from 'node:crypto';
import { LIFE_COLOR_VERTEX, LIFE_FRAGMENT_PARS, LIFE_VERTEX_PARS } from '../../../src/world/life/render/life-material.glsl';
import type { MapRecord } from './detail-maps';

/** The accent palette (linear) of lifeAccent(), read from the shader source so it cannot drift. */
function accentPalette(): number[][] {
  const out = [...LIFE_VERTEX_PARS.matchAll(/return vec3\(([^)]+)\)/g)].map((m) => m[1].split(',').map((v) => Number(v.trim())));
  if (out.length !== 8 || out.some((c) => c.length !== 3 || c.some((v) => !Number.isFinite(v)))) {
    throw new Error(`life shader: expected 8 accent colours, read ${out.length}`);
  }
  return out;
}

const SLOT_RULES: Record<string, { maps: string[]; rules: string[] }> = {
  hull: {
    maps: ['hull_normal', 'hull_mask'],
    rules: [
      'steel plating; normal: vessel_hull_normal (seams every 2.6 m up and 8.5 m along, 4 mm)',
      'albedo *= 0.94 + 0.1 * grime',
      'streak = step(1 - 0.3 * weathering, mask.a) * mask.b * smoothstep(0.3, 1.2, y); albedo = mix(albedo, rust, streak * (0.3 + 0.45 * weathering)); rust = (0.19, 0.075, 0.03)',
      'blotch = smoothstep(0.7, 0.86, mask.g) * smoothstep(0.45, 1, weathering); albedo = mix(albedo, rust * 1.15, blotch * 0.4)',
      'boot = smoothstep(-0.03, 0.02, y) * (1 - smoothstep(0.4, 0.47, y)); albedo = mix(albedo, (0.017, 0.019, 0.021) * (0.9 + 0.2 * grime), boot * 0.94)',
      'antifouling = smoothstep(0.03, -0.03, y); albedo = mix(albedo, (0.26, 0.05, 0.035) * (0.8 + 0.35 * grime), antifouling)',
      'roughness = mix(roughness + (grime - 0.5) * 0.15 + streak * 0.25, 0.75, max(antifouling, boot * 0.6)); metallic = mix(metallic, 0, max(antifouling, streak))',
    ],
  },
  container: {
    maps: ['container_normal', 'container_mask'],
    rules: [
      'corrugated box walls; normal: vessel_container_normal (ribs every 0.28 m, 2 cm), none on faces whose normal points up (n.y > 0.7)',
      'dirt = smoothstep(0.35, 0.95, grime) * 0.4 + mask.b * 0.08; albedo *= (1 - dirt * 0.5) * (0.92 + 0.12 * mask.g)',
      'roughness = clamp(roughness + dirt * 0.2, 0.3, 0.95)',
    ],
  },
  deck: {
    maps: ['deck_normal', 'deck_mask'],
    rules: [
      'steel or wooden deck; TEXCOORD_0 = (x, z) on every face; normal: vessel_deck_normal (plates 2.2 x 6 m, 3 mm)',
      'wear = smoothstep(0.55, 0.85, mask.r); albedo = mix(albedo, (0.09, 0.075, 0.06), wear * 0.55); albedo *= 0.85 + 0.3 * mask.g',
      'roughness = clamp(roughness + wear * 0.1 - 0.05, 0.2, 1)',
    ],
  },
  super: {
    maps: ['super_mask'],
    rules: [
      'painted superstructure: streak = pow(mask.g, 5) * (0.25 + weathering); albedo *= 1 - streak * 0.3; albedo *= 0.94 + 0.08 * grime',
      'roughness = clamp(roughness + (grime - 0.5) * 0.15, 0.2, 1)',
    ],
  },
  wood: {
    maps: ['wood_normal', 'wood_mask'],
    rules: [
      'planked wooden hull; normal: vessel_wood_normal (strakes every 0.17 m, 3 mm)',
      'wear = smoothstep(0.6, 0.85, mask.g); albedo = mix(albedo, (0.2, 0.13, 0.07), wear * 0.6)',
      'antifouling = smoothstep(0.03, -0.03, y); albedo = mix(albedo, (0.25, 0.06, 0.04), antifouling); albedo *= 0.9 + 0.2 * grime',
    ],
  },
  glass: {
    maps: ['glass_mask'],
    rules: ['albedo = mix(albedo * (0.8 + 0.4 * mask.g), (0.05, 0.05, 0.05), mask.r * 0.8); roughness = mix(roughness, 0.5, mask.r)'],
  },
  fabric: { maps: ['fabric_mask'], rules: ['rope, nets, canvas, clothes: albedo *= 0.85 + 0.3 * mask.r'] },
  paint: { maps: ['super_mask'], rules: ['plain paint and fittings: albedo *= 0.95 + 0.08 * grime'] },
  lamp: { maps: [], rules: ['lamp fixture: emissive class 3'] },
  sign: { maps: [], rules: ['illuminated sign: emissive class 4 (piers; no vessel uses it)'] },
  boat: { maps: [], rules: ['moored boats (web props material): vertex colour, roughness 0.7, metalness 0.05 (TEXCOORD_1), two-sided (open hull shells)'] },
  boat_glow: { maps: [], rules: ['moored boats: lanterns and coals, emissive class 5 with strength TEXCOORD_3.y'] },
};

/** Detail pattern of a material slot (`glass_cabin` -> `glass`); the moored boats' slots stand alone. */
export function baseSlot(slot: string): string {
  return slot.startsWith('boat') ? slot : slot.split('_')[0];
}

export function shadingManifest(maps: Record<string, MapRecord>, slots: readonly string[]): Record<string, unknown> {
  const sourceHash = createHash('sha1').update(LIFE_VERTEX_PARS).update(LIFE_COLOR_VERTEX).update(LIFE_FRAGMENT_PARS).digest('hex').slice(0, 16);
  const materials: Record<string, unknown> = {};
  for (const slot of [...slots].sort()) {
    const base = SLOT_RULES[baseSlot(slot)] ?? SLOT_RULES.paint;
    const emit = slot.endsWith('_cabin') ? 1 : slot.endsWith('_crew') ? 2 : slot === 'lamp' ? 3 : slot === 'sign' ? 4 : slot === 'boat_glow' ? 5 : 0;
    materials[`vessel_${slot}`] = {
      maps: Object.fromEntries(base.maps.map((id) => [id.endsWith('normal') ? 'normal' : 'mask', maps[id]?.file ?? `textures/vessel_${id}.png`])),
      emissiveClass: emit,
      twoSided: slot.startsWith('boat'),
      rules: base.rules,
    };
  }
  return {
    source: 'src/world/life/render/life-material.glsl.ts (vessels), src/world/osm/details/props/material.ts (moored boats)',
    sourceHash,
    inputs: {
      albedo: 'COLOR_0.rgb (linear). Paint 1: mix(albedo, instancePaint * albedo, TEXCOORD_2.x). Paint 2: albedo * accentPalette[palette]',
      roughness: 'TEXCOORD_1.x, then the slot rules, clamped to [0.04, 1]',
      metallic: 'TEXCOORD_1.y, then the slot rules',
      y: 'object-space height (m above the design waterline): the vertex position, not TEXCOORD_0',
      grime: 'mask.r of the slot map (vessel_super_mask for plain paint)',
      maps: 'sample at TEXCOORD_0 / map.tiling; offset the mask lookup per instance by the seed (the shader adds seed * 13 in noise space) so hulls differ',
    },
    instance: {
      paint: 'linear RGB of one of the variant paints (sRGB hex in the manifest), per vessel',
      seed: 'palette / 8 + weathering / 8 (the web packs it in the instance colour alpha): palette = floor(seed * 8), weathering = fract(seed * 8)',
    },
    accentPalette: accentPalette(),
    emissive: {
      night: 'night factor 0 (day) .. 1 (night), the web uniform uNight',
      lightsOn: 'smoothstep(0.1, 0.42, night); class 4: smoothstep(0.02, 0.3, night)',
      cellHash: 'h = hash13(floor(objectPos / (1.35, 2.2, 1.35)) + seed * 37.1 + 3.7) with objectPos in model metres (hash13: render/shaders/common.glsl.ts), or the pane hash (vessel_glass_mask g)',
      classes: {
        '1 cabin window': 'mix((1, 0.78, 0.52), (0.92, 0.95, 1), step(0.75, h)) * (2.6 + 1.6 * h) * step(0.07, h)',
        '2 crew window': 'mix((1, 0.8, 0.56), (0.8, 0.88, 1), step(0.8, h)) * 3 * step(0.58, h)',
        '3 lamp': '(1, 0.86, 0.66) * 24',
        '4 sign': '(0.85, 0.93, 1) * 7',
        '5 glow (moored boats)': 'albedo * TEXCOORD_3.y * mix(0.25, 5, smoothstep(0.05, 0.45, night)), also by day',
      },
      output: 'classes 1-4: emissive * lightsOn, class 5 as given (linear, the web HDR scale); classes 1 and 2 darken the albedo when lit: albedo = mix(albedo, albedo * 0.35, lightsOn)',
    },
    materials,
    textures: maps,
    normalMaps: 'glTF convention (green points to the top of the image); Unreal expects the opposite: flip the green channel on import',
  };
}
