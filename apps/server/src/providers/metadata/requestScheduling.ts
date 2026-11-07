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
  private lastStartedAt: number | undefined;
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
        const delay = this.lastStartedAt === undefined ? 0 : Math.max(0, this.intervalMs - (Date.now() - this.lastStartedAt));
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        // Select after the wait so newly arrived interactive work gets its turn.
        let next: (() => Promise<void>) | undefined;
        while (!next) next = this.queues[this.rotation[this.cursor++ % this.rotation.length]].shift();
        this.lastStartedAt = Date.now();
        await next();
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
  constructor(private ttlMs = 15 * 60_000, private maxEntries = 256, private maxBytes = 32 * 1024 * 1024,
    private store?: { get(key: string): Promise<{ json: string; expires: number } | undefined>; set(key: string, json: string, expires: number): Promise<void> }) {}
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
        const saved = await this.store?.get(key);
        if (saved && saved.expires > Date.now()) {
          this.remember(key, saved.json, saved.expires);
          return saved.json;
        }
        const json = JSON.stringify(await load());
        const expires = Date.now() + this.ttlMs;
        this.remember(key, json, expires);
        await this.store?.set(key, json, expires);
        return json;
      })();
      this.pending.set(key, task);
    }
    try { return JSON.parse(await task); }
    finally { if (this.pending.get(key) === task) this.pending.delete(key); }
  }
  private remember(key: string, json: string, expires: number) {
    const bytes = Buffer.byteLength(json);
    if (bytes > this.maxBytes) return;
    while (this.values.size && (this.values.size >= this.maxEntries || this.bytes + bytes > this.maxBytes)) {
      const oldest = this.values.keys().next().value!;
      this.bytes -= this.values.get(oldest)!.bytes; this.values.delete(oldest);
    }
    this.values.set(key, { json, bytes, expires }); this.bytes += bytes;
  }
}
