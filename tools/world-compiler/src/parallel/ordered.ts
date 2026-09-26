/**
 * Ordered steps (registry.ts CompileStep.ordered): a step whose tile() uses up area state tile by tile (the soul
 * layer's quotas). Only that state is passed along, not the whole tile: a thread runs everything before the step in
 * parallel with the others, then waits at the step until the tile before it (in tile order, among the tiles the step
 * runs on) has left the step, takes over that tile's exit state and continues. The main thread holds the chain:
 * the state after prepare, then each tile's exit state as its thread reports it (or as the tile cache restores it).
 * The result is the serial compile's state sequence, whatever thread compiles which tile.
 */
import type { AreaContext, CompileStep } from '../registry';

/** How compileTile passes ordered state: enter() before the step's tile(), leave() after it. */
export interface OrderedGate {
  enter(step: CompileStep, tile: string, a: AreaContext): Promise<void>;
  leave(step: CompileStep, tile: string, a: AreaContext): void;
}

/** Records the exit states of the tile being compiled (TileOut.ordered); `send` also reports them (worker threads). */
export class ExitStates {
  current: Record<string, unknown> = {};

  constructor(private readonly send?: (step: string, tile: string, state: unknown) => void) {}

  record(step: CompileStep, tile: string, a: AreaContext): void {
    const s = structuredClone(step.ordered!.state(a));
    this.current[step.id] = s;
    this.send?.(step.id, tile, s);
  }

  take(): Record<string, unknown> {
    const out = this.current;
    this.current = {};
    return out;
  }
}

/** In-thread gate (serial compile): the state stays in this thread's plans; exits are recorded for the cache. */
export function localGate(exits: ExitStates): OrderedGate {
  return {
    enter: async () => {},
    leave: (step, tile, a) => exits.record(step, tile, a),
  };
}

/** Worker gate: asks the main thread for the entry state and reports the exit state. */
export function remoteGate(exits: ExitStates, ask: (step: string, tile: string) => Promise<unknown>): OrderedGate {
  return {
    enter: async (step, tile, a) => step.ordered!.restore(a, await ask(step.id, tile)),
    leave: (step, tile, a) => exits.record(step, tile, a),
  };
}

/** Main side: per ordered step, the tiles it runs on (tile order) and the states known so far. */
export class OrderedChain {
  private readonly prev = new Map<string, string | null>();
  private readonly known = new Map<string, unknown>();
  private readonly waiting = new Map<string, ((s: unknown) => void)[]>();

  /** `order`: step id -> tile ids in tile order; `initial`: step id -> state after prepare. */
  constructor(order: Map<string, string[]>, initial: Map<string, unknown>) {
    for (const [step, tiles] of order) {
      tiles.forEach((t, k) => this.prev.set(`${step} ${t}`, k ? `${step} ${tiles[k - 1]}` : null));
      this.known.set(`${step} `, initial.get(step));
    }
  }

  /** Exit state of `tile` at `step`. */
  put(step: string, tile: string, state: unknown): void {
    const key = `${step} ${tile}`;
    this.known.set(key, state);
    for (const w of this.waiting.get(key) ?? []) {
      w(state);
    }
    this.waiting.delete(key);
  }

  /** Entry state of `tile` at `step`: the previous tile's exit state (the initial state for the first tile). */
  get(step: string, tile: string): Promise<unknown> {
    const before = this.prev.get(`${step} ${tile}`);
    if (before === undefined) {
      return Promise.reject(new Error(`ordered step ${step}: tile ${tile} is not in its chain`));
    }
    const key = before ?? `${step} `;
    if (this.known.has(key)) {
      return Promise.resolve(this.known.get(key));
    }
    return new Promise((resolve) => this.waiting.set(key, [...(this.waiting.get(key) ?? []), resolve]));
  }
}
