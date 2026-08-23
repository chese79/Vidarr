import type { LibraryConnector } from '@prisma/client';

export interface LibraryConnectorTestResult {
  ok: boolean;
  message?: string;
  musicLibraryId?: string;
}

export interface FetchedLibraryArtist {
  externalId: string;
  name: string;
  genre?: string;
  playCount?: number;
}

export interface LibraryConnectorProvider {
  testConnection(config: LibraryConnector): Promise<LibraryConnectorTestResult>;
  fetchArtists(config: LibraryConnector): Promise<FetchedLibraryArtist[]>;
}
