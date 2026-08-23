import { createHash, randomBytes } from 'node:crypto';
import type { LibraryConnector } from '@prisma/client';
import type { FetchedLibraryArtist, LibraryConnectorProvider, LibraryConnectorTestResult } from './types.js';

function baseUrl(host: string): string {
  return host.replace(/\/+$/, '');
}

function authParams(config: LibraryConnector): string {
  const salt = randomBytes(6).toString('hex');
  const token = createHash('md5')
    .update(`${config.password ?? ''}${salt}`)
    .digest('hex');
  const params = new URLSearchParams({
    u: config.username ?? '',
    t: token,
    s: salt,
    v: '1.16.1',
    c: 'vidarr',
    f: 'json',
  });
  return params.toString();
}

async function subsonicGet(config: LibraryConnector, endpoint: string): Promise<any> {
  const res = await fetch(`${baseUrl(config.host)}/rest/${endpoint}?${authParams(config)}`);
  if (!res.ok) {
    throw new Error(`Subsonic request failed: ${res.status} ${res.statusText}`);
  }
  const body = await res.json();
  const inner = body['subsonic-response'];
  if (inner?.status !== 'ok') {
    throw new Error(inner?.error?.message ?? 'Subsonic request returned a non-ok status.');
  }
  return inner;
}

export const subsonicProvider: LibraryConnectorProvider = {
  async testConnection(config): Promise<LibraryConnectorTestResult> {
    try {
      await subsonicGet(config, 'ping.view');
      return { ok: true };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },

  async fetchArtists(config): Promise<FetchedLibraryArtist[]> {
    const body = await subsonicGet(config, 'getArtists.view');
    const indexes: any[] = body?.artists?.index ?? [];
    const artists: FetchedLibraryArtist[] = [];
    for (const index of indexes) {
      for (const artist of index.artist ?? []) {
        artists.push({ externalId: String(artist.id), name: artist.name as string });
      }
    }
    return artists;
  },
};
