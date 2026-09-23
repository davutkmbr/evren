/**
 * Optional base class for OSM layers: a named group, pending-job counting and ordered disposal. Subclasses add
 * `update(dt, ctx)` when they animate.
 */
import * as THREE from 'three';
import type { OsmLayer } from '../types';
import { disposeGeometries } from './three';

export abstract class LayerBase implements OsmLayer {
  readonly group = new THREE.Group();
  protected disposed = false;
  private jobs = 0;
  private readonly cleanups: (() => void)[] = [];

  constructor(readonly name: string) {
    this.group.name = `osm-${name}`;
  }

  pending(): number {
    return this.jobs;
  }

  /** Counts `job` as pending until it settles; failures are logged (and swallowed once the layer is disposed). */
  protected track(job: Promise<unknown>): void {
    this.jobs++;
    job
      .catch((e: unknown) => {
        if (!this.disposed) {
          console.error(`[osm:${this.name}]`, e);
        }
      })
      .finally(() => {
        this.jobs--;
      });
  }

  /** Runs `fn` on dispose (reverse registration order), e.g. material / collider / worker cleanup. */
  protected onDispose(fn: () => void): void {
    this.cleanups.push(fn);
  }

  dispose(): void {
    this.disposed = true;
    for (let i = this.cleanups.length - 1; i >= 0; i--) {
      this.cleanups[i]();
    }
    this.cleanups.length = 0;
    disposeGeometries(this.group);
  }
}
