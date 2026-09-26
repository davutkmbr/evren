/**
 * Module family specs: what the compiler's module library exporter (library.ts) turns into the shared catalog and
 * glbs (src/street/modules/format.ts). A variant is authored by a function that draws it with the façade Batch in
 * the MODULE FRAME (x right along the wall seen from outside, y up, z out of the wall) at the size it is given; the
 * exporter runs it at the reference size and at a slightly larger w, h and d, and stores the per-metre movement of
 * every vertex (`_DW/_DH/_DD`). Geometry must therefore be linear in w, h and d over the variant's fit range (the
 * exporter checks the corners of the range and refuses a variant that bends).
 */
import { Batch, Frame } from '../facade/frame';
import type { MaterialName } from '../materials';
import { CaptureMesh } from './capture';

/** The module frame: r -> +X, y -> +Y, d -> +Z. */
export const MODULE_FRAME = new Frame(0, 0, 1, 0, 0, 1, 1);

export interface AuthorCtx {
  b: Batch;
  w: number;
  h: number;
  d: number;
  /** Emits `fn`'s geometry with COLOR_0 multiplied at runtime by the slot's tint k (flushes around it). */
  tint(k: number, fn: () => void): void;
}

export interface VariantSpec {
  id: string;
  /** Reference size [w, h, d]. */
  ref: [number, number, number];
  fit?: { w?: [number, number]; h?: [number, number]; d?: [number, number] };
  styles?: string[];
  weight?: number;
  /** Per tint: sRGB hex colours, or `$name.k` (the area's district colour k of `name`, e.g. `$flag.0`). */
  palettes?: string[][];
  /**
   * Repeat along x (see ModuleVariant.repeat): `author` draws one bay of width w; `caps` draw what is placed once at
   * the left and right end, at the slot's full width w.
   */
  repeat?: { pitch: number; up?: boolean; caps?: [((c: AuthorCtx) => void) | null, ((c: AuthorCtx) => void) | null] };
  /** Glyphs: advance width in cap heights. */
  advance?: number;
  /** Draws the variant; omitted: an empty variant (the slot draws nothing). */
  author?: (c: AuthorCtx) => void;
}

export interface FamilySpec {
  name: string;
  doc: string;
  styles?: Record<string, { remap?: Record<string, MaterialName> }>;
  /** Material renames for every slot of the family. */
  remap?: Record<string, MaterialName>;
  /** A text family (see ModuleFamily.text). */
  text?: { glyphs: string; track: number };
  variants: VariantSpec[];
}

/** Runs an author (a variant's, or one of its repeat caps) at one size and returns the capture. */
export function capture(author: ((c: AuthorCtx) => void) | undefined, w: number, h: number, d: number): CaptureMesh {
  const cap = new CaptureMesh();
  const b = new Batch(cap.asTileMesh(), MODULE_FRAME);
  const ctx: AuthorCtx = {
    b,
    w,
    h,
    d,
    tint(k, fn) {
      b.flush();
      const prev = cap.tint;
      cap.tint = k;
      fn();
      b.flush();
      cap.tint = prev;
    },
  };
  author?.(ctx);
  b.flush();
  return cap;
}
