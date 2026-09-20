import { normalizeTitle } from '../../pipeline/normalize.js';
import { createAuthedFetcher } from './util.js';
import type {
  FetchedLibraryArtist,
  FetchedLibraryVideo,
  LibraryConnectorProvider,
  LibraryConnectorTestResult,
  LibraryItemMatch,
  LibrarySection,
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

export const jellyfinProvider: LibraryConnectorProvider = {
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
      `/Users/${config.userId}/Items?IncludeItemTypes=MusicArtist&Recursive=true&ParentId=${encodeURIComponent(config.musicLibraryId)}`,
    );
    const items: any[] = body?.Items ?? [];
    return items.map((item) => ({
      externalId: item.Id as string,
      name: item.Name as string,
      genre: Array.isArray(item.Genres) && item.Genres.length ? item.Genres.join(', ') : undefined,
      playCount: item.UserData?.PlayCount as number | undefined,
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
        `/Users/${config.userId}/Items?IncludeItemTypes=MusicVideo&Recursive=true&ParentId=${encodeURIComponent(config.videoLibraryId)}&Fields=Artists,ProductionYear,Path,UserData,ImageTags&StartIndex=${startIndex}&Limit=${limit}`,
      );
      const items: any[] = body?.Items ?? [];
      for (const item of items) {
        const artistName = (item.Artists?.[0] ?? item.AlbumArtist ?? 'Unknown Artist') as string;
        videos.push({
          externalId: item.Id as string,
          title: item.Name as string,
          artistName,
          releaseYear: item.ProductionYear as number | undefined,
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
      const match = await findLibraryItem(config, item);
      if (match) matchedIds.push(match.id);
      else unmatchedTitles.push(`${item.artistName} - ${item.title}`);
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

  findLibraryItem,
};
