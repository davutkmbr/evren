/**
 * Headless scene budget (phase 01, performance): builds as much of the world scene as Node can without WebGL (the
 * real geo, terrain selection, city streamer + tile builder, vegetation placement + tree generator, mosque /
 * structure / heritage generators) and reports per module and probe camera the triangles and draw calls of the main,
 * shadow and planar-reflection passes, the CPU time of each module's per-frame work, program counts and texture
 * memory estimates. Totals are compared with the phase 01 targets and the biggest offenders listed.
 *
 *   npx tsx tools/headless/scene-budget.ts              all modules, all probe views, "high" preset
 *   npx tsx tools/headless/scene-budget.ts --only=city,terrain --views=karakoy
 *   npx tsx tools/headless/scene-budget.ts --json=.shots/budget/scene-budget.json
 *   npx tsx tools/headless/scene-budget.ts --only=city --no-shadow-top      city shadows without the cascade height cull
 *
 * Numbers are estimates of what the renderer submits (object-level frustum culling as three.js does it, shadow
 * cascades approximated by view-distance slices). GPU time, overdraw and shader cost are not measured here.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildHeadlessGeo } from './geo';
import { globalUniforms } from '../../src/core/uniforms';
import { PROBE_VIEWS, qualityHigh, type ModuleReport, type ProbeContext } from './budget/common';
import { probeTerrain } from './budget/terrain';
import { probeCity } from './budget/city';
import { probeVegetation } from './budget/vegetation';
import { probeHeritage, probeMosques, probeStructures } from './budget/landmarks';
import { probeClouds, probePost, probeSky } from './budget/render';

/**
 * Phase 01 targets on "high" (1600x900, M2 Max, dynamic resolution >= 0.9). The plan measured the whole frame at
 * 4-8 M triangles and 210-300 draw calls with dynamic resolution at its 0.75 floor; >= 0.9 needs roughly a third less
 * GPU work, so the whole-frame envelope is ~5 M triangles / ~220 draws (all passes: main + shadow cascades + planar
 * reflection). The modules probed here (terrain, city, vegetation, mosques, structures, heritage, sky, clouds, post)
 * get the budgets below; water, the OSM slice, city walls, life, fx and the dragon share the remainder.
 */
export const TARGETS = {
  trianglesAllPasses: 4_000_000,
  trianglesMain: 2_500_000,
  drawCallsAllPasses: 160,
  /** CPU budget (ms) of all world-module per-frame work together. */
  cpuMs: 3,
  /** Per-module triangle budgets (all passes) used to name offenders. */
  moduleTriangles: {
    terrain: 900_000,
    city: 1_600_000,
    vegetation: 900_000,
    mosques: 250_000,
    structures: 250_000,
    heritage: 250_000,
    sky: 50_000,
  } as Record<string, number>,
};

type Probe = (pc: ProbeContext) => ModuleReport;
const PROBES: Record<string, Probe> = {
  terrain: probeTerrain,
  city: probeCity,
  vegetation: probeVegetation,
  mosques: probeMosques,
  structures: probeStructures,
  heritage: probeHeritage,
  sky: probeSky,
  clouds: probeClouds,
  post: probePost,
};

function arg(name: string): string | undefined {
  const a = process.argv.find((s) => s.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : undefined;
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) {
    return '-';
  }
  if (n >= 1e6) {
    return `${(n / 1e6).toFixed(2)}M`;
  }
  if (n >= 1e4) {
    return `${(n / 1e3).toFixed(0)}k`;
  }
  return `${Math.round(n)}`;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function lpad(s: string, n: number): string {
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

function main(): void {
  const only = arg('only')?.split(',');
  const viewIds = arg('views')?.split(',');
  const views = PROBE_VIEWS.filter((v) => !viewIds || viewIds.includes(v.id));
  const t0 = performance.now();
  const geo = buildHeadlessGeo();
  console.log(`geo ready in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  // Phase 01 contract checks that need no GPU: the shared GLSL samplers have their globals registered as soon as the
  // shader chunk module loads (sky atmosphere globals: synchronous registration, never a late dynamic import).
  const missing = ['uSkyViewLUT', 'uAtmoState', 'uAtmoGround', 'uKeyLightDir', 'uKeyLightColor', 'uKeyLightRatio', 'uCloudShadowMap', 'uCloudShadowXform'].filter(
    (n) => !globalUniforms[n] || globalUniforms[n].value === null || globalUniforms[n].value === undefined,
  );
  console.log(`contract: shared GLSL globals ${missing.length === 0 ? 'registered at load' : `MISSING ${missing.join(', ')}`}`);
  if (missing.length > 0) {
    process.exitCode = 1;
  }
  const pc: ProbeContext = { geo, quality: qualityHigh(), views };
  const reports: ModuleReport[] = [];
  for (const [name, probe] of Object.entries(PROBES)) {
    if (only && !only.includes(name)) {
      continue;
    }
    const t = performance.now();
    reports.push(probe(pc));
    console.log(`probed ${name} in ${((performance.now() - t) / 1000).toFixed(1)} s`);
  }

  console.log('\nScene budget, preset "high" (tris / draws per pass; cpu = per-frame module work)\n');
  for (const v of views) {
    console.log(`== ${v.id}: ${v.label}`);
    console.log(`   ${pad('module', 11)}${lpad('main tris', 10)}${lpad('draws', 7)}${lpad('shadow', 10)}${lpad('draws', 7)}${lpad('refl', 10)}${lpad('draws', 7)}${lpad('all tris', 10)}${lpad('cpu ms', 8)}  detail`);
    const total = { main: 0, mainDraws: 0, shadow: 0, shadowDraws: 0, refl: 0, reflDraws: 0, cpu: 0 };
    for (const r of reports) {
      const m = r.views[v.id];
      if (!m) {
        continue;
      }
      const all = m.main.tris + m.shadow.tris + m.reflection.tris;
      total.main += m.main.tris;
      total.mainDraws += m.main.draws;
      total.shadow += m.shadow.tris;
      total.shadowDraws += m.shadow.draws;
      total.refl += m.reflection.tris;
      total.reflDraws += m.reflection.draws;
      total.cpu += m.cpuMs;
      const detail = Object.entries(m.detail)
        .map(([k, val]) => `${k}=${typeof val === 'number' ? fmt(val) : val}`)
        .join(' ');
      console.log(
        `   ${pad(r.module, 11)}${lpad(fmt(m.main.tris), 10)}${lpad(String(m.main.draws), 7)}${lpad(fmt(m.shadow.tris), 10)}${lpad(String(m.shadow.draws), 7)}${lpad(fmt(m.reflection.tris), 10)}${lpad(String(m.reflection.draws), 7)}${lpad(fmt(all), 10)}${lpad(m.cpuMs.toFixed(3), 8)}  ${detail}`,
      );
    }
    const all = total.main + total.shadow + total.refl;
    const draws = total.mainDraws + total.shadowDraws + total.reflDraws;
    console.log(
      `   ${pad('TOTAL', 11)}${lpad(fmt(total.main), 10)}${lpad(String(total.mainDraws), 7)}${lpad(fmt(total.shadow), 10)}${lpad(String(total.shadowDraws), 7)}${lpad(fmt(total.refl), 10)}${lpad(String(total.reflDraws), 7)}${lpad(fmt(all), 10)}${lpad(total.cpu.toFixed(3), 8)}`,
    );
    const verdict = (ok: boolean): string => (ok ? 'ok' : 'OVER');
    console.log(
      `   targets: all-pass tris ${fmt(all)} / ${fmt(TARGETS.trianglesAllPasses)} ${verdict(all <= TARGETS.trianglesAllPasses)}, main tris ${fmt(total.main)} / ${fmt(TARGETS.trianglesMain)} ${verdict(total.main <= TARGETS.trianglesMain)}, draws ${draws} / ${TARGETS.drawCallsAllPasses} ${verdict(draws <= TARGETS.drawCallsAllPasses)}, cpu ${total.cpu.toFixed(2)} / ${TARGETS.cpuMs} ms ${verdict(total.cpu <= TARGETS.cpuMs)}\n`,
    );
  }

  console.log('Per module: programs, texture memory, retained geometry, worst view vs module budget');
  const offenders: { module: string; view: string; tris: number; over: number }[] = [];
  for (const r of reports) {
    let worst = 0;
    let worstView = '';
    for (const [id, m] of Object.entries(r.views)) {
      const all = m.main.tris + m.shadow.tris + m.reflection.tris;
      if (all > worst) {
        worst = all;
        worstView = id;
      }
    }
    const budget = TARGETS.moduleTriangles[r.module] ?? Infinity;
    offenders.push({ module: r.module, view: worstView, tris: worst, over: worst / budget });
    console.log(
      `   ${pad(r.module, 11)} programs ${lpad(String(r.materials), 3)}  textures ${lpad(r.textureMB.toFixed(0), 5)} MB  geometry ${lpad(r.geometryMB !== undefined ? r.geometryMB.toFixed(0) : '-', 5)} MB  worst ${fmt(worst)} (${worstView}) / budget ${fmt(budget)}`,
    );
    for (const n of r.notes) {
      console.log(`      - ${n}`);
    }
  }
  offenders.sort((a, b) => b.over - a.over);
  console.log('\nBiggest offenders (worst view, all passes, relative to the module budget):');
  for (const o of offenders.slice(0, 5)) {
    console.log(`   ${pad(o.module, 11)} ${fmt(o.tris)} at ${o.view} (${(o.over * 100).toFixed(0)} % of budget)`);
  }

  const json = arg('json');
  if (json) {
    mkdirSync(dirname(json), { recursive: true });
    writeFileSync(json, JSON.stringify({ preset: 'high', targets: TARGETS, views, reports }, null, 1));
    console.log(`\nwrote ${json}`);
  }
}

main();
