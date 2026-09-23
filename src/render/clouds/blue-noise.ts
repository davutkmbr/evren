import * as THREE from 'three';
import { generateBlueNoise } from './blue-noise-gen';

export const BLUE_NOISE_SIZE = 64;

/**
 * 64x64 void-and-cluster blue-noise texture (R8, repeat, nearest), generated in a worker at startup.
 * Until it arrives the texture holds interleaved-gradient noise so the jitter is never structured badly.
 */
export class BlueNoiseTexture {
  readonly texture: THREE.DataTexture;
  private ready = false;
  private worker: Worker | null = null;

  constructor(seed = 1337) {
    const size = BLUE_NOISE_SIZE;
    const data = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const ign = (52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1)) % 1;
        data[y * size + x] = Math.floor(ign * 255.99);
      }
    }
    this.texture = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.wrapS = THREE.RepeatWrapping;
    this.texture.wrapT = THREE.RepeatWrapping;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.needsUpdate = true;

    try {
      this.worker = new Worker(new URL('./blue-noise.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<{ size: number; data: Uint8Array }>): void => {
        this.apply(event.data.data);
        this.worker?.terminate();
        this.worker = null;
      };
      this.worker.onerror = (): void => {
        this.worker?.terminate();
        this.worker = null;
        this.apply(generateBlueNoise(size, seed));
      };
      this.worker.postMessage({ size, seed });
    } catch {
      this.apply(generateBlueNoise(size, seed));
    }
  }

  get pending(): boolean {
    return !this.ready;
  }

  private apply(data: Uint8Array): void {
    (this.texture.image.data as Uint8Array).set(data);
    this.texture.needsUpdate = true;
    this.ready = true;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.texture.dispose();
  }
}
