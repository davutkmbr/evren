import type * as THREE from 'three';

export type VesselKind =
  | 'vapur'
  | 'ferry'
  | 'seabus'
  | 'tour'
  | 'tanker'
  | 'container'
  | 'bulk'
  | 'fishing'
  | 'seiner'
  | 'yacht'
  | 'sailboat'
  | 'motorboat'
  | 'tug'
  | 'pilot';

export type NavLightKind = 'mast' | 'port' | 'stbd' | 'stern' | 'anchor' | 'deck' | 'red';

export interface NavLightDef {
  kind: NavLightKind;
  x: number;
  y: number;
  z: number;
}

/** A buildable vessel design (geometry for both LODs + metadata in model space). */
export interface VesselModel {
  key: string;
  kind: VesselKind;
  length: number;
  beam: number;
  draft: number;
  /** Highest point above the waterline (m). */
  airDraft: number;
  /** Large vessels render on the Default layer (water reflections) and cast shadows further. */
  big: boolean;
  lod0: THREE.BufferGeometry;
  lod1: THREE.BufferGeometry;
  /** Camera distance (m) at which lod1 takes over. */
  lodDistance: number;
  lights: NavLightDef[];
}

export interface ModelOptions {
  /** 0 = full detail, 1 = distant LOD. */
  lod: 0 | 1;
}
