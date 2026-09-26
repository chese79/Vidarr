import { prisma } from '../db/client.js';
import { MatchMode, PlaylistFiltersSchema } from '@vidarr/shared-types';
import { normalizeTitle } from './normalize.js';
import { createHash, randomInt } from 'node:crypto';

export interface PlaylistFilters {
  yearMin?: number;
  yearMax?: number;
  genre?: string;
  director?: string;
  ownership?: 'local' | 'server' | 'both';
  qualityIds?: number[];
  addedAfter?: string;
  minPlayCount?: number;
  artistIds?: number[];
  musicVideoIds?: number[];
}

export interface GeneratePlaylistResult {
  playlistId: number;
  matchedCount: number;
}

function orderedIds(ids: number[], sortMode: string, shuffleSeed: number | null): number[] {
  if (sortMode !== 'shuffle' || shuffleSeed == null) return ids;
  const ranks = new Map(ids.map((id) => [id, createHash('sha256').update(`${shuffleSeed}:${id}`).digest('hex')]));
  return [...ids].sort((a, b) => {
    const left = ranks.get(a)!;
    const right = ranks.get(b)!;
    return left < right ? -1 : left > right ? 1 : a - b;
  });
}

// A local file or a confirmed available server match can participate in a
// playlist. Push applies the selected connector's availability boundary.
async function matchingVideoIds(filters: PlaylistFilters, matchMode: 'all' | 'any', targetConnectorId?: number | null): Promise<number[]> {
  const candidates = await prisma.musicVideo.findMany({
    where: targetConnectorId ? { libraryVideos: { some: {
      connectorId: targetConnectorId, available: true, matchConfidence: null, connector: { enabled: true },
    } } } : { OR: [
      { hasFile: true },
      { libraryVideos: { some: { available: true, matchConfidence: null, connector: { enabled: true } } } },
    ] },
    include: { artist: true, file: true, libraryVideos: {
      where: { available: true, matchConfidence: null, connector: { enabled: true }, connectorId: targetConnectorId ?? undefined },
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

  if (filters.director) {
    const wantDirector = normalizeTitle(filters.director);
    checks.push((v) => Boolean(v.director && normalizeTitle(v.director).includes(wantDirector)));
  }

  if (filters.ownership) {
    checks.push((v) => {
      const onServer = v.libraryVideos.length > 0;
      if (filters.ownership === 'both') return v.hasFile && onServer;
      if (filters.ownership === 'local') return v.hasFile && !onServer;
      return !v.hasFile && onServer;
    });
  }

  if (filters.qualityIds?.length) {
    const qualities = new Set(filters.qualityIds);
    checks.push((v) => v.file?.qualityId != null && qualities.has(v.file.qualityId));
  }

  if (filters.addedAfter) {
    const threshold = new Date(filters.addedAfter);
    checks.push((v) => v.addedAt >= threshold);
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
  options: { smart?: boolean; regenerateIntervalMinutes?: number | null; targetConnectorId?: number | null; sortMode?: 'artist_title' | 'shuffle' } = {},
): Promise<GeneratePlaylistResult> {
  const matchedIds = await matchingVideoIds(filters, matchMode, options.targetConnectorId);
  const sortMode = options.sortMode ?? 'artist_title';
  const shuffleSeed = sortMode === 'shuffle' ? randomInt(0, 2 ** 31) : null;
  const sortedIds = orderedIds(matchedIds, sortMode, shuffleSeed);

  const playlist = await prisma.playlist.create({ data: {
    name,
    kind: options.smart ? 'smart' : 'static',
    ruleFilters: options.smart ? JSON.stringify(filters) : null,
    ruleMatchMode: options.smart ? matchMode : null,
    regenerateIntervalMinutes: options.smart ? options.regenerateIntervalMinutes ?? null : null,
    lastGeneratedAt: options.smart ? new Date() : null,
    targetConnectorId: options.targetConnectorId ?? null,
    sortMode,
    shuffleSeed,
  } });
  if (sortedIds.length) {
    await prisma.playlistItem.createMany({
      data: sortedIds.map((musicVideoId, sortOrder) => ({ playlistId: playlist.id, musicVideoId, sortOrder })),
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
  const matchedIds = orderedIds(await matchingVideoIds(filters, matchMode, playlist.targetConnectorId), playlist.sortMode, playlist.shuffleSeed);
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
