import { XMLParser } from 'fast-xml-parser';
import type { Indexer } from '@prisma/client';
import type { IndexerSearchResult } from './types.js';
import { parseQualityFromTitle } from '../../pipeline/qualityParser.js';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function attrValue(attrs: any[], name: string): string | undefined {
  const found = attrs.find((a) => a['@_name'] === name);
  return found?.['@_value'];
}

function attrValues(attrs: any[], name: string): string[] {
  return attrs.filter((a) => a['@_name'] === name).map((a) => a['@_value']);
}

// Standard Newznab/Torznab category taxonomy (consistent across compliant
// indexers): 3000 = Audio, 3020 = Audio > Video (i.e. music videos). vidarr
// exists to manage music videos specifically — an unscoped text search on a
// general-purpose indexer readily matches unrelated TV/movie titles that
// happen to share words with a song title (e.g. searching "Stand" or "Losing
// My Religion" can match completely unrelated releases). Always scope to this
// category unless the indexer is explicitly configured with something else.
const MUSIC_VIDEO_CATEGORY = 3020;
const MUSIC_CATEGORY = 3000;

// Torznab and Newznab share the same RSS+attr protocol shape (Newznab predates
// Torznab, which is just "Newznab for torrents") — one client handles both.
export async function searchIndexer(
  indexer: Indexer,
  query: string,
): Promise<IndexerSearchResult[]> {
  const url = new URL(indexer.baseUrl);
  url.searchParams.set('t', 'search');
  url.searchParams.set('q', query);
  if (indexer.apiKey) url.searchParams.set('apikey', indexer.apiKey);
  const configuredCategories: number[] = JSON.parse(indexer.categories || '[]');
  const categories = configuredCategories.length ? configuredCategories : [MUSIC_VIDEO_CATEGORY];
  url.searchParams.set('cat', categories.join(','));

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Indexer request failed: ${res.status} ${res.statusText}`);
  }
  const xml = await res.text();
  const parsed = parser.parse(xml);
  const items = asArray(parsed?.rss?.channel?.item);

  return items
    .map((item: any) => {
      const attrs = asArray(item['torznab:attr']);
      const sizeAttr = attrValue(attrs, 'size') ?? item.enclosure?.['@_length'];
      const seedersAttr = attrValue(attrs, 'seeders');
      const downloadUrl = item.link ?? item.enclosure?.['@_url'];
      const itemCategories = attrValues(attrs, 'category').map(Number);

      return {
        indexerId: indexer.id,
        indexerName: indexer.name,
        title: item.title as string,
        quality: parseQualityFromTitle(item.title as string),
        sizeBytes: sizeAttr ? Number(sizeAttr) : null,
        seeders: seedersAttr ? Number(seedersAttr) : null,
        downloadUrl,
        publishDate: item.pubDate ?? null,
        _categories: itemCategories,
      };
    })
    .filter((item) => {
      // Belt-and-suspenders: some indexers ignore the cat= filter server-side,
      // so also drop anything whose own reported category isn't music/music
      // video when we asked for that category (an indexer explicitly
      // configured for something else is left alone).
      if (!categories.includes(MUSIC_VIDEO_CATEGORY) || !item._categories.length) return true;
      return item._categories.some(
        (c) => c === MUSIC_VIDEO_CATEGORY || Math.floor(c / 1000) * 1000 === MUSIC_CATEGORY,
      );
    })
    .map(({ _categories, ...rest }) => rest);
}
