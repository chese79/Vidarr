import { z } from 'zod';
import { prisma } from '../db/client.js';
import { rememberSecrets } from '../security/redact.js';
import { DAY, LiveError, liveConfiguration } from './policy.js';
import { PerformanceDate } from '@vidarr/shared-types';

const song = z.object({ name: z.string(), tape: z.boolean().optional(), info: z.string().optional() }).passthrough();
const event = z.preprocess(value => {
  if (value && typeof value === 'object' && !('sets' in value) && 'set' in value) return { ...value, sets: { set: value.set } };
  return value;
}, z.object({ id: z.string(), versionId: z.string(), eventDate: z.string(),
  artist: z.object({ mbid: z.string(), name: z.string() }), venue: z.object({ id: z.string().optional(), name: z.string().optional(),
    city: z.object({ name: z.string().optional(), country: z.object({ code: z.string().optional() }).passthrough().optional() }).passthrough().optional() }).passthrough(),
  tour: z.object({ name: z.string() }).optional(), sets: z.object({ set: z.array(z.object({ name: z.string().optional(), encore: z.number().optional(), song: z.array(song).default([]) }).passthrough()).default([]) }).default({ set: [] }),
}).passthrough());
export const SetlistPage = z.object({ page: z.number(), total: z.number(), itemsPerPage: z.number(), setlist: z.array(event).default([]) });
export type SetlistEvent = z.infer<typeof event>;
let nextRequest = 0;
let requests: Promise<unknown> = Promise.resolve();

// Serialize transport access so concurrent manual and scheduled work share the provider limit.
async function transport(resource: string, ruleId?: number) {
  const request = requests.catch(() => {}).then(async () => {
    const { row } = await liveConfiguration();
    if (!row?.setlistApiKey || row.setlistPaused) throw new LiveError('Configure or correct the setlist.fm API key in Live settings');
    if (row.providerRetryAt && row.providerRetryAt > new Date()) throw new LiveError('setlist.fm is cooling down; retry after the displayed provider delay');
    const day = new Date().toISOString().slice(0, 10);
    const allowed = await prisma.$transaction(async tx => {
      const globalKey = `metadata:setlist:${day}`;
      await tx.liveRequestBudget.upsert({ where: { key: globalKey }, create: { key: globalKey }, update: {} });
      const claimed = await tx.liveRequestBudget.updateMany({ where: { key: globalKey, used: { lt: 1000 } }, data: { used: { increment: 1 } } });
      if (!claimed.count) return false;
      if (ruleId) {
        const key = `metadata:rule:${ruleId}:${day}`;
        await tx.liveRequestBudget.upsert({ where: { key }, create: { key }, update: {} });
        if (!await tx.liveRequestBudget.updateMany({ where: { key, used: { lt: 10 } }, data: { used: { increment: 1 } } }).then(value => value.count)) {
          await tx.liveRequestBudget.update({ where: { key: globalKey }, data: { used: { decrement: 1 } } }); return false;
        }
      }
      return true;
    });
    if (!allowed) throw new LiveError('Metadata lookup budget reached; remaining history resumes in the next daily window');
    rememberSecrets({ apiKey: row.setlistApiKey });
    await new Promise(resolve => setTimeout(resolve, Math.max(0, nextRequest - Date.now())));
    nextRequest = Date.now() + 1100;
    const response = await fetch(`https://api.setlist.fm/rest/1.0/${resource}`, { headers: { 'x-api-key': row.setlistApiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if ([401, 403].includes(response.status)) {
      await prisma.liveConfiguration.update({ where: { id: 1 }, data: { setlistPaused: true } });
      throw new LiveError('setlist.fm authentication failed; correct the key to resume', 502);
    }
    if (!response.ok && response.status !== 404) {
      const seconds = Number(response.headers.get('retry-after'));
      const date = Date.parse(response.headers.get('retry-after') ?? '');
      const delay = seconds > 0 ? seconds * 1000 : Number.isFinite(date) ? Math.max(60000, date - Date.now()) : 5 * 60000;
      await prisma.liveConfiguration.update({ where: { id: 1 }, data: { providerRetryAt: new Date(Date.now() + delay) } });
      throw new LiveError(`setlist.fm returned ${response.status}; existing catalog data was retained`, 502);
    }
    return response.status === 404 ? { page: 1, total: 0, itemsPerPage: 20, setlist: [] } : response.json();
  });
  requests = request;
  return request;
}

export async function discoverSetlists(artistId: number, page = 1, date?: string, scope?: { year?: number; tour?: string; from?: string; to?: string; ruleId?: number }) {
  const artist = await prisma.artist.findUniqueOrThrow({ where: { id: artistId } });
  if (!artist.musicbrainzArtistId || artist.musicbrainzMatchStatus !== 'confirmed') throw new LiveError('Confirm the shared MusicBrainz artist first');
  const parameters = new URLSearchParams({ artistMbid: artist.musicbrainzArtistId, p: String(page) });
  if (date) parameters.set('date', date);
  if (scope?.year) parameters.set('year', String(scope.year));
  if (scope?.tour) parameters.set('tourName', scope.tour);
  const resource = date || scope?.year || scope?.tour ? `search/setlists?${parameters}` : `artist/${encodeURIComponent(artist.musicbrainzArtistId)}/setlists?p=${page}`;
  const cacheKey = `metadata:setlist:${resource}`;
  const cached = await prisma.liveSearchJournal.findUnique({ where: { key: cacheKey } });
  const data = SetlistPage.parse(cached?.payload && cached.retryAt && cached.retryAt > new Date() ? JSON.parse(cached.payload) : await transport(resource, scope?.ruleId));
  if (!cached?.retryAt || cached.retryAt <= new Date()) await prisma.liveSearchJournal.upsert({ where: { key: cacheKey },
    create: { key: cacheKey, provider: 'setlist.fm', payload: JSON.stringify(data), outcome: 'metadata', lastSearchAt: new Date(), retryAt: new Date(Date.now() + DAY), expiresAt: new Date(Date.now() + 365 * DAY) },
    update: { payload: JSON.stringify(data), lastSearchAt: new Date(), retryAt: new Date(Date.now() + DAY), expiresAt: new Date(Date.now() + 365 * DAY) } });
  const ids: number[] = [];
  for (const item of data.setlist) {
    if (item.artist.mbid !== artist.musicbrainzArtistId) continue;
    const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(item.eventDate), eventDate = match ? `${match[3]}-${match[2]}-${match[1]}` : '';
    if (scope?.from && eventDate < scope.from || scope?.to && eventDate > `${scope.to}\uffff`) continue;
    ids.push(await ingestSetlist(artistId, item));
  }
  return { ids, page: data.page, total: data.total, hasMore: data.page * data.itemsPerPage < data.total, metadataLookup: true };
}

export async function ingestSetlist(artistId: number, item: SetlistEvent): Promise<number> {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(item.eventDate);
  if (!match) throw new LiveError('setlist.fm supplied an invalid performance date', 502);
  const performanceDate = PerformanceDate.parse(`${match[3]}-${match[2]}-${match[1]}`);
  const songs = item.sets.set.flatMap(set => set.song.filter(value => !value.tape).map(value => ({ title: value.name,
    section: set.name ?? (set.encore ? `Encore ${set.encore}` : null), kind: /snippet/i.test(value.info ?? '') ? 'snippet' : 'unknown' })));
  return prisma.$transaction(async tx => {
    const previous = await tx.livePerformance.findUnique({ where: { setlistFmId: item.id } });
    if (previous) {
      if (previous.artistId !== artistId) throw new LiveError('External event has a conflicting artist; review its identity');
      if (previous.sourceVersion === item.versionId || previous.correctionPayload === JSON.stringify(item)) return previous.id;
      // Stable song-occurrence and recording identities survive corrections. Reordering needs review.
      await tx.livePerformance.update({ where: { id: previous.id }, data: { correctionPayload: JSON.stringify(item), identityStatus: 'correctionPending', lastEvidenceAt: new Date(), revision: { increment: 1 } } });
      return previous.id;
    }
    const created = await tx.livePerformance.create({ data: { artistId, title: `${item.artist.name} at ${item.venue.name ?? 'unknown venue'}`, performanceDate,
      venue: item.venue.name, city: item.venue.city?.name, country: item.venue.city?.country?.code, venueExternalId: item.venue.id, tour: item.tour?.name,
      setlistFmId: item.id, sourceVersion: item.versionId, sourcePayload: JSON.stringify(item), identityStatus: 'reference', userEdited: false,
      songs: { create: songs.map((value, position) => ({ ...value, position: position + 1 })) } } });
    return created.id;
  });
}

export async function linkSetlistReference(performanceId: number, externalId: string, revision: number) {
  const row = await prisma.livePerformance.findUniqueOrThrow({ where: { id: performanceId }, include: { artist: true } });
  if (row.artist.musicbrainzMatchStatus !== 'confirmed' || !row.artist.musicbrainzArtistId) throw new LiveError('Confirm the shared artist identity first');
  const item = event.parse(await transport(`setlist/${encodeURIComponent(externalId)}`));
  if (item.id !== externalId || item.artist.mbid !== row.artist.musicbrainzArtistId) throw new LiveError('This reference belongs to a different artist or event');
  return prisma.$transaction(async tx => {
    const other = await tx.livePerformance.findUnique({ where: { setlistFmId: externalId } });
    if (other && other.id !== performanceId) throw new LiveError(`Reference already belongs to performance ${other.id}; review both entries before merging identity`);
    const changed = await tx.livePerformance.updateMany({ where: { id: performanceId, revision, removedAt: null }, data: {
      setlistFmId: externalId, correctionPayload: JSON.stringify(item), identityStatus: 'correctionPending', lastEvidenceAt: new Date(), userEdited: true, revision: { increment: 1 },
    } });
    if (!changed.count) throw new LiveError('Performance changed; reload before attaching a reference');
    await tx.history.create({ data: { eventType: 'liveReferenceLinked', data: JSON.stringify({ performanceId, externalId }) } });
    return { ok: true };
  });
}
