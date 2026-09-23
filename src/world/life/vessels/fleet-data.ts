import type { ServiceLineDef } from './nav/ferry-plan';

/**
 * Scheduled lines. Stops are [pier id, berth index] into data/places.ts PIERS. Classic vapurs back out of the pier and
 * turn; the ŞH-Küçüksu-class double-enders simply leave with the other end first; İDO sea buses back out quickly.
 */
export const SERVICE_LINES: readonly ServiceLineDef[] = [
  { id: 'eminonu-kadikoy', model: 'vapur', stops: [['eminonu', 1], ['kadikoy', 0]], vessels: 2, dwell: 75 },
  { id: 'karakoy-kadikoy', model: 'vapur', stops: [['karakoy', 0], ['kadikoy', 1]], vessels: 2, dwell: 75 },
  { id: 'eminonu-uskudar', model: 'ferry', stops: [['eminonu', 2], ['uskudar', 0]], vessels: 2, dwell: 55 },
  { id: 'besiktas-uskudar', model: 'ferry', stops: [['besiktas', 0], ['uskudar', 1]], vessels: 2, dwell: 55 },
  { id: 'kabatas-adalar', model: 'vapur', stops: [['kabatas', 0], ['kinaliada', 0], ['burgazada', 0], ['heybeliada', 0], ['buyukada', 0]], vessels: 2, dwell: 50 },
  { id: 'bogaz-turu', model: 'vapur', stops: [['eminonu', 0], ['besiktas', 0], ['kanlica', 0], ['sariyer', 0], ['anadolu-kavagi', 0]], vessels: 1, dwell: 45 },
  { id: 'ido-adalar', model: 'seabus', stops: [['kabatas', 1], ['kadikoy-ido', 0], ['heybeliada', 0], ['buyukada', 0]], vessels: 2, dwell: 40 },
];

/** Manoeuvring data per scheduled model (speeds in m/s: vapur 14 kn, double-ender 12 kn, sea bus 26 kn). */
export const SERVICE_HANDLING: Record<string, { doubleEnded: boolean; vmax: number; accel: number; decel: number; yawRate: number; turnRadius: number }> = {
  vapur: { doubleEnded: false, vmax: 7.2, accel: 0.1, decel: 0.085, yawRate: 0.05, turnRadius: 70 },
  ferry: { doubleEnded: true, vmax: 6.2, accel: 0.12, decel: 0.1, yawRate: 0.07, turnRadius: 48 },
  seabus: { doubleEnded: false, vmax: 13.5, accel: 0.32, decel: 0.28, yawRate: 0.09, turnRadius: 55 },
};

export interface MooringDef {
  /** Where along the waterfront (snapped to the nearest shore). */
  lat: number;
  lon: number;
  model: string;
  count: number;
  /** 'raft': side by side outwards from the quay; 'line': bow to stern along it; 'buoys': swinging off the shore. */
  layout: 'raft' | 'line' | 'buoys';
  /** Hull colours (sRGB) to cycle through. */
  paints: readonly number[];
}

/** Boats made fast along the waterfront: fishing harbours, marinas, tug and excursion boat berths. */
export const MOORINGS: readonly MooringDef[] = [
  { lat: 41.0176, lon: 28.9716, model: 'tour', count: 3, layout: 'line', paints: [0x1f4f9a, 0xb3261e, 0x1f4f9a] },
  { lat: 41.0003, lon: 28.9652, model: 'fishing', count: 6, layout: 'raft', paints: [0x2f9aa0, 0x3f7fc0, 0x3c8a5a, 0xd9a82a, 0x1f3f7a, 0xb8322a] },
  { lat: 41.0008, lon: 28.9675, model: 'seiner', count: 2, layout: 'raft', paints: [0x8fb8bd, 0xa9332b] },
  { lat: 41.1742, lon: 29.0873, model: 'seiner', count: 3, layout: 'raft', paints: [0x8fb8bd, 0x9dbfae, 0x3f6f9a] },
  { lat: 41.1800, lon: 29.0735, model: 'fishing', count: 4, layout: 'raft', paints: [0x2f9aa0, 0xb8322a, 0x3c8a5a, 0x3f7fc0] },
  { lat: 41.1668, lon: 29.0567, model: 'fishing', count: 3, layout: 'line', paints: [0x5aa9c9, 0x2f9aa0, 0xd9a82a] },
  { lat: 41.0773, lon: 29.0436, model: 'yacht', count: 3, layout: 'buoys', paints: [0xf7f7f5, 0x1c2842, 0xf5f4ef] },
  { lat: 41.0782, lon: 29.0452, model: 'sailboat', count: 3, layout: 'buoys', paints: [0xf6f6f3, 0x1d2a44, 0xf6f6f3] },
  { lat: 40.9790, lon: 29.0355, model: 'yacht', count: 4, layout: 'raft', paints: [0xf7f7f5, 0xf7f7f5, 0x6f767b, 0xf5f4ef] },
  { lat: 40.9800, lon: 29.0340, model: 'sailboat', count: 5, layout: 'raft', paints: [0xf6f6f3, 0x1d2a44, 0xf6f6f3, 0x2b4a3a, 0xf6f6f3] },
  { lat: 41.0262, lon: 28.9838, model: 'tug', count: 2, layout: 'raft', paints: [0xb3261e, 0xb3261e] },
  { lat: 41.0470, lon: 29.0262, model: 'tour', count: 2, layout: 'line', paints: [0x1f4f9a, 0x2b6c3f] },
  { lat: 41.0035, lon: 29.0150, model: 'tug', count: 2, layout: 'line', paints: [0xb3261e, 0xd9581c] },
];

/** Harbour craft zones (lat, lon, radius m): tugs and pilot boats stay near the port and the anchorage. */
export const HARBOUR_ZONES: readonly { model: string; lat: number; lon: number; radius: number }[] = [
  { model: 'tug', lat: 41.012, lon: 28.998, radius: 1400 },
  { model: 'tug', lat: 40.998, lon: 29.012, radius: 1200 },
  { model: 'pilot', lat: 40.995, lon: 28.975, radius: 2200 },
  { model: 'pilot', lat: 41.17, lon: 29.08, radius: 1600 },
];
