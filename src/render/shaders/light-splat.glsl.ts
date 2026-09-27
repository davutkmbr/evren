/**
 * Small emissive lights drawn as screen-space splats (street lamp heads, beacons, head / tail lights, navigation
 * lights). A splat whose Gaussian core is narrower than about a pixel aliases: its brightest pixel depends on where
 * the light falls between pixel centres (a light on a pixel corner loses ~80 % of its peak with a 0.4 px core), so
 * distant lights dim to near black and back as the camera moves. Rule: the core's sigma never drops below
 * LIGHT_SPLAT_MIN_SIGMA pixels, and a light drawn wider than it would look is dimmed by the area ratio, so its energy
 * (what the eye sees of a dot) is unchanged. Flicker audit: .docs/planning/flicker-audit.md.
 */
export const LIGHT_SPLAT_GLSL = /* glsl */ `
#define LIGHT_SPLAT_MIN_SIGMA 0.9

/* Smallest splat size (px) whose core keeps LIGHT_SPLAT_MIN_SIGMA: the splat spans size * spread pixels and its core
   is exp(-k r^2) with r = 1 at the splat's edge, i.e. sigma = size * spread / (2 sqrt(2 k)). */
float lightSplatMinSize(float spread, float k) {
  return LIGHT_SPLAT_MIN_SIGMA * 2.0 * sqrt(2.0 * k) / spread;
}

/* Intensity factor of a light that would look \`look\` px wide but is drawn \`drawn\` px wide (energy preserved). */
float lightSplatEnergy(float look, float drawn) {
  float k = look / max(drawn, 1e-4);
  return k * k;
}
`;
