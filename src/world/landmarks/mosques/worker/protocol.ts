import type { BuiltModel, GeomData, LodLevel } from '../gen/types';

export type MosqueJob = { kind: 'landmark'; key: string; levels: LodLevel[]; fallback?: { height: number; radius: number } } | { kind: 'neighborhood' };

export interface MosqueRequest {
  id: number;
  job: MosqueJob;
}

export interface MosqueResponse {
  id: number;
  models: BuiltModel[];
  error?: string;
  ms: number;
}

/** Transferable buffers of a set of models. */
export function modelTransferables(models: readonly BuiltModel[]): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  const add = (g: GeomData | null): void => {
    if (!g) {
      return;
    }
    out.push(g.position.buffer as ArrayBuffer, g.normal.buffer as ArrayBuffer, g.uv.buffer as ArrayBuffer, g.tint.buffer as ArrayBuffer, g.data.buffer as ArrayBuffer, g.index.buffer as ArrayBuffer);
  };
  for (const m of models) {
    m.lods.forEach(add);
  }
  return out;
}
