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
  targetConnectorId: z.number().int().nullable(),
});
export type RootFolder = z.infer<typeof RootFolderSchema>;

export const CreateRootFolderSchema = z.object({
  path: z.string().min(1),
  targetConnectorId: z.number().int().nullable().optional(),
});
export type CreateRootFolder = z.infer<typeof CreateRootFolderSchema>;

export const ArtistSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  sortName: z.string(),
  imvdbArtistId: z.string().nullable(),
  musicbrainzArtistId: z.string().nullable(),
  musicbrainzMatchStatus: z.string(),
  musicbrainzMatchConfidence: z.number().nullable(),
  artistType: z.string().nullable(),
  country: z.string().nullable(),
  disambiguation: z.string().nullable(),
  monitored: z.boolean(),
  rootFolderId: z.number().int(),
  qualityProfileId: z.number().int(),
  posterUrl: z.string().nullable(),
  genre: z.string().nullable(),
  metadataRefreshedAt: z.string().nullable(),
  reconciledAt: z.string().nullable(),
  addedAt: z.string(),
});
export type Artist = z.infer<typeof ArtistSchema>;

export const CreateArtistSchema = z.object({
  name: z.string().min(1),
  imvdbArtistId: z.string().nullable().optional(),
  // Matches the Prisma schema default (see schema.prisma's comment on
  // Artist.monitored) — a newly added artist doesn't start auto-downloading
  // its whole catalog just from being added.
  monitored: z.boolean().default(false),
  rootFolderId: z.number().int(),
  qualityProfileId: z.number().int(),
  // .url() is only a syntax check — it doesn't restrict scheme or reject a
  // private/internal host. Real SSRF hardening (protocol allowlist, literal
  // private-IP rejection, timeout, size cap) happens at fetch time in
  // pipeline/safeImageFetch.ts; this just rejects obvious garbage up front.
  posterUrl: z.string().url().nullable().optional(),
  genre: z.string().nullable().optional(),
});
export type CreateArtist = z.infer<typeof CreateArtistSchema>;

export const UpdateArtistSchema = CreateArtistSchema.partial();
export type UpdateArtist = z.infer<typeof UpdateArtistSchema>;

// --- Library page: artist-centered summary list (docs/requests/2026-09-19-ui-enhance.md, Phase 1) ---

export const ArtistSummarySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  sortName: z.string(),
  genre: z.string().nullable(),
  monitored: z.boolean(),
  musicbrainzMatchStatus: z.string(),
  musicbrainzMatchConfidence: z.number().nullable(),
  musicbrainzCandidateId: z.string().nullable(),
  musicbrainzCandidateName: z.string().nullable(),
  musicbrainzCandidateScore: z.number().nullable(),
  hasImage: z.boolean(),
  knownVideoCount: z.number().int(),
  availableVideoCount: z.number().int(),
  missingVideoCount: z.number().int(),
  downloadingVideoCount: z.number().int(),
  monitoredVideoCount: z.number().int(),
  unmatchedVideoCount: z.number().int(),
  supplementaryVideoCount: z.number().int(),
  // Distinct from 0 — an artist with videos but no known play-count data
  // anywhere is `null`, not "played zero times".
  aggregatePlayCount: z.number().int().nullable(),
});
export type ArtistSummary = z.infer<typeof ArtistSummarySchema>;

export const ArtistSummaryListSchema = z.object({
  items: z.array(ArtistSummarySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  // Which letters (A-Z, or "#" for a non-alphabetic first character) have at
  // least one artist in the *unfiltered* library — lets the rail disable
  // letters with nothing behind them without a separate query per letter.
  availableLetters: z.array(z.string()),
});
export type ArtistSummaryList = z.infer<typeof ArtistSummaryListSchema>;

export const ArtistSummaryQuerySchema = z.object({
  search: z.string().optional(),
  genre: z.string().optional(),
  monitored: z.enum(['true', 'false']).optional(),
  musicbrainzStatus: z.enum(['unmatched', 'suggested', 'ambiguous', 'confirmed', 'notFound', 'failed']).optional(),
  letter: z.string().optional(),
  minKnownVideos: z.coerce.number().int().min(0).optional(),
  minPlayCount: z.coerce.number().int().min(0).optional(),
  hasMissing: z.enum(['true']).optional(),
  completeness: z.enum(['complete', 'unmatched', 'activeDownloads']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ArtistSummaryQuery = z.infer<typeof ArtistSummaryQuerySchema>;

export const BulkMonitorArtistsBodySchema = z.object({
  ids: z.array(z.number().int()).min(1),
  monitored: z.boolean(),
});
export type BulkMonitorArtistsBody = z.infer<typeof BulkMonitorArtistsBodySchema>;

export const BulkArtistIdsBodySchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(1000),
});
export type BulkArtistIdsBody = z.infer<typeof BulkArtistIdsBodySchema>;

export const BulkMonitorArtistsResultSchema = z.object({
  succeeded: z.array(z.number().int()),
  failed: z.array(z.object({ id: z.number().int(), error: z.string() })),
});
export type BulkMonitorArtistsResult = z.infer<typeof BulkMonitorArtistsResultSchema>;

export const MusicVideoSchema = z.object({
  id: z.number().int(),
  artistId: z.number().int(),
  title: z.string().min(1),
  imvdbVideoId: z.string().nullable(),
  youtubeVideoId: z.string().nullable(),
  releaseYear: z.number().int().nullable(),
  durationSeconds: z.number().int().nullable(),
  director: z.string().nullable(),
  genre: z.string().nullable(),
  monitored: z.boolean(),
  ignored: z.boolean(),
  hasFile: z.boolean(),
  thumbnailUrl: z.string().nullable(),
  catalogStatus: z.string(),
  awaitingServerScanAt: z.string().nullable(),
  addedAt: z.string(),
});
export type MusicVideo = z.infer<typeof MusicVideoSchema>;

export const CreateMusicVideoSchema = z.object({
  artistId: z.number().int(),
  title: z.string().min(1),
  imvdbVideoId: z.string().nullable().optional(),
  youtubeVideoId: z.string().nullable().optional(),
  releaseYear: z.number().int().nullable().optional(),
  durationSeconds: z.number().int().positive().nullable().optional(),
  director: z.string().nullable().optional(),
  genre: z.string().nullable().optional(),
  monitored: z.boolean().default(true),
  // Independent of `monitored` — see the schema.prisma comment on
  // MusicVideo.ignored and pipeline/videoStatus.ts for how the two combine.
  ignored: z.boolean().default(false),
  thumbnailUrl: z.string().nullable().optional(),
});
export type CreateMusicVideo = z.infer<typeof CreateMusicVideoSchema>;

// --- Video ownership/acquisition state (Phase 2a) ---

// Whether Vidarr has the file locally, it's available on a synced media
// server, both, or neither — kept distinct from acquisition progress and
// match confidence per the request doc's "must not be collapsed into one
// misleading boolean" requirement. See pipeline/videoStatus.ts.
export const VideoOwnership = z.enum(['local', 'server', 'both', 'none']);
export type VideoOwnership = z.infer<typeof VideoOwnership>;

// Active/most-recent DownloadQueueItem state for a video, or null when there
// is none. 'queued' and 'importing' are deliberately not modeled — see the
// Phase 2a plan Context for why (the DB status value is never actually
// written for the former; the latter resolves synchronously in seconds).
export const VideoAcquisition = z.enum([
  'queued',
  'downloading',
  'submissionUnknown',
  'importing',
  'awaitingServerScan',
  'failed',
]).nullable();
export type VideoAcquisition = z.infer<typeof VideoAcquisition>;

export const VideoStatusSchema = z.object({
  ownership: VideoOwnership,
  acquisition: VideoAcquisition,
  // True only when an automatic backlog/upgrade search would attempt this
  // video right now: video + artist both monitored, not ignored, not
  // already owned, and no active download. A manual single-video grab is
  // allowed even when this is false (see pipeline/videoStatus.ts) — it only
  // ever respects `ignored` and an active download, never `monitored`.
  eligibleForAutoSearch: z.boolean(),
  progress: z.number().min(0).max(1).nullable(),
});
export type VideoStatus = z.infer<typeof VideoStatusSchema>;

export const UpdateMusicVideoSchema = CreateMusicVideoSchema.omit({ artistId: true }).partial();
export type UpdateMusicVideo = z.infer<typeof UpdateMusicVideoSchema>;

export const SettingsSchema = z.object({
  namingFormat: z.string(),
  transferMode: TransferMode,
  minFreeSpaceMb: z.number().int(),
  imvdbApiKey: z.string().nullable(),
  hasImvdbApiKey: z.boolean(),
  // vidarr's own API key — read-only via this schema (UpdateSettingsSchema
  // strips it, since it's Zod .partial()'d from this one); rotate it only
  // via POST /config/regenerate-api-key.
  apiKey: z.string().nullable(),
  // Google Sign-On config — an alternative way to get apiKey into a browser,
  // not a parallel credential (see apps/server/src/api/googleAuth.ts).
  googleClientId: z.string().nullable(),
  googleClientSecret: z.string().nullable(),
  hasGoogleClientSecret: z.boolean(),
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
  setupAllowed: z.boolean(),
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
  hasImvdbApiKey: true,
  hasGoogleClientSecret: true,
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
  hasAuthToken: z.boolean(),
  username: z.string().nullable(),
  userId: z.string().nullable(),
  musicLibraryId: z.string().nullable(),
  musicPath: z.string().nullable(),
  videoLibraryId: z.string().nullable(),
  enabled: z.boolean(),
  lastSyncedAt: z.string().nullable(),
  lastSyncStatus: z.string().nullable(),
  lastSyncError: z.string().nullable(),
  syncRunning: z.boolean(),
  syncProcessed: z.number().int(),
  syncTotal: z.number().int().nullable(),
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
  musicLibraryId: z.string().nullable().optional(),
  musicPath: z.string().trim().min(1).nullable().optional(),
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

// A video's media-server matches, as nested in GET /api/v1/artist/:id's
// musicVideos — a small subset of LibraryVideoSchema below (no connector
// credentials, no path) scoped to what the Artist Detail page needs to show
// "this video is already on your server."
export const MatchedLibraryVideoSchema = z.object({
  id: z.number().int(),
  hasThumbnail: z.boolean(),
  playCount: z.number().int().nullable(),
  durationSeconds: z.number().int().nullable(),
  matchConfidence: z.enum(['probable', 'ambiguous']).nullable().optional(),
  connector: z.object({ name: z.string(), type: LibraryConnectorType }),
});
export type MatchedLibraryVideo = z.infer<typeof MatchedLibraryVideoSchema>;

// null for an exact-key match (needs no review) or no match at all — set
// only alongside a fuzzy-matched musicVideoId. See pipeline/reconciliation.ts.
export const MatchConfidence = z.enum(['probable', 'ambiguous']);
export type MatchConfidence = z.infer<typeof MatchConfidence>;

// The catalog side of a LibraryVideo's proposed match — just enough for a
// "does this look right?" side-by-side comparison in the review UI, the
// reverse pairing of MatchedLibraryVideoSchema above.
export const MatchedMusicVideoSchema = z.object({
  title: z.string(),
  releaseYear: z.number().int().nullable(),
  artistName: z.string(),
});
export type MatchedMusicVideo = z.infer<typeof MatchedMusicVideoSchema>;

export const LibraryVideoSchema = z.object({
  id: z.number().int(),
  connectorId: z.number().int(),
  externalId: z.string(),
  title: z.string(),
  artistName: z.string(),
  releaseYear: z.number().int().nullable(),
  durationSeconds: z.number().int().nullable(),
  path: z.string().nullable(),
  playCount: z.number().int().nullable(),
  hasThumbnail: z.boolean(),
  available: z.boolean(),
  musicVideoId: z.number().int().nullable(),
  matchConfidence: MatchConfidence.nullable(),
  matchedVideo: MatchedMusicVideoSchema.nullable(),
  connector: z.object({ name: z.string(), type: LibraryConnectorType }),
});
export type LibraryVideo = z.infer<typeof LibraryVideoSchema>;

export const RecommendationProviderName = z.enum(['lastfm', 'spotify', 'musicbrainz']);
export type RecommendationProviderName = z.infer<typeof RecommendationProviderName>;

export const RecommendationProviderConfigSchema = z.object({
  id: z.number().int(),
  provider: RecommendationProviderName,
  enabled: z.boolean(),
  apiKey: z.string().nullable(),
  hasApiKey: z.boolean(),
  clientId: z.string().nullable(),
  clientSecret: z.string().nullable(),
  hasClientSecret: z.boolean(),
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
  genre: z.string().nullable().optional(),
  playCount: z.number().int().nullable().optional(),
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
  durationSeconds: z.number().int().nullable(),
  sources: z.array(z.object({ provider: z.string(), externalId: z.string().nullable(), url: z.string() })),
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
  hasApiKey: z.boolean(),
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
  hasPassword: z.boolean(),
  hasApiKey: z.boolean(),
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

export const UpdateDownloadClientSchema = CreateDownloadClientSchema.partial();
export type UpdateDownloadClient = z.infer<typeof UpdateDownloadClientSchema>;

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
  kind: z.enum(['static', 'smart']),
  ruleFilters: z.string().nullable(),
  ruleMatchMode: z.string().nullable(),
  regenerateIntervalMinutes: z.number().int().nullable(),
  lastGeneratedAt: z.string().nullable(),
  targetConnectorId: z.number().int().nullable(),
  sortMode: z.enum(['artist_title', 'shuffle']),
  shuffleSeed: z.number().int().nullable(),
  items: z.array(PlaylistItemSchema),
  syncs: z.array(PlaylistSyncSchema),
});
export type Playlist = z.infer<typeof PlaylistSchema>;

export const CreatePlaylistSchema = z.object({
  name: z.string().min(1),
  targetConnectorId: z.number().int().positive().nullable().optional(),
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
  director: z.string().min(1).optional(),
  ownership: z.enum(['local', 'server', 'both']).optional(),
  qualityIds: z.array(z.number().int()).optional(),
  addedAfter: z.string().datetime().optional(),
  minPlayCount: z.number().int().min(0).optional(),
  artistIds: z.array(z.number().int()).optional(),
  musicVideoIds: z.array(z.number().int()).optional(),
});
export type PlaylistFilters = z.infer<typeof PlaylistFiltersSchema>;

export const GeneratePlaylistBodySchema = z.object({
  name: z.string().min(1),
  filters: PlaylistFiltersSchema,
  matchMode: MatchMode,
  smart: z.boolean().optional(),
  regenerateIntervalMinutes: z.number().int().min(60).nullable().optional(),
  targetConnectorId: z.number().int().positive().nullable().optional(),
  sortMode: z.enum(['artist_title', 'shuffle']).optional(),
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
