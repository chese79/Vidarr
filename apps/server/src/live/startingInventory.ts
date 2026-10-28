import { prisma, logActivity } from '../db/client.js';
import type { Prisma } from '@prisma/client';
import { getMusicBrainzLiveReferences, getMusicBrainzLiveEventReferences } from '../providers/metadata/musicbrainz.js';
import type { DiscoveredYoutubeVideo } from '../providers/youtube/musicDiscovery.js';
import { isScanExcluded, loadScanExclusions } from '../pipeline/deletedVideoScans.js';
import { redactMessage } from '../security/redact.js';
import { liveScanExcluded } from './exclusions.js';
import { liveEnabled, requireLiveEnabled } from './capability.js';
import { LiveError } from './policy.js';

export function isLiveUpload(title: string) {
  if (/\b(?:lyrics?|official audio|audio only|visualizer|trailer|teaser|interview|backstage|karaoke)\b|fan reactions|behind the scenes/i.test(title)) return false;
  return /[([]\s*live\b|\blive\s*(?:@|(?:at|in|on|from)\b|[)\]])|\blive\s*$|\bconcerts?\b|\ben vivo\b|\bao vivo\b/i.test(title);
}

export async function saveLiveUpload(artistId: number, video: DiscoveredYoutubeVideo, sourceUrl: string) {
  if (!isLiveUpload(video.title) || !/^[\w-]{11}$/.test(video.youtubeVideoId)) return;
  if (!await liveEnabled()) return;
  if (await liveScanExcluded([`youtube:${video.youtubeVideoId}`])) return;
  const data = { title: video.title, url: `https://www.youtube.com/watch?v=${video.youtubeVideoId}`,
    evidence: JSON.stringify({ discovery: 'shared-artist-channel', sourceUrl, origins: video.discoveryOrigins,
      officialEvidence: video.officialEvidence, publicationDate: video.sourcePublishedAt, occasionUnconfirmed: true }), rank: 100 };
  await prisma.liveDiscoveryItem.upsert({
    where: { artistId_provider_externalId: { artistId, provider: 'youtube', externalId: video.youtubeVideoId } },
    create: { artistId, kind: 'video', provider: 'youtube', externalId: video.youtubeVideoId, ...data },
    // Decisions and promoted identities survive refresh; no title-based event merging.
    update: data,
  });
}

const active = new Map<number, Promise<void>>();
export const visibleLiveDiscoveries: Prisma.LiveDiscoveryItemWhereInput = {
  dismissed: false, OR: [{ recordingId: null }, { recording: { is: { reviewStatus: { notIn: ['rejected', 'returnedToMusicVideos', 'deleted', 'identifiedDuplicate'] }, deletionState: null } } }],
};
export function prepareLiveStartingInventory(artistId: number, force = false): Promise<void> {
  const existing = active.get(artistId);
  if (existing) return existing;
  const task = prepare(artistId, force).finally(() => active.delete(artistId));
  active.set(artistId, task); return task;
}
async function prepare(artistId: number, force: boolean) {
  if (!await liveEnabled()) return;
  const artist = await prisma.artist.findUniqueOrThrow({ where: { id: artistId } });
  if (artist.musicbrainzMatchStatus !== 'confirmed' || !artist.musicbrainzArtistId) throw new LiveError('Confirm the artist in MusicBrainz first');
  if (!force && artist.liveDiscoveryAttemptedAt && artist.liveDiscoveryAttemptedAt.getTime() > Date.now() - 10 * 60_000) return;
  await prisma.artist.update({ where: { id: artistId }, data: { liveDiscoveryStatus: 'running', liveDiscoveryAttemptedAt: new Date(), liveDiscoveryError: null } });
  const errors: string[] = [];
  try {
    const exclusions = await loadScanExclusions(artistId);
    // Recover the original shared observations without changing MV review decisions.
    let cursor = 0;
    for (;;) {
      const rows = await prisma.videoReviewCandidate.findMany({ where: { artistId, source: 'youtube', id: { gt: cursor },
        OR: [{ decision: 'pending' }, { decision: 'rejected', reason: { startsWith: 'Title indicates live' } }] }, orderBy: { id: 'asc' }, take: 250 });
      if (!rows.length) break;
      for (const row of rows) {
        if (!isScanExcluded(exclusions, artistId, { youtubeVideoId: row.externalId, title: row.title }))
          await saveLiveUpload(artistId, { youtubeVideoId: row.externalId, title: row.title, sourcePublishedAt: row.sourcePublishedAt,
            discoveryOrigins: ['preserved-mv-observation'], officialEvidence: [] }, row.url ?? '');
      }
      cursor = rows[rows.length - 1].id;
    }
  } catch (error) { errors.push(`Saved uploads: ${redactMessage(error)}`); }
  try {
    for (const reference of await getMusicBrainzLiveReferences(artist.musicbrainzArtistId)) {
      if (!await liveEnabled()) break;
      const data = { title: reference.title, url: reference.url, rank: reference.rank,
        evidence: JSON.stringify({ ...reference, discovery: 'musicbrainz-live-release', releaseDateIsNotPerformanceDate: true }) };
      await prisma.liveDiscoveryItem.upsert({ where: { artistId_provider_externalId: { artistId, provider: 'musicbrainz', externalId: reference.id } },
        create: { artistId, kind: 'reference', provider: 'musicbrainz', externalId: reference.id, ...data }, update: data });
    }
  } catch (error) { errors.push(`MusicBrainz: ${redactMessage(error)}`); }
  try {
    for (const reference of await getMusicBrainzLiveEventReferences(artist.musicbrainzArtistId)) {
      if (!await liveEnabled()) break;
      const data = { title: reference.title, url: reference.url, rank: reference.rank, evidence: JSON.stringify({ ...reference, discovery: 'musicbrainz-event', dateRequiresReview: true }) };
      await prisma.liveDiscoveryItem.upsert({ where: { artistId_provider_externalId: { artistId, provider: 'musicbrainz-event', externalId: reference.id } },
        create: { artistId, kind: 'reference', provider: 'musicbrainz-event', externalId: reference.id, ...data }, update: data });
    }
  } catch (error) { errors.push(`MusicBrainz events: ${redactMessage(error)}`); }
  await prisma.artist.update({ where: { id: artistId }, data: { liveDiscoveryStatus: errors.length ? 'partial' : 'complete',
    liveDiscoveryError: errors.join('; ') || null, ...(!errors.length ? { liveDiscoveryCompletedAt: new Date() } : {}) } });
}

export async function backfillLiveStartingInventories() {
  if (!await liveEnabled()) return 'Live & Concerts is disabled';
  const due: Prisma.ArtistWhereInput = { musicbrainzMatchStatus: 'confirmed', musicbrainzArtistId: { not: null },
    OR: [{ liveDiscoveryCompletedAt: null }, { liveDiscoveryStatus: { in: ['pending', 'partial', 'running'] } }],
    AND: [{ OR: [{ liveDiscoveryAttemptedAt: null }, { liveDiscoveryAttemptedAt: { lt: new Date(Date.now() - 10 * 60_000) } }] }] };
  const orderBy = [{ addedAt: 'desc' }, { id: 'desc' }] as const;
  const videos = await prisma.artist.findMany({ where: { ...due, videoReviewCandidates: { some: { source: 'youtube', title: { contains: 'live' },
    OR: [{ decision: 'pending' }, { decision: 'rejected', reason: { startsWith: 'Title indicates live' } }] } } }, orderBy: [...orderBy], take: 3, select: { id: true } });
  const others = videos.length < 3 ? await prisma.artist.findMany({ where: { ...due, id: { notIn: videos.map(artist => artist.id) } },
    orderBy: [...orderBy], take: 3 - videos.length, select: { id: true } }) : [];
  const artists = [...videos, ...others];
  for (const artist of artists) try { await prepareLiveStartingInventory(artist.id); }
  catch (error) { await logActivity('warn', `live-start:${artist.id}`, error); }
  return `${artists.length} artist Live starting inventories prepared; setlist.fm not queried`;
}

export async function liveStartingItems(artistId: number, kind: 'video' | 'reference', offset = 0, limit = 5, search = '') {
  const enabled = await liveEnabled();
  const artist = await prisma.artist.findUniqueOrThrow({ where: { id: artistId }, select: { name: true, liveDiscoveryStatus: true,
    liveDiscoveryAttemptedAt: true, liveDiscoveryCompletedAt: true, liveDiscoveryError: true, videoInventoryStatus: true, videoInventoryError: true } });
  const where = { ...visibleLiveDiscoveries, artistId, kind, ...(search.trim() ? { title: { contains: search.trim() } } : {}) };
  const [total, items] = await prisma.$transaction([prisma.liveDiscoveryItem.count({ where }),
    prisma.liveDiscoveryItem.findMany({ where, orderBy: [{ rank: 'desc' }, { id: 'asc' }], skip: offset, take: limit })]);
  return { enabled, artist, total, items, offset, limit };
}

export async function openLiveStartingItem(artistId: number, itemId: number) {
  await requireLiveEnabled();
  return prisma.$transaction(async tx => {
    const item = await tx.liveDiscoveryItem.findUniqueOrThrow({ where: { id: itemId } });
    if (item.artistId !== artistId || item.dismissed) throw new LiveError('Choose a current discovery for this artist');
    const artist = await tx.artist.findUniqueOrThrow({ where: { id: artistId } });
    if (artist.musicbrainzMatchStatus !== 'confirmed' || !artist.musicbrainzArtistId) throw new LiveError('Confirm the artist identity first');
    if (item.recordingId) return { recordingId: item.recordingId, performanceId: item.performanceId };
    if (item.performanceId && await tx.livePerformance.count({ where: { id: item.performanceId, removedAt: null } })) return { performanceId: item.performanceId };
    if (item.kind === 'video') {
      if (await liveScanExcluded([`youtube:${item.externalId}`], tx)) throw new LiveError('This upload is excluded from future discovery');
      const existing = await tx.recordingSource.findUnique({ where: { provider_externalId: { provider: 'youtube', externalId: item.externalId } }, include: { recording: { include: { performances: { include: { performance: true } } } } } });
      if (existing) {
        if (existing.recording.catalogType !== 'live' || !existing.recording.performances.some(link => link.performance.artistId === artistId)) throw new LiveError('This exact source already belongs to another catalog/artist; review its existing identity');
        await tx.liveDiscoveryItem.update({ where: { id: itemId }, data: { recordingId: existing.recordingId } });
        return { recordingId: existing.recordingId };
      }
      if (await tx.musicVideo.count({ where: { OR: [{ youtubeVideoId: item.externalId }, { acquisitionSources: { some: { provider: 'youtube', OR: [{ externalId: item.externalId }, { url: item.url }] } } }] } })) throw new LiveError('This upload already belongs to Music Videos. Use its Live/Concert classification review instead.');
    }
    const performance = await tx.livePerformance.create({ data: { artistId, title: item.title,
      identityStatus: item.kind === 'reference' ? 'reference' : 'independent', sourcePayload: item.evidence,
      notes: 'Discovery proposal. Performance date/place, artist/content and exact capture remain to be reviewed.', userEdited: false } });
    const recording = item.kind === 'video' ? await tx.recording.create({ data: { title: item.title, evidenceUrl: item.url, evidence: item.evidence,
      performances: { create: { performanceId: performance.id } }, sources: { create: { provider: 'youtube', externalId: item.externalId, url: item.url, payload: item.evidence } } } }) : null;
    await tx.liveDiscoveryItem.update({ where: { id: itemId }, data: { performanceId: performance.id, recordingId: recording?.id } });
    return { performanceId: performance.id, ...(recording ? { recordingId: recording.id } : {}) };
  });
}
