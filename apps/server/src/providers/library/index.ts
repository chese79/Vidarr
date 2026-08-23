import type { LibraryConnectorProvider } from './types.js';
import { plexProvider } from './plex.js';
import { jellyfinProvider } from './jellyfin.js';
import { subsonicProvider } from './subsonic.js';

export * from './types.js';

const PROVIDERS: Record<string, LibraryConnectorProvider> = {
  plex: plexProvider,
  jellyfin: jellyfinProvider,
  subsonic: subsonicProvider,
};

export function getLibraryConnectorProvider(type: string): LibraryConnectorProvider {
  const provider = PROVIDERS[type];
  if (!provider) throw new Error(`Unknown library connector type: ${type}`);
  return provider;
}
