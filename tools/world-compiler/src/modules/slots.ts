/**
 * Slot sink of one tile: the façade code adds a slot per module (a family, a place on a wall frame, a size, a seed,
 * tints) instead of emitting its triangles. The sink is stored as a step record (`extra['slots:<step>']`, so the
 * stage cache keeps it with the step's other effects); the assembly (cli.ts) encodes every such record into the
 * tile's `tiles/<id>.slots.bin` and drops it from the manifest.
 */
import { encodeSlots, type Rgba, type Slot, type SlotFrame } from '../../../../src/street/modules/format';
import type { Frame } from '../facade/frame';
import { familySpec } from './library';

/** Prefix of the step records that hold slots. */
export const SLOTS_RECORD = 'slots:';

export interface SlotRecord {
  frames: SlotFrame[];
  slots: Slot[];
}

export interface SlotInput {
  style?: string | null;
  /** Any number: hashed to the slot's 16-bit seed. */
  seed: number;
  r: number;
  y: number;
  d?: number;
  w?: number;
  h?: number;
  dd?: number;
  tint0?: Rgba | null;
  tint1?: Rgba | null;
}

const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;

export class SlotSink {
  private readonly frames: SlotFrame[] = [];
  private readonly frameIds = new Map<string, number>();
  private readonly slots: Slot[] = [];

  /** `origin`: the tile origin (x, z); frames are stored relative to it. */
  constructor(private readonly origin: readonly [number, number]) {}

  get count(): number {
    return this.slots.length;
  }

  private frameOf(f: Frame): number {
    const fr: SlotFrame = [r4(f.ox - this.origin[0]), r4(f.oz - this.origin[1]), r4(f.nx), r4(f.nz)];
    const key = fr.join(',');
    let id = this.frameIds.get(key);
    if (id === undefined) {
      id = this.frames.length;
      this.frames.push(fr);
      this.frameIds.set(key, id);
    }
    return id;
  }

  /** Adds a slot of `family` on wall frame `f` at (r, y, d) (frame coordinates, see facade/frame.ts). */
  add(f: Frame, family: string, s: SlotInput): void {
    familySpec(family);
    this.slots.push({
      family,
      style: s.style ?? null,
      seed: seed16(s.seed),
      frame: this.frameOf(f),
      r: s.r,
      y: s.y,
      d: s.d ?? 0,
      w: Math.max(0, s.w ?? 0),
      h: Math.max(0, s.h ?? 0),
      dd: Math.max(0, s.dd ?? 0),
      tint0: s.tint0 ?? null,
      tint1: s.tint1 ?? null,
    });
  }

  record(): SlotRecord {
    return { frames: this.frames, slots: this.slots };
  }
}

/** A 16-bit seed from any number (façade seeds are fractional hashes). */
export function seed16(v: number): number {
  const s = Math.sin(v * 91.3458 + 17.17) * 43758.5453;
  return Math.floor((s - Math.floor(s)) * 65536) & 0xffff;
}

/** Merges the slot records of a tile's steps (frames renumbered) and encodes them; null when there are none. */
export function encodeTileSlots(records: readonly SlotRecord[]): { bytes: Uint8Array; count: number } | null {
  const frames: SlotFrame[] = [];
  const slots: Slot[] = [];
  const ids = new Map<string, number>();
  for (const rec of records) {
    const map = rec.frames.map((f) => {
      const key = f.join(',');
      let id = ids.get(key);
      if (id === undefined) {
        id = frames.length;
        frames.push(f);
        ids.set(key, id);
      }
      return id;
    });
    for (const s of rec.slots) {
      slots.push({ ...s, frame: map[s.frame] });
    }
  }
  if (!slots.length) {
    return null;
  }
  return { bytes: encodeSlots(frames, slots), count: slots.length };
}
