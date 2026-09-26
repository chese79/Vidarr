import { prisma } from '../db/client.js';
import { normalizeTitle } from './normalize.js';

export interface PlaylistFilters {
  yearMin?: number;
  yearMax?: number;
  genre?: string;
  minPlayCount?: number;
  artistIds?: number[];
  musicVideoIds?: number[];
}

export interface GeneratePlaylistResult {
  playlistId: number;
  matchedCount: number;
}

// A local file or a confirmed available server match can participate in a
// playlist. Push applies the selected connector's availability boundary.
export async function generatePlaylistFromFilters(
  name: string,
  filters: PlaylistFilters,
  matchMode: 'all' | 'any',
): Promise<GeneratePlaylistResult> {
  const candidates = await prisma.musicVideo.findMany({
    where: { OR: [
      { hasFile: true },
      { libraryVideos: { some: { available: true, matchConfidence: null, connector: { enabled: true } } } },
    ] },
    include: { artist: true, file: true, libraryVideos: {
      where: { available: true, matchConfidence: null, connector: { enabled: true } },
    } },
  });

  type Candidate = (typeof candidates)[number];
  const checks: ((v: Candidate) => boolean)[] = [];

  if (filters.yearMin !== undefined || filters.yearMax !== undefined) {
    checks.push((v) => {
      if (v.releaseYear === null) return false;
      if (filters.yearMin !== undefined && v.releaseYear < filters.yearMin) return false;
      if (filters.yearMax !== undefined && v.releaseYear > filters.yearMax) return false;
      return true;
    });
  }

  if (filters.genre) {
    // Substring match (not exact) so a broad term like "rock" matches a more
    // specific stored value like "album rock" (e.g. from Spotify's genre
    // taxonomy — see pipeline/genreMatch.ts).
    const wantGenre = normalizeTitle(filters.genre);
    checks.push((v) => {
      const videoGenre = v.genre ? normalizeTitle(v.genre) : '';
      const artistGenre = v.artist.genre ? normalizeTitle(v.artist.genre) : '';
      return videoGenre.includes(wantGenre) || artistGenre.includes(wantGenre);
    });
  }

  if (filters.minPlayCount !== undefined) {
    const min = filters.minPlayCount;
    checks.push((v) => (v.file?.playCount ?? Math.max(0, ...v.libraryVideos.map((item) => item.playCount ?? 0))) >= min);
  }

  if (filters.artistIds?.length) {
    const artistSet = new Set(filters.artistIds);
    checks.push((v) => artistSet.has(v.artistId));
  }

  if (filters.musicVideoIds?.length) {
    const videoSet = new Set(filters.musicVideoIds);
    checks.push((v) => videoSet.has(v.id));
  }

  const matched = checks.length
    ? candidates.filter((v) => (matchMode === 'all' ? checks.every((c) => c(v)) : checks.some((c) => c(v))))
    : [];

  const playlist = await prisma.playlist.create({ data: { name } });
  if (matched.length) {
    await prisma.playlistItem.createMany({
      data: matched.map((v, i) => ({ playlistId: playlist.id, musicVideoId: v.id, sortOrder: i })),
    });
  }

  return { playlistId: playlist.id, matchedCount: matched.length };
}
