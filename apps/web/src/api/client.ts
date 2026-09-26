import type {
  Artist,
  CreateArtist,
  MusicVideo,
  CreateMusicVideo,
  QualityProfile,
  CreateQualityProfile,
  QualityDefinition,
  RootFolder,
  CreateRootFolder,
  Settings,
  UpdateSettings,
  LibraryConnector,
  CreateLibraryConnector,
  UpdateLibraryConnector,
  LibraryConnectorTestResult,
  LibrarySection,
  Playlist,
  CreatePlaylist,
  PlaylistPushResult,
  PlaylistImportCandidate,
  ImportArtistGroup,
  ImportCommitResult,
  Recommendation,
  RecommendationRefreshResult,
  RecommendationProviderConfig,
  UpdateRecommendationProviderConfig,
  ImvdbArtist,
  ImvdbVideoCandidate,
  YoutubeSource,
  CreateYoutubeSource,
  YoutubeSourceSyncResult,
  GrabResult,
  Indexer,
  CreateIndexer,
  UpdateIndexer,
  DownloadClient,
  CreateDownloadClient,
  UpdateDownloadClient,
  ConnectionTestResult,
  IndexerSearchResult,
  QueueRefreshResult,
  ScheduledTask,
  HistoryEntry,
  CalendarItem,
  UpdateArtist,
  BulkSearchResult,
  UpdateMusicVideo,
  GeneratePlaylistBody,
  GeneratePlaylistResult,
  StandardGenreMatch,
  PlayCountSyncResult,
  GoogleAuthStatus,
  LocalLoginStatus,
  DiscoverableLibraryConnectorType,
  DiscoveredServer,
  LibraryVideo,
  ArtistSummaryList,
  BulkMonitorArtistsResult,
  MatchedLibraryVideo,
  VideoStatus,
} from '@vidarr/shared-types';

export interface ArtistSummaryParams {
  search?: string;
  genre?: string;
  monitored?: boolean;
  musicbrainzStatus?: 'unmatched' | 'suggested' | 'ambiguous' | 'confirmed' | 'notFound' | 'failed';
  letter?: string;
  minKnownVideos?: number;
  minPlayCount?: number;
  hasMissing?: boolean;
  completeness?: 'complete' | 'unmatched' | 'activeDownloads';
  page?: number;
  pageSize?: number;
}

export interface QueueItem {
  id: number;
  musicVideoId: number;
  sourceType: string;
  status: string;
  progress: number;
  quality: string | null;
  addedAt: string;
  musicVideo: { title: string; artist: { name: string } };
}

const API_KEY_STORAGE_KEY = 'vidarr_api_key';

export function getStoredApiKey(): string | null {
  return localStorage.getItem(API_KEY_STORAGE_KEY);
}
export function setStoredApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE_KEY, key);
}
export function clearStoredApiKey(): void {
  localStorage.removeItem(API_KEY_STORAGE_KEY);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Only declare a JSON content-type when there's actually a body — Fastify's
  // default JSON parser rejects Content-Type: application/json paired with an
  // empty body (FST_ERR_CTP_EMPTY_JSON_BODY), which every bodyless POST here
  // (test/sync/refresh/grab/run) would otherwise hit.
  const headers: Record<string, string> = {};
  if (init?.body) headers['Content-Type'] = 'application/json';
  const apiKey = getStoredApiKey();
  if (apiKey) headers['X-Api-Key'] = apiKey;

  const res = await fetch(`/api/v1${path}`, { ...init, headers });
  if (res.status === 401) {
    clearStoredApiKey();
    // Tells the authentication gate to show sign-in without a full reload.
    window.dispatchEvent(new Event('vidarr:unauthorized'));
    throw new Error('Your session ended. Sign in again.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function requestBlob(path: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  const apiKey = getStoredApiKey();
  if (apiKey) headers['X-Api-Key'] = apiKey;
  const res = await fetch(`/api/v1${path}`, { headers });
  if (res.status === 401) {
    clearStoredApiKey();
    window.dispatchEvent(new Event('vidarr:unauthorized'));
    throw new Error('Your session ended. Sign in again.');
  }
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.blob();
}

export const api = {
  artists: {
    list: () => request<Artist[]>('/artist'),
    get: (id: number) =>
      request<
        Artist & {
          musicVideos: (MusicVideo & {
            libraryVideos: MatchedLibraryVideo[];
            status: VideoStatus;
            acquisitionSources: Array<{
              id: number; provider: string; url: string; authority: string; confidence: string; accepted: boolean;
            }>;
          })[];
          summary: { known: number; available: number; missing: number; monitored: number; aggregatePlayCount: number | null };
          unmatchedInventory: Array<{
            id: number; title: string; releaseYear: number | null; durationSeconds: number | null;
            matchConfidence: string | null; musicVideoId: number | null;
            connector: { name: string; type: string };
          }>;
        }
        >(`/artist/${id}`),
    videos: (id: number) => request<Array<{
      id: number; title: string; releaseYear: number | null; director: string | null;
      durationSeconds: number | null; monitored: boolean; ignored: boolean; hasFile: boolean;
      libraryVideos: Array<{ available: boolean; matchConfidence: string | null; playCount: number | null }>;
      status: VideoStatus;
    }>>(`/artist/${id}/videos`),
    create: (data: CreateArtist) =>
      request<Artist>('/artist', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: UpdateArtist) =>
      request<Artist & { videosAdded?: number; metadataRefreshError?: string }>(`/artist/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    remove: (id: number) => request<void>(`/artist/${id}`, { method: 'DELETE' }),
    matchGenre: (id: number) =>
      request<StandardGenreMatch>(`/artist/${id}/match-genre`, { method: 'POST' }),
    musicbrainzCandidates: (id: number) => request<Array<{
      id: number; musicbrainzArtistId: string; name: string; sortName: string | null;
      artistType: string | null; country: string | null; disambiguation: string | null; score: number; evidence: string;
    }>>(`/artist/${id}/musicbrainz/candidates`),
    discoverMusicbrainzCandidates: (id: number) => request<Array<{
      id: number; musicbrainzArtistId: string; name: string; sortName: string | null;
      artistType: string | null; country: string | null; disambiguation: string | null; score: number; evidence: string;
    }>>(`/artist/${id}/musicbrainz/discover`, { method: 'POST' }),
    confirmMusicbrainz: (id: number, musicbrainzArtistId: string) => request<Artist>(`/artist/${id}/musicbrainz/confirm`, {
      method: 'POST', body: JSON.stringify({ musicbrainzArtistId }),
    }),
    summary: (params: ArtistSummaryParams = {}) => {
      const qs = new URLSearchParams();
      if (params.search) qs.set('search', params.search);
      if (params.genre) qs.set('genre', params.genre);
      if (params.monitored !== undefined) qs.set('monitored', String(params.monitored));
      if (params.musicbrainzStatus) qs.set('musicbrainzStatus', params.musicbrainzStatus);
      if (params.letter) qs.set('letter', params.letter);
      if (params.minKnownVideos !== undefined) qs.set('minKnownVideos', String(params.minKnownVideos));
      if (params.minPlayCount !== undefined) qs.set('minPlayCount', String(params.minPlayCount));
      if (params.hasMissing) qs.set('hasMissing', 'true');
      if (params.completeness) qs.set('completeness', params.completeness);
      if (params.page !== undefined) qs.set('page', String(params.page));
      if (params.pageSize !== undefined) qs.set('pageSize', String(params.pageSize));
      const query = qs.toString();
      return request<ArtistSummaryList>(`/artist/summary${query ? `?${query}` : ''}`);
    },
    bulkMonitor: (ids: number[], monitored: boolean) =>
      request<BulkMonitorArtistsResult>('/artist/bulk-monitor', {
        method: 'POST',
        body: JSON.stringify({ ids, monitored }),
      }),
    bulkDiscoverMusicbrainz: (ids: number[]) => request<{
      succeeded: Array<{ id: number; candidateCount: number }>;
      failed: Array<{ id: number; error: string }>;
    }>('/artist/bulk-musicbrainz-discover', { method: 'POST', body: JSON.stringify({ ids }) }),
    bulkSearchMissing: (ids: number[]) => request<BulkSearchResult>('/artist/bulk-search-missing', {
      method: 'POST', body: JSON.stringify({ ids }),
    }),
    searchAllMissing: () => request<BulkSearchResult>('/artist/search-all-missing', { method: 'POST' }),
    // Not routed through request() — this needs the X-Api-Key header attached
    // as a fetch header (an <img src> can't do that), same reasoning as
    // libraryVideos.thumbnail below.
    image: (id: number) => requestBlob(`/artist/${id}/image`),
    refreshMetadata: (id: number) => request<{ videosAdded: number; videosUpdated: number; videosFlaggedForReview: number }>(`/artist/${id}/refresh-metadata`, { method: 'POST' }),
    reconcile: (id: number) => request<{ confident: number; review: number; unmatched: number }>(`/artist/${id}/reconcile`, { method: 'POST' }),
    monitorVideos: (id: number, mode: 'all' | 'none' | 'missing') => request<{ updated: number }>(`/artist/${id}/monitor-videos`, { method: 'POST', body: JSON.stringify({ mode }) }),
    searchMissing: (id: number) => request<BulkSearchResult>(`/artist/${id}/search-missing`, { method: 'POST' }),
  },
  musicVideos: {
    list: (opts?: { artistId?: number; hasFile?: boolean }) => {
      const params = new URLSearchParams();
      if (opts?.artistId !== undefined) params.set('artistId', String(opts.artistId));
      if (opts?.hasFile !== undefined) params.set('hasFile', String(opts.hasFile));
      const qs = params.toString();
      return request<(MusicVideo & { artist: { name: string } })[]>(`/musicvideo${qs ? `?${qs}` : ''}`);
    },
    create: (data: CreateMusicVideo) =>
      request<MusicVideo>('/musicvideo', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: UpdateMusicVideo) =>
      request<MusicVideo>(`/musicvideo/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id: number) => request<void>(`/musicvideo/${id}`, { method: 'DELETE' }),
    grab: (id: number) => request<GrabResult>(`/musicvideo/${id}/grab`, { method: 'POST' }),
    bulkSearch: (ids: number[]) =>
      request<BulkSearchResult>('/musicvideo/bulk-search', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }),
  },
  qualityProfiles: {
    list: () => request<QualityProfile[]>('/qualityprofile'),
    create: (data: CreateQualityProfile) =>
      request<QualityProfile>('/qualityprofile', { method: 'POST', body: JSON.stringify(data) }),
    remove: (id: number) => request<void>(`/qualityprofile/${id}`, { method: 'DELETE' }),
  },
  qualities: {
    list: () => request<QualityDefinition[]>('/quality'),
  },
  rootFolders: {
    list: () => request<RootFolder[]>('/rootfolder'),
    create: (data: CreateRootFolder) =>
      request<RootFolder>('/rootfolder', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<CreateRootFolder>) =>
      request<RootFolder>(`/rootfolder/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id: number) => request<void>(`/rootfolder/${id}`, { method: 'DELETE' }),
  },
  settings: {
    get: () => request<Settings>('/config'),
    update: (data: UpdateSettings) =>
      request<Settings>('/config', { method: 'PUT', body: JSON.stringify(data) }),
    regenerateApiKey: () =>
      request<Settings>('/config/regenerate-api-key', { method: 'POST' }),
    setLoginCredentials: (username: string, password: string) =>
      request<{ adminUsername: string }>('/auth/login/credentials', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
  },
  libraryConnectors: {
    list: () => request<LibraryConnector[]>('/libraryconnector'),
    create: (data: CreateLibraryConnector) =>
      request<LibraryConnector>('/libraryconnector', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: UpdateLibraryConnector) =>
      request<LibraryConnector>(`/libraryconnector/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    remove: (id: number) => request<void>(`/libraryconnector/${id}`, { method: 'DELETE' }),
    test: (id: number) =>
      request<LibraryConnectorTestResult>(`/libraryconnector/${id}/test`, { method: 'POST' }),
    sync: (id: number) =>
      request<{ ok: boolean; artistCount: number; videoCount: number; recordingCount: number; recommendationCount: number }>(`/libraryconnector/${id}/sync`, {
        method: 'POST',
      }),
    sections: (id: number) => request<LibrarySection[]>(`/libraryconnector/${id}/sections`),
    syncPlayCounts: (id: number) =>
      request<PlayCountSyncResult>(`/libraryconnector/${id}/sync-play-counts`, { method: 'POST' }),
    discover: (type: DiscoverableLibraryConnectorType) =>
      request<DiscoveredServer[]>('/libraryconnector/discover', {
        method: 'POST',
        body: JSON.stringify({ type }),
      }),
  },
  libraryVideos: {
    list: () => request<LibraryVideo[]>('/libraryvideo'),
    thumbnail: (id: number) => requestBlob(`/libraryvideo/${id}/thumbnail`),
    confirmMatch: (id: number) => request<LibraryVideo>(`/libraryvideo/${id}/confirm-match`, { method: 'POST' }),
    rejectMatch: (id: number) => request<LibraryVideo>(`/libraryvideo/${id}/reject-match`, { method: 'POST' }),
  },
  playlists: {
    list: () => request<Playlist[]>('/playlist'),
    generate: (data: GeneratePlaylistBody) =>
      request<GeneratePlaylistResult>('/playlist/generate', { method: 'POST', body: JSON.stringify(data) }),
    create: (data: CreatePlaylist) =>
      request<Playlist>('/playlist', { method: 'POST', body: JSON.stringify(data) }),
    remove: (id: number) => request<void>(`/playlist/${id}`, { method: 'DELETE' }),
    addItem: (id: number, musicVideoId: number) =>
      request<void>(`/playlist/${id}/items`, { method: 'POST', body: JSON.stringify({ musicVideoId }) }),
    removeItem: (id: number, musicVideoId: number) =>
      request<void>(`/playlist/${id}/items/${musicVideoId}`, { method: 'DELETE' }),
    push: (id: number, connectorId: number) =>
      request<PlaylistPushResult>(`/playlist/${id}/push/${connectorId}`, { method: 'POST' }),
  },
  bulkImport: {
    previewYoutubePlaylist: (url: string) =>
      request<PlaylistImportCandidate[]>('/bulkimport/youtube-playlist/preview', {
        method: 'POST',
        body: JSON.stringify({ url }),
      }),
    commitYoutubePlaylist: (
      groups: ImportArtistGroup[],
      rootFolderId: number,
      qualityProfileId: number,
    ) =>
      request<ImportCommitResult>('/bulkimport/youtube-playlist/commit', {
        method: 'POST',
        body: JSON.stringify({ groups, rootFolderId, qualityProfileId }),
      }),
  },
  recommendations: {
    list: () => request<Recommendation[]>('/recommendation'),
    refresh: () =>
      request<RecommendationRefreshResult>('/recommendation/refresh', { method: 'POST' }),
    dismiss: (id: number) =>
      request<Recommendation>(`/recommendation/${id}/dismiss`, { method: 'POST' }),
    add: (id: number, data: { rootFolderId: number; qualityProfileId: number }) =>
      request<Artist>(`/recommendation/${id}/add`, { method: 'POST', body: JSON.stringify(data) }),
  },
  recommendationProviders: {
    list: () => request<RecommendationProviderConfig[]>('/recommendationprovider'),
    update: (provider: string, data: UpdateRecommendationProviderConfig) =>
      request<RecommendationProviderConfig>(`/recommendationprovider/${provider}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
  },
  imvdb: {
    searchArtists: (q: string) =>
      request<ImvdbArtist[]>(`/imvdb/search-artists?q=${encodeURIComponent(q)}`),
    getArtistVideos: (slug: string, name: string) =>
      request<ImvdbVideoCandidate[]>(
        `/imvdb/artist/${encodeURIComponent(slug)}/videos?name=${encodeURIComponent(name)}`,
      ),
  },
  youtubeSources: {
    list: (artistId: number) =>
      request<YoutubeSource[]>(`/youtubesource?artistId=${artistId}`),
    create: (data: CreateYoutubeSource) =>
      request<YoutubeSource>('/youtubesource', { method: 'POST', body: JSON.stringify(data) }),
    remove: (id: number) => request<void>(`/youtubesource/${id}`, { method: 'DELETE' }),
    sync: (id: number) =>
      request<YoutubeSourceSyncResult>(`/youtubesource/${id}/sync`, { method: 'POST' }),
  },
  indexers: {
    list: () => request<Indexer[]>('/indexer'),
    create: (data: CreateIndexer) =>
      request<Indexer>('/indexer', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: UpdateIndexer) =>
      request<Indexer>(`/indexer/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    updateCategories: (id: number, categories: number[]) =>
      request<Indexer>(`/indexer/${id}`, { method: 'PUT', body: JSON.stringify({ categories }) }),
    remove: (id: number) => request<void>(`/indexer/${id}`, { method: 'DELETE' }),
    test: (id: number) => request<ConnectionTestResult>(`/indexer/${id}/test`, { method: 'POST' }),
  },
  downloadClients: {
    list: () => request<DownloadClient[]>('/downloadclient'),
    create: (data: CreateDownloadClient) =>
      request<DownloadClient>('/downloadclient', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: UpdateDownloadClient) =>
      request<DownloadClient>(`/downloadclient/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id: number) => request<void>(`/downloadclient/${id}`, { method: 'DELETE' }),
    test: (id: number) =>
      request<ConnectionTestResult>(`/downloadclient/${id}/test`, { method: 'POST' }),
  },
  search: {
    forVideo: (musicVideoId: number) =>
      request<IndexerSearchResult[]>(`/musicvideo/${musicVideoId}/search`),
    grabRelease: (
      musicVideoId: number,
      data: { downloadClientId: number; downloadUrl: string; quality: string },
    ) =>
      request<GrabResult>(`/musicvideo/${musicVideoId}/grab-release`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  queue: {
    list: () => request<QueueItem[]>('/queue'),
    refresh: () => request<QueueRefreshResult>('/queue/refresh', { method: 'POST' }),
  },
  system: {
    tasks: () => request<ScheduledTask[]>('/system/task'),
    runTask: (name: string) =>
      request<{ ok: boolean }>(`/system/task/${encodeURIComponent(name)}/run`, { method: 'POST' }),
    regenerateLibraryMetadata: () =>
      request<{ written: number; failed: number }>('/system/regenerate-library-metadata', {
        method: 'POST',
      }),
  },
  history: {
    list: () => request<HistoryEntry[]>('/history'),
  },
  calendar: {
    list: () => request<CalendarItem[]>('/calendar'),
  },
  googleAuth: {
    // Not routed through request() — it must work with no stored API key at
    // all, which is exactly the point (see ApiKeyGate).
    status: () => fetch('/api/v1/auth/google/status').then((r) => r.json() as Promise<GoogleAuthStatus>),
  },
  localAuth: {
    // These routes work before the browser has its internal API credential.
    status: async () => {
      const res = await fetch('/api/v1/auth/login/status');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Could not check sign-in status.');
      return body as LocalLoginStatus;
    },
    login: async (username: string, password: string) => {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Login failed.');
      return body as { apiKey: string };
    },
    setup: async (username: string, password: string) => {
      const res = await fetch('/api/v1/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Account setup failed.');
      return body as { apiKey: string };
    },
  },
};
