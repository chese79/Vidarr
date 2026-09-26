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
  // A provider-supplied or embedded Picard tag is identity evidence, not
  // merely display metadata. When present it safely bypasses fuzzy matching.
  musicbrainzArtistId?: string;
  musicbrainzSource?: 'connector' | 'embedded';
}

export interface LibraryVideoThumbnail {
  contentType: string;
  data: Buffer;
}

export interface FetchedLibraryVideo {
  externalId: string;
  title: string;
  artistName: string;
  releaseYear?: number;
  durationSeconds?: number;
  path?: string;
  playCount?: number;
  hasThumbnail?: boolean;
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
  fetchVideos?(config: LibraryConnector): Promise<FetchedLibraryVideo[]>;
  fetchVideoThumbnail?(config: LibraryConnector, externalId: string): Promise<LibraryVideoThumbnail | null>;
  // Same image-fetch shape as fetchVideoThumbnail, keyed by a LibraryArtist's
  // externalId instead of a video's — Plex/Jellyfin both serve any item's
  // primary image by item id regardless of item type, so this is a thin,
  // clearly-named wrapper rather than a separate fetch mechanism.
  fetchArtistImage?(config: LibraryConnector, externalId: string): Promise<LibraryVideoThumbnail | null>;
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
  refreshVideoLibrary?(config: LibraryConnector): Promise<void>;
}
