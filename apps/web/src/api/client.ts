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
  DownloadClient,
  CreateDownloadClient,
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
} from '@vidarr/shared-types';

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
    // Tells the ApiKeyGate to re-prompt without a full page reload.
    window.dispatchEvent(new Event('vidarr:unauthorized'));
    throw new Error('Unauthorized — check your API key.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  artists: {
    list: () => request<Artist[]>('/artist'),
    get: (id: number) => request<Artist & { musicVideos: MusicVideo[] }>(`/artist/${id}`),
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
    remove: (id: number) => request<void>(`/rootfolder/${id}`, { method: 'DELETE' }),
  },
  settings: {
    get: () => request<Settings>('/config'),
    update: (data: UpdateSettings) =>
      request<Settings>('/config', { method: 'PUT', body: JSON.stringify(data) }),
    regenerateApiKey: () =>
      request<Settings>('/config/regenerate-api-key', { method: 'POST' }),
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
      request<{ ok: boolean; artistCount: number }>(`/libraryconnector/${id}/sync`, {
        method: 'POST',
      }),
    sections: (id: number) => request<LibrarySection[]>(`/libraryconnector/${id}/sections`),
    syncPlayCounts: (id: number) =>
      request<PlayCountSyncResult>(`/libraryconnector/${id}/sync-play-counts`, { method: 'POST' }),
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
    updateCategories: (id: number, categories: number[]) =>
      request<Indexer>(`/indexer/${id}`, { method: 'PUT', body: JSON.stringify({ categories }) }),
    remove: (id: number) => request<void>(`/indexer/${id}`, { method: 'DELETE' }),
    test: (id: number) => request<ConnectionTestResult>(`/indexer/${id}/test`, { method: 'POST' }),
  },
  downloadClients: {
    list: () => request<DownloadClient[]>('/downloadclient'),
    create: (data: CreateDownloadClient) =>
      request<DownloadClient>('/downloadclient', { method: 'POST', body: JSON.stringify(data) }),
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
};
