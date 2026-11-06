import { randomUUID } from 'node:crypto';
import type { LibraryConnector, LibraryVideo, MetadataEnrichmentRun } from '@prisma/client';
import type { EnrichmentFacts, EnrichmentField, EnrichmentProposal, EnrichmentSnapshot } from '@vidarr/shared-types';
import { prisma, logActivity } from '../db/client.js';
import { createAuthedFetcher } from '../providers/library/util.js';
import { enrichmentAlbumEvidence, searchMusicBrainzArtists, type MusicBrainzArtist } from '../providers/metadata/musicbrainz.js';
import { enrichmentVideoDirectors } from '../providers/metadata/imvdb.js';
import { redactMessage } from '../security/redact.js';
import { videoIdentities, cleanVideoTitle, isPlausibleArtistName } from './videoIdentity.js';
import { isUsableArtistHint } from './artistObservation.js';
import { normalizeTitle } from './normalize.js';

type EnrichmentArtist = { id: number; name: string; musicbrainzArtistId: string | null };
// Filename/title interpretation supplies search hints, never catalog identity acceptance.
export function enrichmentIdentityHint(video: { title: string; artistName: string; path?: string | null }, artists: EnrichmentArtist[]) {
  const byName = new Map<string, EnrichmentArtist[]>();
  for (const artist of artists) { const key = normalizeTitle(artist.name); byName.set(key, [...(byName.get(key) ?? []), artist]); }
  for (const hint of videoIdentities(video, { has: key => byName.has(key) })) {
    const matches = byName.get(normalizeTitle(hint.artistName));
    if (matches?.length === 1) return { artist: matches[0], title: hint.title, source: hint.source };
  }
  return null;
}
const artistSuggestions = new Map<string, { candidates: MusicBrainzArtist[]; observedAt: string; expiresAt: number }>();
async function suggestedArtists(name: string) {
  const key = normalizeTitle(name);
  const cached = artistSuggestions.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const candidates = await searchMusicBrainzArtists(name, 3);
  const entry = { candidates, observedAt: candidates[0]?.observedAt ?? new Date().toISOString(), expiresAt: Date.now() + 86400000 };
  if (artistSuggestions.size >= 1000) artistSuggestions.delete(artistSuggestions.keys().next().value!);
  artistSuggestions.set(key, entry);
  return entry;
}

const http = createAuthedFetcher('Jellyfin metadata', 'Authorization', token => `MediaBrowser Token="${token}"`);
const fields: EnrichmentField[] = ['artist', 'title', 'album', 'albumYear', 'recordLabel', 'directors'];
const populated = (value: unknown) => value != null && value !== '' && (!Array.isArray(value) || value.length > 0);
export const missingFacts = (facts: EnrichmentFacts) => fields.filter(field => !facts[field] || (Array.isArray(facts[field]) && !facts[field]!.length));
const locks: Record<EnrichmentField, string> = { artist: 'Artists', title: 'Name', album: 'Album', albumYear: 'ProductionYear', recordLabel: 'Studios', directors: 'Cast' };
export function automaticFacts(snapshot: EnrichmentSnapshot, evidence: EnrichmentProposal['evidence']): EnrichmentFacts {
  const result: EnrichmentFacts = {};
  if (snapshot.Locked || !snapshot.NfoValid) return result;
  for (const field of missingFacts(snapshot.Facts)) {
    if (snapshot.LockedFields.some(lock => lock.toLowerCase() === locks[field].toLowerCase())) continue;
    const album = result.album ?? snapshot.Facts.album;
    const candidates = evidence.filter(row => row.verified && populated(row.facts[field])
      && (!['albumYear', 'recordLabel'].includes(field) || (album && row.facts.album?.trim().toLowerCase() === album.trim().toLowerCase()))).map(row => row.facts[field]);
    const unique = [...new Map(candidates.map(value => [JSON.stringify(value), value])).values()];
    if (unique.length === 1) (result as any)[field] = unique[0];
  }
  // Album year/label are an edition package; never combine different album proposals.
  if (result.albumYear && !result.album && !snapshot.Facts.album) delete result.albumYear;
  return result;
}

async function target(connector: LibraryConnector) {
  if (!connector.enabled || connector.type !== 'jellyfin' || !connector.videoLibraryId) throw new Error('Select an enabled Jellyfin music-video library.');
  if (!connector.authToken) throw new Error('Test and save the Jellyfin connector credentials before enrichment.');
  const capabilities = await http.get(connector, '/MtvOverlay/Metadata/Capabilities');
  if (capabilities.MetadataEnrichment !== true) throw new Error('Install MTV plugin 0.1.4 or newer before enrichment.');
  if (capabilities.Enabled !== true || capabilities.TimingEnabled !== true || !capabilities.LibraryIds?.some((id: string) => sameId(id, connector.videoLibraryId!))) throw new Error('Enable the MTV plugin, nonzero timing and this selected library before enrichment.');
  const info = await http.get(connector, '/System/Info');
  if (!info.Id) throw new Error('Jellyfin server identity is unavailable.');
  const libraries = await http.get(connector, '/MtvOverlay/Libraries');
  if (!libraries.some((row: any) => sameId(row.Id, connector.videoLibraryId!))) throw new Error('Selected library is not a music-video library.');
  return String(info.Id);
}
const sameId = (a: string, b: string) => a.replaceAll('-', '').toLowerCase() === b.replaceAll('-', '').toLowerCase();
const snapshotPath = (id: string, libraryId: string) => `/MtvOverlay/Metadata/${encodeURIComponent(id)}?libraryId=${encodeURIComponent(libraryId)}`;
let starting = false;
export async function startMetadataEnrichment(connectorId: number, afterScan = false) {
  if (starting) throw new Error('An enrichment start is already in progress.');
  starting = true;
  try {
    const connector = await prisma.libraryConnector.findUniqueOrThrow({ where: { id: connectorId } });
    const serverId = await target(connector);
    const active = await prisma.metadataEnrichmentRun.findFirst({ where: { connectorId, status: { in: ['running', 'paused'] } } });
    const high = await prisma.libraryVideo.aggregate({ where: { connectorId, available: true }, _max: { id: true } });
    if (active && !afterScan) return active;
    const queued = await prisma.metadataEnrichmentRun.findFirst({ where: { connectorId, status: 'queued' } });
    if (queued) return prisma.metadataEnrichmentRun.update({ where: { id: queued.id }, data: { highWaterId: high._max.id ?? 0 } });
    return prisma.metadataEnrichmentRun.create({ data: { connectorId, serverId, libraryId: connector.videoLibraryId!, highWaterId: high._max.id ?? 0, status: active ? 'queued' : 'running' } });
  } finally { starting = false; }
}
export async function enrichAfterScan(connectorId: number) {
  const connector = await prisma.libraryConnector.findUnique({ where: { id: connectorId } });
  if (connector?.type !== 'jellyfin' || !connector.enabled || !connector.videoLibraryId) return;
  try { await startMetadataEnrichment(connectorId, true); }
  catch (error) { await logActivity('warn', 'metadata-enrichment', `Scan succeeded; enrichment unavailable: ${redactMessage(error instanceof Error ? error.message : String(error))}`); }
}

export async function proposeMetadata(video: LibraryVideo, snapshot: EnrichmentSnapshot, serverUrl = '', previous?: EnrichmentProposal, artists?: EnrichmentArtist[]): Promise<EnrichmentProposal> {
  const proposal: EnrichmentProposal = { evidence: [], automatic: {}, missing: missingFacts(snapshot.Facts), notes: [], providerErrors: [], completedProviders: [] };
  const failed = (source: string, error: unknown) => proposal.providerErrors!.push({ source, message: redactMessage(error instanceof Error ? error.message : String(error)) });
  const observedAt = new Date().toISOString();
  const add = (facts: EnrichmentFacts, source: string, url: string, entityId: string, verified: boolean, reason: string, fetchedAt = observedAt) => proposal.evidence.push({ facts, source, url, entityId, observedAt: fetchedAt, verified, reason });
  if (!snapshot.NfoValid) { proposal.notes.push(snapshot.NfoError ?? 'Invalid NFO was preserved.'); return proposal; }
  if (snapshot.Locked) { proposal.notes.push('Locked metadata was preserved.'); return proposal; }
  const serverItemUrl = (id: string) => serverUrl ? `${serverUrl.replace(/\/$/, '')}/web/index.html#!/details?id=${encodeURIComponent(id)}` : '/connectors';
  if (snapshot.NfoFacts) add(snapshot.NfoFacts, 'Existing music-video NFO', serverItemUrl(snapshot.ItemId), snapshot.NfoHash, true, 'Existing local musicvideo metadata; only the explicit albumyear field is an album date.');
  const linked = video.musicVideoId && !video.matchConfidence ? await prisma.musicVideo.findUnique({ where: { id: video.musicVideoId }, include: { artist: true } }) : null;
  const confirmed = linked?.artist.musicbrainzMatchStatus === 'confirmed' ? linked : null;
  const hint = confirmed ? null : enrichmentIdentityHint(video, artists ?? await prisma.artist.findMany({ where: { musicbrainzMatchStatus: 'confirmed' }, select: { id: true, name: true, musicbrainzArtistId: true } }));
  const knownArtist = confirmed?.artist ?? hint?.artist;
  let searchTitle = confirmed?.title ?? hint?.title ?? cleanVideoTitle(video.title);
  if (!confirmed && knownArtist) {
    proposal.artistId = knownArtist.id;
    add({ artist: knownArtist.name, title: searchTitle }, 'Confirmed artist; unreviewed video hints', `/artist/${knownArtist.id}`, String(knownArtist.id), false, `Existing confirmed artist found through ${hint?.source ?? 'metadata'} hints. This video's identity/version and populated corrections require review.`);
  }
  if (confirmed) {
    proposal.artistId = confirmed.artistId;
    add({ artist: confirmed.artist.name, title: confirmed.title, ...(confirmed.director ? { directors: [confirmed.director] } : {}) }, 'Confirmed Vidarr video', `/artist/${confirmed.artistId}`, String(confirmed.id), true, 'Confirmed exact inventory/catalog link; populated corrections still require review.');
  } else proposal.notes.push('Artist/video identity is not confirmed. Resolve it in Artist Review and Video Review; title and uploader names remain hints.');
  if (snapshot.LocalAlbum) add({ album: snapshot.LocalAlbum.Name, albumYear: snapshot.LocalAlbum.Year, recordLabel: snapshot.LocalAlbum.RecordLabel || undefined }, 'Jellyfin album', serverItemUrl(snapshot.LocalAlbum.ItemId ?? snapshot.ItemId), snapshot.LocalAlbum.ItemId ?? snapshot.ItemId, true, 'Unique local album title and credited artist match.');
  const ids = Object.fromEntries(Object.entries(snapshot.ProviderIds).map(([key, value]) => [key.toLowerCase(), value]));
  let artistId = knownArtist?.musicbrainzArtistId ?? ids.musicbrainzartist;
  let requiresArtistReview = false;
  if (!artistId) {
    try {
    const nameHint = videoIdentities(video, { has: () => false }).find(row => isPlausibleArtistName(row.artistName) && isUsableArtistHint(row.artistName));
    if (nameHint) {
      const suggestions = await suggestedArtists(nameHint.artistName);
      for (const candidate of suggestions.candidates) proposal.evidence.push({ facts: { artist: candidate.name }, source: 'MusicBrainz artist suggestion', url: `https://musicbrainz.org/artist/${candidate.id}`, entityId: candidate.id, observedAt: suggestions.observedAt, verified: false, requiresArtistReview: true, reason: 'Name/filename suggestion only. Confirm this identity in Artist Review, then run enrichment again.' });
      const exact = suggestions.candidates.filter(candidate => [candidate.name, ...candidate.aliases].some(name => normalizeTitle(name) === normalizeTitle(nameHint.artistName)));
      if (exact.length === 1) { artistId = exact[0].id; searchTitle = nameHint.title; requiresArtistReview = true; }
    }
    } catch (error) { failed('MusicBrainz artist', error); }
  }
  proposal.providerContext = JSON.stringify([video.externalId, video.path, artistId, searchTitle, confirmed?.id, confirmed?.imvdbVideoId, confirmed?.musicbrainzAudioRecordingId ?? ids.musicbrainztrack, ids.musicbrainzalbum, requiresArtistReview]);
  const reuse = (source: string) => {
    if (!previous || previous.providerContext !== proposal.providerContext || !previous.completedProviders?.includes(source)) return false;
    proposal.evidence.push(...previous.evidence.filter(row => row.source === source));
    proposal.completedProviders!.push(source);
    return true;
  };
  // Independent providers can overlap, while MusicBrainz retains one fair, rate-limited lane.
  const directors = (async () => {
    if (reuse('IMVDb') || !confirmed?.imvdbVideoId || snapshot.Facts.directors?.length) return;
    try {
      const settings = await prisma.settings.findFirst();
      if (settings?.imvdbApiKey) return await enrichmentVideoDirectors(settings.imvdbApiKey, confirmed.imvdbVideoId);
    } catch (error) { failed('IMVDb', error); }
  })();
  if (!reuse('MusicBrainz') && artistId && proposal.missing.some(field => ['album', 'albumYear', 'recordLabel'].includes(field))) {
    try {
    let releaseFailed = false;
    const candidates = await enrichmentAlbumEvidence(artistId, searchTitle, confirmed?.musicbrainzAudioRecordingId ?? ids.musicbrainztrack, ids.musicbrainzalbum, error => { releaseFailed = true; failed('MusicBrainz', error); });
    for (const row of candidates) {
      add({ album: row.album, albumYear: row.albumYear, recordLabel: row.recordLabel }, 'MusicBrainz', `https://musicbrainz.org/release/${row.releaseId}`, row.releaseId, row.verified && !requiresArtistReview, `${requiresArtistReview ? 'Artist identity needs Artist Review first. ' : ''}${row.reason}`, row.observedAt);
      if (requiresArtistReview) proposal.evidence[proposal.evidence.length - 1].requiresArtistReview = true;
    }
    if (!releaseFailed) proposal.completedProviders!.push('MusicBrainz');
    } catch (error) { failed('MusicBrainz', error); }
  }
  const details = await directors;
  if (details) {
    proposal.completedProviders!.push('IMVDb');
    if (details.directors.length) add({ directors: details.directors }, 'IMVDb', details.url, confirmed!.imvdbVideoId!, true, 'Established exact video identity.');
  }
  if (previous?.providerContext === proposal.providerContext && proposal.providerErrors?.some(row => row.source === 'MusicBrainz')) {
    for (const row of previous.evidence.filter(row => row.source === 'MusicBrainz')) {
      if (!proposal.evidence.some(current => current.source === row.source && current.entityId === row.entityId)) proposal.evidence.push(row);
    }
  }
  proposal.automatic = automaticFacts(snapshot, proposal.evidence);
  return proposal;
}

async function refreshCounters(id: number) {
  const groups = await prisma.metadataEnrichmentItem.groupBy({ by: ['status'], where: { runId: id }, _count: true });
  const count = (status: string) => groups.find(group => group.status === status)?._count ?? 0;
  await prisma.metadataEnrichmentRun.update({ where: { id }, data: { processed: groups.reduce((n, group) => n + (group.status === 'pending' ? 0 : group._count), 0), updated: await prisma.metadataEnrichmentItem.count({ where: { runId: id, changed: true } }), completeCount: count('complete'), reviewCount: count('review'), unknownCount: count('unknown'), failedCount: count('failed') } });
}
async function apply(connector: LibraryConnector, run: MetadataEnrichmentRun, externalId: string, snapshot: EnrichmentSnapshot, facts: EnrichmentFacts, corrections: string[], evidence: unknown, requestId: string) {
  return http.send(connector, 'POST', `/MtvOverlay/Metadata/${encodeURIComponent(externalId)}`, { LibraryId: run.libraryId, RequestId: requestId, ExpectedFingerprint: snapshot.Fingerprint, Facts: facts, Corrections: corrections, Provenance: JSON.stringify(evidence) }) as Promise<EnrichmentSnapshot>;
}
let busy = false;
export const metadataEnrichmentBusy = () => busy;
export async function withMetadataEnrichmentControl<T>(operation: () => Promise<T>): Promise<T> {
  if (busy) throw new Error('Pause the batch and wait for the current item before retrying failed work.');
  busy = true;
  try { return await operation(); } finally { busy = false; }
}
let continuing = false;
export const metadataEnrichmentPending = () => continuing;
export async function runMetadataEnrichment(): Promise<string> {
  if (busy) return 'Enrichment is already processing.';
  busy = true;
  continuing = false;
  try {
    let run = await prisma.metadataEnrichmentRun.findFirst({ where: { status: 'running' }, orderBy: { id: 'asc' } });
    if (!run) {
      const queued = await prisma.metadataEnrichmentRun.findMany({ where: { status: 'queued' }, orderBy: { id: 'asc' }, take: 20 });
      for (const candidate of queued) {
        if (!await prisma.metadataEnrichmentRun.findFirst({ where: { connectorId: candidate.connectorId, status: { in: ['running', 'paused'] } } })) {
          run = await prisma.metadataEnrichmentRun.update({ where: { id: candidate.id }, data: { status: 'running' } }); break;
        }
      }
    }
    if (!run) return 'No enrichment batch queued.';
    const connector = await prisma.libraryConnector.findUniqueOrThrow({ where: { id: run.connectorId } });
    try {
      if (!sameId(connector.videoLibraryId ?? '', run.libraryId) || await target(connector) !== run.serverId) throw new Error('Server/library scope changed.');
    } catch (error) {
      await prisma.metadataEnrichmentRun.update({ where: { id: run.id }, data: { status: 'paused', error: redactMessage((error as Error).message) } });
      return 'Enrichment paused: check target configuration.';
    }
    const artists = await prisma.artist.findMany({ where: { musicbrainzMatchStatus: 'confirmed' }, select: { id: true, name: true, musicbrainzArtistId: true } });
    for (let n = 0; n < 3; n++) {
      if ((await prisma.metadataEnrichmentRun.findUniqueOrThrow({ where: { id: run.id } })).status !== 'running') break;
      const cursor = (await prisma.metadataEnrichmentRun.findUniqueOrThrow({ where: { id: run.id } })).cursor;
      const video = await prisma.libraryVideo.findFirst({ where: { connectorId: run.connectorId, available: true, id: { gt: cursor, lte: run.highWaterId } }, orderBy: { id: 'asc' } });
      if (!video) { await prisma.metadataEnrichmentRun.update({ where: { id: run.id }, data: { status: 'completed' } }); break; }
      const item = await prisma.metadataEnrichmentItem.upsert({ where: { runId_externalId: { runId: run.id, externalId: video.externalId } }, create: { runId: run.id, libraryVideoId: video.id, externalId: video.externalId, title: video.title, artistName: video.artistName, beforeJson: 'null', proposalJson: 'null' }, update: {} });
      if (!['pending', 'failed'].includes(item.status)) {
        await prisma.metadataEnrichmentRun.update({ where: { id: run.id }, data: { cursor: video.id } });
        continue;
      }
      try {
        // Persist the exact request before sending; a restart retries the same idempotency key.
        let snapshot: EnrichmentSnapshot = JSON.parse(item.beforeJson);
        let proposal: EnrichmentProposal = JSON.parse(item.proposalJson);
        if (!snapshot || !proposal || proposal.retryProviders) {
          const previous = proposal?.retryProviders ? proposal : undefined;
          snapshot = await http.get(connector, snapshotPath(video.externalId, run.libraryId));
          const earlier = await prisma.metadataEnrichmentItem.findFirst({ where: { runId: { not: run.id }, externalId: video.externalId, run: { connectorId: run.connectorId, serverId: run.serverId, libraryId: run.libraryId }, status: { notIn: ['pending', 'failed'] }, updatedAt: { gte: new Date(Date.now() - 7 * 86400000) } }, orderBy: { id: 'desc' } });
          const previousSnapshot: EnrichmentSnapshot | null = earlier ? JSON.parse(earlier.resultJson ?? earlier.beforeJson) : null;
          const cached: EnrichmentProposal | null = earlier ? JSON.parse(earlier.proposalJson) : null;
          const cacheStillConfirmed = cached?.artistId && video.musicVideoId && !video.matchConfidence
            && await prisma.musicVideo.count({ where: { id: video.musicVideoId, artistId: cached.artistId, artist: { musicbrainzMatchStatus: 'confirmed' } } });
          proposal = !previous && previousSnapshot?.Fingerprint === snapshot.Fingerprint && cached && !cached.providerErrors?.length && cacheStillConfirmed ? cached : await proposeMetadata(video, snapshot, connector.host, previous, artists);
          if (previous) proposal.previousRequestIds = [...(previous.previousRequestIds ?? []), ...(previous.requestId ? [previous.requestId] : [])];
          proposal.automatic = automaticFacts(snapshot, proposal.evidence);
          proposal.requestId = randomUUID();
          delete proposal.reviewRequest;
          await prisma.metadataEnrichmentItem.update({ where: { id: item.id }, data: { beforeJson: JSON.stringify(snapshot), proposalJson: JSON.stringify(proposal), resultJson: null } });
        }
        let after = snapshot;
        const changes = Object.keys(proposal.automatic).length > 0;
        after = await apply(connector, run, video.externalId, snapshot, proposal.automatic, [], proposal.evidence, proposal.requestId ?? itemRequestId(run.id, item.id));
        const needsReview = proposal.notes.some(note => note.startsWith('Artist/video identity')) || proposal.evidence.some(row => Object.entries(row.facts).some(([field, value]) => populated(value) && JSON.stringify(value) !== JSON.stringify(after.Facts[field as EnrichmentField])));
        const status = proposal.providerErrors?.length ? 'failed' : needsReview ? 'review' : !missingFacts(after.Facts).length ? 'complete' : proposal.notes.length && !proposal.evidence.length ? 'review' : changes ? 'updated' : 'unknown';
        proposal.missing = missingFacts(after.Facts);
        await prisma.metadataEnrichmentItem.update({ where: { id: item.id }, data: { status, changed: item.changed || changes, proposalJson: JSON.stringify(proposal), resultJson: JSON.stringify(after), error: proposal.providerErrors?.length ? proposal.providerErrors.map(row => `${row.source}: ${row.message}`).join('; ') : null, attempts: { increment: 1 } } });
      } catch (error) {
        await prisma.metadataEnrichmentItem.update({ where: { id: item.id }, data: { status: 'failed', error: redactMessage((error as Error).message), attempts: { increment: 1 } } });
      }
      await prisma.metadataEnrichmentRun.update({ where: { id: run.id }, data: { cursor: video.id, leaseAt: new Date() } });
      await refreshCounters(run.id);
    }
    continuing = await prisma.metadataEnrichmentRun.count({ where: { status: 'running' } }) > 0;
    return 'Enrichment checkpoint saved.';
  } finally { busy = false; }
}
// Deterministic UUID scoped to a durable proposal; retries cannot create another native request.
function itemRequestId(run: number, item: number) { return `00000000-0000-4000-8000-${(BigInt(run) * 4294967296n + BigInt(item)).toString(16).padStart(12, '0')}`; }
export async function reviewEnrichmentItem(id: number, evidenceIndex: number, selected: EnrichmentField[], corrections: boolean) {
  if (busy) throw new Error('Wait for the current enrichment checkpoint before applying review.');
  busy = true;
  try {
    const item = await prisma.metadataEnrichmentItem.findUniqueOrThrow({ where: { id }, include: { run: { include: { connector: true } } } });
    const proposal: EnrichmentProposal = JSON.parse(item.proposalJson);
    const evidence = proposal.evidence[evidenceIndex];
    if (!evidence || !selected.length) throw new Error('Choose evidence and fields.');
    if (evidence.requiresArtistReview) throw new Error('Confirm this artist identity in Artist Review, then start enrichment again before applying external facts.');
    if (!proposal.artistId && selected.some(field => ['artist', 'title', 'directors'].includes(field))) throw new Error('Confirm the artist/video identity in the established review pages first, then start a new enrichment scan.');
    if (await target(item.run.connector) !== item.run.serverId || !sameId(item.run.connector.videoLibraryId ?? '', item.run.libraryId)) throw new Error('Server/library scope changed.');
    const before: EnrichmentSnapshot = JSON.parse(item.resultJson ?? item.beforeJson);
    const facts = Object.fromEntries(selected.filter(field => evidence.facts[field] != null).map(field => [field, evidence.facts[field]]));
    if (proposal.artistId && !(await prisma.artist.findFirst({ where: { id: proposal.artistId, musicbrainzMatchStatus: 'confirmed' } }))) throw new Error('Artist identity changed; recheck this proposal.');
    const pending = proposal.reviewRequest ?? { id: randomUUID(), facts, corrections: corrections ? selected : [], before, evidenceIndex, fields: selected };
    if (JSON.stringify(pending.facts) !== JSON.stringify(facts) || pending.evidenceIndex !== evidenceIndex) throw new Error('Retry the pending reviewed request or recheck the item before changing fields.');
    proposal.reviewRequest = pending;
    await prisma.metadataEnrichmentItem.update({ where: { id }, data: { proposalJson: JSON.stringify(proposal), error: 'Reviewed update pending verification; retry the same selection after a failure.' } });
    const result = await apply(item.run.connector, item.run, item.externalId, pending.before, pending.facts, pending.corrections, evidence, pending.id);
    delete proposal.reviewRequest;
    proposal.missing = missingFacts(result.Facts);
    await prisma.metadataEnrichmentItem.update({ where: { id }, data: { proposalJson: JSON.stringify(proposal), resultJson: JSON.stringify(result), status: proposal.providerErrors?.length ? 'failed' : missingFacts(result.Facts).length ? 'review' : 'complete', changed: true, error: proposal.providerErrors?.length ? proposal.providerErrors.map(row => `${row.source}: ${row.message}`).join('; ') : null } });
    await refreshCounters(item.runId);
    return result;
  } finally { busy = false; }
}
