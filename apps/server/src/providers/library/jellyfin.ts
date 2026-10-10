import type { LibraryConnector } from '@prisma/client';
import { normalizeTitle } from '../../pipeline/normalize.js';
import { createAuthedFetcher, isNotFound } from './util.js';
import type {
  FetchedLibraryArtist,
  FetchedLibraryVideo,
  LibraryConnectorProvider,
  LibraryConnectorTestResult,
  LibraryItemMatch,
  LibrarySection,
  PlaylistPushItem,
  PlaylistPushResult,
} from './types.js';

// Jellyfin 12 disables the legacy X-Emby-Token header by default. The
// MediaBrowser Authorization scheme is accepted by both current and older
// Jellyfin releases, so use it for all connector requests.
const { get: jellyfinGet, send: jellyfinSend, getBinary: jellyfinGetBinary } = createAuthedFetcher(
  'Jellyfin',
  'Authorization',
  (token) => `MediaBrowser Token="${token}"`,
);

const playbackLibraries = new Map<number, { signature: string; expiresAt: number; ids: Set<string> }>();
async function playbackLibraryIds(config: LibraryConnector): Promise<Set<string>> {
  const signature = JSON.stringify([config.host, config.authToken, config.videoLibraryId]);
  const cached = playbackLibraries.get(config.id);
  if (cached?.signature === signature && cached.expiresAt > Date.now()) return cached.ids;
  const ids = new Set<string>();
  for (let start = 0; ; start += 500) {
    // Jellyfin's Ids filter bypasses ParentId, and virtual library IDs are not
    // physical ancestors. Enumerate the selected library instead; cache only
    // one minute while active playback exists to keep polling inexpensive.
    const body = await jellyfinGet(config, `/Items?ParentId=${encodeURIComponent(config.videoLibraryId!)}&Recursive=true&IncludeItemTypes=MusicVideo&EnableImages=false&EnableUserData=false&StartIndex=${start}&Limit=500`);
    if (!Array.isArray(body?.Items)) throw new Error('Jellyfin returned invalid library membership');
    for (const item of body.Items) if (item.Id) ids.add(String(item.Id));
    if (body.Items.length < 500 || start + body.Items.length >= body.TotalRecordCount) break;
  }
  playbackLibraries.set(config.id, { signature, ids, expiresAt: Date.now() + 60_000 });
  return ids;
}

// One item per music video in the target library, matched by normalized
// title + artist (Jellyfin's MusicVideo items carry an Artists array). Exact
// normalized match only — good enough as long as vidarr's own naming
// convention (see pipeline/libraryConvention.ts) is what populated Jellyfin's
// scan in the first place. UserData.PlayCount comes free on the same search
// response, so playlist push and play-count sync share this one lookup.
const findLibraryItem: LibraryConnectorProvider['findLibraryItem'] = async (config, item) => {
  if (!config.userId) {
    throw new Error('Jellyfin connector has no resolved user id; run Test first.');
  }
  const body = await jellyfinGet(
    config,
    `/Users/${config.userId}/Items?IncludeItemTypes=MusicVideo&Recursive=true&SearchTerm=${encodeURIComponent(item.title)}&ParentId=${encodeURIComponent(config.videoLibraryId ?? '')}&Fields=Artists`,
  );
  const candidates: any[] = body?.Items ?? [];
  const wantTitle = normalizeTitle(item.title);
  const wantArtist = normalizeTitle(item.artistName);
  const match = candidates.find((c) => {
    const titleMatches = normalizeTitle(c.Name ?? '') === wantTitle;
    const artists: string[] = c.Artists ?? [];
    const artistMatches = artists.some((a) => normalizeTitle(a) === wantArtist);
    return titleMatches && artistMatches;
  });
  if (!match) return null;
  const result: LibraryItemMatch = { id: match.Id as string, playCount: match.UserData?.PlayCount ?? null };
  return result;
};

// Prefers the item id the library sync already reconciled (see the Plex
// provider's twin of this helper for why): it pins one specific video, and is
// still verified live so a rescan that re-keyed or removed the item between
// syncs is caught. Only a definite 404 falls back to the title+artist search;
// any other failure propagates rather than silently degrading the push.
async function resolvePlaylistItemId(config: LibraryConnector, item: PlaylistPushItem): Promise<string | null> {
  if (item.externalId) {
    try {
      const found = await jellyfinGet(config, `/Users/${config.userId}/Items/${encodeURIComponent(item.externalId)}`);
      if (found?.Id) return found.Id as string;
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }
  return (await findLibraryItem!(config, item))?.id ?? null;
}

export const jellyfinProvider: LibraryConnectorProvider = {
  async fetchPlaybackSessions(config) {
    if (!config.videoLibraryId) return [];
    const sessions = await jellyfinGet(config, '/Sessions');
    if (!Array.isArray(sessions)) throw new Error('Jellyfin returned invalid playback sessions');
    const result = [];
    const candidates = sessions.filter((session: any) => session.NowPlayingItem?.Type === 'MusicVideo');
    if (!candidates.length) return [];
    const libraryIds = await playbackLibraryIds(config);
    for (const session of candidates) {
      const item = session.NowPlayingItem;
      const state = session.PlayState;
      if (!session.Id || !item?.Id || item.Type !== 'MusicVideo' || !state
        || typeof state.PositionTicks !== 'number' || typeof item.RunTimeTicks !== 'number') continue;
      if (!libraryIds.has(String(item.Id))) continue;
      result.push({
        sessionId: `${session.Id}:${session.PlaySessionId ?? ''}`,
        externalId: String(item.Id), positionSeconds: state.PositionTicks / 10_000_000,
        durationSeconds: item.RunTimeTicks / 10_000_000, playing: state.IsPaused === false,
        artistName: item.Artists?.[0] ?? item.AlbumArtist, title: item.Name,
      });
    }
    return result;
  },
  async testConnection(config): Promise<LibraryConnectorTestResult> {
    try {
      await jellyfinGet(config, '/System/Info');
      const users: any[] = await jellyfinGet(config, '/Users');
      const user = users.find(
        (u) => u.Name?.toLowerCase() === (config.username ?? '').toLowerCase(),
      );
      if (!user) {
        return { ok: false, message: `No Jellyfin user named "${config.username}" found.` };
      }
      return { ok: true, userId: user.Id as string };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },

  async fetchArtists(config): Promise<FetchedLibraryArtist[]> {
    if (!config.userId) {
      throw new Error('Jellyfin connector has no resolved user id; run Test first.');
    }
    if (!config.musicLibraryId) {
      throw new Error('No music library selected for this Jellyfin connector.');
    }
    const body = await jellyfinGet(
      config,
      `/Users/${config.userId}/Items?IncludeItemTypes=MusicArtist&Recursive=true&ParentId=${encodeURIComponent(config.musicLibraryId)}&Fields=Genres,UserData,ProviderIds`,
    );
    const items: any[] = body?.Items ?? [];
    return items.map((item) => ({
      externalId: item.Id as string,
      name: item.Name as string,
      genre: Array.isArray(item.Genres) && item.Genres.length ? item.Genres.join(', ') : undefined,
      playCount: item.UserData?.PlayCount as number | undefined,
      musicbrainzArtistId: item.ProviderIds?.MusicBrainzArtist as string | undefined,
      musicbrainzSource: item.ProviderIds?.MusicBrainzArtist ? 'connector' as const : undefined,
    }));
  },

  async fetchVideos(config): Promise<FetchedLibraryVideo[]> {
    if (!config.userId) {
      throw new Error('Jellyfin connector has no resolved user id; run Test first.');
    }
    if (!config.videoLibraryId) {
      throw new Error('No music-video library selected for this Jellyfin connector.');
    }

    const videos: FetchedLibraryVideo[] = [];
    const limit = 500;
    for (let startIndex = 0; ; startIndex += limit) {
      const body = await jellyfinGet(
        config,
        `/Users/${config.userId}/Items?IncludeItemTypes=MusicVideo&Recursive=true&ParentId=${encodeURIComponent(config.videoLibraryId)}&Fields=Artists,ProductionYear,Path,UserData,ImageTags,RunTimeTicks&StartIndex=${startIndex}&Limit=${limit}`,
      );
      const items: any[] = body?.Items ?? [];
      for (const item of items) {
        const artistName = (item.Artists?.[0] ?? item.AlbumArtist ?? 'Unknown Artist') as string;
        videos.push({
          externalId: item.Id as string,
          title: item.Name as string,
          artistName,
          releaseYear: item.ProductionYear as number | undefined,
          durationSeconds: typeof item.RunTimeTicks === 'number' ? Math.round(item.RunTimeTicks / 10_000_000) : undefined,
          path: item.Path as string | undefined,
          playCount: item.UserData?.PlayCount as number | undefined,
          hasThumbnail: Boolean(item.ImageTags?.Primary),
        });
      }
      // A short page always means "last page" regardless of TotalRecordCount.
      // Only trust the TotalRecordCount-based early-stop when Jellyfin
      // actually sent one — falling back to `videos.length` here would make
      // `videos.length >= videos.length` trivially true and silently cut the
      // inventory off after the very first page whenever that field is
      // missing.
      const total = body?.TotalRecordCount;
      if (items.length < limit || (typeof total === 'number' && videos.length >= total)) break;
    }
    return videos;
  },

  async fetchVideoThumbnail(config, externalId) {
    return jellyfinGetBinary(config, `/Items/${encodeURIComponent(externalId)}/Images/Primary?maxWidth=640&quality=85`);
  },

  async fetchArtistImage(config, externalId) {
    return jellyfinGetBinary(config, `/Items/${encodeURIComponent(externalId)}/Images/Primary?maxWidth=400&quality=90`);
  },

  async listSections(config): Promise<LibrarySection[]> {
    const folders: any[] = await jellyfinGet(config, '/Library/VirtualFolders');
    return folders.map((f) => ({
      id: f.ItemId as string,
      title: f.Name as string,
      type: f.CollectionType ?? 'unknown',
    }));
  },

  async pushPlaylist(config, { name, items, existingRemoteId }): Promise<PlaylistPushResult> {
    if (!config.userId) {
      throw new Error('Jellyfin connector has no resolved user id; run Test first.');
    }
    if (!config.videoLibraryId) {
      throw new Error('No video library selected for this Jellyfin connector.');
    }

    const matchedIds: string[] = [];
    const unmatchedTitles: string[] = [];
    for (const item of items) {
      const id = await resolvePlaylistItemId(config, item);
      if (id) matchedIds.push(id);
      else unmatchedTitles.push(`${item.artistName} - ${item.title}`);
    }
    if (existingRemoteId && unmatchedTitles.length) {
      throw new Error(`Keeping the existing Jellyfin playlist: ${unmatchedTitles.length} item(s) are not in the selected video library`);
    }
    if (!matchedIds.length) {
      throw new Error('None of this playlist’s videos were found in the selected Jellyfin video library');
    }

    // Create first so a transient Jellyfin failure never destroys the last
    // known-good playlist. If deleting the old playlist fails, remove the new
    // one again and surface the error rather than silently leaving duplicates.
    const created = await jellyfinSend(config, 'POST', '/Playlists', {
      Name: name,
      Ids: matchedIds,
      UserId: config.userId,
      MediaType: 'Video',
    });
    const remotePlaylistId = created.Id as string;

    if (existingRemoteId) {
      try {
        await jellyfinSend(config, 'DELETE', `/Items/${existingRemoteId}`);
      } catch (err) {
        await jellyfinSend(config, 'DELETE', `/Items/${remotePlaylistId}`).catch(() => {});
        throw err;
      }
    }

    return { remotePlaylistId, matchedCount: matchedIds.length, unmatchedTitles };
  },

  async deletePlaylist(config, remotePlaylistId) {
    try {
      await jellyfinSend(config, 'DELETE', `/Items/${encodeURIComponent(remotePlaylistId)}`);
    } catch (err) {
      // Already gone (deleted in Jellyfin by hand) is the state we wanted.
      if (!isNotFound(err)) throw err;
    }
  },

  findLibraryItem,

  async refreshVideoLibrary(config) {
    if (!config.videoLibraryId) throw new Error('Select a Jellyfin music-video library before requesting its scan.');
    const folders = await jellyfinGet(config, '/Library/VirtualFolders');
    const selected = folders.find((folder: { ItemId: string }) => folder.ItemId === config.videoLibraryId);
    if (!Array.isArray(selected?.Locations) || !selected.Locations.length) throw new Error('Selected Jellyfin library has no accessible media roots.');
    // Item refresh alone does not report new filesystem entries. Notify only
    // this library's physical roots, then refresh metadata without replacing it.
    await jellyfinSend(config, 'POST', '/Library/Media/Updated', {
      Updates: selected.Locations.map((Path: string) => ({ Path, UpdateType: 'Created' })),
    });
    await jellyfinSend(config, 'POST', `/Items/${encodeURIComponent(config.videoLibraryId)}/Refresh?MetadataRefreshMode=Default&ImageRefreshMode=Default&ReplaceAllMetadata=false&ReplaceAllImages=false`);
  },
};
