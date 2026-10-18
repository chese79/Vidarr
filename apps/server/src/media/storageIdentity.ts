import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const FILE = '.vidarr-storage-id';
export async function storageIdentity(root: string, create = false): Promise<string | null> {
  const filename = path.join(root, FILE);
  if (create) {
    try { await fs.writeFile(filename, randomUUID(), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return null; }
  }
  try {
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 100) return null;
    const value = (await fs.readFile(filename, 'utf8')).trim();
    return /^[0-9a-f-]{36}$/i.test(value) ? value : null;
  } catch { return null; }
}
