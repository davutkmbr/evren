import type { Services } from './contracts';

export class ServiceRegistry {
  private map = new Map<keyof Services, unknown>();
  private waiters = new Map<keyof Services, Array<(v: unknown) => void>>();

  provide<K extends keyof Services>(key: K, value: Services[K]): void {
    this.map.set(key, value);
    const w = this.waiters.get(key);
    if (w) {
      this.waiters.delete(key);
      w.forEach((fn) => fn(value));
    }
  }

  /** Throws if the service is not provided yet. */
  get<K extends keyof Services>(key: K): Services[K] {
    const v = this.map.get(key);
    if (v === undefined) {
      throw new Error(`Service "${String(key)}" is not available`);
    }
    return v as Services[K];
  }

  tryGet<K extends keyof Services>(key: K): Services[K] | undefined {
    return this.map.get(key) as Services[K] | undefined;
  }

  has(key: keyof Services): boolean {
    return this.map.has(key);
  }

  /** Resolves when the service gets provided. */
  when<K extends keyof Services>(key: K): Promise<Services[K]> {
    const v = this.map.get(key);
    if (v !== undefined) {
      return Promise.resolve(v as Services[K]);
    }
    return new Promise((resolve) => {
      const list = this.waiters.get(key) ?? [];
      list.push(resolve as (v: unknown) => void);
      this.waiters.set(key, list);
    });
  }
}
