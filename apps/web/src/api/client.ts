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
};
