import type { LibraryConnector } from '@prisma/client';
import type { FetchedLibraryArtist, LibraryConnectorProvider, LibraryConnectorTestResult } from './types.js';

function baseUrl(host: string): string {
  return host.replace(/\/+$/, '');
}

async function jellyfinGet(config: LibraryConnector, path: string): Promise<any> {
  const res = await fetch(`${baseUrl(config.host)}${path}`, {
    headers: {
      Accept: 'application/json',
      'X-Emby-Token': config.authToken ?? '',
    },
  });
  if (!res.ok) {
    throw new Error(`Jellyfin request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
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
};
