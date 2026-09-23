/**
 * FXAA 3.11 (Timothy Lottes), PC quality path, preset 39 (12 search steps, 1-pixel steps near the pixel).
 * Input: display-encoded colour with perceptual luma in alpha (written by the composite pass).
 */
export const FXAA_FRAG = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 uTexel;
varying vec2 vUv;

#define FXAA_SUBPIX 0.75
#define FXAA_EDGE_THRESHOLD 0.125
#define FXAA_EDGE_THRESHOLD_MIN 0.0312

float lumaAt(vec2 uv) { return textureLod(tSource, uv, 0.0).a; }
float lumaOff(vec2 uv, vec2 o) { return textureLod(tSource, uv + o * uTexel, 0.0).a; }

void main() {
  const float STEPS[12] = float[12](1.0, 1.0, 1.0, 1.0, 1.0, 1.5, 2.0, 2.0, 2.0, 2.0, 4.0, 8.0);
  vec2 posM = vUv;
  vec4 rgbyM = textureLod(tSource, posM, 0.0);
  float lumaM = rgbyM.a;
  float lumaS = lumaOff(posM, vec2(0.0, 1.0));
  float lumaE = lumaOff(posM, vec2(1.0, 0.0));
  float lumaN = lumaOff(posM, vec2(0.0, -1.0));
  float lumaW = lumaOff(posM, vec2(-1.0, 0.0));

  float maxSM = max(lumaS, lumaM);
  float minSM = min(lumaS, lumaM);
  float maxESM = max(lumaE, maxSM);
  float minESM = min(lumaE, minSM);
  float maxWN = max(lumaN, lumaW);
  float minWN = min(lumaN, lumaW);
  float rangeMax = max(maxWN, maxESM);
  float rangeMin = min(minWN, minESM);
  float range = rangeMax - rangeMin;
  if (range < max(FXAA_EDGE_THRESHOLD_MIN, rangeMax * FXAA_EDGE_THRESHOLD)) {
    gl_FragColor = rgbyM;
    return;
  }

  float lumaNW = lumaOff(posM, vec2(-1.0, -1.0));
  float lumaSE = lumaOff(posM, vec2(1.0, 1.0));
  float lumaNE = lumaOff(posM, vec2(1.0, -1.0));
  float lumaSW = lumaOff(posM, vec2(-1.0, 1.0));

  float lumaNS = lumaN + lumaS;
  float lumaWE = lumaW + lumaE;
  float subpixRcpRange = 1.0 / range;
  float subpixNSWE = lumaNS + lumaWE;
  float edgeHorz1 = -2.0 * lumaM + lumaNS;
  float edgeVert1 = -2.0 * lumaM + lumaWE;
  float lumaNESE = lumaNE + lumaSE;
  float lumaNWNE = lumaNW + lumaNE;
  float edgeHorz2 = -2.0 * lumaE + lumaNESE;
  float edgeVert2 = -2.0 * lumaN + lumaNWNE;
  float lumaNWSW = lumaNW + lumaSW;
  float lumaSWSE = lumaSW + lumaSE;
  float edgeHorz4 = abs(edgeHorz1) * 2.0 + abs(edgeHorz2);
  float edgeVert4 = abs(edgeVert1) * 2.0 + abs(edgeVert2);
  float edgeHorz3 = -2.0 * lumaW + lumaNWSW;
  float edgeVert3 = -2.0 * lumaS + lumaSWSE;
  float edgeHorz = abs(edgeHorz3) + edgeHorz4;
  float edgeVert = abs(edgeVert3) + edgeVert4;
  float subpixNWSWNESE = lumaNWSW + lumaNESE;
  float lengthSign = uTexel.x;
  bool horzSpan = edgeHorz >= edgeVert;
  float subpixA = subpixNSWE * 2.0 + subpixNWSWNESE;
  if (!horzSpan) { lumaN = lumaW; lumaS = lumaE; }
  if (horzSpan) { lengthSign = uTexel.y; }
  float subpixB = subpixA * (1.0 / 12.0) - lumaM;
  float gradientN = lumaN - lumaM;
  float gradientS = lumaS - lumaM;
  float lumaNN = lumaN + lumaM;
  float lumaSS = lumaS + lumaM;
  bool pairN = abs(gradientN) >= abs(gradientS);
  float gradient = max(abs(gradientN), abs(gradientS));
  if (pairN) { lengthSign = -lengthSign; }
  float subpixC = clamp(abs(subpixB) * subpixRcpRange, 0.0, 1.0);

  vec2 posB = posM;
  vec2 offNP = horzSpan ? vec2(uTexel.x, 0.0) : vec2(0.0, uTexel.y);
  if (!horzSpan) { posB.x += lengthSign * 0.5; }
  if (horzSpan) { posB.y += lengthSign * 0.5; }
  vec2 posN = posB - offNP * STEPS[0];
  vec2 posP = posB + offNP * STEPS[0];
  float subpixD = -2.0 * subpixC + 3.0;
  float lumaEndN = lumaAt(posN);
  float subpixE = subpixC * subpixC;
  float lumaEndP = lumaAt(posP);
  if (!pairN) { lumaNN = lumaSS; }
  float gradientScaled = gradient * 0.25;
  float lumaMM = lumaM - lumaNN * 0.5;
  float subpixF = subpixD * subpixE;
  bool lumaMLTZero = lumaMM < 0.0;
  lumaEndN -= lumaNN * 0.5;
  lumaEndP -= lumaNN * 0.5;
  bool doneN = abs(lumaEndN) >= gradientScaled;
  bool doneP = abs(lumaEndP) >= gradientScaled;
  if (!doneN) { posN -= offNP * STEPS[1]; }
  if (!doneP) { posP += offNP * STEPS[1]; }
  bool doneNP = !doneN || !doneP;
  for (int i = 2; i < 12; i++) {
    if (!doneNP) { break; }
    if (!doneN) { lumaEndN = lumaAt(posN) - lumaNN * 0.5; }
    if (!doneP) { lumaEndP = lumaAt(posP) - lumaNN * 0.5; }
    doneN = abs(lumaEndN) >= gradientScaled;
    doneP = abs(lumaEndP) >= gradientScaled;
    if (!doneN) { posN -= offNP * STEPS[i]; }
    if (!doneP) { posP += offNP * STEPS[i]; }
    doneNP = !doneN || !doneP;
  }

  float dstN = horzSpan ? posM.x - posN.x : posM.y - posN.y;
  float dstP = horzSpan ? posP.x - posM.x : posP.y - posM.y;
  bool goodSpanN = (lumaEndN < 0.0) != lumaMLTZero;
  bool goodSpanP = (lumaEndP < 0.0) != lumaMLTZero;
  float spanLength = dstP + dstN;
  bool directionN = dstN < dstP;
  float dst = min(dstN, dstP);
  bool goodSpan = directionN ? goodSpanN : goodSpanP;
  float subpixG = subpixF * subpixF;
  float pixelOffset = dst * (-1.0 / spanLength) + 0.5;
  float subpixH = subpixG * FXAA_SUBPIX;
  float pixelOffsetGood = goodSpan ? pixelOffset : 0.0;
  float pixelOffsetSubpix = max(pixelOffsetGood, subpixH);
  if (!horzSpan) { posM.x += pixelOffsetSubpix * lengthSign; }
  if (horzSpan) { posM.y += pixelOffsetSubpix * lengthSign; }
  gl_FragColor = vec4(textureLod(tSource, posM, 0.0).rgb, lumaM);
}
`;
