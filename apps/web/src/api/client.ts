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
} from '@vidarr/shared-types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
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
    remove: (id: number) => request<void>(`/artist/${id}`, { method: 'DELETE' }),
  },
  musicVideos: {
    list: (artistId?: number) =>
      request<MusicVideo[]>(`/musicvideo${artistId ? `?artistId=${artistId}` : ''}`),
    create: (data: CreateMusicVideo) =>
      request<MusicVideo>('/musicvideo', { method: 'POST', body: JSON.stringify(data) }),
    remove: (id: number) => request<void>(`/musicvideo/${id}`, { method: 'DELETE' }),
    grab: (id: number) => request<GrabResult>(`/musicvideo/${id}/grab`, { method: 'POST' }),
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
};
