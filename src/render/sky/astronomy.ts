import * as THREE from 'three';

/**
 * Low-precision ephemerides (Paul Schlyter, "How to compute planetary positions"; ~1-2 arcmin for the Sun and the Moon
 * including the main lunar perturbations) + topocentric lunar parallax + atmospheric refraction (Saemundsson).
 * All directions are returned in the engine's local frame: +X east, +Y up, -Z north.
 */
const DEG = Math.PI / 180;

export interface CelestialState {
  /** Unit vectors toward the apparent (refracted) Sun / Moon. */
  sunDirection: THREE.Vector3;
  moonDirection: THREE.Vector3;
  sunElevationDeg: number;
  moonElevationDeg: number;
  /** Illuminated fraction of the lunar disk 0..1 and phase angle (0 = full, PI = new). */
  moonIllumination: number;
  moonPhaseAngle: number;
  /** Apparent angular radius of the Moon (radians). */
  moonAngularRadius: number;
  /** Rotation: equatorial J2000 unit vector (x -> RA 0h, z -> north celestial pole) to local frame. */
  equatorialToLocal: THREE.Matrix3;
  /** Local sidereal time in degrees. */
  localSiderealDeg: number;
}

export function createCelestialState(): CelestialState {
  return {
    sunDirection: new THREE.Vector3(0, 1, 0),
    moonDirection: new THREE.Vector3(0, -1, 0),
    sunElevationDeg: 90,
    moonElevationDeg: -90,
    moonIllumination: 0,
    moonPhaseAngle: Math.PI,
    moonAngularRadius: 0.004521,
    equatorialToLocal: new THREE.Matrix3(),
    localSiderealDeg: 0,
  };
}

function rev(x: number): number {
  return x - Math.floor(x / 360) * 360;
}

/** Days since 2000 Jan 0.0 UT (Schlyter's epoch), valid 1900..2100. */
export function schlyterDay(year: number, dayOfYear: number, utHours: number): number {
  const y = Math.trunc(year);
  return 367 * y - Math.trunc((7 * y) / 4) + 30 + dayOfYear - 730530 + utHours / 24;
}

/** Bennett/Saemundsson refraction: true elevation (deg) -> apparent elevation (deg). */
export function refract(trueElevationDeg: number): number {
  if (trueElevationDeg < -4) {
    return trueElevationDeg;
  }
  const h = Math.max(trueElevationDeg, -1.9);
  const r = 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * DEG) / 60;
  const fade = trueElevationDeg < -1.9 ? (trueElevationDeg + 4) / 2.1 : 1;
  return trueElevationDeg + r * fade;
}

const tmpEq = new THREE.Vector3();

function equatorialUnit(raDeg: number, decDeg: number, out: THREE.Vector3): THREE.Vector3 {
  const cosDec = Math.cos(decDeg * DEG);
  return out.set(cosDec * Math.cos(raDeg * DEG), cosDec * Math.sin(raDeg * DEG), Math.sin(decDeg * DEG));
}

function setDirectionFromAltAz(out: THREE.Vector3, altDeg: number, azDeg: number): void {
  const ca = Math.cos(altDeg * DEG);
  out.set(ca * Math.sin(azDeg * DEG), Math.sin(altDeg * DEG), -ca * Math.cos(azDeg * DEG));
}

const sunAltAz = { alt: 0, az: 0 };
const moonAltAz = { alt: 0, az: 0 };

/** Local direction -> altitude/azimuth (deg). */
function altAzFromLocal(v: THREE.Vector3, out: { alt: number; az: number }): { alt: number; az: number } {
  out.alt = Math.asin(THREE.MathUtils.clamp(v.y, -1, 1)) / DEG;
  out.az = rev(Math.atan2(v.x, -v.z) / DEG);
  return out;
}

function sd(x: number): number {
  return Math.sin(x * DEG);
}

function cd(x: number): number {
  return Math.cos(x * DEG);
}

/**
 * Updates `state` for the given local civil time. `latDeg/lonDeg` observer, `utcOffset` hours.
 */
export function computeCelestial(
  state: CelestialState,
  year: number,
  dayOfYear: number,
  localHours: number,
  latDeg: number,
  lonDeg: number,
  utcOffset: number,
): void {
  const ut = localHours - utcOffset;
  const d = schlyterDay(year, dayOfYear, ut);
  const ecl = (23.4393 - 3.563e-7 * d) * DEG;

  // Sun
  const ws = rev(282.9404 + 4.70935e-5 * d);
  const es = 0.016709 - 1.151e-9 * d;
  const Ms = rev(356.047 + 0.9856002585 * d);
  const Es = Ms + (es / DEG) * Math.sin(Ms * DEG) * (1 + es * Math.cos(Ms * DEG));
  const xvS = Math.cos(Es * DEG) - es;
  const yvS = Math.sqrt(1 - es * es) * Math.sin(Es * DEG);
  const vS = Math.atan2(yvS, xvS) / DEG;
  const lonSun = rev(vS + ws);
  const xs = Math.cos(lonSun * DEG);
  const ys = Math.sin(lonSun * DEG);
  const sunRa = rev(Math.atan2(ys * Math.cos(ecl), xs) / DEG);
  const sunDec = Math.atan2(ys * Math.sin(ecl), Math.sqrt(xs * xs + (ys * Math.cos(ecl)) ** 2)) / DEG;

  // Sidereal time
  const Ls = rev(Ms + ws);
  const gmst0 = rev(Ls + 180);
  const lst = rev(gmst0 + ut * 15 + lonDeg);
  state.localSiderealDeg = lst;

  const sinL = Math.sin(lst * DEG);
  const cosL = Math.cos(lst * DEG);
  const sinP = Math.sin(latDeg * DEG);
  const cosP = Math.cos(latDeg * DEG);
  // rows: east, up, south (= -north)
  state.equatorialToLocal.set(-sinL, cosL, 0, cosP * cosL, cosP * sinL, sinP, sinP * cosL, sinP * sinL, -cosP);

  // Moon (geocentric ecliptic with perturbations)
  const N = rev(125.1228 - 0.0529538083 * d);
  const i = 5.1454;
  const w = rev(318.0634 + 0.1643573223 * d);
  const a = 60.2666;
  const e = 0.0549;
  const M = rev(115.3654 + 13.0649929509 * d);
  let E = M + (e / DEG) * Math.sin(M * DEG) * (1 + e * Math.cos(M * DEG));
  for (let k = 0; k < 5; k++) {
    E = E - (E - (e / DEG) * Math.sin(E * DEG) - M) / (1 - e * Math.cos(E * DEG));
  }
  const xv = a * (Math.cos(E * DEG) - e);
  const yv = a * Math.sqrt(1 - e * e) * Math.sin(E * DEG);
  const v = Math.atan2(yv, xv) / DEG;
  let r = Math.sqrt(xv * xv + yv * yv);
  const cN = Math.cos(N * DEG);
  const sN = Math.sin(N * DEG);
  const cvw = Math.cos((v + w) * DEG);
  const svw = Math.sin((v + w) * DEG);
  const ci = Math.cos(i * DEG);
  const xh = r * (cN * cvw - sN * svw * ci);
  const yh = r * (sN * cvw + cN * svw * ci);
  const zh = r * (svw * Math.sin(i * DEG));
  let lonM = Math.atan2(yh, xh) / DEG;
  let latM = Math.atan2(zh, Math.sqrt(xh * xh + yh * yh)) / DEG;
  const Lm = rev(N + w + M);
  const Dm = rev(Lm - Ls);
  const F = rev(Lm - N);
  lonM +=
    -1.274 * sd(M - 2 * Dm) +
    0.658 * sd(2 * Dm) -
    0.186 * sd(Ms) -
    0.059 * sd(2 * M - 2 * Dm) -
    0.057 * sd(M - 2 * Dm + Ms) +
    0.053 * sd(M + 2 * Dm) +
    0.046 * sd(2 * Dm - Ms) +
    0.041 * sd(M - Ms) -
    0.035 * sd(Dm) -
    0.031 * sd(M + Ms) -
    0.015 * sd(2 * F - 2 * Dm) +
    0.011 * sd(M - 4 * Dm);
  latM += -0.173 * sd(F - 2 * Dm) - 0.055 * sd(M - F - 2 * Dm) - 0.046 * sd(M + F - 2 * Dm) + 0.033 * sd(F + 2 * Dm) + 0.017 * sd(2 * M + F);
  r += -0.58 * cd(M - 2 * Dm) - 0.46 * cd(2 * Dm);
  const xe = Math.cos(lonM * DEG) * Math.cos(latM * DEG);
  const ye = Math.sin(lonM * DEG) * Math.cos(latM * DEG);
  const ze = Math.sin(latM * DEG);
  const moonRa = rev(Math.atan2(ye * Math.cos(ecl) - ze * Math.sin(ecl), xe) / DEG);
  const moonDec = Math.asin(ye * Math.sin(ecl) + ze * Math.cos(ecl)) / DEG;

  // To local horizontal
  equatorialUnit(sunRa, sunDec, tmpEq).applyMatrix3(state.equatorialToLocal);
  const sunAA = altAzFromLocal(tmpEq, sunAltAz);
  equatorialUnit(moonRa, moonDec, tmpEq).applyMatrix3(state.equatorialToLocal);
  const moonAA = altAzFromLocal(tmpEq, moonAltAz);

  // Topocentric parallax of the Moon (r in Earth radii).
  const parallax = Math.asin(1 / r) / DEG;
  const moonAltTopo = moonAA.alt - parallax * Math.cos(moonAA.alt * DEG);

  const sunAlt = refract(sunAA.alt);
  const moonAlt = refract(moonAltTopo);
  setDirectionFromAltAz(state.sunDirection, sunAlt, sunAA.az);
  setDirectionFromAltAz(state.moonDirection, moonAlt, moonAA.az);
  state.sunElevationDeg = sunAlt;
  state.moonElevationDeg = moonAlt;

  // Phase: elongation between geocentric Sun and Moon.
  const cosElong = THREE.MathUtils.clamp(
    Math.cos(sunDec * DEG) * Math.cos(moonDec * DEG) * Math.cos((sunRa - moonRa) * DEG) + Math.sin(sunDec * DEG) * Math.sin(moonDec * DEG),
    -1,
    1,
  );
  const elong = Math.acos(cosElong);
  state.moonPhaseAngle = Math.PI - elong;
  state.moonIllumination = (1 + Math.cos(state.moonPhaseAngle)) / 2;
  state.moonAngularRadius = Math.asin(0.2725 / r);
}

/** Lambertian-sphere phase law (relative disk-integrated brightness, 1 at full). */
export function moonPhaseBrightness(phaseAngle: number): number {
  const a = Math.min(Math.abs(phaseAngle), Math.PI);
  return ((Math.PI - a) * Math.cos(a) + Math.sin(a)) / Math.PI;
}
