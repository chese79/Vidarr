import { expect, it } from 'vitest';
import { CATALOG_LABELS, isUnfilteredScreen, matchesCatalog, parseCatalogMode } from '../../web/src/catalogMode.js';

it('defaults invalid saved filters to Music Videos and retains valid category choices', () => {
  expect(parseCatalogMode(null)).toBe('musicVideos');
  expect(parseCatalogMode('unknown')).toBe('musicVideos');
  expect(parseCatalogMode('live')).toBe('live');
  expect(parseCatalogMode('both')).toBe('both');
  expect(CATALOG_LABELS.live).toBe('Live & Concerts');
});

it('keeps Queue, its result pages and History explicitly outside the global filter', () => {
  for (const path of ['/queue', '/queue/completed', '/queue/failures', '/history']) expect(isUnfilteredScreen(path)).toBe(true);
  for (const path of ['/', '/artist/1', '/live', '/discover', '/playlists', '/history-other']) expect(isUnfilteredScreen(path)).toBe(false);
});

it('filters mixed playlist entries without changing their saved sequence', () => {
  const items = [{ musicVideoId: 1 }, { musicVideoId: null, recordingPartId: 2 }, { musicVideoId: 3, musicVideo: { catalogKind: 'liveClassified' } }];
  expect(items.filter(item => matchesCatalog('musicVideos', item))).toEqual([items[0]]);
  expect(items.filter(item => matchesCatalog('live', item))).toEqual([items[1], items[2]]);
  expect(items.filter(item => matchesCatalog('both', item))).toEqual(items);
  expect(items.map(item => item.musicVideoId)).toEqual([1, null, 3]);
  expect(matchesCatalog('live', { musicVideoId: null })).toBe(false);
  expect(matchesCatalog('both', { musicVideoId: null })).toBe(true);
});
