import * as THREE from 'three';
import { CLOUD_CONSTANTS } from './config';

const DEG = Math.PI / 180;
const R = CLOUD_CONSTANTS.planetRadius;
const ATMOSPHERE_TOP = 80_000;
/** Scattering/absorption coefficients at sea level (1/m), RGB ~ 680/550/440 nm. Mie tuned for Istanbul haze. */
const BETA_RAYLEIGH = [5.8e-6, 13.5e-6, 33.1e-6];
const BETA_MIE_EXT = 2.4e-5;
const BETA_OZONE = [0.65e-6, 1.881e-6, 0.085e-6];
const H_RAYLEIGH = 8000;
const H_MIE = 1300;
/** Representative altitude of the lit cumulus tops (m). */
const CLOUD_LIGHT_ALTITUDE = 2300;
/** Default top-of-atmosphere sun irradiance scale until calibrated against the sky's sun colour. */
const DEFAULT_SUN_SCALE = 5.2;

/** Transmittance of sunlight reaching a point at `altitude` from a sun at `elevation` (rad). */
export function sunTransmittance(elevation: number, altitude: number, out: number[]): void {
  const r0 = R + altitude;
  const dx = Math.cos(elevation);
  const dy = Math.sin(elevation);
  // Ray p(t) = (t*dx, r0 + t*dy) in the plane containing the Earth centre (0,0).
  const b = r0 * dy;
  const cTop = r0 * r0 - (R + ATMOSPHERE_TOP) ** 2;
  const tTop = -b + Math.sqrt(Math.max(b * b - cTop, 0));
  const cGround = r0 * r0 - R * R;
  const discGround = b * b - cGround;
  if (discGround > 0 && -b - Math.sqrt(discGround) > 0) {
    out[0] = out[1] = out[2] = 0;
    return;
  }
  const steps = 160;
  let odR = 0;
  let odM = 0;
  let odO = 0;
  let prevT = 0;
  for (let i = 1; i <= steps; i++) {
    const s = i / steps;
    const t = tTop * s * s;
    const tm = (t + prevT) * 0.5;
    const dt = t - prevT;
    prevT = t;
    const px = tm * dx;
    const py = r0 + tm * dy;
    const h = Math.sqrt(px * px + py * py) - R;
    odR += Math.exp(-h / H_RAYLEIGH) * dt;
    odM += Math.exp(-h / H_MIE) * dt;
    odO += Math.max(0, 1 - Math.abs(h - 25_000) / 15_000) * dt;
  }
  for (let c = 0; c < 3; c++) {
    out[c] = Math.exp(-(BETA_RAYLEIGH[c] * odR + BETA_MIE_EXT * odM + BETA_OZONE[c] * odO));
  }
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export interface CloudLightInputs {
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  moonDir: THREE.Vector3;
  night: number;
}

/**
 * Derives the cloud key light (sun at cloud altitude, incl. post-sunset pink tops via the Earth's
 * shadow, or the moon), ambient sky light and city glow from the environment state. CPU cost ~µs.
 */
export class CloudLighting {
  readonly lightDir = new THREE.Vector3(0, 1, 0);
  readonly lightColor = new THREE.Color();
  /** Multiplier on the shader's sky ambient (skyRadiance). */
  readonly ambientTop = new THREE.Color(1, 1, 1);
  /** Ground-bounce radiance added at cloud bases. */
  readonly ambientBottom = new THREE.Color();
  readonly glowColor = new THREE.Color();
  /** Altitude (m) below which the key light is hidden by the Earth. */
  earthShadowAltitude = -1e5;
  /** Artistic multiplier on the sky ambient seen by clouds. */
  ambientScale = 1;
  private sunScale = DEFAULT_SUN_SCALE;
  private cachedElevation = Number.NaN;
  private readonly tCloud = [1, 1, 1];
  private readonly tGround = [1, 1, 1];
  private readonly skyRgb = [0, 0, 0];

  update(env: CloudLightInputs): void {
    const sunDir = env.sunDir;
    const elevation = Math.asin(THREE.MathUtils.clamp(sunDir.y, -1, 1));
    const refracted = elevation + 0.45 * DEG;
    this.earthShadowAltitude = refracted >= 0 ? -1e5 : R * (1 / Math.cos(refracted) - 1);

    if (!(Math.abs(elevation - this.cachedElevation) <= 0.0002)) {
      this.cachedElevation = elevation;
      const litAltitude = Math.max(CLOUD_LIGHT_ALTITUDE, this.earthShadowAltitude + 1200);
      sunTransmittance(refracted, litAltitude, this.tCloud);
      sunTransmittance(Math.max(refracted, 0.2 * DEG), 0, this.tGround);
    }

    const sc = env.sunColor;
    const groundLum = luminance(this.tGround[0], this.tGround[1], this.tGround[2]);
    const skyLum = luminance(sc.r, sc.g, sc.b);
    if (elevation > 4 * DEG && groundLum > 1e-3 && skyLum > 1e-3) {
      this.sunScale += (skyLum / groundLum - this.sunScale) * 0.1;
    }

    const sunVisible = THREE.MathUtils.smoothstep(elevation, -5 * DEG, -3.5 * DEG);
    if (sunVisible > 0) {
      this.lightDir.copy(sunDir);
      const k = this.sunScale;
      // Above ~6 deg follow the sky's sun colour (boosted for the thinner air below the cloud); below it,
      // use the transmittance model so tops stay lit (red/pink) after ground-level sunset.
      const follow = THREE.MathUtils.smoothstep(elevation, 2 * DEG, 8 * DEG);
      const skyRgb = this.skyRgb;
      sc.toArray(skyRgb);
      for (let c = 0; c < 3; c++) {
        const model = k * this.tCloud[c];
        const ratio = this.tGround[c] > 1e-4 ? Math.min(this.tCloud[c] / this.tGround[c], 3) : 1;
        skyRgb[c] = THREE.MathUtils.lerp(model, skyRgb[c] * ratio, follow) * sunVisible;
      }
      this.lightColor.fromArray(skyRgb);
    } else {
      this.lightDir.copy(env.moonDir);
      const moonUp = THREE.MathUtils.smoothstep(env.moonDir.y, -0.03, 0.2);
      this.lightColor.setRGB(0.028, 0.033, 0.042).multiplyScalar(moonUp * THREE.MathUtils.clamp(env.night, 0, 1));
      this.earthShadowAltitude = -1e5;
    }

    const day = 1 - THREE.MathUtils.clamp(env.night, 0, 1);
    const sunUp = Math.max(sunDir.y, 0);
    // Sky ambient itself comes from skyRadiance() in the shader; this only scales it.
    this.ambientTop.setScalar(this.ambientScale);
    // Sunlight bounced off the ground/sea (albedo ~0.1, /pi) lighting cloud bases from below.
    this.ambientBottom.setRGB(sc.r * 0.03, sc.g * 0.03, sc.b * 0.028).multiplyScalar(sunUp * day);
    // City light pollution on cloud bases at night: Istanbul's mix of high-pressure sodium and warm-white LED reads
    // as a warm beige-orange (not the saturated sodium orange, which turns mauve against the blue moonlit sky).
    const glow = THREE.MathUtils.smoothstep(env.night, 0.35, 0.95);
    this.glowColor.setRGB(0.1, 0.07, 0.042).multiplyScalar(glow);
  }
}
