import * as THREE from 'three';
import { SHADOW_CASCADES } from './cascaded-shadow';

/**
 * Global shader-chunk patches for the key light (installed once, before any program compiles):
 * 1. SunLight cascade count 2 -> SHADOW_CASCADES, cascades packed in a 2x2 atlas with per-cascade normal-offset bias
 *    (cascade.w = texel size in metres) and an explicit tile bounds test (so reflection cameras never read a
 *    neighbouring tile).
 * 2. Height dependent key-light colour: the SunLight colour is the transmittance at 4000 m; fragments below get the
 *    extra reddening/extinction of the lower atmosphere and the planet's shadow (keyLightRatio(), SHARED_GLSL), and
 *    the clouds' shadow (cloudShadow(), owned by render/clouds) so every built-in lit material gets cloud shadows.
 */
let installed = false;

function replaceOnce(source: string, search: string, replacement: string, label: string): string {
  if (!source.includes(search)) {
    console.warn(`[sky] shader patch "${label}" did not apply (three.js chunk changed)`);
    return source;
  }
  return source.replace(search, replacement);
}

const SUN_SHADOW_OVERRIDE = /* glsl */ `
#if defined( USE_SHADOWMAP ) && NUM_SUN_LIGHT_SHADOWS > 0
	float getSunShadow(
		#if defined( SHADOWMAP_TYPE_PCF )
			sampler2DShadow shadowMap,
		#else
			sampler2D shadowMap,
		#endif
		SunLightShadow sunLightShadow,
		int shadowIndex
	) {
		float viewDepth = vSunShadowWorldPosition.w;
		int cascadeOffset = shadowIndex * SUN_LIGHT_CASCADES;
		float shadow = 1.0;
		for ( int i = SUN_LIGHT_CASCADES - 1; i >= 0; i -- ) {
			vec4 cascade = sunShadowCascade[ cascadeOffset + i ];
			if ( viewDepth >= cascade.x && viewDepth < cascade.y ) {
				vec4 worldPos = vec4( vSunShadowWorldPosition.xyz + vSunShadowWorldNormal * ( sunLightShadow.shadowNormalBias * cascade.w ), 1.0 );
				vec4 coord = sunShadowMatrix[ cascadeOffset + i ] * worldPos;
				vec2 tile = ( coord.xy / coord.w - vec2( float( i - ( i / 2 ) * 2 ), float( i / 2 ) ) * 0.5 ) * 2.0;
				float cascadeShadow = 1.0;
				if ( tile.x > 0.0 && tile.x < 1.0 && tile.y > 0.0 && tile.y < 1.0 ) {
					cascadeShadow = getShadow( shadowMap, sunLightShadow.shadowMapSize, sunLightShadow.shadowIntensity, sunLightShadow.shadowBias, sunLightShadow.shadowRadius, coord );
				}
				shadow = mix( cascadeShadow, shadow, smoothstep( cascade.z, cascade.y, viewDepth ) );
			}
		}
		return shadow;
	}
#endif
`;

export function installSkyShaderPatches(): void {
  if (installed) {
    return;
  }
  installed = true;
  if (THREE.REVISION !== '186') {
    console.warn(`[sky] shader patches target three r186 (found r${THREE.REVISION}); verify the cascaded sun shadow and key-light tint`);
  }
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;

  let shadowPars = chunks.shadowmap_pars_fragment;
  shadowPars = replaceOnce(shadowPars, '#define SUN_LIGHT_CASCADES 2', `#define SUN_LIGHT_CASCADES ${SHADOW_CASCADES}`, 'cascade count');
  shadowPars = replaceOnce(shadowPars, 'float getSunShadow(', 'float getSunShadowThree(', 'sun shadow override');
  chunks.shadowmap_pars_fragment = `${shadowPars}\n${SUN_SHADOW_OVERRIDE}`;

  chunks.lights_fragment_begin = replaceOnce(
    chunks.lights_fragment_begin,
    'getSunLightInfo( sunLight, directLight );',
    `getSunLightInfo( sunLight, directLight );
		#ifdef ATMO_KEYLIGHT_TINT
		{
			vec3 atmoWorldPos = cameraPosition + ( vec4( geometryPosition, 0.0 ) * viewMatrix ).xyz;
			directLight.color *= keyLightRatio( atmoWorldPos.y ) * cloudShadow( atmoWorldPos );
		}
		#endif`,
    'key light height tint',
  );
}
