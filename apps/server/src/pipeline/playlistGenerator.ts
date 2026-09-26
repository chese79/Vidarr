import { prisma } from '../db/client.js';
import { MatchMode, PlaylistFiltersSchema } from '@vidarr/shared-types';
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
async function matchingVideoIds(filters: PlaylistFilters, matchMode: 'all' | 'any'): Promise<number[]> {
  const candidates = await prisma.musicVideo.findMany({
    where: { OR: [
      { hasFile: true },
      { libraryVideos: { some: { available: true, matchConfidence: null, connector: { enabled: true } } } },
    ] },
    include: { artist: true, file: true, libraryVideos: {
      where: { available: true, matchConfidence: null, connector: { enabled: true } },
    } },
    orderBy: [{ artist: { sortName: 'asc' } }, { title: 'asc' }, { id: 'asc' }],
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

  return matched.map((video) => video.id);
}

export async function generatePlaylistFromFilters(
  name: string,
  filters: PlaylistFilters,
  matchMode: 'all' | 'any',
  options: { smart?: boolean; regenerateIntervalMinutes?: number | null } = {},
): Promise<GeneratePlaylistResult> {
  const matchedIds = await matchingVideoIds(filters, matchMode);

  const playlist = await prisma.playlist.create({ data: {
    name,
    kind: options.smart ? 'smart' : 'static',
    ruleFilters: options.smart ? JSON.stringify(filters) : null,
    ruleMatchMode: options.smart ? matchMode : null,
    regenerateIntervalMinutes: options.smart ? options.regenerateIntervalMinutes ?? null : null,
    lastGeneratedAt: options.smart ? new Date() : null,
  } });
  if (matchedIds.length) {
    await prisma.playlistItem.createMany({
      data: matchedIds.map((musicVideoId, sortOrder) => ({ playlistId: playlist.id, musicVideoId, sortOrder })),
    });
  }

  return { playlistId: playlist.id, matchedCount: matchedIds.length };
}

export async function regenerateSmartPlaylist(playlistId: number): Promise<{ matchedCount: number; changed: boolean }> {
  const playlist = await prisma.playlist.findUnique({
    where: { id: playlistId },
    include: { items: { orderBy: { sortOrder: 'asc' }, select: { musicVideoId: true } } },
  });
  if (!playlist || playlist.kind !== 'smart' || !playlist.ruleFilters || !playlist.ruleMatchMode) {
    throw new Error('Smart playlist not found');
  }
  const filters = PlaylistFiltersSchema.parse(JSON.parse(playlist.ruleFilters));
  const matchMode = MatchMode.parse(playlist.ruleMatchMode);
  const matchedIds = await matchingVideoIds(filters, matchMode);
  const previousIds = playlist.items.map((item) => item.musicVideoId);
  const changed = matchedIds.length !== previousIds.length || matchedIds.some((id, index) => id !== previousIds[index]);
  await prisma.$transaction(async (tx) => {
    if (changed) {
      await tx.playlistItem.deleteMany({ where: { playlistId } });
      if (matchedIds.length) await tx.playlistItem.createMany({
        data: matchedIds.map((musicVideoId, sortOrder) => ({ playlistId, musicVideoId, sortOrder })),
      });
    }
    await tx.playlist.update({ where: { id: playlistId }, data: { lastGeneratedAt: new Date() } });
  });
  return { matchedCount: matchedIds.length, changed };
}
