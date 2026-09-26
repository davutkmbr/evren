/**
 * Reads the game state into a TutorialFrame for the hint triggers: flight telemetry (DragonState), what lies below
 * (geo: water depth, flat open land, a roof), and the gates (race context, perching, a busy hint line).
 */
import * as THREE from 'three';
import type { EngineContext, GeoQuery } from '../../core/contracts';
import type { HudDirector } from '../zones/director';
import { TUTORIAL_HINT_ID } from './engine';
import type { TutorialFrame } from './hints-data';

const DEG = 180 / Math.PI;
/** Start-of-game hint item (src/ui/overlays/hints.ts FlightHints.ID). */
const START_HINTS_ID = 'hints.start';
/** Flat enough for a run-out: terrain normal y (≈ 11°). */
const FLAT_NORMAL_Y = 0.98;
/** Surface (the dragon's stand height included) more than this above the terrain: a roof or a structure. */
const STRUCTURE_M = 7;
/** Built-up density above which the ground is not open. */
const OPEN_DENSITY = 0.35;

export function emptyFrame(): TutorialFrame {
  return {
    mode: null,
    speed: 0,
    agl: 0,
    pathDeg: 0,
    bankDeg: 0,
    stamina: 1,
    flow: 0,
    ground: 'unknown',
    waterDepth: 0,
    coastDistance: Infinity,
    racing: false,
    perchBusy: false,
    lineBusy: false,
    startHints: false,
  };
}

const right = new THREE.Vector3();
const up = new THREE.Vector3();
const normal = new THREE.Vector3();

function groundBelow(geo: GeoQuery, x: number, z: number, surfaceY: number, out: TutorialFrame): void {
  const terrain = geo.heightAt(x, z);
  out.coastDistance = Math.abs(geo.coastDistance(x, z));
  if (geo.isWater(x, z)) {
    out.ground = 'water';
    out.waterDepth = Math.max(0, -terrain);
    return;
  }
  out.waterDepth = 0;
  if (surfaceY - Math.max(0, terrain) > STRUCTURE_M) {
    out.ground = 'structure';
    return;
  }
  geo.normalAt(x, z, normal);
  out.ground = normal.y >= FLAT_NORMAL_Y && geo.densityAt(x, z) < OPEN_DENSITY ? 'flat' : 'rough';
}

/** Fills `out` from the running game. */
export function senseTutorial(ctx: EngineContext, zones: HudDirector, out: TutorialFrame): TutorialFrame {
  const dragon = ctx.services.tryGet('dragon');
  const shownLine = zones.shownIn('lowerCenter');
  out.lineBusy = (shownLine !== '' && shownLine !== TUTORIAL_HINT_ID) || zones.shownIn('title') !== '' || zones.shownIn('corner') !== '';
  out.startHints = zones.has(START_HINTS_ID);
  out.racing = zones.hasContext('race') || !!dragon?.racing;
  if (!dragon) {
    out.mode = null;
    out.perchBusy = false;
    out.ground = 'unknown';
    return out;
  }
  const perch = dragon.perch;
  out.perchBusy = !!perch && (perch.phase !== 'free' || perch.offer !== null);
  out.mode = dragon.mode;
  out.speed = dragon.airspeed;
  out.agl = dragon.agl;
  const v = dragon.velocity;
  out.pathDeg = Math.atan2(v.y, Math.hypot(v.x, v.z)) * DEG;
  right.set(1, 0, 0).applyQuaternion(dragon.quaternion);
  up.set(0, 1, 0).applyQuaternion(dragon.quaternion);
  out.bankDeg = Math.atan2(-right.y, up.y) * DEG;
  out.stamina = dragon.stamina;
  out.flow = dragon.flow ?? 0;
  const geo = ctx.services.tryGet('geo');
  if (geo) {
    groundBelow(geo, dragon.position.x, dragon.position.z, dragon.altitude - dragon.agl, out);
  } else {
    out.ground = 'unknown';
    out.waterDepth = 0;
    out.coastDistance = Infinity;
  }
  return out;
}
