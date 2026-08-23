import { z } from 'zod';

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
});
export type ImvdbVideoCandidate = z.infer<typeof ImvdbVideoCandidateSchema>;
