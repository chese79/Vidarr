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

const { get: plexGet, send: plexSend, getBinary: plexGetBinary } = createAuthedFetcher('Plex', 'X-Plex-Token');

function plexMusicBrainzArtistId(artist: any): string | undefined {
  const guids: string[] = [artist.guid, ...(artist.Guid ?? []).map((entry: any) => entry.id)].filter(Boolean);
  const match = guids.map((value) => String(value).match(/musicbrainz:\/\/artist\/([0-9a-f-]{36})/i)).find(Boolean);
  return match?.[1]?.toLowerCase();
}

// Plex has no first-class "music video" item type — vidarr's video library is
// whatever Plex section (Movies / Home Videos / Other Videos) the user points
// it at. Without a native Artist field on those item types, matching falls
// back to an exact normalized-title text search within that one section.
// `viewCount` (absent = never played) comes free on the same search
// response, so playlist push and play-count sync share this one lookup.
// UNVERIFIED against a real Plex server (none was available while building
// this) — confirm against your own instance before relying on it, and expect
// to adjust the `type=1` (movie) filter or the fields used for artist
// matching/play count once you see real item shapes.
const findLibraryItem: LibraryConnectorProvider['findLibraryItem'] = async (config, item) => {
  const body = await plexGet(
    config,
    `/library/sections/${config.videoLibraryId}/all?type=1&title=${encodeURIComponent(item.title)}`,
  );
  const candidates: any[] = body?.MediaContainer?.Metadata ?? [];
  const wantTitle = normalizeTitle(item.title);
  const match = candidates.find((c) => normalizeTitle(c.title ?? '') === wantTitle);
  if (!match) return null;
  const result: LibraryItemMatch = { id: String(match.ratingKey), playCount: match.viewCount ?? null };
  return result;
};

export const plexProvider: LibraryConnectorProvider = {
  async testConnection(config): Promise<LibraryConnectorTestResult> {
    try {
      const body = await plexGet(config, '/library/sections');
      const sections: any[] = body?.MediaContainer?.Directory ?? [];
      const musicSection = sections.find((s) => s.type === 'artist');
      if (!musicSection) {
        return { ok: false, message: 'No music library section found on this Plex server.' };
      }
      return { ok: true, musicLibraryId: String(musicSection.key) };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },

  async fetchArtists(config): Promise<FetchedLibraryArtist[]> {
    if (!config.musicLibraryId) {
      throw new Error('Plex connector has no music library id; run Test first.');
    }
    const body = await plexGet(
      config,
      `/library/sections/${config.musicLibraryId}/all?type=8`,
    );
    const artists: any[] = body?.MediaContainer?.Metadata ?? [];
    return artists.map((a) => {
      const musicbrainzArtistId = plexMusicBrainzArtistId(a);
      return {
        externalId: String(a.ratingKey),
        name: a.title as string,
        musicbrainzArtistId,
        musicbrainzSource: musicbrainzArtistId ? 'connector' as const : undefined,
      };
    });
  },

  async fetchVideos(config): Promise<FetchedLibraryVideo[]> {
    if (!config.videoLibraryId) {
      throw new Error('No music-video library selected for this Plex connector.');
    }
    const body = await plexGet(config, `/library/sections/${config.videoLibraryId}/all`);
    const items: any[] = body?.MediaContainer?.Metadata ?? [];
    return items.map((item) => ({
      externalId: String(item.ratingKey),
      title: item.title as string,
      artistName: (item.grandparentTitle ?? item.parentTitle ?? item.originalTitle ?? 'Unknown Artist') as string,
      releaseYear: item.year as number | undefined,
      durationSeconds: typeof item.duration === 'number' ? Math.round(item.duration / 1000) : undefined,
      path: item.Media?.[0]?.Part?.[0]?.file as string | undefined,
      playCount: item.viewCount as number | undefined,
      hasThumbnail: Boolean(item.thumb),
    }));
  },

  async fetchVideoThumbnail(config, externalId) {
    return plexGetBinary(config, `/library/metadata/${encodeURIComponent(externalId)}/thumb`);
  },

  async fetchArtistImage(config, externalId) {
    return plexGetBinary(config, `/library/metadata/${encodeURIComponent(externalId)}/thumb`);
  },

  async listSections(config): Promise<LibrarySection[]> {
    const body = await plexGet(config, '/library/sections');
    const sections: any[] = body?.MediaContainer?.Directory ?? [];
    return sections.map((s) => ({ id: String(s.key), title: s.title as string, type: s.type as string }));
  },

  async pushPlaylist(config, { name, items, existingRemoteId }): Promise<PlaylistPushResult> {
    if (!config.videoLibraryId) {
      throw new Error('No video library selected for this Plex connector.');
    }

    const matchedKeys: string[] = [];
    const unmatchedTitles: string[] = [];
    for (const item of items) {
      const match = await findLibraryItem(config, item);
      if (match) matchedKeys.push(match.id);
      else unmatchedTitles.push(`${item.artistName} - ${item.title}`);
    }

    const identity = await plexGet(config, '/identity');
    const machineIdentifier = identity?.MediaContainer?.machineIdentifier as string;
    const uri = `server://${machineIdentifier}/com.plexapp.plugins.library/library/metadata/${matchedKeys.join(',')}`;
    const created = await plexSend(
      config,
      'POST',
      `/playlists?type=video&title=${encodeURIComponent(name)}&smart=0&uri=${encodeURIComponent(uri)}`,
    );
    const remotePlaylistId = String(created?.MediaContainer?.Metadata?.[0]?.ratingKey ?? '');
    if (!remotePlaylistId) throw new Error('Plex created a playlist but returned no playlist id.');

    if (existingRemoteId) {
      try {
        await plexSend(config, 'DELETE', `/playlists/${existingRemoteId}`);
      } catch (err) {
        await plexSend(config, 'DELETE', `/playlists/${remotePlaylistId}`).catch(() => {});
        throw err;
      }
    }

    return { remotePlaylistId, matchedCount: matchedKeys.length, unmatchedTitles };
  },

  findLibraryItem,

  async refreshVideoLibrary(config) {
    if (!config.videoLibraryId) throw new Error('No video library selected for this Plex connector.');
    await plexSend(config, 'GET', `/library/sections/${encodeURIComponent(config.videoLibraryId)}/refresh`);
  },
};
