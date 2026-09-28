export interface DownloadSelectionVideo {
  id: number;
  hasFile: boolean;
  ignored: boolean;
  youtubeVideoId: string | null;
  status: { acquisition: string | null };
  acquisitionSources: Array<{ accepted: boolean; url: string }>;
}

export function downloadableSelectedIds(videos: DownloadSelectionVideo[], selected: Set<number>): number[] {
  return videos.filter((video) => selected.has(video.id)
    && !video.hasFile
    && !video.ignored
    && (video.status.acquisition == null || video.status.acquisition === 'failed')
    && (Boolean(video.youtubeVideoId) || video.acquisitionSources.some((source) => source.accepted && /^https?:\/\//i.test(source.url))))
    .map((video) => video.id);
}
