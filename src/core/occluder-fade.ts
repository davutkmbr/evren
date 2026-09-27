import * as THREE from 'three';

/**
 * Occluder fade: everything between the camera and a subject (the perched dragon) is dithered out, so trees, OSM
 * buildings, street props and the perch's own structure never hide the subject. The camera rigs keep the eye out of
 * the collision world, but trees, facade details and most buildings are not in it; this is the generic answer for
 * those. The test runs in every built-in material's fragment shader (installGlobalShaderHooks puts it after three's
 * clipping chunk, next to the street hole test), so shadows are unaffected (depth materials have no fog chunk).
 *
 * The faded volume is a cone around the segment from the eye to the subject: `uOccluderEye.w` wide at the eye,
 * `uOccluderSubject.w` wide at the subject, ending `uOccluderEnd.x` m before the subject's centre (its body and the
 * grip under it stay), and scaled by `uOccluderEnd.y` (0 = off, eased in and out by the camera system).
 * Materials that must never be cut (the dragon and its rider, the terrain) call keepThroughOccluderFade().
 */
export const occluderUniforms = {
  uOccluderEye: { value: new THREE.Vector4(0, 0, 0, 1) },
  uOccluderSubject: { value: new THREE.Vector4(0, 0, 0, 6) },
  uOccluderEnd: { value: new THREE.Vector2(8, 0) },
};

/** Declarations (inside USE_FOG: the test reads the fog chunk's world position). */
export const OCCLUDER_FADE_PARS_GLSL = /* glsl */ `
#ifndef OCCLUDER_KEEP
  uniform vec4 uOccluderEye;
  uniform vec4 uOccluderSubject;
  uniform vec2 uOccluderEnd;
#endif
`;

/** The test itself: discards the fragment where the fade beats a per-pixel dither. */
export const OCCLUDER_FADE_GLSL = /* glsl */ `
#if defined(USE_FOG) && !defined(OCCLUDER_KEEP) && !defined(OCCLUDER_FADE_DONE)
  #define OCCLUDER_FADE_DONE
  if (uOccluderEnd.y > 0.001) {
    vec3 occD = uOccluderSubject.xyz - uOccluderEye.xyz;
    float occL = max(length(occD), 1e-3);
    vec3 occDir = occD / occL;
    vec3 occP = vFogWorldPos - uOccluderEye.xyz;
    float occS = dot(occP, occDir);
    float occStop = occL - uOccluderEnd.x;
    if (occS > 0.0 && occS < occStop) {
      float occT = occS / occL;
      float occR = mix(uOccluderEye.w, uOccluderSubject.w, occT);
      float occDist = length(occP - occDir * occS);
      // Soft edge across the cone's rim, and along its last metres before the subject.
      float occFade = (1.0 - smoothstep(occR * 0.55, occR, occDist)) * smoothstep(0.0, 2.0, occStop - occS);
      occFade *= uOccluderEnd.y;
      // Interleaved gradient noise: a stable screen-space dither.
      float occNoise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      if (occFade * 0.92 > occNoise) discard;
    }
  }
#endif
`;

/** Keeps a material whole inside the occluder fade (the subject itself, the ground). */
export function keepThroughOccluderFade<T extends THREE.Material>(material: T): T {
  material.defines = { ...(material.defines ?? {}), OCCLUDER_KEEP: 1 };
  material.needsUpdate = true;
  return material;
}

/**
 * Sets the faded cone for this frame: eye and subject positions, the cone radius at each end, how far before the
 * subject's centre it stops, and the strength (0 turns it off).
 */
export function setOccluderFade(eye: THREE.Vector3, subject: THREE.Vector3, eyeRadius: number, subjectRadius: number, stopBefore: number, strength: number): void {
  occluderUniforms.uOccluderEye.value.set(eye.x, eye.y, eye.z, eyeRadius);
  occluderUniforms.uOccluderSubject.value.set(subject.x, subject.y, subject.z, subjectRadius);
  occluderUniforms.uOccluderEnd.value.set(stopBefore, strength);
}

/** Turns the fade off. */
export function clearOccluderFade(): void {
  occluderUniforms.uOccluderEnd.value.y = 0;
}
