import { prisma } from '../db/client.js';
import { searchIndexer } from '../providers/indexer/torznab.js';
import type { IndexerSearchResult } from '../providers/indexer/types.js';

export async function searchAllIndexers(query: string): Promise<IndexerSearchResult[]> {
  const indexers = await prisma.indexer.findMany({ where: { enabled: true } });
  const results: IndexerSearchResult[] = [];

  for (const indexer of indexers) {
    try {
      results.push(...(await searchIndexer(indexer, query)));
    } catch (err) {
      await prisma.activityLog.create({
        data: { level: 'warn', source: `indexer:${indexer.name}`, message: (err as Error).message },
      });
    }
  }

  return results.sort((a, b) => (b.seeders ?? 0) - (a.seeders ?? 0));
}
