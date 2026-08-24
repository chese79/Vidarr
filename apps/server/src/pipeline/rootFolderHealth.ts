import fs from 'node:fs/promises';
import { prisma } from '../db/client.js';

export async function checkRootFolders(): Promise<{ checked: number; inaccessible: number }> {
  const folders = await prisma.rootFolder.findMany();
  let inaccessible = 0;

  for (const folder of folders) {
    let accessible = true;
    let freeSpaceBytes: bigint | null = null;
    try {
      await fs.access(folder.path);
      // fs.statfs isn't available on every platform/Node build — free space is
      // best-effort; accessibility is the part that actually matters here.
      try {
        const stats = await fs.statfs(folder.path);
        freeSpaceBytes = BigInt(stats.bsize) * BigInt(stats.bavail);
      } catch {
        // leave freeSpaceBytes null
      }
    } catch {
      accessible = false;
      inaccessible++;
    }

    await prisma.rootFolder.update({
      where: { id: folder.id },
      data: { accessible, freeSpaceBytes, lastCheckedAt: new Date() },
    });
  }

  return { checked: folders.length, inaccessible };
}
