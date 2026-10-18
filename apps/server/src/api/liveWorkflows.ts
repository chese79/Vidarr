import { inspectRecordingSource } from '../live/sourceInspection.js';
import { redundantRecordings, confirmRedundantCleanup } from '../live/cleanup.js';
import { registerExistingRecordingFile, recordingServerCandidates, registerServerRecording } from '../live/localImport.js';
import { playbackChoices, startRecordingPlayback } from '../live/playbackControl.js';
import { classifyExistingVideo, returnToMusicVideos } from '../live/reclassification.js';
import { addRecordingToPlaylist } from '../live/playlists.js';
import { reviewExternalCorrection, removePerformance } from '../live/catalog.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';
import { changeViewing } from '../live/playback.js';
import { scheduleRecordingDeletion } from '../live/deletion.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { LivePolicy, LiveError, directVideoIdentity, liveConfiguration } from '../live/policy.js';
import { discoverSetlists, linkSetlistReference } from '../live/setlist.js';
import { exactLiveMatch, coverageSummary } from '../live/evidence.js';
import { discoverRecordings, MonitoringInput, monitoringWhere, previewMonitoring } from '../live/discovery.js';
import { enqueueRecording } from '../live/acquisition.js';
import { liveScanExcluded } from '../live/exclusions.js';

const idParams = z.object({ id: z.coerce.number().int().positive() });
export async function liveWorkflowRoutes(app: FastifyInstance) {
  app.post('/api/v1/live/performances/:id/link-reference', req => {
    const body = z.object({ setlistFmId: z.string().regex(/^[a-zA-Z0-9]{1,32}$/), revision: z.number().int().positive() }).strict().parse(req.body);
    return linkSetlistReference(idParams.parse(req.params).id, body.setlistFmId, body.revision);
  });
  app.get('/api/v1/live/search-status', () => prisma.liveSearchJournal.findMany({ where: { outcome: { in: ['error', 'authenticationPaused', 'failed', 'contentReviewRequired'] } }, orderBy: { lastSearchAt: 'desc' }, take: 25,
    select: { key: true, provider: true, outcome: true, failures: true, lastSearchAt: true, retryAt: true } }));
  app.get('/api/v1/live/recordings/:id/cleanup', req => redundantRecordings(idParams.parse(req.params).id));
  app.post('/api/v1/live/recordings/:id/cleanup', req => {
    const body = z.object({ recordingId: z.number().int().positive(), confirmed: z.literal(true) }).strict().parse(req.body);
    return confirmRedundantCleanup(idParams.parse(req.params).id, body.recordingId, body.confirmed);
  });
  app.post('/api/v1/live/sources/:id/inspect', async req => inspectRecordingSource(idParams.parse(req.params).id));
  app.get('/api/v1/live/recordings/:id/playback', async req => playbackChoices(idParams.parse(req.params).id));
  app.post('/api/v1/live/recordings/:id/playback', async req => {
    const { id } = idParams.parse(req.params);
    const body = z.object({ connectorId: z.number().int().positive(), libraryId: z.string().min(1).max(100), sessionId: z.string().min(1).max(200), userId: z.string().min(1).max(200), viewingId: z.number().int().positive().optional(), songId: z.number().int().positive().optional() }).strict().parse(req.body);
    return startRecordingPlayback(id, body);
  });
  app.get('/api/v1/live/exclusions', async req => {
    const query = z.object({ offset: z.coerce.number().int().min(0).default(0), artistId: z.coerce.number().int().positive().optional() }).parse(req.query);
    const items = await prisma.liveExclusion.findMany({ where: { artistId: query.artistId }, orderBy: { id: 'desc' }, skip: query.offset, take: 25 });
    const artists = await prisma.artist.findMany({ where: { id: { in: [...new Set(items.map(item => item.artistId))] } }, select: { id: true, name: true } });
    return items.map(item => ({ ...item, artistName: artists.find(artist => artist.id === item.artistId)?.name ?? 'Removed artist' }));
  });
  app.post('/api/v1/live/exclusions/:id/restore', async req => {
    const { id } = idParams.parse(req.params); await prisma.liveExclusion.delete({ where: { id } }); return { ok: true };
  });
  app.post('/api/v1/live/performances/:id/monitoring', async req => {
    const { id } = idParams.parse(req.params), { excluded } = z.object({ excluded: z.boolean() }).strict().parse(req.body);
    return prisma.$transaction(async tx => {
      const performance = await tx.livePerformance.update({ where: { id }, data: { ignored: excluded, monitored: false, userEdited: true } });
      if (!excluded) for (const rule of await tx.liveMonitoringRule.findMany({ where: { artistId: performance.artistId, state: 'active' } })) {
        if (await tx.livePerformance.count({ where: { ...monitoringWhere(MonitoringInput.parse(JSON.parse(rule.filters))), id } })) await tx.livePerformance.update({ where: { id }, data: { monitored: true } });
      }
      return { ok: true };
    });
  });
  app.post('/api/v1/live/recordings/:id/register-local', async req => {
    const { id } = idParams.parse(req.params);
    const body = z.object({ rootFolderId: z.number().int().positive(), path: z.string().min(1).max(3000) }).strict().parse(req.body);
    return registerExistingRecordingFile(id, body.rootFolderId, body.path);
  });
  app.get('/api/v1/live/server-candidates', async req => {
    const body = z.object({ connectorId: z.coerce.number().int().positive(), search: z.string().trim().min(2).max(100), offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
    const connector = await prisma.libraryConnector.findUniqueOrThrow({ where: { id: body.connectorId, enabled: true } });
    return recordingServerCandidates(connector, body.search, body.offset);
  });
  app.post('/api/v1/live/recordings/:id/register-server', async req => {
    const { id } = idParams.parse(req.params);
    const body = z.object({ rootFolderId: z.number().int().positive(), connectorId: z.number().int().positive(), externalId: z.string().min(1).max(200) }).strict().parse(req.body);
    return registerServerRecording(id, body.connectorId, body.externalId, body.rootFolderId);
  });
  app.post('/api/v1/live/performances/:id/correction', async req => {
    const { id } = idParams.parse(req.params);
    const body = z.object({ revision: z.number().int().positive(), action: z.enum(['keepUserDetails', 'applyReferenceMetadata']) }).strict().parse(req.body);
    return reviewExternalCorrection(id, body.revision, body.action);
  });
  app.post('/api/v1/live/performances/:id/remove', async req => {
    const { id } = idParams.parse(req.params), { confirmed } = z.object({ confirmed: z.literal(true) }).parse(req.body);
    return removePerformance(id, confirmed);
  });
  app.post('/api/v1/live/performances/:id/restore', async req => {
    const { id } = idParams.parse(req.params);
    await prisma.livePerformance.update({ where: { id }, data: { removedAt: null, ignored: false, userEdited: true } }); return { ok: true };
  });
  app.post('/api/v1/live/performances/:id/credits', async req => {
    const { id } = idParams.parse(req.params);
    const body = z.object({ artistId: z.number().int().positive(), songId: z.number().int().positive().optional(), role: z.enum(['guest', 'support', 'performer']) }).strict().parse(req.body);
    const artist = await prisma.artist.findUniqueOrThrow({ where: { id: body.artistId } });
    if (artist.musicbrainzMatchStatus !== 'confirmed') throw new LiveError('Confirm the participating artist identity first');
    if (body.songId && !await prisma.liveSongPerformance.count({ where: { id: body.songId, performanceId: id } })) throw new LiveError('Choose a song occurrence in this performance');
    return prisma.liveCredit.create({ data: { performanceId: id, ...body } });
  });
  app.patch('/api/v1/live/songs/:id', async req => {
    const { id } = idParams.parse(req.params);
    const data = z.object({ title: z.string().trim().min(1).max(300).optional(), section: z.string().trim().max(300).nullable().optional(),
      kind: z.enum(['full', 'snippet', 'medleyComponent', 'unknown']).optional(), style: z.enum(['acoustic', 'electric', 'mixed', 'unknown']).optional(),
      musicbrainzWorkId: z.string().uuid().nullable().optional(), durationSeconds: z.number().positive().nullable().optional() }).strict().parse(req.body);
    return prisma.$transaction(async tx => {
      const song = await tx.liveSongPerformance.update({ where: { id }, data });
      if (['snippet', 'medleyComponent'].includes(song.kind)) await tx.recordingCoverage.updateMany({ where: { songId: id }, data: { fullSong: false } });
      await tx.livePerformance.update({ where: { id: song.performanceId }, data: { userEdited: true, revision: { increment: 1 } } });
      return song;
    });
  });
  app.post('/api/v1/live/performances/:id/songs/sequence', async req => {
    const { id } = idParams.parse(req.params), { songIds } = z.object({ songIds: z.array(z.number().int().positive()).max(500) }).strict().parse(req.body);
    return prisma.$transaction(async tx => {
      const songs = await tx.liveSongPerformance.findMany({ where: { performanceId: id } });
      if (new Set(songIds).size !== songIds.length || songIds.length !== songs.length || songIds.some(songId => !songs.some(song => song.id === songId))) throw new LiveError('The song list changed; reload before reordering');
      for (const [position, songId] of songIds.entries()) await tx.liveSongPerformance.update({ where: { id: songId }, data: { position: -position - 1 } });
      for (const [position, songId] of songIds.entries()) await tx.liveSongPerformance.update({ where: { id: songId }, data: { position: position + 1 } });
      await tx.livePerformance.update({ where: { id }, data: { userEdited: true, referenceComplete: false, revision: { increment: 1 } } }); return { ok: true };
    });
  });
  app.post('/api/v1/live/performances/:id/songs', async req => {
    const { id } = idParams.parse(req.params), body = z.object({ title: z.string().trim().min(1).max(300), section: z.string().max(300).optional(), kind: z.enum(['full', 'snippet', 'medleyComponent', 'unknown']).default('unknown') }).strict().parse(req.body);
    return prisma.$transaction(async tx => {
      const last = await tx.liveSongPerformance.aggregate({ where: { performanceId: id }, _max: { position: true } });
      await tx.livePerformance.update({ where: { id }, data: { userEdited: true, referenceComplete: false, revision: { increment: 1 } } });
      return tx.liveSongPerformance.create({ data: { performanceId: id, position: (last._max.position ?? 0) + 1, ...body } });
    });
  });
  app.get('/api/v1/live/occasions', async req => {
    const { search } = z.object({ search: z.string().trim().max(100).default('') }).parse(req.query);
    return prisma.liveOccasion.findMany({ where: { title: { contains: search } }, take: 25, orderBy: { id: 'desc' }, include: { performances: { select: { id: true, title: true, artistId: true } } } });
  });
  app.patch('/api/v1/live/performances/:id/occasion', async req => {
    const { id } = idParams.parse(req.params), { occasionId } = z.object({ occasionId: z.number().int().positive().nullable() }).strict().parse(req.body);
    if (occasionId) await prisma.liveOccasion.findUniqueOrThrow({ where: { id: occasionId } });
    return prisma.livePerformance.update({ where: { id }, data: { occasionId, userEdited: true, revision: { increment: 1 } } });
  });
  app.post('/api/v1/live/occasions', async req => {
    const body = z.object({ title: z.string().trim().min(1).max(300), performanceIds: z.array(z.number().int().positive()).min(1).max(100) }).strict().parse(req.body);
    return prisma.$transaction(async tx => {
      const ids = [...new Set(body.performanceIds)];
      if (await tx.livePerformance.count({ where: { id: { in: ids } } }) !== ids.length) throw new LiveError('A selected performance no longer exists');
      const occasion = await tx.liveOccasion.create({ data: { title: body.title } });
      await tx.livePerformance.updateMany({ where: { id: { in: ids } }, data: { occasionId: occasion.id, userEdited: true } });
      return occasion;
    });
  });
  app.get('/api/v1/live/reclassification', async req => {
    const { offset, artistId } = z.object({ offset: z.coerce.number().int().min(0).default(0), artistId: z.coerce.number().int().positive().optional() }).parse(req.query);
    return prisma.musicVideo.findMany({ where: { isLiveConcert: true, artistId, catalogKind: { not: 'liveClassified' } }, include: { artist: { select: { id: true, name: true } } }, skip: offset, take: 25, orderBy: { id: 'asc' } });
  });
  app.post('/api/v1/live/reclassification/:id', async req => {
    const { id } = idParams.parse(req.params);
    const body = z.object({ performanceId: z.number().int().positive(), videoVerified: z.literal(true) }).strict().parse(req.body);
    return classifyExistingVideo(id, body.performanceId, body.videoVerified);
  });
  app.post('/api/v1/live/recordings/:id/return-to-music-videos', async req => {
    const { id } = idParams.parse(req.params);
    const body = z.object({ officialMusicVideoConfirmed: z.literal(true) }).strict().parse(req.body);
    return returnToMusicVideos(id, body.officialMusicVideoConfirmed);
  });
  app.post('/api/v1/live/parts/:id/playlist', async req => {
    const { id } = idParams.parse(req.params);
    const body = z.object({ playlistId: z.number().int().positive(), songId: z.number().int().positive().optional(), fullRecordingFallback: z.boolean().default(false) }).strict().parse(req.body);
    return addRecordingToPlaylist(body.playlistId, id, body.songId, body.fullRecordingFallback);
  });
  app.post('/api/v1/live/playlist-items/:id/remove', async req => {
    const { id } = idParams.parse(req.params);
    const item = await prisma.playlistItem.findUniqueOrThrow({ where: { id }, include: { playlist: true } });
    if (item.playlist.kind !== 'static' || !item.recordingPartId) throw new LiveError('Choose a live item in a static playlist');
    await prisma.playlistItem.delete({ where: { id } }); return { ok: true };
  });
  app.post('/api/v1/live/recordings/:id/delete', async req => {
    const { id } = idParams.parse(req.params);
    const body = z.object({ confirmed: z.boolean(), scope: z.enum(['recording', 'rendition', 'artistSet']).default('recording'), songId: z.number().int().positive().optional(), performanceId: z.number().int().positive().optional() }).strict().parse(req.body);
    await scheduleRecordingDeletion(id, body.confirmed, body.scope, body.songId, body.performanceId); return { scheduled: true };
  });
  app.get('/api/v1/live/performances/:id/viewings', async req => {
    const { id } = idParams.parse(req.params);
    return prisma.liveViewing.findMany({ where: { performanceId: id }, orderBy: { updatedAt: 'desc' }, take: 100 });
  });
  app.post('/api/v1/live/viewings/:id', async req => {
    const { id } = idParams.parse(req.params);
    const { action } = z.object({ action: z.enum(['startAgain', 'markFinished']) }).parse(req.body);
    return changeViewing(id, action);
  });
  app.get('/api/v1/live/configuration', async () => {
    const { row, policy } = await liveConfiguration();
    return { policy, hasSetlistApiKey: Boolean(row?.setlistApiKey), setlistPaused: row?.setlistPaused ?? false, providerRetryAt: row?.providerRetryAt ?? null };
  });
  app.put('/api/v1/live/configuration', async req => {
    const body = z.object({ policy: LivePolicy, setlistApiKey: z.string().trim().max(500).optional() }).strict().parse(req.body);
    for (const id of [body.policy.fullRootFolderId, body.policy.songRootFolderId].filter((id): id is number => id !== null)) await prisma.rootFolder.findUniqueOrThrow({ where: { id } });
    for (const [id, libraryId] of [[body.policy.fullConnectorId, body.policy.fullLibraryId], [body.policy.songConnectorId, body.policy.songLibraryId]] as const) {
      if (!id && !libraryId) continue;
      if (!id || !libraryId) throw new LiveError('Choose both a playback connector and a library');
      const connector = await prisma.libraryConnector.findUniqueOrThrow({ where: { id } });
      if (!connector.enabled || !['plex', 'jellyfin'].includes(connector.type)) throw new LiveError('Choose an enabled video connector');
      if (connector.videoLibraryId !== libraryId) throw new LiveError('Use a connector configured for this live video library. Add a separate connector for a different library so playlists, inventory and playback use the same destination');
      const sections = await getLibraryConnectorProvider(connector.type).listSections?.(connector);
      const section = sections?.find(value => value.id === libraryId);
      if (!section || (connector.type === 'jellyfin' ? section.type !== 'musicvideos' : section.type !== 'movie'))
        throw new LiveError('Choose a verified Jellyfin Music Videos or Plex Movies library; other item types are not supported by the shared video adapters');
    }
    const data = { policy: JSON.stringify(body.policy), ...(body.setlistApiKey !== undefined ? { setlistApiKey: body.setlistApiKey || null, setlistPaused: false, providerRetryAt: null } : {}) };
    await prisma.liveConfiguration.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    return { ok: true };
  });
  app.post('/api/v1/live/artists/:id/discover', async req => {
    const { id } = idParams.parse(req.params);
    const body = z.object({ page: z.number().int().min(1).max(10000).default(1), date: z.string().regex(/^\d{2}-\d{2}-\d{4}$/).optional() }).strict().parse(req.body ?? {});
    return discoverSetlists(id, body.page, body.date);
  });
  app.post('/api/v1/live/performances/:id/search', async req => {
    const { id } = idParams.parse(req.params);
    return discoverRecordings(id, undefined, true);
  });
  app.get('/api/v1/live/recordings/:id', async req => {
    const { id } = idParams.parse(req.params);
    return prisma.recording.findUniqueOrThrow({ where: { id, catalogType: 'live' }, include: { sources: true, parts: { orderBy: { position: 'asc' }, include: { coverage: true, serverCopies: true } },
      performances: { include: { performance: { include: { artist: true, songs: { orderBy: { position: 'asc' } } } } } }, queueItems: { take: 10, orderBy: { id: 'desc' } } } });
  });
  app.post('/api/v1/live/recordings/:id/review', async req => {
    const { id } = idParams.parse(req.params);
    const body = z.object({ action: z.enum(['confirm', 'independent', 'reject', 'automatic']), performanceId: z.number().int().positive(),
      videoVerified: z.boolean(), artistMbid: z.string().optional(), performanceDate: z.string().optional(), venueId: z.string().optional(), venue: z.string().optional(), song: z.string().optional(),
      conflicts: z.array(z.string()).default([]), songId: z.number().int().positive().optional(), notes: z.string().max(10000).default('') }).strict().parse(req.body);
    return prisma.$transaction(async tx => {
      const recording = await tx.recording.findUniqueOrThrow({ where: { id, catalogType: 'live' }, include: { performances: true, parts: true } });
      if (recording.catalogType === 'musicVideo' || recording.reviewStatus === 'returnedToMusicVideos') throw new LiveError('Use the music video classification review to return this entry to Live');
      const target = await tx.livePerformance.findUniqueOrThrow({ where: { id: body.performanceId }, include: { artist: true, songs: true } });
      if (body.action !== 'reject' && await liveScanExcluded([`artistSet:${target.artistId}:${target.id}`, ...(body.songId ? [`rendition:${body.songId}`] : [])], tx)) throw new LiveError('This performance or rendition is excluded from future scans; remove that exclusion before accepting it');
      if (body.songId && !target.songs.some(song => song.id === body.songId)) throw new LiveError('Choose a song occurrence in this performance');
      if (target.removedAt) throw new LiveError('Restore this performance before accepting a recording');
      if (body.action !== 'reject' && (target.artist.musicbrainzMatchStatus !== 'confirmed' || !target.artist.musicbrainzArtistId)) throw new LiveError('Confirm the shared MusicBrainz artist before accepting this recording');
      const auto = Boolean(target.setlistFmId) && target.identityStatus !== 'correctionPending' && target.artist.musicbrainzMatchStatus === 'confirmed' && Boolean(target.artist.musicbrainzArtistId)
        && exactLiveMatch(body, { ...target, artistMbid: target.artist.musicbrainzArtistId ?? '' });
      if (body.action === 'automatic' && !auto) throw new LiveError('Date, venue, artist and song must all agree without conflicts for automatic confirmation');
      if (body.action !== 'reject' && !body.videoVerified) throw new LiveError('Confirm actual moving video; audio-only and static-image recordings are excluded');
      if (recording.deletionState) throw new LiveError('Recording deletion is pending');
      if (recording.reviewStatus === 'pending' && recording.performances.length === 1 && recording.performances[0].performanceId !== target.id && !recording.parts.length)
        await tx.recordingPerformance.deleteMany({ where: { recordingId: id } });
      await tx.recordingPerformance.upsert({ where: { recordingId_performanceId: { recordingId: id, performanceId: target.id } }, create: { recordingId: id, performanceId: target.id, identityVerified: body.action !== 'reject' }, update: { identityVerified: body.action !== 'reject' } });
      const allConfirmed = !await tx.recordingPerformance.count({ where: { recordingId: id, identityVerified: false } });
      await tx.history.create({ data: { recordingId: id, eventType: 'liveIdentityReviewed', data: JSON.stringify(body) } });
      return tx.recording.update({ where: { id }, data: { reviewStatus: body.action === 'reject' ? 'rejected' : 'accepted',
        identityVerified: body.action !== 'reject' && allConfirmed, videoVerified: body.videoVerified && body.action !== 'reject',
        evidence: JSON.stringify({ ...JSON.parse(recording.evidence), review: body, automaticEligible: auto }) } });
    });
  });
  app.post('/api/v1/live/recordings/:id/sources', async req => {
    const { id } = idParams.parse(req.params);
    const body = z.object({ url: z.string().max(2000), accepted: z.boolean().default(false) }).strict().parse(req.body);
    await prisma.recording.findUniqueOrThrow({ where: { id, catalogType: 'live', deletionState: null } });
    const { url, provider, externalId } = directVideoIdentity(body.url);
    const owner = await prisma.recordingSource.findUnique({ where: { provider_externalId: { provider, externalId } } });
    if (owner && owner.recordingId !== id) throw new LiveError(`This provider item already belongs to recording ${owner.recordingId}; review that recording instead`);
    return prisma.recordingSource.upsert({ where: { recordingId_url: { recordingId: id, url } },
      create: { recordingId: id, provider, externalId, url, accepted: body.accepted }, update: { accepted: body.accepted } });
  });
  app.patch('/api/v1/live/sources/:id', async req => {
    const { id } = idParams.parse(req.params);
    const data = z.object({ accepted: z.boolean().optional(), available: z.boolean().optional() }).strict().parse(req.body);
    return prisma.recordingSource.update({ where: { id, recording: { catalogType: 'live', deletionState: null } }, data });
  });
  app.patch('/api/v1/live/recordings/:id/metadata', async req => {
    const { id } = idParams.parse(req.params);
    const data = z.object({ title: z.string().trim().min(1).max(300).optional(), origin: z.enum(['professional', 'audience', 'unknown']).optional(),
      claimedCoverage: z.enum(['entirePerformance', 'severalSongs', 'individualSong', 'excerpt', 'unknown']).optional(), notes: z.string().max(5000).optional() }).strict().parse(req.body);
    return prisma.$transaction(async tx => {
      const row = await tx.recording.findUniqueOrThrow({ where: { id, catalogType: 'live' } });
      if (row.deletionState) throw new LiveError('Deletion is pending');
      return tx.recording.update({ where: { id }, data: { ...data, ...(data.claimedCoverage && data.claimedCoverage !== row.claimedCoverage ? { uninterruptedVerified: false, qualityVerified: false } : {}) } });
    });
  });
  app.post('/api/v1/live/recordings/:id/download', async req => {
    const { id } = idParams.parse(req.params);
    const body = z.object({ sourceId: z.number().int().positive(), partPosition: z.number().int().min(1).max(500).default(1), downloadClientId: z.number().int().positive().optional(),
      packApproval: z.object({ totalSizeBytes: z.number().positive(), contents: z.array(z.string().min(1).max(1000)).min(1).max(10000), selected: z.array(z.string().min(1).max(1000)).min(1).max(500), approved: z.literal(true) }).optional() }).strict().parse(req.body);
    return enqueueRecording(id, body.sourceId, body.downloadClientId, body.packApproval, body.partPosition);
  });
  app.patch('/api/v1/live/recordings/:id/preference', async req => {
    const { id } = idParams.parse(req.params);
    const data = z.object({ pinned: z.boolean().optional(), preferred: z.boolean().optional(), verifiedCoverage: z.number().int().min(0).max(100).optional(),
      audioScore: z.number().min(0).max(10).optional(), visualScore: z.number().min(0).max(10).optional(), qualityVerified: z.boolean().optional(), uninterruptedVerified: z.boolean().optional() }).strict().parse(req.body);
    return prisma.$transaction(async tx => {
      const recording = await tx.recording.findUniqueOrThrow({ where: { id, catalogType: 'live' }, include: { performances: true, parts: true } });
      if (recording.deletionState) throw new LiveError('Deletion is pending');
      if (data.uninterruptedVerified && (recording.claimedCoverage !== 'entirePerformance' || !recording.identityVerified || !recording.videoVerified
        || !recording.parts.length || recording.parts.some(part => !part.durationSeconds))) throw new LiveError('Verify an eligible entire-performance recording with known part durations before confirming continuity');
      if (data.preferred) {
        const linked = recording.performances.map(link => link.performanceId);
        if (await tx.recordingPerformance.count({ where: { recordingId: { not: id }, performanceId: { in: linked }, preferred: true, recording: { pinned: true } } })) throw new LiveError('Unpin the current preference before choosing another recording');
        const others = await tx.recordingPerformance.findMany({ where: { recordingId: { not: id }, performanceId: { in: linked }, preferred: true }, select: { recordingId: true } });
        await tx.recordingPerformance.updateMany({ where: { recordingId: { not: id }, performanceId: { in: linked } }, data: { preferred: false } });
        for (const otherId of new Set(others.map(link => link.recordingId))) await tx.recording.update({ where: { id: otherId }, data: { preferred: Boolean(await tx.recordingPerformance.count({ where: { recordingId: otherId, preferred: true } })) } });
      }
      if (data.preferred !== undefined) await tx.recordingPerformance.updateMany({ where: { recordingId: id }, data: { preferred: data.preferred } });
      return tx.recording.update({ where: { id }, data });
    });
  });
  app.post('/api/v1/live/performances/:id/reference', async req => {
    const { id } = idParams.parse(req.params);
    const body = z.object({ revision: z.number().int().positive(), complete: z.boolean(), evidence: z.string().trim().min(1).max(5000) }).strict().parse(req.body);
    return prisma.$transaction(async tx => {
      if (body.complete && !await tx.liveSongPerformance.count({ where: { performanceId: id } })) throw new LiveError('An empty song list cannot establish reference completeness');
      const result = await tx.livePerformance.updateMany({ where: { id, revision: body.revision }, data: { referenceComplete: body.complete, userEdited: true, revision: { increment: 1 } } });
      if (!result.count) throw new LiveError('Performance changed; reload before reviewing the reference');
      await tx.history.create({ data: { eventType: 'liveReferenceCompletenessReviewed', data: JSON.stringify({ performanceId: id, ...body }) } });
      return { ok: true };
    });
  });
  app.put('/api/v1/live/parts/:id/coverage', async req => {
    const { id } = idParams.parse(req.params);
    const body = z.object({ songs: z.array(z.object({ songId: z.number().int().positive(), startSeconds: z.number().min(0), endSeconds: z.number().positive(),
      fullSong: z.boolean(), verified: z.literal(true) }).strict()).max(500) }).strict().parse(req.body);
    if (new Set(body.songs.map(song => song.songId)).size !== body.songs.length) throw new LiveError('Choose each song occurrence once');
    return prisma.$transaction(async tx => {
      const part = await tx.recordingPart.findUniqueOrThrow({ where: { id }, include: { recording: { include: { performances: true } } } });
      if (part.recording.catalogType !== 'live' || part.recording.deletionState) throw new LiveError('Choose an active live recording');
      for (const item of body.songs) {
        const song = await tx.liveSongPerformance.findUniqueOrThrow({ where: { id: item.songId } });
        if (!part.recording.performances.some(link => link.performanceId === song.performanceId) || !part.durationSeconds
          || item.endSeconds <= item.startSeconds || item.endSeconds > part.durationSeconds
          || (item.fullSong && ['snippet', 'medleyComponent'].includes(song.kind))) throw new LiveError('Coverage must identify an eligible occurrence with verified boundaries inside this file');
        await tx.recordingCoverage.upsert({ where: { partId_songId: { partId: id, songId: item.songId } }, create: { partId: id, ...item }, update: item });
      }
      return { ok: true };
    });
  });
  app.get('/api/v1/live/performances/:id/coverage', async req => {
    const { id } = idParams.parse(req.params);
    const performance = await prisma.livePerformance.findUniqueOrThrow({ where: { id }, include: { songs: true } });
    const coverage = await prisma.recordingCoverage.findMany({ where: { song: { performanceId: id }, part: { available: true, recording: { deletionState: null } } } });
    return coverageSummary(performance.songs, coverage, performance.referenceComplete);
  });
  app.post('/api/v1/live/monitoring/preview', req => previewMonitoring(MonitoringInput.parse(req.body)));
  app.get('/api/v1/live/monitoring', () => prisma.liveMonitoringRule.findMany({ orderBy: { id: 'desc' }, take: 100 }));
  app.post('/api/v1/live/monitoring', async req => {
    const { approved, ...input } = z.object({ ...MonitoringInput.innerType().shape, approved: z.literal(true) }).strict().parse(req.body);
    const parsed = MonitoringInput.parse(input);
    await prisma.artist.findUniqueOrThrow({ where: { id: input.artistId } });
    return prisma.$transaction(async tx => {
      const rule = await tx.liveMonitoringRule.create({ data: { artistId: parsed.artistId, performanceId: parsed.performanceId, tour: parsed.tour, filters: JSON.stringify(parsed), dailyBudget: parsed.dailyBudget } });
      await tx.livePerformance.updateMany({ where: monitoringWhere(parsed), data: { monitored: true } });
      return rule;
    });
  });
  app.patch('/api/v1/live/monitoring/:id', async req => {
    const { id } = idParams.parse(req.params), { state } = z.object({ state: z.enum(['active', 'paused', 'cancelled']) }).parse(req.body);
    const rule = await prisma.liveMonitoringRule.update({ where: { id }, data: { state } });
    // Recompute the union of active rules; removing one overlap must not unmonitor another.
    await prisma.$transaction(async tx => {
      await tx.livePerformance.updateMany({ where: { artistId: rule.artistId }, data: { monitored: false } });
      for (const active of await tx.liveMonitoringRule.findMany({ where: { artistId: rule.artistId, state: 'active' } }))
        await tx.livePerformance.updateMany({ where: monitoringWhere(MonitoringInput.parse(JSON.parse(active.filters))), data: { monitored: true } });
    });
    return rule;
  });
}
