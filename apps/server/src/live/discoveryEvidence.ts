import type { LiveDiscoveryItem } from '@prisma/client';
import type { LiveDiscoveryEvidence, LiveMatchProvider, LiveProviderCheck, LiveReferenceEvidence } from '@vidarr/shared-types';
import { prisma } from '../db/client.js';
import { redactMessage } from '../security/redact.js';
import { getMusicBrainzLiveReferences, getMusicBrainzLiveEventReferences, lookupLiveEventEvidence, searchLiveSongEvidence } from '../providers/metadata/musicbrainz.js';
import { readSetlistPage } from './setlist.js';
import { liveEnabled, requireLiveEnabled } from './capability.js';
import { DAY, LiveError } from './policy.js';
import { candidateFacts, candidateFingerprint, compareLiveReference, evidenceKey, normalizeLiveEvidence, referenceFacts, summarizeComparisons, validPerformanceDate } from './discoveryMatching.js';

const providers: LiveMatchProvider[] = ['musicbrainz', 'setlist.fm'];
const eligibleRecording = { OR: [{ recordingId: null }, { recording: { is: { reviewStatus: { notIn: ['rejected', 'returnedToMusicVideos', 'deleted', 'identifiedDuplicate'] }, deletionState: null } } }] };
const expiry = () => new Date(Date.now() + 365 * DAY);
const empty = (fingerprint: string): LiveProviderCheck => ({ status: 'notChecked', checkedAt: null, fingerprint, scope: 'Not checked', references: [] });
function stored(payload: string | null | undefined, fingerprint: string): LiveProviderCheck {
  try {
    const value = JSON.parse(payload ?? 'null');
    if (value?.fingerprint === fingerprint && typeof value.status === 'string' && Array.isArray(value.references)) return value;
  } catch { /* A corrupt or stale report is not matching evidence. */ }
  return empty(fingerprint);
}
export async function liveCandidate(artistId: number, itemId: number) {
  const item = await prisma.liveDiscoveryItem.findFirst({ where: { id: itemId, artistId, dismissed: false, kind: 'video', OR: [{ recordingId: null }, { recording: { is: { reviewStatus: { notIn: ['rejected', 'returnedToMusicVideos', 'deleted', 'identifiedDuplicate'] }, deletionState: null } } }] }, include: { artist: true } });
  if (!item) throw new LiveError('Choose a current Live video candidate for this artist', 404);
  return item;
}
export async function discoveryEvidence(items: LiveDiscoveryItem[], artist: { name: string; musicbrainzArtistId: string | null }): Promise<Map<number, LiveDiscoveryEvidence>> {
  if (!items.length) return new Map();
  const rows = await prisma.liveSearchJournal.findMany({ where: { key: { in: items.flatMap(item => providers.map(provider => evidenceKey(item.id, provider))) } }, select: { key: true, payload: true } });
  const reports = new Map(rows.map(row => [row.key, row.payload]));
  return new Map(items.map(item => {
    const fingerprint = candidateFingerprint(item, artist.musicbrainzArtistId);
    const checks = Object.fromEntries(providers.map(provider => [provider, stored(reports.get(evidenceKey(item.id, provider)), fingerprint)])) as LiveDiscoveryEvidence['checks'];
    const facts = candidateFacts(item, artist);
    const claimedSong = facts.find(fact => fact.field === 'song')?.value;
    return [item.id, { facts: [...facts, ...providers.flatMap(provider => referenceFacts(checks[provider], provider, claimedSong))], checks }];
  }));
}
export async function queueCandidateMatches(item: LiveDiscoveryItem, mbid: string | null) {
  if (item.dismissed || item.kind !== 'video') return;
  const fingerprint = candidateFingerprint(item, mbid);
  for (const provider of providers) {
    const key = evidenceKey(item.id, provider), prior = await prisma.liveSearchJournal.findUnique({ where: { key } });
    if (stored(prior?.payload, fingerprint).status !== 'notChecked') continue;
    const data = { provider: `live-candidate:${provider}`, payload: JSON.stringify({ ...empty(fingerprint), status: 'pending', scope: 'Queued for automatic matching' }),
      outcome: 'liveMatchPending', retryAt: new Date(), expiresAt: expiry() };
    await prisma.liveSearchJournal.upsert({ where: { key }, create: { key, ...data }, update: data });
  }
}
async function cachedMusicBrainz<T>(key: string, load: () => Promise<T>): Promise<T> {
  const cached = await prisma.liveSearchJournal.findUnique({ where: { key } });
  if (cached?.payload && cached.retryAt && cached.retryAt > new Date()) { try { return JSON.parse(cached.payload) as T; } catch { /* Rebuild corrupt cache entries. */ } }
  const budgetKey = `metadata:live-match-mb:${new Date().toISOString().slice(0, 10)}`;
  await prisma.liveRequestBudget.upsert({ where: { key: budgetKey }, create: { key: budgetKey }, update: {} });
  if (!await prisma.liveRequestBudget.updateMany({ where: { key: budgetKey, used: { lt: 1000 } }, data: { used: { increment: 1 } } }).then(row => row.count)) throw new LiveError('MusicBrainz matching daily budget reached; queued checks will retry');
  const result = await load();
  const data = { provider: 'musicbrainz', payload: JSON.stringify(result), outcome: 'matchingReferenceCache', lastSearchAt: new Date(), retryAt: new Date(Date.now() + DAY), expiresAt: expiry() };
  await prisma.liveSearchJournal.upsert({ where: { key }, create: { key, ...data }, update: data });
  return result;
}
const active = new Map<string, Promise<LiveProviderCheck>>();
export function matchLiveCandidate(artistId: number, itemId: number, provider: LiveMatchProvider, page = 1): Promise<LiveProviderCheck> {
  const key = `${artistId}:${itemId}:${provider}:${page}`;
  if (active.has(key)) return active.get(key)!;
  const task = checkCandidate(artistId, itemId, provider, page).finally(() => active.delete(key)); active.set(key, task); return task;
}
async function checkCandidate(artistId: number, itemId: number, provider: LiveMatchProvider, page: number): Promise<LiveProviderCheck> {
  await requireLiveEnabled();
  const item = await liveCandidate(artistId, itemId), artist = item.artist;
  const fingerprint = candidateFingerprint(item, artist.musicbrainzArtistId), key = evidenceKey(item.id, provider);
  const previous = stored((await prisma.liveSearchJournal.findUnique({ where: { key } }))?.payload, fingerprint);
  const facts = candidateFacts(item, artist), value = (field: string) => facts.find(fact => fact.field === field)?.value;
  let result: LiveProviderCheck = { ...empty(fingerprint), checkedAt: new Date().toISOString() };
  try {
    if (!artist.musicbrainzArtistId || artist.musicbrainzMatchStatus !== 'confirmed') throw new LiveError('Confirm the shared MusicBrainz artist before matching');
    const mbid = artist.musicbrainzArtistId;
    let references: LiveReferenceEvidence[] = [];
    if (provider === 'setlist.fm') {
      const date = value('date'), exactDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) && validPerformanceDate(date) ? date.split('-').reverse().join('-') : undefined;
      const data = await readSetlistPage(artistId, page, exactDate, date && /^\d{4}$/.test(date) ? { year: Number(date) } : undefined);
      references = data.setlist.filter(event => event.artist.mbid === mbid).map(event => {
        const parts = /^(\d{2})-(\d{2})-(\d{4})$/.exec(event.eventDate), performanceDate = parts ? `${parts[3]}-${parts[2]}-${parts[1]}` : undefined;
        return { id: event.id, title: `${event.artist.name} at ${event.venue.name ?? 'unknown venue'}`, url: `https://www.setlist.fm/setlist/${event.id}.html`, artistMbid: event.artist.mbid, kind: 'event' as const,
          date: performanceDate && validPerformanceDate(performanceDate) ? performanceDate : undefined, venue: event.venue.name, city: event.venue.city?.name, event: event.tour?.name,
          songs: event.sets.set.flatMap(set => set.song.filter(song => !song.tape).map(song => song.name)) };
      });
      const combined = [...previous.references.filter(reference => !references.some(value => value.id === reference.id)), ...references].map(reference => compareLiveReference(facts, mbid, reference));
      result = { ...result, ...summarizeComparisons(combined), page, hasMore: data.page * data.itemsPerPage < data.total,
        scope: `setlist.fm page ${data.page}; ${data.setlist.length} of ${data.total} results in ${exactDate ? 'claimed-date' : date ? 'claimed-year' : 'artist-history'} scope. Unchecked pages remain unknown.` };
    } else {
      const releases = await cachedMusicBrainz(`live-match-mb:releases:${mbid}`, () => getMusicBrainzLiveReferences(mbid));
      const events = await cachedMusicBrainz(`live-match-mb:events:${mbid}`, () => getMusicBrainzLiveEventReferences(mbid));
      references = releases.map(release => ({ id: release.id, title: release.title, url: release.url, artistMbid: mbid, kind: 'release',
        event: release.title, venue: candidateFacts({ title: release.title, url: release.url }, artist).find(fact => fact.field === 'venue')?.value }));
      // Release dates are deliberately absent: they cannot establish performance dates.
      const likely = events.map(event => ({ event, score: (value('date') && event.eventDate?.startsWith(value('date')!) ? 10 : 0)
        + (value('venue') && normalizeLiveEvidence(event.title).includes(normalizeLiveEvidence(value('venue')!)) ? 5 : 0)
        + (value('event') && normalizeLiveEvidence(event.title).includes(normalizeLiveEvidence(value('event')!)) ? 5 : 0) })).filter(row => row.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
      for (const { event } of likely) {
        const detail = await cachedMusicBrainz(`live-match-mb:event:${event.id}:${mbid}`, () => lookupLiveEventEvidence(event.id, mbid));
        if (detail) references.push({ ...detail, date: detail.date && validPerformanceDate(detail.date) ? detail.date : undefined, artistMbid: mbid, kind: 'event', event: detail.title });
      }
      const song = value('song');
      if (song) for (const recording of await cachedMusicBrainz(`live-match-mb:song:${mbid}:${normalizeLiveEvidence(song)}`, () => searchLiveSongEvidence(mbid, song.slice(0, 300))))
        references.push({ ...recording, artistMbid: mbid, kind: 'song', songs: [recording.title] });
      result = { ...result, ...summarizeComparisons(references.map(reference => compareLiveReference(facts, mbid, reference))),
        scope: `Up to 100 Live releases, 100 artist-linked events, 3 relevant event details and 10 song recordings. Song/release matches do not prove this capture.` };
    }
  } catch (error) {
    result = { ...result, status: /configure|confirm the shared|authentication|cooling down/i.test(String(error)) ? 'unavailable' : 'error', references: previous.references,
      error: redactMessage(error).slice(0, 1500), scope: 'Check incomplete; earlier evidence is retained and no absence is inferred.' };
  }
  // Keep reports separate from source evidence so rescans never overwrite decisions or matching.
  const current = await prisma.liveDiscoveryItem.findUnique({ where: { id: item.id }, include: { artist: true } });
  if (!current || current.dismissed || candidateFingerprint(current, current.artist.musicbrainzArtistId) !== fingerprint) throw new LiveError('Candidate changed; reload before checking it again');
  const failed = ['error', 'unavailable'].includes(result.status);
  const data = { provider: `live-candidate:${provider}`, payload: JSON.stringify(result), outcome: failed ? 'liveMatchRetry' : 'liveMatchDone',
    lastSearchAt: new Date(), retryAt: failed ? new Date(Date.now() + 30 * 60_000) : null, expiresAt: expiry() };
  await prisma.liveSearchJournal.upsert({ where: { key }, create: { key, ...data }, update: data });
  return result;
}
let matching = false;
export async function runLiveCandidateMatching() {
  if (matching || !await liveEnabled()) return 'Live candidate matching is disabled or busy';
  matching = true;
  try {
    const backfillKey = 'live-candidate-match-backfill';
    const state = await prisma.liveSearchJournal.findUnique({ where: { key: backfillKey } });
    let cursor = 0; try { cursor = JSON.parse(state?.payload ?? '{}').cursor ?? 0; } catch { /* Restart a corrupt cursor idempotently. */ }
    const items = await prisma.liveDiscoveryItem.findMany({ where: { id: { gt: cursor }, kind: 'video', dismissed: false, ...eligibleRecording }, include: { artist: true }, orderBy: { id: 'asc' }, take: 50 });
    for (const item of items) await queueCandidateMatches(item, item.artist.musicbrainzArtistId);
    const data = { provider: 'live-candidate-backfill', payload: JSON.stringify({ cursor: items.at(-1)?.id ?? cursor }), outcome: 'matchingBackfill', expiresAt: expiry() };
    await prisma.liveSearchJournal.upsert({ where: { key: backfillKey }, create: { key: backfillKey, ...data }, update: data });
    const jobs = await prisma.liveSearchJournal.findMany({ where: { outcome: { in: ['liveMatchPending', 'liveMatchRetry'] }, retryAt: { lte: new Date() } }, orderBy: [{ lastSearchAt: 'asc' }, { key: 'asc' }], take: 5 });
    for (const job of jobs) {
      const match = /^live-candidate-match:(\d+):(musicbrainz|setlist\.fm)$/.exec(job.key); if (!match) continue;
      const item = await prisma.liveDiscoveryItem.findFirst({ where: { id: Number(match[1]), ...eligibleRecording } });
      if (!item || item.dismissed) { await prisma.liveSearchJournal.update({ where: { key: job.key }, data: { outcome: 'liveMatchIgnored', retryAt: null } }); continue; }
      try { await matchLiveCandidate(item.artistId, item.id, match[2] as LiveMatchProvider); }
      catch (error) { await prisma.liveSearchJournal.update({ where: { key: job.key }, data: { outcome: 'liveMatchRetry', retryAt: new Date(Date.now() + 30 * 60_000) } }); }
    }
    return `${items.length} Live candidates prepared for matching; ${jobs.length} provider checks attempted`;
  } finally { matching = false; }
}
export async function liveCandidateMatchingStatus() {
  const groups = await prisma.liveSearchJournal.groupBy({ by: ['outcome'], where: { provider: { in: providers.map(provider => `live-candidate:${provider}`) } }, _count: true });
  const count = (outcome: string) => groups.find(group => group.outcome === outcome)?._count ?? 0;
  return { pending: count('liveMatchPending'), completed: count('liveMatchDone'), retrying: count('liveMatchRetry') };
}
