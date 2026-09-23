/**
 * Facade archetypes of the slice (Galata, Pera, Karaköy, Eminönü, Tophane, Cihangir) and the per-vertex encoding
 * shared by the worker (build.ts, facade.ts, details.ts) and the facade shader (facade-glsl.ts). Change a number
 * here and both sides follow; the shader decodes the same bit layout (see FACADE_DECODE_GLSL).
 */

/** Facade archetype (aSty.y & 7). */
export const Arch = {
  /** Cumhuriyet-era / post-war apartment block: plain rendered walls, PVC windows, roller-shutter boxes, çıkma. */
  Plain: 0,
  /** 19th-century Levantine / neoclassical Pera block: tall windows with caps or pediments, rustication, cornice. */
  Levantine: 1,
  /** Late-Ottoman timber house: clapboard, small windows, cumba, wide eaves. */
  Wood: 2,
  /** Karaköy / Eminönü han and warehouse: masonry, arched ground floor, segmental window heads, iron shutters. */
  Han: 3,
  /** Post-1960 concrete: offices, hotels, apartments with ribbon windows and balcony slabs. */
  Modern: 4,
  /** Churches, schools, consulates, banks: stone, tall round-arched windows. */
  Civic: 5,
  /** Neighbourhood mosque, türbe, hamam: stone, two window tiers, dome or hipped roof. */
  Mosque: 6,
} as const;
export type Arch = (typeof Arch)[keyof typeof Arch];

/** Facade texture layers (index into the facade texture array, see materials.ts FACADE_LAYERS). */
export const Layer = { Plaster: 0, Painted: 1, Stone: 2, Concrete: 3, Brick: 4 } as const;
export type Layer = (typeof Layer)[keyof typeof Layer];

/** Surface kind (flags & 3). */
export const Kind = {
  /** Wall with the window grid. */
  Wall: 0,
  /** Trim surface without openings (cornices, soffits, parapet backs, slab edges). */
  Trim: 1,
  /** Blank wall: party / fire wall exposed above a lower neighbour. */
  Blank: 2,
  /** Horizontal roof slab of flat roofs (membrane, terrace tiles). */
  Slab: 3,
} as const;

/** Window head (flags bits 6-7): opening shape and near-LOD surround. */
export const Head = {
  /** Rectangular opening, flat cornice cap (Levantine) or plain frame (others). */
  Cap: 0,
  /** Rectangular opening with a triangular pediment. */
  Pediment: 1,
  /** Segmental arch. */
  Segmental: 2,
  /** Semicircular arch. */
  Round: 3,
} as const;
export type Head = (typeof Head)[keyof typeof Head];

/** Balcony pattern of a wall (flags bits 12-14); see balconyAt(). */
export const Balcony = {
  None: 0,
  /** One stack in the middle bay (Levantine). */
  Centre: 1,
  /** Continuous balcony across the wall on the first upper floor (piano nobile). */
  Nobile: 2,
  /** Every bay of every upper floor (post-war apartments). */
  All: 3,
  /** Every second bay, all upper floors. */
  Alternate: 4,
  /** Two stacks at the ends of the wall. */
  Ends: 5,
} as const;
export type Balcony = (typeof Balcony)[keyof typeof Balcony];

/** Flag bits of aSty.z. */
export const Flag = {
  Street: 4,
  Pitched: 8,
  Shop: 16,
  Shutters: 32,
  HeadShift: 64,
  Roller: 256,
  /** Courtyard / light-well wall: smaller windows, no ground floor openings. */
  Court: 512,
  /** Upper floors are offices (blinds, no curtains, dark at night). */
  Office: 1024,
  /** Rusticated stone plinth (ground floor in the stone layer). */
  Plinth: 2048,
  BalconyShift: 4096,
  /** Brick bands in stone walls (almaşık masonry). */
  Banded: 32768,
  /** Clapboard (timber) walls. */
  Clapboard: 65536,
  /** Mapped shops / cafés in front: shop fronts stay open late. */
  Busy: 131072,
} as const;

export interface ArchetypeDef {
  /** Floor-to-floor height range (m). */
  floorH: [number, number];
  /** Target bay width (m); the real width divides the wall into whole bays. */
  bayW: number;
  /** Window half width (m); Modern uses the bay minus the pier. */
  halfW: number;
  /** Sill height above the floor line (m). */
  sill: number;
  /** Opening top above the floor line (m); for arches the springing line plus rise. */
  head: number;
  /** Recess depth of the glass (m). */
  depth: number;
  /** Height of the window crown (cap, pediment, keystone, roller box) above the opening head (m). */
  crown: number;
}

export const ARCHETYPES: Record<Arch, ArchetypeDef> = {
  [Arch.Plain]: { floorH: [2.95, 3.15], bayW: 3.1, halfW: 0.62, sill: 0.9, head: 2.35, depth: 0.16, crown: 0.25 },
  [Arch.Levantine]: { floorH: [3.8, 4.25], bayW: 2.75, halfW: 0.56, sill: 0.72, head: 3.15, depth: 0.24, crown: 0.5 },
  [Arch.Wood]: { floorH: [2.85, 3.05], bayW: 1.9, halfW: 0.42, sill: 0.8, head: 2.25, depth: 0.1, crown: 0.22 },
  [Arch.Han]: { floorH: [3.9, 4.4], bayW: 3.0, halfW: 0.6, sill: 0.95, head: 2.85, depth: 0.3, crown: 0.3 },
  [Arch.Modern]: { floorH: [3.05, 3.35], bayW: 3.5, halfW: 1.25, sill: 0.95, head: 2.55, depth: 0.12, crown: 0.25 },
  [Arch.Civic]: { floorH: [4.6, 5.4], bayW: 3.6, halfW: 0.7, sill: 1.1, head: 3.9, depth: 0.32, crown: 0.3 },
  [Arch.Mosque]: { floorH: [3.6, 3.9], bayW: 3.2, halfW: 0.55, sill: 1.0, head: 2.6, depth: 0.45, crown: 0.2 },
};

/** Arch rise (m) above the springing line for a head type and window half width. */
export function archRise(head: Head, halfW: number): number {
  return head === Head.Round ? halfW : head === Head.Segmental ? halfW * 0.38 : 0;
}

/** Packs arch, wall layer and plinth layer into aSty.y. */
export function styleCode(arch: Arch, wall: Layer, plinth: Layer): number {
  return arch + 8 * wall + 64 * plinth;
}

/** Balcony present at bay `bay` (0-based) of `nb` on upper floor `k` (0 = first floor above the shop floor). */
export function balconyAt(mode: Balcony, bay: number, nb: number, k: number, topK: number): boolean {
  switch (mode) {
    case Balcony.Centre:
      return nb >= 3 && bay === Math.floor(nb / 2) && k <= topK;
    case Balcony.Nobile:
      return k === 0 && nb >= 2 && Math.abs(bay + 0.5 - nb / 2) < nobileHalf(nb);
    case Balcony.All:
      return true;
    case Balcony.Alternate:
      return bay % 2 === (nb % 2 === 1 ? 1 : 0) || nb <= 2;
    case Balcony.Ends:
      return nb >= 4 && (bay === 0 || bay === nb - 1);
    default:
      return false;
  }
}

/** Half width (in bays) of a piano-nobile balcony centred on a wall of `nb` bays. */
export function nobileHalf(nb: number): number {
  return Math.max(1.5, nb * 0.32);
}

/**
 * Wall layout shared by the worker and the shader: whole bays along the wall, floor rows from the footprint base,
 * the ground (shop) row per bay from the local ground height.
 */
export interface WallLayout {
  nb: number;
  bw: number;
}

export function bayCount(len: number, bayW: number): number {
  return Math.max(1, Math.floor(len / bayW + 0.3));
}

/**
 * Highest windowed floor row: row r carries windows when its opening head plus `clearance` (crown, cornice and
 * parapet zone, see plan.ts) stays below the wall top `wallTopV` (both m above the footprint base).
 */
export function topWindowRow(wallTopV: number, clearance: number, head: number, floorH: number): number {
  return Math.floor((wallTopV - clearance - head) / floorH + 1e-4);
}

/** Row index of the street-level floor at local ground `g` (m above the footprint base). */
export function groundRow(g: number, floorH: number): number {
  let r = Math.floor((g + 0.9) / floorH);
  if ((r + 1) * floorH - g < 2.6) {
    r++;
  }
  return r;
}

/** GLSL twins of balconyAt() / groundRow() (kept next to the TS versions on purpose). */
export const LAYOUT_GLSL = /* glsl */ `
float osmTopRow(float wallTopV, float clearance, float head, float fh) {
  return floor((wallTopV - clearance - head) / fh + 1e-4);
}
float osmGroundRow(float g, float fh) {
  float r = floor((g + 0.9) / fh);
  return r + step((r + 1.0) * fh - g, 2.6 - 1e-4);
}
float osmBalconyAt(float mode, float bay, float nb, float k, float topK) {
  if (mode < 0.5) return 0.0;
  if (mode < 1.5) return step(2.5, nb) * (1.0 - step(0.5, abs(bay - floor(nb * 0.5)))) * step(k, topK + 0.5);
  if (mode < 2.5) return (1.0 - step(0.5, k)) * step(1.5, nb) * step(abs(bay + 0.5 - nb * 0.5), max(1.5, nb * 0.32) - 1e-3);
  if (mode < 3.5) return 1.0;
  if (mode < 4.5) return max(1.0 - step(0.5, abs(mod(bay, 2.0) - (mod(nb, 2.0) > 0.5 ? 1.0 : 0.0))), step(nb, 2.5));
  return step(3.5, nb) * max(1.0 - step(0.5, bay), 1.0 - step(0.5, abs(bay - (nb - 1.0))));
}
`;
