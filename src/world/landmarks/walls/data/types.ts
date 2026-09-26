/**
 * Compact wall dataset written by scripts/data/fetch-walls.mjs (data/osm/walls.json, compiler input, not read by the
 * game). Local metres (+X east, +Z south), flat x, z pairs rounded to 0.1 m. Only tags that were present are written.
 */

/** Opening kinds along a wall line. */
export const Opening = {
  /** Carriageway crossing: breach with crumbled ends (a gate when a mapped gate is near). */
  Road: 0,
  /** Footway / path / steps: a gate passage. */
  Path: 1,
  /** The line runs through an OSM building that is not part of the walls. */
  Building: 2,
  /** Railway or tram crossing: breach. */
  Rail: 3,
  /** Over water (supplement lines only): no wall. */
  Water: 4,
} as const;

export interface WallMeta {
  name?: string;
  /** height=* (m). */
  h?: number;
  /** width=* / thickness=* (m). */
  thick?: number;
  /** ruins=yes / historic=ruins. */
  ruined?: 1;
  /** material=* reduced to brick / limestone / stone. */
  mat?: 'brick' | 'limestone' | 'stone';
  /** historic:civilization / period. */
  era?: 'byzantine' | 'ottoman' | 'genoese';
  /** start_date year. */
  year?: number;
  /** Castle / palace enclosure wall (wall=castle_wall): lower default height. */
  castle?: 1;
  /** Supplementary source id when the line does not come from OSM. */
  src?: string;
}

export interface WallLine extends WallMeta {
  /** OSM way id (supplement lines: source id * 100 + part). */
  id: number;
  pts: number[];
  /** Enclosure ring (the last point connects back to the first). */
  closed?: 1;
  /** Arc-length intervals [s0, s1, Opening kind] flattened, sorted, non-overlapping. */
  open?: number[];
}

/** Thick wall mapped as a thin outline polygon: extruded as a solid wall. */
export interface WallArea extends WallMeta {
  id: number;
  ring: number[];
  /** Road / rail crossings of the outline: [x, z, half width, Opening kind] flattened. */
  open?: number[];
}

export interface WallTower {
  id: number;
  x: number;
  z: number;
  /** Outline (absent for tower nodes). */
  ring?: number[];
  h?: number;
  ruined?: 1;
  /** historic=city_gate pylon. */
  gate?: 1;
  name?: string;
}

export interface WallGate {
  x: number;
  z: number;
  name?: string;
}

export interface WallData {
  generated: string;
  sources: string[];
  lines: WallLine[];
  areas: WallArea[];
  towers: WallTower[];
  gates: WallGate[];
  /** OSM ids of buildings the walls module draws (towers, gate pylons, wall rings). */
  owned: number[];
}
