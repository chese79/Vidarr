export function filterArtistVideos<T extends { title: string }>(videos: T[], search: string): T[] {
  const key = search.trim().toLocaleLowerCase();
  return key ? videos.filter(video => video.title.toLocaleLowerCase().includes(key)) : videos;
}
