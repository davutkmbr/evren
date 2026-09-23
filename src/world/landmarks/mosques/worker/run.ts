import { buildLandmarkModel, buildNeighborhoodModels } from '../gen/build';
import type { BuiltModel } from '../gen/types';
import type { MosqueJob } from './protocol';

export function runMosqueJob(job: MosqueJob): BuiltModel[] {
  if (job.kind === 'neighborhood') {
    return buildNeighborhoodModels();
  }
  const model = buildLandmarkModel(job.key, job.levels, job.fallback);
  return model ? [model] : [];
}
