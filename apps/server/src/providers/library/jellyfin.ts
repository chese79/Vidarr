import type { LibraryConnector } from '@prisma/client';
import { normalizeTitle } from '../../pipeline/normalize.js';
import { createAuthedFetcher } from './util.js';
import type {
  FetchedLibraryArtist,
  LibraryConnectorProvider,
  LibraryConnectorTestResult,
  LibrarySection,
  PlaylistPushItem,
  PlaylistPushResult,
} from './types.js';

const { get: jellyfinGet, send: jellyfinSend } = createAuthedFetcher('Jellyfin', 'X-Emby-Token');

// One item per music video in the target library, matched by normalized
// title + artist (Jellyfin's MusicVideo items carry an Artists array). Exact
// normalized match only — good enough as long as vidarr's own naming
// convention (see pipeline/libraryConvention.ts) is what populated Jellyfin's
// scan in the first place.
async function findMusicVideoItem(
  config: LibraryConnector,
  userId: string,
  item: PlaylistPushItem,
): Promise<string | null> {
  const body = await jellyfinGet(
    config,
    `/Users/${userId}/Items?IncludeItemTypes=MusicVideo&Recursive=true&SearchTerm=${encodeURIComponent(item.title)}&ParentId=${encodeURIComponent(config.videoLibraryId ?? '')}&Fields=Artists`,
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
  return match?.Id ?? null;
}

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
      return { ok: true, musicLibraryId: user.Id as string };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },

  async fetchArtists(config): Promise<FetchedLibraryArtist[]> {
    if (!config.musicLibraryId) {
      throw new Error('Jellyfin connector has no resolved user id; run Test first.');
    }
    const body = await jellyfinGet(
      config,
      `/Users/${config.musicLibraryId}/Items?IncludeItemTypes=MusicArtist&Recursive=true`,
    );
    const items: any[] = body?.Items ?? [];
    return items.map((item) => ({
      externalId: item.Id as string,
      name: item.Name as string,
      genre: Array.isArray(item.Genres) && item.Genres.length ? item.Genres.join(', ') : undefined,
      playCount: item.UserData?.PlayCount as number | undefined,
    }));
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
    if (!config.musicLibraryId) {
      throw new Error('Jellyfin connector has no resolved user id; run Test first.');
    }
    if (!config.videoLibraryId) {
      throw new Error('No video library selected for this Jellyfin connector.');
    }
    const userId = config.musicLibraryId;

    const matchedIds: string[] = [];
    const unmatchedTitles: string[] = [];
    for (const item of items) {
      const id = await findMusicVideoItem(config, userId, item);
      if (id) matchedIds.push(id);
      else unmatchedTitles.push(`${item.artistName} - ${item.title}`);
    }

    // Full replace, not a diff — see PlaylistSync doc comment in schema.prisma.
    if (existingRemoteId) {
      await jellyfinSend(config, 'DELETE', `/Items/${existingRemoteId}`).catch(() => {});
    }

    const created = await jellyfinSend(config, 'POST', '/Playlists', {
      Name: name,
      Ids: matchedIds,
      UserId: userId,
      MediaType: 'Video',
    });

    return { remotePlaylistId: created.Id as string, matchedCount: matchedIds.length, unmatchedTitles };
  },
};
