import { COMMON_GLSL } from '../../../render/shaders';
import { LOD_COUNT } from '../config';
import { HEIGHT_GLSL } from './height.glsl';

/** Declarations prepended to the terrain vertex shader (after three's <common>). */
export const VERTEX_PARS_GLSL = /* glsl */ `
${COMMON_GLSL}
${HEIGHT_GLSL}
attribute vec4 aPatch;
uniform vec2 uLodMorph[${LOD_COUNT}];
uniform vec3 uLodCamera;
uniform float uPatchQuads;
varying vec3 vTerrainPos;
varying float vTerrainLod;
`;

/**
 * Replaces <beginnormal_vertex>: places the grid vertex (CDLOD geomorph toward the parent grid), samples the
 * elevation and provides a coarse normal for the shadow normal offset. Lighting normals are rebuilt per pixel.
 */
export const VERTEX_TERRAIN_GLSL = /* glsl */ `
vec2 terrainGrid = position.xz;
float terrainQuad = aPatch.z / uPatchQuads;
vec2 terrainXZ = aPatch.xy + terrainGrid * terrainQuad;
float terrainH0 = terrainHeight(terrainXZ);
float terrainDist = distance(uLodCamera, vec3(terrainXZ.x, terrainH0, terrainXZ.y));
vec2 terrainMorphWin = uLodMorph[int(aPatch.w + 0.5)];
float terrainMorph = clamp((terrainDist - terrainMorphWin.x) * terrainMorphWin.y, 0.0, 1.0);
terrainGrid -= fract(terrainGrid * 0.5) * 2.0 * terrainMorph;
terrainXZ = aPatch.xy + terrainGrid * terrainQuad;
float terrainY = terrainHeight(terrainXZ);
vec3 terrainWorld = vec3(terrainXZ.x, terrainY, terrainXZ.y);
vTerrainPos = terrainWorld;
vTerrainLod = aPatch.w + terrainMorph;
float terrainE = max(terrainQuad, GEO_CELL);
vec3 objectNormal = normalize(vec3(
  terrainHeight(terrainXZ - vec2(terrainE, 0.0)) - terrainHeight(terrainXZ + vec2(terrainE, 0.0)),
  2.0 * terrainE,
  terrainHeight(terrainXZ - vec2(0.0, terrainE)) - terrainHeight(terrainXZ + vec2(0.0, terrainE))));
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(1.0, 0.0, 0.0);
#endif
`;

export const VERTEX_BEGIN_GLSL = /* glsl */ `
vec3 transformed = terrainWorld;
`;
