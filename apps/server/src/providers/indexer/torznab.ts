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
  const categories: number[] = JSON.parse(indexer.categories || '[]');
  if (categories.length) url.searchParams.set('cat', categories.join(','));

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Indexer request failed: ${res.status} ${res.statusText}`);
  }
  const xml = await res.text();
  const parsed = parser.parse(xml);
  const items = asArray(parsed?.rss?.channel?.item);

  return items.map((item: any) => {
    const attrs = asArray(item['torznab:attr']);
    const sizeAttr = attrValue(attrs, 'size') ?? item.enclosure?.['@_length'];
    const seedersAttr = attrValue(attrs, 'seeders');
    const downloadUrl = item.link ?? item.enclosure?.['@_url'];

    return {
      indexerId: indexer.id,
      indexerName: indexer.name,
      title: item.title as string,
      quality: parseQualityFromTitle(item.title as string),
      sizeBytes: sizeAttr ? Number(sizeAttr) : null,
      seeders: seedersAttr ? Number(seedersAttr) : null,
      downloadUrl,
      publishDate: item.pubDate ?? null,
    };
  });
}
