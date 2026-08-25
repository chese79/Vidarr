import { z } from 'zod';

export * from './naming.js';

// Shared DTOs/validators for requests and responses between apps/server and apps/web.
// M1 covers Artist, MusicVideo, QualityProfile, RootFolder, Settings — the manual-entry
// CRUD skeleton. Indexer/DownloadClient/YoutubeSource/queue/history types are added in M2/M3
// alongside the providers and pipeline that actually use them.

export const TransferMode = z.enum(['hardlink', 'copy', 'move']);
export type TransferMode = z.infer<typeof TransferMode>;

export const QualityDefinitionSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  source: z.enum(['web', 'youtube', 'unknown']),
  resolution: z.number().int().nullable(),
  weight: z.number().int(),
});
export type QualityDefinition = z.infer<typeof QualityDefinitionSchema>;

export const QualityProfileItemSchema = z.object({
  qualityId: z.number().int(),
  allowed: z.boolean(),
});
export type QualityProfileItem = z.infer<typeof QualityProfileItemSchema>;

export const QualityProfileSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  cutoffQualityId: z.number().int(),
  items: z.array(QualityProfileItemSchema),
});
export type QualityProfile = z.infer<typeof QualityProfileSchema>;

export const CreateQualityProfileSchema = QualityProfileSchema.omit({ id: true });
export type CreateQualityProfile = z.infer<typeof CreateQualityProfileSchema>;

export const RootFolderSchema = z.object({
  id: z.number().int(),
  path: z.string().min(1),
  freeSpaceBytes: z.number().int().nullable(),
  accessible: z.boolean(),
});
export type RootFolder = z.infer<typeof RootFolderSchema>;

export const CreateRootFolderSchema = z.object({
  path: z.string().min(1),
});
export type CreateRootFolder = z.infer<typeof CreateRootFolderSchema>;

export const ArtistSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  sortName: z.string(),
  imvdbArtistId: z.string().nullable(),
  monitored: z.boolean(),
  rootFolderId: z.number().int(),
  qualityProfileId: z.number().int(),
  posterUrl: z.string().nullable(),
  addedAt: z.string(),
});
export type Artist = z.infer<typeof ArtistSchema>;

export const CreateArtistSchema = z.object({
  name: z.string().min(1),
  imvdbArtistId: z.string().nullable().optional(),
  monitored: z.boolean().default(true),
  rootFolderId: z.number().int(),
  qualityProfileId: z.number().int(),
  posterUrl: z.string().nullable().optional(),
});
export type CreateArtist = z.infer<typeof CreateArtistSchema>;

export const UpdateArtistSchema = CreateArtistSchema.partial();
export type UpdateArtist = z.infer<typeof UpdateArtistSchema>;

export const MusicVideoSchema = z.object({
  id: z.number().int(),
  artistId: z.number().int(),
  title: z.string().min(1),
  imvdbVideoId: z.string().nullable(),
  youtubeVideoId: z.string().nullable(),
  releaseYear: z.number().int().nullable(),
  director: z.string().nullable(),
  monitored: z.boolean(),
  hasFile: z.boolean(),
  thumbnailUrl: z.string().nullable(),
  addedAt: z.string(),
});
export type MusicVideo = z.infer<typeof MusicVideoSchema>;

export const CreateMusicVideoSchema = z.object({
  artistId: z.number().int(),
  title: z.string().min(1),
  imvdbVideoId: z.string().nullable().optional(),
  youtubeVideoId: z.string().nullable().optional(),
  releaseYear: z.number().int().nullable().optional(),
  director: z.string().nullable().optional(),
  monitored: z.boolean().default(true),
  thumbnailUrl: z.string().nullable().optional(),
});
export type CreateMusicVideo = z.infer<typeof CreateMusicVideoSchema>;

export const UpdateMusicVideoSchema = CreateMusicVideoSchema.omit({ artistId: true }).partial();
export type UpdateMusicVideo = z.infer<typeof UpdateMusicVideoSchema>;

export const SettingsSchema = z.object({
  namingFormat: z.string(),
  transferMode: TransferMode,
  minFreeSpaceMb: z.number().int(),
  imvdbApiKey: z.string().nullable(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const UpdateSettingsSchema = SettingsSchema.partial();
export type UpdateSettings = z.infer<typeof UpdateSettingsSchema>;

// --- Library Connectors & Artist Recommendations (M2.5) ---

export const LibraryConnectorType = z.enum(['plex', 'jellyfin', 'subsonic']);
export type LibraryConnectorType = z.infer<typeof LibraryConnectorType>;

export const LibraryConnectorSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  type: LibraryConnectorType,
  host: z.string().min(1),
  authToken: z.string().nullable(),
  username: z.string().nullable(),
  musicLibraryId: z.string().nullable(),
  videoLibraryId: z.string().nullable(),
  enabled: z.boolean(),
  lastSyncedAt: z.string().nullable(),
  lastSyncStatus: z.string().nullable(),
  lastSyncError: z.string().nullable(),
});
export type LibraryConnector = z.infer<typeof LibraryConnectorSchema>;

export const CreateLibraryConnectorSchema = z.object({
  name: z.string().min(1),
  type: LibraryConnectorType,
  host: z.string().min(1),
  authToken: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
  password: z.string().nullable().optional(),
  videoLibraryId: z.string().nullable().optional(),
  enabled: z.boolean().default(true),
});
export type CreateLibraryConnector = z.infer<typeof CreateLibraryConnectorSchema>;

export const UpdateLibraryConnectorSchema = CreateLibraryConnectorSchema.partial();
export type UpdateLibraryConnector = z.infer<typeof UpdateLibraryConnectorSchema>;

export const LibraryConnectorTestResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
});
export type LibraryConnectorTestResult = z.infer<typeof LibraryConnectorTestResultSchema>;

export const LibrarySectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.string(),
});
export type LibrarySection = z.infer<typeof LibrarySectionSchema>;

export const LibraryArtistSchema = z.object({
  id: z.number().int(),
  connectorId: z.number().int(),
  externalId: z.string(),
  name: z.string(),
  genre: z.string().nullable(),
  playCount: z.number().int().nullable(),
});
export type LibraryArtist = z.infer<typeof LibraryArtistSchema>;

export const RecommendationProviderName = z.enum(['lastfm', 'spotify', 'musicbrainz']);
export type RecommendationProviderName = z.infer<typeof RecommendationProviderName>;

export const RecommendationProviderConfigSchema = z.object({
  id: z.number().int(),
  provider: RecommendationProviderName,
  enabled: z.boolean(),
  apiKey: z.string().nullable(),
  clientId: z.string().nullable(),
  clientSecret: z.string().nullable(),
});
export type RecommendationProviderConfig = z.infer<typeof RecommendationProviderConfigSchema>;

export const UpdateRecommendationProviderConfigSchema = z.object({
  enabled: z.boolean().optional(),
  apiKey: z.string().nullable().optional(),
  clientId: z.string().nullable().optional(),
  clientSecret: z.string().nullable().optional(),
});
export type UpdateRecommendationProviderConfig = z.infer<
  typeof UpdateRecommendationProviderConfigSchema
>;

export const RecommendationSourceHitSchema = z.object({
  id: z.number().int(),
  source: z.enum(['library', 'lastfm', 'spotify', 'musicbrainz']),
  seedArtistName: z.string(),
  score: z.number(),
  reason: z.string(),
});
export type RecommendationSourceHit = z.infer<typeof RecommendationSourceHitSchema>;

export const RecommendationSchema = z.object({
  id: z.number().int(),
  artistName: z.string(),
  mbid: z.string().nullable(),
  aggregateScore: z.number(),
  dateFound: z.string(),
  sourceHits: z.array(RecommendationSourceHitSchema),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

export const RecommendationRefreshResultSchema = z.object({
  totalRecommendations: z.number().int(),
  newRecommendations: z.number().int(),
});
export type RecommendationRefreshResult = z.infer<typeof RecommendationRefreshResultSchema>;

// --- IMVDb metadata (M2) ---

export const ImvdbArtistSchema = z.object({
  slug: z.string(),
  name: z.string(),
});
export type ImvdbArtist = z.infer<typeof ImvdbArtistSchema>;

export const ImvdbVideoCandidateSchema = z.object({
  imvdbVideoId: z.string(),
  title: z.string(),
  year: z.number().int().nullable(),
  thumbnailUrl: z.string().nullable(),
  director: z.string().nullable(),
  youtubeVideoId: z.string().nullable(),
});
export type ImvdbVideoCandidate = z.infer<typeof ImvdbVideoCandidateSchema>;

// --- YouTube source pipeline (M2) ---

export const YoutubeSourceType = z.enum(['channel', 'playlist', 'single_video']);
export type YoutubeSourceType = z.infer<typeof YoutubeSourceType>;

export const YoutubeSourceSchema = z.object({
  id: z.number().int(),
  type: YoutubeSourceType,
  url: z.string(),
  artistId: z.number().int(),
  monitored: z.boolean(),
  lastPolledAt: z.string().nullable(),
  qualitySelector: z.string(),
});
export type YoutubeSource = z.infer<typeof YoutubeSourceSchema>;

export const CreateYoutubeSourceSchema = z.object({
  type: YoutubeSourceType,
  url: z.string().min(1),
  artistId: z.number().int(),
  monitored: z.boolean().default(true),
});
export type CreateYoutubeSource = z.infer<typeof CreateYoutubeSourceSchema>;

export const YoutubeSourceSyncResultSchema = z.object({
  matched: z.number().int(),
  created: z.number().int(),
  isInitialSync: z.boolean(),
});
export type YoutubeSourceSyncResult = z.infer<typeof YoutubeSourceSyncResultSchema>;

export const GrabResultSchema = z.object({
  ok: z.boolean(),
  path: z.string().optional(),
  error: z.string().optional(),
});
export type GrabResult = z.infer<typeof GrabResultSchema>;

// --- Indexer / DownloadClient pipeline (M2) ---

export const IndexerImplementation = z.enum(['Torznab', 'Newznab']);
export type IndexerImplementation = z.infer<typeof IndexerImplementation>;

export const IndexerSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  implementation: IndexerImplementation,
  baseUrl: z.string(),
  apiKey: z.string().nullable(),
  categories: z.string(), // JSON-encoded int[]
  enabled: z.boolean(),
  priority: z.number().int(),
});
export type Indexer = z.infer<typeof IndexerSchema>;

export const CreateIndexerSchema = z.object({
  name: z.string().min(1),
  implementation: IndexerImplementation,
  baseUrl: z.string().min(1),
  apiKey: z.string().nullable().optional(),
  categories: z.array(z.number().int()).default([]),
  enabled: z.boolean().default(true),
  priority: z.number().int().default(25),
});
export type CreateIndexer = z.infer<typeof CreateIndexerSchema>;

export const DownloadClientImplementation = z.enum(['qBittorrent', 'SABnzbd']);
export type DownloadClientImplementation = z.infer<typeof DownloadClientImplementation>;

export const DownloadClientSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  implementation: DownloadClientImplementation,
  host: z.string(),
  port: z.number().int(),
  username: z.string().nullable(),
  category: z.string().nullable(),
  enabled: z.boolean(),
  priority: z.number().int(),
});
export type DownloadClient = z.infer<typeof DownloadClientSchema>;

export const CreateDownloadClientSchema = z.object({
  name: z.string().min(1),
  implementation: DownloadClientImplementation,
  host: z.string().min(1),
  port: z.number().int(),
  username: z.string().nullable().optional(),
  password: z.string().nullable().optional(),
  apiKey: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  enabled: z.boolean().default(true),
});
export type CreateDownloadClient = z.infer<typeof CreateDownloadClientSchema>;

export const ConnectionTestResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
});
export type ConnectionTestResult = z.infer<typeof ConnectionTestResultSchema>;

export const IndexerSearchResultSchema = z.object({
  indexerId: z.number().int(),
  indexerName: z.string(),
  title: z.string(),
  quality: z.string(),
  sizeBytes: z.number().nullable(),
  seeders: z.number().nullable(),
  downloadUrl: z.string(),
  publishDate: z.string().nullable(),
});
export type IndexerSearchResult = z.infer<typeof IndexerSearchResultSchema>;

export const QueueRefreshResultSchema = z.object({
  completed: z.number().int(),
  failed: z.number().int(),
  pending: z.number().int(),
});
export type QueueRefreshResult = z.infer<typeof QueueRefreshResultSchema>;

export const BulkSearchResultSchema = z.object({
  grabbed: z.number().int(),
  skipped: z.number().int(),
});
export type BulkSearchResult = z.infer<typeof BulkSearchResultSchema>;

// --- Scheduler / History / Calendar (M3) ---

export const ScheduledTaskSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  intervalMs: z.number().int(),
  lastRunAt: z.string().nullable(),
  nextRunAt: z.string().nullable(),
  lastResult: z.string().nullable(),
  lastError: z.string().nullable(),
});
export type ScheduledTask = z.infer<typeof ScheduledTaskSchema>;

export const ActivityLogEntrySchema = z.object({
  id: z.number().int(),
  level: z.enum(['info', 'warn', 'error']),
  source: z.string(),
  message: z.string(),
  date: z.string(),
});
export type ActivityLogEntry = z.infer<typeof ActivityLogEntrySchema>;

export const HistoryEntrySchema = z.object({
  id: z.number().int(),
  musicVideoId: z.number().int(),
  eventType: z.string(),
  date: z.string(),
  data: z.string().nullable(),
  musicVideo: z.object({ title: z.string(), artist: z.object({ name: z.string() }) }),
});
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

export const CalendarItemSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  releaseYear: z.number().int().nullable(),
  hasFile: z.boolean(),
  addedAt: z.string(),
  artist: z.object({ name: z.string() }),
});
export type CalendarItem = z.infer<typeof CalendarItemSchema>;

// --- Playlists: build from downloaded videos, push to Plex/Jellyfin ---

export const PlaylistSyncSchema = z.object({
  id: z.number().int(),
  connectorId: z.number().int(),
  connectorName: z.string(),
  connectorType: LibraryConnectorType,
  remotePlaylistId: z.string().nullable(),
  lastPushedAt: z.string().nullable(),
  lastPushStatus: z.string().nullable(),
  lastPushError: z.string().nullable(),
  unmatchedCount: z.number().int().nullable(),
});
export type PlaylistSync = z.infer<typeof PlaylistSyncSchema>;

export const PlaylistItemSchema = z.object({
  id: z.number().int(),
  musicVideoId: z.number().int(),
  sortOrder: z.number().int(),
  musicVideo: z.object({
    title: z.string(),
    thumbnailUrl: z.string().nullable(),
    hasFile: z.boolean(),
    artist: z.object({ name: z.string() }),
  }),
});
export type PlaylistItem = z.infer<typeof PlaylistItemSchema>;

export const PlaylistSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  createdAt: z.string(),
  items: z.array(PlaylistItemSchema),
  syncs: z.array(PlaylistSyncSchema),
});
export type Playlist = z.infer<typeof PlaylistSchema>;

export const CreatePlaylistSchema = z.object({
  name: z.string().min(1),
});
export type CreatePlaylist = z.infer<typeof CreatePlaylistSchema>;

export const PlaylistPushResultSchema = z.object({
  ok: z.boolean(),
  remotePlaylistId: z.string().nullable(),
  matchedCount: z.number().int(),
  unmatchedTitles: z.array(z.string()),
  error: z.string().optional(),
});
export type PlaylistPushResult = z.infer<typeof PlaylistPushResultSchema>;
