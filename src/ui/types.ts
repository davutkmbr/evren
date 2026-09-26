import type { FlightMode, LandmarkDef } from '../core/contracts';

/** Per-frame flight/camera snapshot the UI reads (filled once per frame, no allocations). */
export interface FlightSnapshot {
  valid: boolean;
  x: number;
  y: number;
  z: number;
  /** Horizontal heading of the view camera (compass degrees): drives the compass, minimap and markers. */
  viewHeadingDeg: number;
  /** Dragon body heading (compass degrees). */
  headingDeg: number;
  speedKmh: number;
  altitude: number;
  agl: number;
  verticalSpeed: number;
  stamina: number;
  /** Flow 0..1 (phase 20 stage D; 0 without a dragon). */
  flow: number;
  mode: FlightMode;
}

export function createSnapshot(): FlightSnapshot {
  return {
    valid: false,
    x: 0,
    y: 0,
    z: 0,
    viewHeadingDeg: 0,
    headingDeg: 0,
    speedKmh: 0,
    altitude: 0,
    agl: 0,
    verticalSpeed: 0,
    stamina: 1,
    flow: 0,
    mode: 'flying',
  };
}

/** Shared, read-mostly discovery state (owned by DiscoveryTracker). */
export interface DiscoveryState {
  readonly discovered: ReadonlySet<string>;
  readonly total: number;
}

/** Compass bearing (degrees, 0 = north, clockwise) from a point toward a landmark. */
export function bearingTo(fromX: number, fromZ: number, landmark: Pick<LandmarkDef, 'x' | 'z'>): number {
  const deg = (Math.atan2(landmark.x - fromX, -(landmark.z - fromZ)) * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg;
}
