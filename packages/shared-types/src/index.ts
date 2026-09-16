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
  lastCheckedAt: z.string().nullable(),
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
  genre: z.string().nullable(),
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
  genre: z.string().nullable().optional(),
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
  genre: z.string().nullable(),
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
  genre: z.string().nullable().optional(),
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
  // vidarr's own API key — read-only via this schema (UpdateSettingsSchema
  // strips it, since it's Zod .partial()'d from this one); rotate it only
  // via POST /config/regenerate-api-key.
  apiKey: z.string().nullable(),
  // Google Sign-On config — an alternative way to get apiKey into a browser,
  // not a parallel credential (see apps/server/src/api/googleAuth.ts).
  googleClientId: z.string().nullable(),
  googleClientSecret: z.string().nullable(),
  googleAllowedEmail: z.string().nullable(),
  // Username/password login — another alternative way to get apiKey into a
  // browser (see apps/server/src/api/localAuth.ts). adminPasswordHash is a
  // one-way scrypt hash, never the plaintext password, but is still not
  // settable via a general settings PUT (see UpdateSettingsSchema below) —
  // it's only ever written by POST /api/v1/auth/login/credentials, which
  // hashes the plaintext password server-side.
  adminUsername: z.string().nullable(),
  adminPasswordHash: z.string().nullable(),
});

// GET /api/v1/setup/bootstrap-key's response — see apps/server/src/api/setup.ts.
export const BootstrapKeyResponseSchema = z.object({
  apiKey: z.string(),
});
export type BootstrapKeyResponse = z.infer<typeof BootstrapKeyResponseSchema>;
export type Settings = z.infer<typeof SettingsSchema>;

export const GoogleAuthStatusSchema = z.object({
  configured: z.boolean(),
});
export type GoogleAuthStatus = z.infer<typeof GoogleAuthStatusSchema>;

// POST /api/v1/auth/google/exchange — see apps/server/src/api/googleAuth.ts.
export const GoogleAuthExchangeResponseSchema = z.object({
  apiKey: z.string(),
});
export type GoogleAuthExchangeResponse = z.infer<typeof GoogleAuthExchangeResponseSchema>;

// GET /api/v1/auth/login/status — see apps/server/src/api/localAuth.ts.
export const LocalLoginStatusSchema = z.object({
  configured: z.boolean(),
});
export type LocalLoginStatus = z.infer<typeof LocalLoginStatusSchema>;

// POST /api/v1/auth/login — same shape used for POST /api/v1/auth/login/credentials
// (setting/changing the admin login), though the two routes enforce different
// minimum-length rules server-side.
export const LocalLoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LocalLoginRequest = z.infer<typeof LocalLoginRequestSchema>;

export const LocalLoginResponseSchema = z.object({
  apiKey: z.string(),
});
export type LocalLoginResponse = z.infer<typeof LocalLoginResponseSchema>;

// .omit even though SettingsSchema.partial() alone would already make apiKey
// optional — explicit here so a general settings PUT can never carry a
// client-supplied apiKey, regardless of how SettingsSchema's shape changes
// later. Rotation only happens via POST /config/regenerate-api-key, which
// always generates the value server-side. adminUsername/adminPasswordHash
// are excluded the same way — they're only ever set together, and only via
// POST /api/v1/auth/login/credentials, which hashes the plaintext password;
// a generic PUT could otherwise store an unhashed value into adminPasswordHash.
export const UpdateSettingsSchema = SettingsSchema.omit({
  apiKey: true,
  adminUsername: true,
  adminPasswordHash: true,
}).partial();
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

// A bare "192.168.1.10:8096" (no scheme) makes every outgoing request build
// an invalid URL and fail with a cryptic "Failed to parse URL from ..." —
// the fetch() call has no way to guess http vs https, and there's no
// legitimate reason a local Plex/Jellyfin/Subsonic server needs https, so
// defaulting the scheme to http rather than rejecting the input turns a
// confusing dead end into something that just works.
function normalizeConnectorHost(host: string): string {
  const trimmed = host.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export const CreateLibraryConnectorSchema = z.object({
  name: z.string().min(1),
  type: LibraryConnectorType,
  host: z.string().min(1).transform(normalizeConnectorHost),
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

// Auto-detect: broadcasts a UDP discovery request on the local network for
// Plex or Jellyfin servers — see apps/server/src/pipeline/discovery.ts. No
// equivalent protocol exists for Subsonic/Navidrome.
export const DiscoverableLibraryConnectorType = z.enum(['plex', 'jellyfin']);
export type DiscoverableLibraryConnectorType = z.infer<typeof DiscoverableLibraryConnectorType>;

export const DiscoverLibraryConnectorBodySchema = z.object({
  type: DiscoverableLibraryConnectorType,
});
export type DiscoverLibraryConnectorBody = z.infer<typeof DiscoverLibraryConnectorBodySchema>;

export const DiscoveredServerSchema = z.object({
  host: z.string(),
  name: z.string(),
});
export type DiscoveredServer = z.infer<typeof DiscoveredServerSchema>;

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
  sourceRef: z.string().nullable(),
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

export const AddRecommendationBodySchema = z.object({
  rootFolderId: z.number().int(),
  qualityProfileId: z.number().int(),
});
export type AddRecommendationBody = z.infer<typeof AddRecommendationBodySchema>;

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

export const UpdateIndexerSchema = CreateIndexerSchema.partial();
export type UpdateIndexer = z.infer<typeof UpdateIndexerSchema>;

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

// Identical shape to LibraryConnectorTestResultSchema — kept as a separate
// export name since Indexer/DownloadClient test-connection responses are a
// conceptually distinct resource from library connectors, but there's no
// need for two independent schema definitions of the same {ok, message?}.
export const ConnectionTestResultSchema = LibraryConnectorTestResultSchema;
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

// --- Bulk import: pull many videos in at once from a YouTube playlist URL ---

export const PlaylistImportCandidateSchema = z.object({
  youtubeVideoId: z.string(),
  title: z.string(),
  channel: z.string(),
  suggestedArtistName: z.string(),
  matchedArtistId: z.number().int().nullable(),
  matchedArtistName: z.string().nullable(),
  alreadyInLibrary: z.boolean(),
});
export type PlaylistImportCandidate = z.infer<typeof PlaylistImportCandidateSchema>;

// Videos are checked (include) by default; the artist-level watchlist
// checkbox (monitor) is unchecked by default — importing a video doesn't
// imply you want vidarr to actively track that performer going forward,
// especially for a "various artists" playlist with many one-off performers.
export const ImportVideoSelectionSchema = z.object({
  youtubeVideoId: z.string(),
  title: z.string(),
  include: z.boolean(),
});
export type ImportVideoSelection = z.infer<typeof ImportVideoSelectionSchema>;

export const ImportArtistGroupSchema = z.object({
  artistId: z.number().int().nullable(), // set => assign to this existing artist; null => create one named artistName
  artistName: z.string(),
  monitor: z.boolean(),
  videos: z.array(ImportVideoSelectionSchema),
});
export type ImportArtistGroup = z.infer<typeof ImportArtistGroupSchema>;

export const PreviewYoutubePlaylistBodySchema = z.object({
  url: z.string().min(1),
});
export type PreviewYoutubePlaylistBody = z.infer<typeof PreviewYoutubePlaylistBodySchema>;

export const CommitYoutubePlaylistBodySchema = z.object({
  groups: z.array(ImportArtistGroupSchema),
  rootFolderId: z.number().int(),
  qualityProfileId: z.number().int(),
});
export type CommitYoutubePlaylistBody = z.infer<typeof CommitYoutubePlaylistBodySchema>;

export const ImportCommitResultSchema = z.object({
  artistsCreated: z.number().int(),
  videosAdded: z.number().int(),
  skipped: z.number().int(),
});
export type ImportCommitResult = z.infer<typeof ImportCommitResultSchema>;

// --- Playlist generation: build a playlist from selectable filters ---

export const MatchMode = z.enum(['all', 'any']);
export type MatchMode = z.infer<typeof MatchMode>;

// Every field is optional — only the filters the user actually enables are
// applied, combined with `matchMode` (AND = "all", OR = "any").
export const PlaylistFiltersSchema = z.object({
  yearMin: z.number().int().optional(),
  yearMax: z.number().int().optional(),
  genre: z.string().min(1).optional(),
  minPlayCount: z.number().int().min(0).optional(),
  artistIds: z.array(z.number().int()).optional(),
  musicVideoIds: z.array(z.number().int()).optional(),
});
export type PlaylistFilters = z.infer<typeof PlaylistFiltersSchema>;

export const GeneratePlaylistBodySchema = z.object({
  name: z.string().min(1),
  filters: PlaylistFiltersSchema,
  matchMode: MatchMode,
});
export type GeneratePlaylistBody = z.infer<typeof GeneratePlaylistBodySchema>;

export const GeneratePlaylistResultSchema = z.object({
  playlistId: z.number().int(),
  matchedCount: z.number().int(),
});
export type GeneratePlaylistResult = z.infer<typeof GeneratePlaylistResultSchema>;

export const StandardGenreMatchSchema = z.object({
  genre: z.string(),
  source: z.string(),
});
export type StandardGenreMatch = z.infer<typeof StandardGenreMatchSchema>;

export const PlayCountSyncResultSchema = z.object({
  matched: z.number().int(),
  unmatched: z.number().int(),
});
export type PlayCountSyncResult = z.infer<typeof PlayCountSyncResultSchema>;
