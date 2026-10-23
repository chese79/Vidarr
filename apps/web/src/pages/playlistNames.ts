export function nextPlaylistName(playlists: readonly { name: string }[]): string {
  const names = new Set(playlists.map(item => item.name.trim().toLowerCase()));
  let iteration = 1;
  while (names.has(`awesome playlist #${iteration}`)) iteration++;
  return `Awesome playlist #${iteration}`;
}
