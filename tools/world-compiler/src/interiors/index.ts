/**
 * Interior step (format 1): L3 interior shells fitted behind a street door of their building, emitted into the tile
 * at LOD0 only, with props, lights and an interior record in `extra.interiors` (cell id, door link, room, seats with
 * sit positions and headings, NPC slots, lights, instances, preview views). It runs after the façade step so it sees
 * the final door records.
 *
 * Contract with the shopfront / façade lane: `area.shared.get('interiors')` (InteriorShared) lists the doors that
 * open into a compiled interior. For those doors the shopfront should leave the door opening clear (no leaf or door
 * glass: this step emits the open leaf) at `doorWidth`, keep the kepenk open, and skip its lit interior box (back
 * wall, side walls, floor, ceiling, shelves, counter) behind the unit's glazing, and may use `name` for the sign.
 *
 * Every business shown in the game is fictional: the cell names are invented and the OSM name stays data only.
 */
import type { AreaContext, CompileStep } from '../registry';
import { buildCafe, CAFE_DOOR_W, type CafeCell } from './cafe';

export interface InteriorDoor {
  cell: string;
  kind: 'cafe';
  building: string;
  poi: string;
  /** Fictional Turkish business name for the sign. */
  name: string;
  open: true;
  doorWidth: number;
}

export interface InteriorShared {
  /** Door record id -> the interior behind it. */
  doors: Map<string, InteriorDoor>;
  pois: Set<string>;
}

/** Interiors to compile: a real POI of the strip (by building and kind) and its fictional name. */
const CELLS: { id: string; kind: 'cafe'; building: string; poiKind: string; name: string }[] = [
  // Yasa Cd north side, ch 187–199 (spec section 2): an unnamed amenity=cafe in the T3 block w179197243.
  { id: 'cafe0', kind: 'cafe', building: 'w179197243', poiKind: 'amenity=cafe', name: 'Lodos Kahvesi' },
];

/**
 * Eye-level viewpoints in front of the interiors' street doors (door + 3.4 m out, looking in): other steps keep them
 * clear (the crowd does not stand in the café's street view). Usable from any step's prepare.
 */
export function interiorDoorViews(a: AreaContext): { x: number; z: number; fx: number; fz: number }[] {
  const out: { x: number; z: number; fx: number; fz: number }[] = [];
  for (const c of CELLS) {
    for (const m of a.manifests.values()) {
      const poi = m.pois.find((p) => p.building === c.building && p.kind === c.poiKind && p.door);
      const door = poi ? m.doors.find((d) => d.id === poi.door) : undefined;
      if (door) {
        const [nx, , nz] = door.normal;
        out.push({ x: door.position[0] + nx * 3.4, z: door.position[2] + nz * 3.4, fx: -nx, fz: -nz });
        break;
      }
    }
  }
  return out;
}

export const interiorStep: CompileStep = {
  id: 'interiors',
  prepare(a: AreaContext) {
    const shared: InteriorShared = { doors: new Map(), pois: new Set() };
    for (const c of CELLS) {
      for (const m of a.manifests.values()) {
        const poi = m.pois.find((p) => p.building === c.building && p.kind === c.poiKind && p.door);
        if (poi) {
          shared.doors.set(poi.door!, { cell: `${m.id}/${c.id}`, kind: c.kind, building: c.building, poi: poi.id, name: c.name, open: true, doorWidth: CAFE_DOOR_W });
          shared.pois.add(poi.id);
          break;
        }
      }
    }
    a.shared.set('interiors', shared);
  },
  tile(t) {
    const shared = t.area.shared.get('interiors') as InteriorShared;
    const out: Record<string, unknown>[] = [];
    for (const [doorId, d] of shared.doors) {
      const door = t.manifest.doors.find((q) => q.id === doorId);
      const solid = t.solids.find((s) => s.rec.id === d.building);
      if (!door || !solid) {
        continue;
      }
      const cell: CafeCell = { id: d.cell.split('/').pop()!, name: d.name, poi: d.poi, building: d.building, door: doorId };
      const siblings = t.manifest.doors.filter((q) => q.building === d.building);
      const rec = buildCafe(t, cell, solid.ring, door, siblings);
      if (rec) {
        out.push(rec);
      }
    }
    if (out.length) {
      t.record('interiors', out);
    }
  },
};
