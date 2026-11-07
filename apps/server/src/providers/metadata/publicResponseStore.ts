import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

// Disposable public MusicBrainz responses only. Batch/proposal/request journals
// remain in the database; cache failure must never fail or replan enrichment.
export class PublicResponseStore {
  private index?: Map<string, { file: string; expires: number; bytes: number }>;
  private operations: Promise<unknown> = Promise.resolve();
  private warned = false;
  constructor(private directory: string, private maxEntries = 4096, private maxBytes = 128 * 1024 * 1024) {}
  private async run<T>(work: () => Promise<T>): Promise<T | undefined> {
    const task = this.operations.then(work);
    this.operations = task.catch(() => {});
    try { return await task; }
    catch {
      this.index = undefined;
      if (!this.warned) { console.warn('MusicBrainz disk cache unavailable; continuing with live lookups.'); this.warned = true; }
      return undefined;
    }
  }
  private async entries() {
    if (this.index) return this.index;
    await fs.mkdir(this.directory, { recursive: true });
    const entries = new Map<string, { file: string; expires: number; bytes: number }>();
    // Expiration and serialized size in the name allow a bounded index without
    // loading every release's track list into memory on startup.
    for (const file of (await fs.readdir(this.directory)).sort()) {
      const match = /^(\d+)-(\d+)-([a-f0-9]{64})\.json$/.exec(file);
      if (!match) { if (/^[a-f0-9-]+\.tmp$/.test(file)) await fs.unlink(path.join(this.directory, file)); continue; }
      const expires = Number(match[1]), bytes = Number(match[2]);
      if (expires <= Date.now() || bytes > this.maxBytes || !Number.isSafeInteger(bytes)) { await fs.unlink(path.join(this.directory, file)); continue; }
      const previous = entries.get(match[3]);
      if (previous) await fs.unlink(path.join(this.directory, previous.file));
      entries.delete(match[3]); entries.set(match[3], { file, expires, bytes });
    }
    this.index = entries;
    await this.trim();
    return entries;
  }
  private async trim() {
    const entries = this.index!;
    let bytes = [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    for (const [key, entry] of entries) {
      if (entry.expires > Date.now() && entries.size <= this.maxEntries && bytes <= this.maxBytes) continue;
      await fs.unlink(path.join(this.directory, entry.file)).catch(error => { if (error.code !== 'ENOENT') throw error; });
      entries.delete(key); bytes -= entry.bytes;
    }
  }
  async get(key: string) {
    return this.run(async () => {
      const entries = await this.entries(), digest = createHash('sha256').update(key).digest('hex');
      const entry = entries.get(digest);
      if (!entry) return;
      try {
        if (entry.expires <= Date.now()) { await this.trim(); return; }
        const file = path.join(this.directory, entry.file);
        const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.bytes) throw Error('Invalid cache entry');
        const saved = JSON.parse(await fs.readFile(file, 'utf8'));
        if (saved.key !== key || saved.expires !== entry.expires || typeof saved.json !== 'string') throw Error('Invalid cache envelope');
        JSON.parse(saved.json);
        entries.delete(digest); entries.set(digest, entry);
        return { json: saved.json as string, expires: entry.expires };
      } catch {
        await fs.unlink(path.join(this.directory, entry.file)).catch(error => { if (error.code !== 'ENOENT') throw error; });
        entries.delete(digest);
      }
    });
  }
  async set(key: string, json: string, expires: number): Promise<void> {
    await this.run(async () => {
      const entries = await this.entries(), digest = createHash('sha256').update(key).digest('hex');
      const body = JSON.stringify({ key, expires, json }), bytes = Buffer.byteLength(body);
      if (bytes > this.maxBytes || expires <= Date.now()) return;
      const file = `${expires}-${bytes}-${digest}.json`, temporary = path.join(this.directory, `${randomUUID()}.tmp`);
      try {
        await fs.writeFile(temporary, body, { flag: 'wx', mode: 0o600 });
        await fs.rename(temporary, path.join(this.directory, file));
      } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      const previous = entries.get(digest);
      if (previous && previous.file !== file) await fs.unlink(path.join(this.directory, previous.file)).catch(error => { if (error.code !== 'ENOENT') throw error; });
      entries.delete(digest); entries.set(digest, { file, expires, bytes });
      await this.trim();
    });
  }
}
