import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryConnector } from '@prisma/client';
import { jellyfinProvider } from '../src/providers/library/jellyfin.js';
import { plexProvider } from '../src/providers/library/plex.js';

const config = { host: 'http://media-server', authToken: 'media-token', videoLibraryId: 'videos', userId: 'selected-user' } as LibraryConnector;
let connectorId = 0;
beforeEach(() => { config.id = ++connectorId; });
afterEach(() => vi.unstubAllGlobals());
function mockJson(body: any) { return { ok: true, status: 200, json: async () => body }; }
describe('current library playback', () => {
  it('reads all Jellyfin users while restricting playback to the selected virtual library', async () => {
    const sessions = ['selected-user', 'other-user'].map((UserId, index) => ({ Id: `device${index}`, UserId, PlaySessionId: `play${index}`,
      NowPlayingItem: { Id: `item${index}`, Type: 'MusicVideo', Name: 'Song', Artists: ['Artist'], RunTimeTicks: 120 * 10_000_000 },
      PlayState: { PositionTicks: 30 * 10_000_000, IsPaused: index === 1 } }));
    const mock = vi.fn().mockResolvedValueOnce(mockJson(sessions))
      .mockResolvedValueOnce(mockJson({ Items: [{ Id: 'item0' }, { Id: 'item1' }], TotalRecordCount: 2 }));
    vi.stubGlobal('fetch', mock);
    expect(await jellyfinProvider.fetchPlaybackSessions!(config)).toEqual([
      { sessionId: 'device0:play0', externalId: 'item0', positionSeconds: 30, durationSeconds: 120, playing: true, artistName: 'Artist', title: 'Song' },
      { sessionId: 'device1:play1', externalId: 'item1', positionSeconds: 30, durationSeconds: 120, playing: false, artistName: 'Artist', title: 'Song' },
    ]);
    expect(mock.mock.calls[0][0]).toBe('http://media-server/Sessions');
    expect(mock.mock.calls[0][1].headers.Authorization).toBe('MediaBrowser Token="media-token"');
    expect(mock.mock.calls[1][0]).toContain('/Items?ParentId=videos&Recursive=true');
    expect(mock.mock.calls[1][0]).not.toContain('Ids=');
  });
  it('excludes Jellyfin idle, audio, and other-library sessions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(mockJson([
      { Id: 'idle' }, { Id: 'audio', NowPlayingItem: { Id: 'audio', Type: 'Audio' } },
      { Id: 'other', NowPlayingItem: { Id: 'video', Type: 'MusicVideo', RunTimeTicks: 120 * 10_000_000 }, PlayState: { PositionTicks: 10, IsPaused: false } },
    ])).mockResolvedValueOnce(mockJson({ Items: [] })));
    expect(await jellyfinProvider.fetchPlaybackSessions!(config)).toEqual([]);
  });
  it('reads Plex sessions only in the selected section and treats buffering as non-playing', async () => {
    const item = { ratingKey: 'video', Session: { id: 'session' }, librarySectionID: 'videos', viewOffset: 30_000, duration: 120_000,
      Player: { state: 'playing' }, title: 'Song', grandparentTitle: 'Artist' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockJson({ MediaContainer: { Metadata: [
      item, { ...item, Session: { id: 'buffering' }, Player: { state: 'buffering' } }, { ...item, librarySectionID: 'other' },
      { ...item, viewOffset: undefined },
    ] } })));
    expect(await plexProvider.fetchPlaybackSessions!(config)).toEqual([
      { sessionId: 'session', externalId: 'video', positionSeconds: 30, durationSeconds: 120, playing: true, artistName: 'Artist', title: 'Song' },
      { sessionId: 'buffering', externalId: 'video', positionSeconds: 30, durationSeconds: 120, playing: false, artistName: 'Artist', title: 'Song' },
    ]);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('http://media-server/status/sessions');
    expect((vi.mocked(fetch).mock.calls[0][1]?.headers as Record<string, string>)['X-Plex-Token']).toBe('media-token');
  });
  it('does not poll a connector without a selected video library', async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect(await plexProvider.fetchPlaybackSessions!({ ...config, videoLibraryId: null })).toEqual([]);
    expect(await jellyfinProvider.fetchPlaybackSessions!({ ...config, videoLibraryId: null })).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
