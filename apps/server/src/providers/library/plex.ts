import type { LibraryConnector } from '@prisma/client';
import { normalizeTitle } from '../../pipeline/normalize.js';
import type {
  FetchedLibraryArtist,
  LibraryConnectorProvider,
  LibraryConnectorTestResult,
  LibrarySection,
  PlaylistPushItem,
  PlaylistPushResult,
} from './types.js';

function baseUrl(host: string): string {
  return host.replace(/\/+$/, '');
}

async function plexGet(config: LibraryConnector, path: string): Promise<any> {
  const res = await fetch(`${baseUrl(config.host)}${path}`, {
    headers: {
      Accept: 'application/json',
      'X-Plex-Token': config.authToken ?? '',
    },
  });
  if (!res.ok) {
    throw new Error(`Plex request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function plexSend(config: LibraryConnector, method: string, path: string): Promise<any> {
  const res = await fetch(`${baseUrl(config.host)}${path}`, {
    method,
    headers: { Accept: 'application/json', 'X-Plex-Token': config.authToken ?? '' },
  });
  if (!res.ok) {
    throw new Error(`Plex request failed: ${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Plex has no first-class "music video" item type — vidarr's video library is
// whatever Plex section (Movies / Home Videos / Other Videos) the user points
// it at. Without a native Artist field on those item types, matching falls
// back to an exact normalized-title text search within that one section.
// UNVERIFIED against a real Plex server (none was available while building
// this) — confirm against your own instance before relying on it, and expect
// to adjust the `type=1` (movie) filter or the field used for artist matching
// once you see real item shapes.
async function findVideoItem(config: LibraryConnector, item: PlaylistPushItem): Promise<string | null> {
  const body = await plexGet(
    config,
    `/library/sections/${config.videoLibraryId}/all?type=1&title=${encodeURIComponent(item.title)}`,
  );
  const candidates: any[] = body?.MediaContainer?.Metadata ?? [];
  const wantTitle = normalizeTitle(item.title);
  const match = candidates.find((c) => normalizeTitle(c.title ?? '') === wantTitle);
  return match ? String(match.ratingKey) : null;
}

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
    return artists.map((a) => ({
      externalId: String(a.ratingKey),
      name: a.title as string,
    }));
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
      const key = await findVideoItem(config, item);
      if (key) matchedKeys.push(key);
      else unmatchedTitles.push(`${item.artistName} - ${item.title}`);
    }

    // Full replace, not a diff — see PlaylistSync doc comment in schema.prisma.
    if (existingRemoteId) {
      await plexSend(config, 'DELETE', `/playlists/${existingRemoteId}`).catch(() => {});
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

    return { remotePlaylistId, matchedCount: matchedKeys.length, unmatchedTitles };
  },
};
