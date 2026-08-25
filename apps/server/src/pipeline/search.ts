import { prisma, logActivity } from '../db/client.js';
import { searchIndexer } from '../providers/indexer/torznab.js';
import type { IndexerSearchResult } from '../providers/indexer/types.js';

export async function searchAllIndexers(query: string): Promise<IndexerSearchResult[]> {
  const indexers = await prisma.indexer.findMany({ where: { enabled: true } });
  const results: IndexerSearchResult[] = [];

  for (const indexer of indexers) {
    try {
      results.push(...(await searchIndexer(indexer, query)));
    } catch (err) {
      await logActivity('warn', `indexer:${indexer.name}`, err);
    }
  }

  return results.sort((a, b) => (b.seeders ?? 0) - (a.seeders ?? 0));
}
