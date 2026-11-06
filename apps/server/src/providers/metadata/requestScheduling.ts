import { AsyncLocalStorage } from 'node:async_hooks';

export type ProviderPriority = 'interactive' | 'enrichment' | 'background';
const context = new AsyncLocalStorage<ProviderPriority>();
export const withProviderPriority = <T>(priority: ProviderPriority, work: () => T): T => context.run(priority, work);

// Weighted rotation keeps interactive requests responsive and prevents either
// enrichment or maintenance jobs from monopolizing the provider's single lane.
export class FairRequestQueue {
  private queues: Record<ProviderPriority, Array<() => Promise<void>>> = { interactive: [], enrichment: [], background: [] };
  private rotation: ProviderPriority[] = ['interactive', 'enrichment', 'enrichment', 'background'];
  private cursor = 0;
  private running = false;
  private lastFinishedAt = 0;
  constructor(private intervalMs = 1100) {}
  enqueue<T>(work: () => Promise<T>, priority = context.getStore() ?? 'interactive'): Promise<T> {
    const promise = new Promise<T>((resolve, reject) => {
      this.queues[priority].push(async () => { try { resolve(await work()); } catch (error) { reject(error); } });
    });
    void this.drain();
    return promise;
  }
  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (Object.values(this.queues).some(queue => queue.length)) {
        let next: (() => Promise<void>) | undefined;
        while (!next) next = this.queues[this.rotation[this.cursor++ % this.rotation.length]].shift();
        const delay = Math.max(0, this.intervalMs - (Date.now() - this.lastFinishedAt));
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        try { await next(); } finally { this.lastFinishedAt = Date.now(); }
      }
    } finally { this.running = false; }
  }
}

// Store serialized responses so callers cannot mutate another item's evidence.
// Limits apply to both response count and total bytes; outages are never cached.
export class JsonRequestCache {
  private values = new Map<string, { json: string; expires: number; bytes: number }>();
  private pending = new Map<string, Promise<string>>();
  private bytes = 0;
  constructor(private ttlMs = 15 * 60_000, private maxEntries = 256, private maxBytes = 32 * 1024 * 1024) {}
  clear() { this.values.clear(); this.bytes = 0; }
  async get<T>(key: string, load: () => Promise<T>): Promise<T> {
    const cached = this.values.get(key);
    if (cached && cached.expires > Date.now()) {
      this.values.delete(key); this.values.set(key, cached);
      return JSON.parse(cached.json);
    }
    if (cached) { this.bytes -= cached.bytes; this.values.delete(key); }
    let task = this.pending.get(key);
    if (!task) {
      task = (async () => {
        const json = JSON.stringify(await load());
        const bytes = Buffer.byteLength(json);
        if (bytes <= this.maxBytes) {
          while (this.values.size && (this.values.size >= this.maxEntries || this.bytes + bytes > this.maxBytes)) {
            const oldest = this.values.keys().next().value!;
            this.bytes -= this.values.get(oldest)!.bytes; this.values.delete(oldest);
          }
          this.values.set(key, { json, bytes, expires: Date.now() + this.ttlMs }); this.bytes += bytes;
        }
        return json;
      })();
      this.pending.set(key, task);
    }
    try { return JSON.parse(await task); }
    finally { if (this.pending.get(key) === task) this.pending.delete(key); }
  }
}
