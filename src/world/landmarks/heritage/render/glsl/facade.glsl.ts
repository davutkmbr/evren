import { FACADE_BASE, FACADE_STYLES, Surf } from '../../build/surfaces';

const f = (n: number): string => {
  const s = n.toFixed(4);
  return s.includes('.') ? s : `${s}.0`;
};
const arr = (name: string, pick: (i: number) => number): string =>
  `const float ${name}[${FACADE_STYLES.length}] = float[${FACADE_STYLES.length}](${FACADE_STYLES.map((_, i) => f(pick(i))).join(', ')});`;

/**
 * Facade window grids (table generated from FACADE_STYLES) and the per-surface dispatch with night lighting.
 * The window zone's u starts at 0 on the first bay (see facadeWalls) and v = 0 at the facade base.
 */
export const FACADE_GLSL = /* glsl */ `
${arr('FS_BASE', (i) => FACADE_STYLES[i].base)}
${arr('FS_SPACING', (i) => FACADE_STYLES[i].spacing)}
${arr('FS_WINW', (i) => FACADE_STYLES[i].winW)}
${arr('FS_WINH', (i) => FACADE_STYLES[i].winH)}
${arr('FS_FLOORH', (i) => FACADE_STYLES[i].floorH)}
${arr('FS_SILL', (i) => FACADE_STYLES[i].sill)}
${arr('FS_ROWS', (i) => FACADE_STYLES[i].rows)}
${arr('FS_ARCH', (i) => FACADE_STYLES[i].arch)}
${arr('FS_FRAME', (i) => FACADE_STYLES[i].frame)}
${arr('FS_MULL', (i) => FACADE_STYLES[i].mullion)}
${arr('FS_LIT', (i) => FACADE_STYLES[i].lit)}
${arr('FS_SURR', (i) => FACADE_STYLES[i].surround)}
${arr('FS_PIL', (i) => FACADE_STYLES[i].pilaster)}

float hLightsOn() { return smoothstep(0.06, 0.5, uNight); }

HS hBase(float id, vec2 p, vec3 wp, vec3 tint, float w, float hag, float vert, float fw) {
  if (id < 0.5) return hPlaster(p, wp, tint, w, hag, vert, fw);
  if (id < ${Surf.Ashlar}.5) return hAshlar(p, wp, tint, w, hag, vert, fw);
  if (id < ${Surf.Byzantine}.5) return hByzantine(p, wp, tint, w, hag, vert, fw);
  if (id < ${Surf.Rubble}.5) return hRubble(p, wp, tint, w, hag, vert, fw);
  if (id < ${Surf.Marble}.5) return hMarble(p, wp, tint, w, hag, vert, fw);
  if (id < ${Surf.Brick}.5) return hBrick(p, wp, tint, w, hag, vert, fw);
  return hBanded(p, wp, tint, w, hag, vert, fw);
}

/* Signed distance to the window outline (negative inside); lx centred, ly from the sill. */
float hWindowSdf(float lx, float ly, float hw, float wh, float arch) {
  float d = max(abs(lx) - hw, -ly);
  if (arch < 0.5) {
    return max(d, ly - wh);
  }
  if (arch < 1.5) {
    float yr = wh - hw;
    return ly > yr ? max(d, length(vec2(lx, ly - yr)) - hw) : d;
  }
  if (arch < 2.5) {
    float rise = hw * 0.38;
    float R = (hw * hw + rise * rise) / (2.0 * rise);
    float cy = wh - R;
    return ly > cy ? max(d, length(vec2(lx, ly - cy)) - R) : d;
  }
  if (arch < 3.5) {
    float w = hw * 2.0;
    float yr = wh - w * 0.866;
    return ly > yr ? max(d, max(length(vec2(lx + hw, ly - yr)), length(vec2(lx - hw, ly - yr))) - w) : d;
  }
  float yr = wh - hw * 1.1;
  float circ = length(vec2(lx, ly - yr)) - hw * 1.12;
  return ly > yr - hw * 0.45 ? max(-ly, circ) : d;
}

HS hFacade(float fid, vec2 p, vec3 wp, vec3 tint, float w, float hag, float vert, float fw, vec3 T) {
  int si = int(fid - ${FACADE_BASE}.0 + 0.5);
  float spacing = FS_SPACING[si];
  float hw = FS_WINW[si] * 0.5;
  float wh = FS_WINH[si];
  float floorH = FS_FLOORH[si];
  float frame = FS_FRAME[si];
  HS s = hBase(FS_BASE[si], p, wp, tint, w, hag, vert, fw);
  float det = hDetail(fw, hw * 0.5);
  float bay = floor(p.x / spacing);
  float lx = (fract(p.x / spacing) - 0.5) * spacing;
  float yy = p.y - FS_SILL[si];
  float row = floor(yy / floorH);
  float ly = yy - row * floorH;
  // Pilasters between bays and string courses between floors.
  float pil = FS_PIL[si];
  if (pil > 0.0) {
    float e = abs(abs(lx) - spacing * 0.5);
    float pm = (1.0 - smoothstep(0.26 - fw, 0.26 + fw, e)) * det;
    s.height += pm * 0.03 * pil;
    s.albedo *= 1.0 + pm * 0.04 * pil;
    float sc = (1.0 - smoothstep(0.12 - fw, 0.12 + fw, abs(ly - floorH + 0.55))) * step(0.0, row) * det;
    s.height += sc * 0.04 * pil;
    s.ao *= 1.0 - sc * 0.15;
  }
  if (row < 0.0 || row > FS_ROWS[si] - 0.5) {
    return s;
  }
  float d = hWindowSdf(lx, ly, hw, wh, FS_ARCH[si]);
  float inGlass = 1.0 - smoothstep(-fw, fw, d);
  float inFrame = (1.0 - smoothstep(frame - fw, frame + fw, d)) * (1.0 - inGlass);
  float sill = step(-0.14, ly) * step(ly, 0.0) * step(abs(lx), hw + frame + 0.12);
  // Surround and sill.
  vec3 surr = s.albedo * FS_SURR[si] + vec3(0.02);
  s.albedo = mix(s.albedo, surr, max(inFrame, sill) * det);
  s.height += (inFrame * 0.025 + sill * 0.05) * det;
  // Mullions / grilles.
  float mull = FS_MULL[si];
  float bars = 0.0;
  if (mull > 0.5 && mull < 1.5) {
    bars = max(1.0 - smoothstep(0.03, 0.03 + fw, abs(lx)), 1.0 - smoothstep(0.03, 0.03 + fw, abs(ly - wh * 0.62)));
  } else if (mull > 1.5 && mull < 2.5) {
    bars = max(hGrid(lx + hw, hw, 0.05, fw), hGrid(ly, 0.55, 0.05, fw));
  } else if (mull > 2.5) {
    bars = max(hGrid(lx + hw, 0.14, 0.025, fw), hGrid(ly, 0.14, 0.025, fw)) * 0.9;
  }
  bars *= inGlass * hDetail(fw, 0.06);
  // Glass: dark interior, reveal shadow at the top and one side, per-pane variation.
  vec3 wc = wp - T * lx - vec3(0.0, ly - wh * 0.5, 0.0);
  float winId = hash13(floor(wc * 2.0 + 0.5) * 0.37 + 11.3);
  float reveal = smoothstep(0.0, 0.22, -d);
  vec3 glass = vec3(0.025, 0.028, 0.032) * (0.6 + 0.8 * winId) * mix(0.55, 1.0, reveal);
  vec3 frameCol = mull > 2.5 ? vec3(0.03) : vec3(0.55, 0.53, 0.5);
  vec3 winAlb = mix(glass, frameCol, bars);
  s.albedo = mix(s.albedo, winAlb, inGlass * mix(0.75, 1.0, det));
  s.rough = mix(s.rough, mix(0.05 + 0.08 * winId, 0.5, bars), inGlass);
  s.metal = mix(s.metal, 0.0, inGlass);
  s.height = mix(s.height, -0.06 + bars * 0.03, inGlass * det);
  s.ao *= mix(1.0, 0.7, inGlass * (1.0 - reveal));
  // Night: a fraction of rooms lit (warm, uneven), fading out late at night.
  float on = hLightsOn();
  if (on > 0.0) {
    float late = clamp((mod(uTimeOfDay - 17.0, 24.0) - 3.0) / 8.0, 0.0, 1.0);
    float litP = FS_LIT[si] * mix(1.0, 0.35, late);
    float lit = step(winId, litP);
    vec3 lc = mix(vec3(1.0, 0.62, 0.32), vec3(1.0, 0.78, 0.52), fract(winId * 7.3));
    float curtain = 0.55 + 0.45 * vnoise2(vec2(lx * 3.0, ly * 1.5) + winId * 40.0);
    s.emit += lc * lit * inGlass * (1.0 - bars * 0.8) * curtain * (1.4 + 1.6 * fract(winId * 3.7)) * on;
  }
  return s;
}
`;
