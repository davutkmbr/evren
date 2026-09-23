import type { EngineContext, PipelineFactory, RenderPipeline } from '../../core/contracts';
import { PostPipeline } from './pipeline';

export type { PostDiagnostics } from './pipeline';
export { PostPipeline } from './pipeline';

/** Render pipeline factory (wired in main.ts). */
export const createRenderPipeline: PipelineFactory = (ctx: EngineContext): RenderPipeline => new PostPipeline(ctx);
