import { COMMON_GLSL } from './common.glsl';
import { ATMOSPHERE_GLSL } from './atmosphere.glsl';
import { CLOUD_SHADOW_GLSL } from './cloudshadow.glsl';
import { LIGHT_SPLAT_GLSL } from './light-splat.glsl';

/**
 * Prepend to every custom fragment/vertex shader that needs globals:
 * uniforms (uTime, uSunDir, uSunColor, uAmbient, uNight, uCamPos...), noise, linearDepth(),
 * applyAtmosphere(color, worldPos), skyRadiance(dir), cloudShadow(worldPos), lightSplatMinSize() / lightSplatEnergy().
 * The matching uniform values are injected automatically (see core/uniforms.ts).
 */
export const SHARED_GLSL = `${COMMON_GLSL}\n${ATMOSPHERE_GLSL}\n${CLOUD_SHADOW_GLSL}\n${LIGHT_SPLAT_GLSL}\n`;

export { COMMON_GLSL, ATMOSPHERE_GLSL, CLOUD_SHADOW_GLSL, LIGHT_SPLAT_GLSL };
