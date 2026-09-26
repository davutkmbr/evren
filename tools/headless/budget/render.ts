/**
 * Sky, clouds and post probe. These are full-screen / fixed-size GPU passes whose cost is resolution and shader
 * bound, so the probe reports what can be known without a GPU: the sky dome and star geometry built by the real
 * classes, the per-frame pass list (draw calls) and the render-target / texture memory at the "high" internal size.
 */
import * as THREE from 'three';
import { AtmosphereLuts } from '../../../src/render/sky/luts';
import { SKY_VIEW_LUT_SIZE, TRANSMITTANCE_LUT_SIZE, MULTI_SCATTERING_LUT_SIZE } from '../../../src/render/sky/params';
import { SkyDome } from '../../../src/render/sky/sky-dome';
import { StarField } from '../../../src/render/sky/stars';
import { BASE_NOISE_SIZE, CIRRUS_SIZE, CLOUD_QUALITY_LEVELS, DETAIL_NOISE_SIZE, GLOW_SIZE, WEATHER_SIZE } from '../../../src/render/clouds/config';
import { emptyView, MB, texBytes, type ModuleReport, type ProbeContext } from './common';

function geometryTris(g: THREE.BufferGeometry): number {
  return g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
}

export function probeSky(pc: ProbeContext): ModuleReport {
  const luts = new AtmosphereLuts(SKY_VIEW_LUT_SIZE);
  const blank = new THREE.Texture();
  const dome = new SkyDome({ transmittance: luts.transmittance.texture, moon: blank, milkyWay: blank }, luts.medium);
  const stars = new StarField(luts.transmittance.texture, luts.skyView.texture, luts.medium);
  const domeTris = geometryTris(dome.mesh.geometry);
  const starCount = stars.points.geometry.attributes.position.count;
  const report: ModuleReport = {
    module: 'sky',
    // Dome, stars, env dome copy, 3 LUT programs, moon/milky-way bakes.
    materials: 8,
    textureMB:
      (texBytes(SKY_VIEW_LUT_SIZE.width, SKY_VIEW_LUT_SIZE.height, 8) +
        texBytes(TRANSMITTANCE_LUT_SIZE.width, TRANSMITTANCE_LUT_SIZE.height, 8) +
        texBytes(MULTI_SCATTERING_LUT_SIZE, MULTI_SCATTERING_LUT_SIZE, 8) +
        // Environment cube (128², 6 faces, RGBA16F, mips) + PMREM, moon and milky-way targets (~1024² RGBA16F each).
        texBytes(128, 128, 8, 6, true) * 2 +
        texBytes(1024, 512, 8) * 2 +
        // Shadow atlas: 2x2 tiles of shadowMapSize / 2 (clamped 512..2048), 32-bit depth.
        texBytes(pc.quality.shadowMapSize, pc.quality.shadowMapSize, 4)) /
      MB,
    views: {},
    notes: [
      `sky dome ${domeTris} tris, ${starCount} stars (1 point draw); LUT / environment renders are amortised (only on sun, altitude or haze change)`,
      `shadow atlas ${pc.quality.shadowMapSize}² (4 cascades on high); caster cost is booked to each module's shadow column`,
    ],
  };
  for (const v of pc.views) {
    const r = emptyView();
    r.main = { tris: domeTris, draws: 2 };
    r.reflection = { tris: domeTris, draws: 2 };
    r.detail = { dome: domeTris, starPoints: starCount };
    report.views[v.id] = r;
  }
  dome.dispose();
  stars.dispose();
  luts.dispose();
  return report;
}

export function probeClouds(pc: ProbeContext): ModuleReport {
  const level = CLOUD_QUALITY_LEVELS[(pc.quality.cloudQuality || 2) as 1 | 2 | 3];
  // High: 1600x900 at maxPixelRatio 1.5 -> 2400x1350 at render scale 1.
  const w = Math.ceil((1600 * pc.quality.maxPixelRatio) / level.divisor);
  const h = Math.ceil((900 * pc.quality.maxPixelRatio) / level.divisor);
  const lowRes = texBytes(w, h, 8, 2 + 3 + 3);
  const tex =
    texBytes(BASE_NOISE_SIZE, BASE_NOISE_SIZE, 4, BASE_NOISE_SIZE) +
    texBytes(DETAIL_NOISE_SIZE, DETAIL_NOISE_SIZE, 4, DETAIL_NOISE_SIZE) +
    texBytes(WEATHER_SIZE, WEATHER_SIZE, 4, 1, true) +
    texBytes(CIRRUS_SIZE, CIRRUS_SIZE, 4, 1, true) +
    texBytes(GLOW_SIZE, GLOW_SIZE, 4) +
    texBytes(level.shadowMapSize, level.shadowMapSize, 4, 2);
  const report: ModuleReport = {
    module: 'clouds',
    materials: 5,
    textureMB: (lowRes + tex) / MB,
    views: {},
    notes: [
      `quality ${pc.quality.cloudQuality}: march ${w}x${h} (1/${level.divisor}), ${level.steps} steps, ${level.lightSteps} light steps; shadow map ${level.shadowMapSize}²`,
      'per frame: ambient 1x1, march, temporal, composite (full res) + cloud shadow map = 5 full-screen draws; GPU cost needs the owner profile (?cloudprof=1)',
    ],
  };
  for (const v of pc.views) {
    const r = emptyView();
    r.main = { tris: 5, draws: 5 };
    r.detail = { lowRes: `${w}x${h}` };
    report.views[v.id] = r;
  }
  return report;
}

export function probePost(pc: ProbeContext): ModuleReport {
  const w = Math.round(1600 * pc.quality.maxPixelRatio);
  const h = Math.round(900 * pc.quality.maxPixelRatio);
  const msaa = pc.quality.preset === 'ultra' ? 4 : pc.quality.preset === 'high' || pc.quality.preset === 'medium' ? 2 : 0;
  // Scene target RGBA16F + float depth (+ MSAA renderbuffers), two HDR ping-pong, two LDR, bloom chain (~1/3 of a
  // half-res chain), SMAA edges + weights, output.
  const scene = texBytes(w, h, 8 + 4) * (1 + msaa);
  const ping = texBytes(w, h, 8, 2);
  const ldr = texBytes(w, h, 4, 2);
  const bloom = texBytes(w / 2, h / 2, 8) * (4 / 3);
  const smaa = texBytes(w, h, 4, 2);
  const report: ModuleReport = {
    module: 'post',
    materials: 10,
    textureMB: (scene + ping + ldr + bloom + smaa) / MB,
    views: {},
    notes: [
      `internal ${w}x${h} at render scale 1, ${msaa}x MSAA on the scene target; bloom ~6 mips down + up, metering, composite, SMAA (3 passes), output`,
      'about 20 full-screen draws per frame; cost is fill-rate bound (dynamic resolution handles it)',
    ],
  };
  for (const v of pc.views) {
    const r = emptyView();
    r.main = { tris: 20, draws: 20 };
    report.views[v.id] = r;
  }
  return report;
}
