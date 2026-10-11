import { prisma, logActivity } from '../db/client.js';
import { refreshArtistMetadata } from './metadataRefresh.js';
import { scanLocalVideoCandidates } from './localVideoReview.js';
import { syncYoutubeSource } from './youtubeSync.js';
import { channelVideosUrl } from '../providers/youtube/ytdlp.js';
import { randomUUID } from 'node:crypto';
import { enrichConfirmedArtist } from './artistIdentity.js';
import type { MusicBrainzArtist } from '../providers/metadata/musicbrainz.js';
import { redactMessage } from '../security/redact.js';

export interface ArtistVideoCollectionResult {
  official: number;
  approvedOther: number;
  pendingYoutube: number;
  pendingLocal: number;
  errors: string[];
}

// Collect the three launch inputs for one confirmed artist. A failing source
// does not erase records from another source or revoke artist confirmation.
interface CollectionOptions {
  refreshImvdb?: boolean; scanLocal?: boolean; enrichIdentity?: boolean; metadata?: MusicBrainzArtist;
  localScan?: () => Promise<unknown>;
}
const collections = new Map<number, Promise<ArtistVideoCollectionResult>>();

export function collectArtistVideoInventory(artistId: number, options: CollectionOptions = {}): Promise<ArtistVideoCollectionResult> {
  const existing = collections.get(artistId);
  if (existing) return existing;
  const task = runCollection(artistId, options).finally(() => collections.delete(artistId));
  collections.set(artistId, task);
  return task;
}

async function runCollection(
  artistId: number,
  options: CollectionOptions,
): Promise<ArtistVideoCollectionResult> {
  const artist = await prisma.artist.findUniqueOrThrow({ where: { id: artistId } });
  if (artist.musicbrainzMatchStatus !== 'confirmed' || !artist.musicbrainzArtistId) {
    throw new Error('Confirm the artist in MusicBrainz before collecting videos.');
  }
  const errors: string[] = [];
  const runId = randomUUID();
  const source = `artist-video-inventory:${artistId}:${runId}`;
  await prisma.artist.update({ where: { id: artistId }, data: {
    videoInventoryStatus: 'running', videoInventoryAttemptedAt: new Date(), videoInventoryError: null,
  } });
  try {
  await logActivity('info', source, 'Collection started');
  if (options.enrichIdentity) {
    try {
      await enrichConfirmedArtist(artistId, artist.musicbrainzArtistId, undefined, options.metadata);
      await logActivity('info', `${source}:musicbrainz`, 'Identity enrichment completed');
    } catch (error) {
      errors.push(`MusicBrainz: ${redactMessage(error)}`);
      await logActivity('warn', `${source}:musicbrainz`, error);
    }
  }
  if (options.refreshImvdb !== false) {
    try { await refreshArtistMetadata(artistId); await logActivity('info', `${source}:imvdb`, 'Catalog check completed'); }
    catch (error) {
      errors.push(`IMVDb: ${redactMessage(error)}`);
      await logActivity('warn', `${source}:imvdb`, error);
    }
  }
  const channels = await prisma.youtubeSource.findMany({ where: { artistId }, orderBy: { id: 'asc' } });
  const scannedChannels = new Map<string, Date | null>();
  for (const channel of channels) {
    const canonicalUrl = channelVideosUrl(channel.url);
    if (scannedChannels.has(canonicalUrl)) {
      const checkedAt = scannedChannels.get(canonicalUrl);
      if (checkedAt) await prisma.youtubeSource.update({ where: { id: channel.id }, data: { lastPolledAt: checkedAt } });
      continue;
    }
    try {
      await syncYoutubeSource(channel.id);
      await logActivity('info', `${source}:youtube:${channel.id}`, 'Channel check completed');
      scannedChannels.set(canonicalUrl, new Date());
    }
    catch (error) {
      scannedChannels.set(canonicalUrl, null);
      errors.push(`YouTube channel ${channel.id}: ${redactMessage(error)}`);
      await logActivity('warn', `${source}:youtube:${channel.id}`, error);
    }
  }
  if (options.scanLocal !== false) {
    try { await (options.localScan ? options.localScan() : scanLocalVideoCandidates(artistId)); await logActivity('info', `${source}:local`, 'Local check completed'); }
    catch (error) {
      errors.push(`Local files: ${redactMessage(error)}`);
      await logActivity('warn', `${source}:local`, error);
    }
  }
  await prisma.artist.update({ where: { id: artistId }, data: {
    videoInventoryCheckedAt: new Date(), videoInventoryError: errors.join('; ') || null,
    videoInventoryStatus: errors.length ? 'partial' : 'complete',
    ...(!errors.length ? { videoInventoryCompletedAt: new Date() } : {}),
  } });
  const [official, approvedOther, pendingYoutube, pendingLocal] = await Promise.all([
    prisma.musicVideo.count({ where: { artistId, catalogKind: 'official' } }),
    prisma.musicVideo.count({ where: { artistId, catalogKind: { not: 'official' } } }),
    prisma.videoReviewCandidate.count({ where: { artistId, source: 'youtube', decision: 'pending' } }),
    prisma.videoReviewCandidate.count({ where: { artistId, source: 'local', decision: 'pending' } }),
  ]);
  await logActivity(errors.length ? 'warn' : 'info', source,
    `Collection ${errors.length ? 'partial; retry scheduled' : 'complete'}: ${official} official, ${approvedOther} other, ${pendingYoutube + pendingLocal} pending review, ${errors.length} source errors`);
  return { official, approvedOther, pendingYoutube, pendingLocal, errors };
  } catch (error) {
    await prisma.artist.update({ where: { id: artistId }, data: {
      videoInventoryStatus: 'failed', videoInventoryError: redactMessage(error),
    } });
    await logActivity('warn', source, error);
    throw error;
  }
}
