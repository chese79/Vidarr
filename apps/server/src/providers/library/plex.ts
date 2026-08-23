import type { LibraryConnector } from '@prisma/client';
import type { FetchedLibraryArtist, LibraryConnectorProvider, LibraryConnectorTestResult } from './types.js';

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
};
