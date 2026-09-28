import { describe, expect, it, vi } from 'vitest';
import { mapArtist } from '../src/providers/metadata/musicbrainz.js';
import { findPublicArtistSlug, parsePublicArtistVideos } from '../src/providers/metadata/imvdb.js';
import { channelHasNoVideosTab, channelVideosUrl, parseYoutubePublishedFeed } from '../src/providers/youtube/ytdlp.js';
import { excludedMusicVideoTitleReason } from '../src/pipeline/youtubeValidation.js';

describe('Amy Grant full-scope source boundaries', () => {
  it('reads public publication dates from the recent YouTube channel feed', () => {
    const dates = parseYoutubePublishedFeed('<feed><entry><yt:videoId>song-1</yt:videoId><published>2026-09-27T12:30:00+00:00</published></entry>'
      + '<entry><yt:videoId>song-2</yt:videoId><published>invalid</published></entry></feed>');
    expect(dates.get('song-1')?.toISOString()).toBe('2026-09-27T12:30:00.000Z');
    expect(dates.has('song-2')).toBe(false);
  });
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

  it('retains punctuation in R.E.M.\'s linked IMVDb slug', () => {
    expect(mapArtist({ id: 'ea4dfa26-f633-4da6-a52a-f49ea4897b58', name: 'R.E.M.', relations: [
      { url: { resource: 'https://imvdb.com/n/r.e.m.' } },
    ] }).imvdbSlug).toBe('r.e.m.');
  });

  it('keeps same-title official video versions separate and excludes guest appearances', () => {
    const row = (slug: string, title: string, year: number) => `<tr><td><img data-src="https://example.com/${slug}.jpg"></td><td><strong><a href="https://imvdb.com/video/amy-grant/${slug}">${title}</a></strong> (${year})</td></tr>`;
    const html = `<h1>Videography</h1><div id="artist-credits"><table>${row('house-of-love', 'House of Love', 1994)}${row('house-of-love/2', 'House of Love', 1991)}${row('baby-baby', 'Baby, Baby', 1991)}</table></div><div class="anchorOffset" id="appearance"></div><table><tr><td><strong><a href="https://imvdb.com/video/amy-grant/guest">Guest Video</a></strong></td></tr></table>`;
    expect(parsePublicArtistVideos(html, 'amy-grant').map((video) => video.title)).toEqual([
      'House of Love', 'House of Love (Version 2)', 'Baby, Baby',
    ]);
  });

  it('finds an unlinked public artist page only when its displayed identity matches', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, text: async () => '<title>Mike Watt | IMVDb</title>' })
      .mockResolvedValueOnce({ ok: true, text: async () => '<title>Someone Else | IMVDb</title>' });
    vi.stubGlobal('fetch', fetchMock);
    try {
      expect(await findPublicArtistSlug('Mike Watt')).toBe('mike-watt');
      expect(await findPublicArtistSlug('Mike Watt')).toBeNull();
      expect(fetchMock).toHaveBeenCalledWith('https://imvdb.com/n/mike-watt', expect.any(Object));
    } finally { vi.unstubAllGlobals(); }
  });

  it('scans the channel video tab and filters Amy Grant podcast, lyric, and live uploads', () => {
    expect(channelHasNoVideosTab('ERROR: This channel does not have a videos tab')).toBe(true);
    expect(channelHasNoVideosTab('ERROR: Sign in to confirm you are not a bot')).toBe(false);
    expect(channelVideosUrl('https://www.youtube.com/channel/UCZSki0usQ84d5cVkiWxy2UQ'))
      .toBe('https://www.youtube.com/channel/UCZSki0usQ84d5cVkiWxy2UQ/videos');
    expect(excludedMusicVideoTitleReason('The Me That Remains - Album Podcast - Episode 8')).toMatch(/podcast/);
    expect(excludedMusicVideoTitleReason('Amy Grant - The Saint (Official Lyric Video)')).toMatch(/lyric/);
    expect(excludedMusicVideoTitleReason('Amy Grant - Baby Baby (From Time Again…Live)')).toMatch(/live/);
    expect(excludedMusicVideoTitleReason('Lead Me On (Live Music Video)')).toMatch(/live/);
    expect(excludedMusicVideoTitleReason('AC/DC - Highway to Hell (Official Video - AC/DC Live)')).toMatch(/live/);
    expect(excludedMusicVideoTitleReason('AC/DC - Let There Be Rock (Live Stuttgart 2000)')).toMatch(/live/);
    expect(excludedMusicVideoTitleReason('AC/DC - Live Wire (Official Video)')).toBeNull();
    expect(excludedMusicVideoTitleReason('Amy Grant - The Me That Remains (Official Music Video)')).toBeNull();
  });
});
