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

export interface LibrarySection {
  id: string;
  title: string;
  type: string;
}

export interface PlaylistPushItem {
  artistName: string;
  title: string;
}

export interface PlaylistPushResult {
  remotePlaylistId: string;
  matchedCount: number;
  unmatchedTitles: string[];
}

export interface LibraryConnectorProvider {
  testConnection(config: LibraryConnector): Promise<LibraryConnectorTestResult>;
  fetchArtists(config: LibraryConnector): Promise<FetchedLibraryArtist[]>;
  // Playlist push is optional per-type — Subsonic/Navidrome has no music-video
  // concept to push a video playlist into.
  listSections?(config: LibraryConnector): Promise<LibrarySection[]>;
  pushPlaylist?(
    config: LibraryConnector,
    params: { name: string; items: PlaylistPushItem[]; existingRemoteId: string | null },
  ): Promise<PlaylistPushResult>;
}
