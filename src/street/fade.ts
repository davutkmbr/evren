import * as THREE from 'three';

/**
 * Per-tile cross-fade of the street tiles (screen-door dissolve). Every live tile owns a slot (1..255) of a 256 x 1
 * fade table; slot 0 is always 0. A street tile fragment is kept where `fade > streetDither()`, and a host that hides
 * its own geometry under the tile (the flight game's hole mask stores the tile's slot per texel) discards its fragment
 * under the same condition, so every pixel shows exactly one of the two while a tile fades in or out.
 */
export const FADE_SLOTS = 256;

/**
 * Interleaved gradient noise on the pixel grid, in [0, 1). Street tiles and the geometry they replace must use this
 * exact function so their dither patterns are complementary.
 */
export const STREET_DITHER_GLSL = /* glsl */ `
float streetDither() {
  return fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))));
}
float streetFadeAt(sampler2D table, float slot) {
  return texture2D(table, vec2((slot + 0.5) / ${FADE_SLOTS}.0, 0.5)).r;
}
`;

/** The fade table: slot -> fade (R8). Slots are handed out by the tile streamer. */
export class FadeTable {
  readonly texture: THREE.DataTexture;
  private readonly data = new Uint8Array(FADE_SLOTS);
  private readonly free: number[] = [];

  constructor() {
    for (let s = FADE_SLOTS - 1; s >= 1; s--) {
      this.free.push(s);
    }
    this.texture = new THREE.DataTexture(this.data, FADE_SLOTS, 1, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.unpackAlignment = 1;
    this.texture.needsUpdate = true;
  }

  /** A free slot (fade 0), or 0 when all are taken (the tile is then drawn unfaded). */
  acquire(): number {
    return this.free.pop() ?? 0;
  }

  release(slot: number): void {
    if (slot > 0) {
      this.set(slot, 0);
      this.free.push(slot);
    }
  }

  set(slot: number, fade: number): void {
    if (slot <= 0) {
      return;
    }
    const v = Math.round(THREE.MathUtils.clamp(fade, 0, 1) * 255);
    if (this.data[slot] !== v) {
      this.data[slot] = v;
      this.texture.needsUpdate = true;
    }
  }

  dispose(): void {
    this.texture.dispose();
  }
}
