import { describe, expect, it } from 'vitest';
import { mapArtist } from '../src/providers/metadata/musicbrainz.js';
import { parsePublicArtistVideos } from '../src/providers/metadata/imvdb.js';
import { channelVideosUrl } from '../src/providers/youtube/ytdlp.js';
import { excludedMusicVideoTitleReason } from '../src/pipeline/youtubeValidation.js';

describe('Amy Grant full-scope source boundaries', () => {
  it('reads the direct IMVDb artist slug and YouTube channel from MusicBrainz URL relationships', () => {
    const artist = mapArtist({
      id: '3cd18a93-1797-4bbb-9b8a-c096d5e7864c', name: 'Amy Grant',
      relations: [
        { 'type-id': 'd94fb61c-fa20-4e3c-a19a-71a949fb2c55', url: { resource: 'https://imvdb.com/n/amy-grant' } },
        { 'type-id': '6a540e5b-58c6-4192-b6ba-dbc71ec8fcf0', url: { resource: 'https://www.youtube.com/channel/UCIneJfQU5QYRexcOckYiDpA' } },
      ],
    });
    expect(artist.imvdbSlug).toBe('amy-grant');
    expect(artist.youtubeChannels).toEqual(['https://www.youtube.com/channel/UCIneJfQU5QYRexcOckYiDpA']);
  });

  it('keeps same-title official video versions separate and excludes guest appearances', () => {
    const row = (slug: string, title: string, year: number) => `<tr><td><img data-src="https://example.com/${slug}.jpg"></td><td><strong><a href="https://imvdb.com/video/amy-grant/${slug}">${title}</a></strong> (${year})</td></tr>`;
    const html = `<h1>Videography</h1><div id="artist-credits"><table>${row('house-of-love', 'House of Love', 1994)}${row('house-of-love/2', 'House of Love', 1991)}${row('baby-baby', 'Baby, Baby', 1991)}</table></div><div class="anchorOffset" id="appearance"></div><table><tr><td><strong><a href="https://imvdb.com/video/amy-grant/guest">Guest Video</a></strong></td></tr></table>`;
    expect(parsePublicArtistVideos(html, 'amy-grant').map((video) => video.title)).toEqual([
      'House of Love', 'House of Love (Version 2)', 'Baby, Baby',
    ]);
  });

  it('scans the channel video tab and filters Amy Grant podcast, lyric, and live uploads', () => {
    expect(channelVideosUrl('https://www.youtube.com/channel/UCZSki0usQ84d5cVkiWxy2UQ'))
      .toBe('https://www.youtube.com/channel/UCZSki0usQ84d5cVkiWxy2UQ/videos');
    expect(excludedMusicVideoTitleReason('The Me That Remains - Album Podcast - Episode 8')).toMatch(/podcast/);
    expect(excludedMusicVideoTitleReason('Amy Grant - The Saint (Official Lyric Video)')).toMatch(/lyric/);
    expect(excludedMusicVideoTitleReason('Amy Grant - Baby Baby (From Time Again…Live)')).toMatch(/live/);
    expect(excludedMusicVideoTitleReason('Amy Grant - The Me That Remains (Official Music Video)')).toBeNull();
  });
});
