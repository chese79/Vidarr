import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverYoutubeChannel, extractMusicItems, hasOfficialKeyword, parseMusicPage } from '../src/providers/youtube/musicDiscovery.js';
import { listChannelVideos, listPlaylistVideos } from '../src/providers/youtube/ytdlp.js';
vi.mock('../src/providers/youtube/ytdlp.js', () => ({ listChannelVideos: vi.fn(), listPlaylistVideos: vi.fn() }));
const playlist = (id: string, title: string) => ({ musicTwoRowItemRenderer: { title: { runs: [{ text: title }] }, navigationEndpoint: { browseEndpoint: { browseId: 'VL' + id } } } });
const video = (id: string, title: string) => ({ musicTwoRowItemRenderer: { title: { runs: [{ text: title }] }, navigationEndpoint: { watchEndpoint: { videoId: id } } } });
const shelf = (title: string, contents: unknown[], browseId?: string) => ({ musicCarouselShelfRenderer: {
  header: { musicCarouselShelfBasicHeaderRenderer: { title: { runs: [{ text: title }] }, ...(browseId ? { moreContentButton: { buttonRenderer: { navigationEndpoint: { browseEndpoint: { browseId } } } } } : {}) } }, contents,
} });
function html(data: unknown) {
  const encoded = JSON.stringify(data).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\x22');
  return `ytcfg.set({"INNERTUBE_CLIENT_VERSION":"1.20261016","INNERTUBE_CONTEXT":{"client":{"visitorData":"public-page-context"}}}); initialData.push({path: '/browse', params: JSON.parse('{}'), data: '${encoded}'});`;
}
describe('YouTube Music shelf traversal', () => {
  beforeEach(() => { vi.resetAllMocks(); vi.mocked(listChannelVideos).mockResolvedValue([]); vi.mocked(listPlaylistVideos).mockResolvedValue([]); });
  afterEach(() => vi.unstubAllGlobals());
  it('parses escaped public data without executing page scripts and matches whole-word official', () => {
    const data = shelf('Official videos', [video('abcdefghijk', "Band - Don't Stop")]);
    expect(parseMusicPage(html(data) + '; throw new Error("do not execute");').data).toEqual([data]);
    expect(hasOfficialKeyword('OFFICIAL Music Videos')).toBe(true);
    expect(hasOfficialKeyword('Unofficial Video')).toBe(false);
    expect(() => parseMusicPage('<html>Consent or changed markup</html>')).toThrow(/incomplete/);
  });
  it('ignores album/recommendation shelves while retaining official categories', () => {
    const found = extractMusicItems([shelf('Albums', [playlist('album', 'Official Audio')]), shelf('Fans also like', [video('wrongartist', 'Official Video')]), shelf('Official Videos', [video('abcdefghijk', 'Band - Song')])]);
    expect(found.playlists).toHaveLength(0);
    expect(found.videos).toEqual([expect.objectContaining({ id: 'abcdefghijk', officialCategory: 'Official Videos' })]);
  });
  it('continues from an empty uploads tab and merges category evidence for duplicate video IDs', async () => {
    vi.mocked(listChannelVideos).mockResolvedValue([{ youtubeVideoId: 'abcdefghijk', title: 'Band - Song (Video)', sourcePublishedAt: new Date('2020-01-01') }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(html([shelf('Videos', [video('abcdefghijk', 'Band - Song (Video)')]), shelf('Playlists by Band', [playlist('PLofficial', 'Official Music Videos')])]))));
    vi.mocked(listPlaylistVideos).mockResolvedValue([{ youtubeVideoId: 'abcdefghijk', title: 'Band - Song (Video)', channel: 'BandVEVO' }]);
    const result = await discoverYoutubeChannel('https://music.youtube.com/channel/UCband');
    expect(result.errors).toEqual([]);
    expect(result.videos).toHaveLength(1);
    expect(result.videos[0]).toMatchObject({ sourcePublishedAt: new Date('2020-01-01'), officialEvidence: ['category:Official Music Videos'] });
    expect(listPlaylistVideos).toHaveBeenCalledWith('https://www.youtube.com/playlist?list=PLofficial');
  });
  it('follows View all and continuation pages to discover official playlists beyond the home page', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(html(shelf('Playlists by Band', [], 'UCband'))))
      .mockResolvedValueOnce(Response.json({ contents: [playlist('PLfirst', 'Band songs')], continuations: [{ nextContinuationData: { continuation: 'next-page' } }] }))
      .mockResolvedValueOnce(Response.json({ contents: [playlist('PLofficial', 'Official Videos')] }));
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(listPlaylistVideos).mockResolvedValue([{ youtubeVideoId: 'abcdefghijk', title: 'Band - Song', channel: 'Band' }]);
    const result = await discoverYoutubeChannel('https://www.youtube.com/channel/UCband');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ context: { client: { visitorData: 'public-page-context', clientName: 'WEB_REMIX' } } });
    expect(fetchMock.mock.calls[1][1].headers['X-YouTube-Client-Name']).toBe('67');
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({ continuation: 'next-page' });
    expect(result.errors).toEqual([]);
    expect(result.videos[0].officialEvidence).toContain('category:Official Videos');
  });
  it('retains discovered videos when a playlist fails, and reports incomplete coverage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(html(shelf('Playlists by Band', [playlist('PLbad', 'Official Videos'), playlist('PLgood', 'Official Clips')])))));
    vi.mocked(listPlaylistVideos).mockRejectedValueOnce(new Error('playlist unavailable')).mockResolvedValueOnce([{ youtubeVideoId: 'abcdefghijk', title: 'Band - Song', channel: 'Band' }]);
    const result = await discoverYoutubeChannel('https://www.youtube.com/channel/UCband');
    expect(result.errors).toEqual(['playlist unavailable']);
    expect(result.videos).toHaveLength(1);
  });
  it('reports looping continuations while still expanding playlists already found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url, options) => options?.method === 'POST' ? Response.json({ contents: [playlist('PLgood', 'Official Videos')], nextContinuationData: { continuation: 'same' } }) : new Response(html(shelf('Playlists by Band', [], 'UCband')))));
    const result = await discoverYoutubeChannel('https://www.youtube.com/channel/UCband');
    expect(result.errors.join()).toMatch(/repeated a continuation/);
    expect(listPlaylistVideos).toHaveBeenCalledWith('https://www.youtube.com/playlist?list=PLgood');
  });
  it('reports a header-only View all response as partial, not a successful empty result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(html(shelf('Playlists by Band', [], 'UCband')))).mockResolvedValueOnce(Response.json({ header: { title: 'Music' } })));
    const result=await discoverYoutubeChannel('https://music.youtube.com/channel/UCband');
    expect(result.errors.join()).toMatch(/no readable content/);
  });
});
