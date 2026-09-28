import { describe, expect, it } from 'vitest';
import { downloadableSelectedIds, type DownloadSelectionVideo } from '../../web/src/pages/downloadSelection.js';

const video = (id: number, changes: Partial<DownloadSelectionVideo> = {}): DownloadSelectionVideo => ({
  id, hasFile: false, ignored: false, youtubeVideoId: null,
  status: { acquisition: null }, acquisitionSources: [{ accepted: true, url: 'https://www.youtube.com/watch?v=abc' }],
  ...changes,
});

describe('artist selected downloads', () => {
  it('includes only selected videos with an accepted direct source and no active download', () => {
    const videos = [
      video(1), video(2, { youtubeVideoId: 'abc', acquisitionSources: [] }),
      video(3, { ignored: true }), video(4, { hasFile: true }),
      video(5, { status: { acquisition: 'downloading' } }),
      video(6, { acquisitionSources: [{ accepted: false, url: 'https://example.com/video' }] }),
      video(7, { status: { acquisition: 'failed' } }),
      video(8),
    ];
    expect(downloadableSelectedIds(videos, new Set([1, 2, 3, 4, 5, 6, 7]))).toEqual([1, 2, 7]);
  });
});
