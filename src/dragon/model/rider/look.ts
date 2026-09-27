/**
 * The rider's look, set at runtime on the character built by tools/humans/ (one file carries every option): headwear,
 * hair style and colour, face archetype, skin tone, armour, and the garments' palette. Stored and sent as plain data.
 */
import * as THREE from 'three';
import type { HumanRider } from './human';

export type Headwear = 'cicak' | 'none';
export type HairStyle = 'short02' | 'braid01' | 'ponytail01' | 'none';
export type FaceArchetype = 'noble' | 'weathered' | 'young' | 'broad' | 'sharp';

export interface RiderPalette {
  /** Dolama and helmet lining, şalvar, sash and piping, leather, the gilt fittings (CSS colours). */
  primary: string;
  secondary: string;
  accent: string;
  leather: string;
  metal: string;
}

export interface RiderLook {
  palette: RiderPalette;
  headwear: Headwear;
  hair: HairStyle;
  hairColor: string;
  face: FaceArchetype;
  /** -1 lighter … 0 as built … 1 darker. */
  skin: number;
  armour: boolean;
}

/** Palettes after Ottoman and Turkic dress: the akıncı's crimson, a sipahi's blue and gold, a deli's earth, a
 * janissary's white and red. */
export const PALETTES: Record<string, RiderPalette> = {
  akinci: { primary: '#6b1410', secondary: '#1a1714', accent: '#8c6a2a', leather: '#3d2112', metal: '#c2913f' },
  sipahi: { primary: '#1d3050', secondary: '#2a2522', accent: '#b88a2e', leather: '#2e1d12', metal: '#d4a24a' },
  deli: { primary: '#6e5530', secondary: '#3a2a1c', accent: '#a1602a', leather: '#4a2c16', metal: '#9c7a45' },
  yeniceri: { primary: '#d8d0bf', secondary: '#5e1a16', accent: '#9e2a22', leather: '#2b1a10', metal: '#c89a45' },
};

export const HAIR_COLORS = ['#1a120d', '#2e1f16', '#4a3222', '#7a5a3a', '#8a8580'];

export const DEFAULT_LOOK: RiderLook = {
  palette: PALETTES.akinci,
  headwear: 'cicak',
  hair: 'braid01',
  hairColor: HAIR_COLORS[0],
  face: 'noble',
  skin: 0,
  armour: true,
};

const _c = new THREE.Color();

/** Applies a look to a loaded character (instant; call again on any change). */
export function applyLook(human: HumanRider, look: RiderLook): void {
  const bare = look.headwear === 'none';
  human.root.traverse((o) => {
    const n = o.name;
    if (n.startsWith('outfit_head_')) {
      o.visible = !bare;
    } else if (n.startsWith('outfit_armour_')) {
      o.visible = look.armour;
    } else if (n.startsWith('hair_')) {
      // Hair shows without headwear (under the çiçak it would push through the mail).
      o.visible = bare && n === `hair_${look.hair}`;
    }
  });
  // Palette onto the garment materials (the scans stay, the colour tints them).
  const g = human.garments;
  if (g) {
    const set = (id: string, css: string, k = 1): void => {
      for (const m of g.get(id) ?? []) {
        m.color.set(css).multiplyScalar(k);
        m.sheenColor.copy(m.color).lerp(_c.set(1, 1, 1), 0.35);
      }
    };
    set('primary', look.palette.primary);
    set('secondary', look.palette.secondary);
    set('accent', look.palette.accent);
    set('leather', look.palette.leather);
    set('darkLeather', look.palette.leather, 0.45);
    set('metal', look.palette.metal);
  }
  // Skin, hair colour, face archetype.
  for (const m of human.meshes) {
    const mat = m.material as THREE.MeshStandardMaterial;
    if (m.name === 'Human' && mat?.color) {
      const s = THREE.MathUtils.clamp(look.skin, -1, 1);
      mat.color.setRGB(1, 1, 1).lerp(s > 0 ? _c.setRGB(0.45, 0.32, 0.25) : _c.setRGB(1.15, 1.1, 1.05), Math.abs(s));
    }
    if (m.name.startsWith('hair_') && mat?.color) {
      mat.color.set(look.hairColor).multiplyScalar(2.2);
    }
    const dict = m.morphTargetDictionary;
    const inf = m.morphTargetInfluences;
    if (dict && inf) {
      for (const a of ['weathered', 'young', 'broad', 'sharp']) {
        const i = dict[`face_${a}`];
        if (i !== undefined) {
          inf[i] = look.face === a ? 1 : 0;
        }
      }
    }
  }
}

const STORAGE_KEY = 'evren.riderLook';

/** The player's saved look (or the default). */
export function loadRiderLook(): RiderLook {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<RiderLook>;
      return { ...DEFAULT_LOOK, ...saved, palette: { ...DEFAULT_LOOK.palette, ...(saved.palette ?? {}) } };
    }
  } catch {
    // Private mode or blocked storage: the default look.
  }
  return { ...DEFAULT_LOOK };
}

export function saveRiderLook(look: RiderLook): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(look));
  } catch {
    // Not persisted; the look still applies for this session.
  }
}
