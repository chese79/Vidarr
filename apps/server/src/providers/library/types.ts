import type { LibraryConnector } from '@prisma/client';

export interface LibraryConnectorTestResult {
  ok: boolean;
  message?: string;
  musicLibraryId?: string;
  userId?: string;
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

export interface LibraryItemMatch {
  id: string;
  playCount: number | null;
}

export interface LibraryConnectorProvider {
  testConnection(config: LibraryConnector): Promise<LibraryConnectorTestResult>;
  fetchArtists(config: LibraryConnector): Promise<FetchedLibraryArtist[]>;
  // Playlist push and play-count sync are optional per-type — Subsonic/
  // Navidrome has no music-video concept to push a video playlist into or
  // read a video watch-count from.
  listSections?(config: LibraryConnector): Promise<LibrarySection[]>;
  pushPlaylist?(
    config: LibraryConnector,
    params: { name: string; items: PlaylistPushItem[]; existingRemoteId: string | null },
  ): Promise<PlaylistPushResult>;
  // Resolves a video's item in this connector's video library — shared by
  // pushPlaylist (uses .id) and pipeline/playCountSync.ts (uses .playCount),
  // so the actual item lookup/matching logic exists exactly once per provider.
  findLibraryItem?(config: LibraryConnector, item: PlaylistPushItem): Promise<LibraryItemMatch | null>;
}
