import { createHash } from 'node:crypto';
import type { LiveDiscoveryItem } from '@prisma/client';
import type { LiveEvidenceFact, LiveEvidenceField, LiveProviderCheck, LiveReferenceComparison, LiveReferenceEvidence } from '@vidarr/shared-types';

export const evidenceKey = (id: number, provider: string) => `live-candidate-match:${id}:${provider}`;
export const normalizeLiveEvidence = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function candidateFingerprint(item: Pick<LiveDiscoveryItem, 'artistId' | 'title' | 'url' | 'externalId'>, mbid: string | null) {
  return createHash('sha256').update(JSON.stringify([item.artistId, mbid, item.title, item.url, item.externalId])).digest('hex');
}
export function validPerformanceDate(value: string): boolean {
  if (/^\d{4}$/.test(value)) return Number(value) >= 1900 && Number(value) <= 2100;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function candidateFacts(item: Pick<LiveDiscoveryItem, 'title' | 'url'>, artist: { name: string; musicbrainzArtistId: string | null }): LiveEvidenceFact[] {
  const facts: LiveEvidenceFact[] = [{ field: 'artist', value: artist.name, source: 'Library / MusicBrainz identity', basis: 'catalog',
    ...(artist.musicbrainzArtistId ? { url: `https://musicbrainz.org/artist/${artist.musicbrainzArtistId}` } : {}) }];
  const claim = (field: LiveEvidenceField, value?: string) => { if (value?.trim()) facts.push({ field, value: value.trim(), source: 'YouTube title (unverified claim)', url: item.url, basis: 'claim' }); };
  const escaped = artist.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const title = item.title.replace(new RegExp(`^${escaped}\\s*[-–—:]\\s*`, 'i'), '');
  const live = /\blive\b|\bconcert\b|\ben vivo\b|\bao vivo\b/i.exec(title);
  const context = live ? title.slice(live.index) : '';
  const song = title.replace(/\s*[\[(]\s*live\b.*$/i, '').replace(/\s+(?:[-–—]\s*)?live\s+(?:(?:at|in|from|on)\b|@).*$/i, '').trim();
  if (song && (song !== title || !/\blive\b|\bconcert\b|\bfestival\b|\bfull show\b/i.test(song))) {
    if (normalizeLiveEvidence(song) !== normalizeLiveEvidence(artist.name)) claim('song', song);
  }
  const fullDate = /\b(?:19|20)\d{2}-\d{2}-\d{2}\b/.exec(context)?.[0];
  const year = /\b(?:19|20)\d{2}\b/.exec(context)?.[0];
  if (fullDate && validPerformanceDate(fullDate)) claim('date', fullDate);
  else if (!fullDate && year) claim('date', year);
  const venue = /\blive\s+(?:at\s+|@\s*|from\s+)(.+?)(?=\s*\b(?:19|20)\d{2}\b|[()[\]]|$)/i.exec(context)?.[1];
  claim('venue', venue?.replace(/[\s,–—-]+$/, ''));
  const city = /\blive\s+in\s+(.+?)(?=\s*\b(?:19|20)\d{2}\b|[()[\]]|$)/i.exec(context)?.[1];
  claim('city', city?.replace(/[\s,–—-]+$/, ''));
  claim('event', context.replace(/[\])]+$/, '').trim());
  return facts;
}
export function compareLiveReference(facts: LiveEvidenceFact[], artistMbid: string, reference: LiveReferenceEvidence): LiveReferenceComparison {
  const get = (field: LiveEvidenceField) => facts.find(fact => fact.field === field)?.value;
  const same = (a?: string, b?: string) => !!a && !!b && normalizeLiveEvidence(a) === normalizeLiveEvidence(b);
  const date = get('date'), venue = get('venue'), city = get('city'), song = get('song'), event = get('event');
  const matches: LiveEvidenceField[] = [], conflicts: LiveEvidenceField[] = [];
  if (reference.artistMbid !== artistMbid) return { ...reference, status: 'conflict', matches, conflicts: ['artist'], score: -100 };
  matches.push('artist');
  const fullDate = !!date && /^\d{4}-\d{2}-\d{2}$/.test(date);
  if (date && reference.date) (reference.date.startsWith(date) ? matches : conflicts).push('date');
  if (venue && reference.venue) (same(venue, reference.venue) ? matches : conflicts).push('venue');
  if (city && reference.city) (same(city, reference.city) ? matches : conflicts).push('city');
  if (song && reference.songs?.some(value => same(song, value))) matches.push('song');
  if (event && same(event, reference.event ?? reference.title)) matches.push('event');
  const anchor = matches.some(field => ['date', 'venue', 'city', 'event'].includes(field));
  const status = anchor && conflicts.length ? 'conflict'
    : fullDate && matches.includes('date') && matches.includes('venue') && (!song || matches.includes('song')) ? 'strong'
      : anchor ? 'possible' : matches.includes('song') ? 'songOnly' : 'noMatch';
  const score = (status === 'conflict' ? 10 : 0) + matches.filter(field => field !== 'artist').length * 10
    + (status === 'strong' ? 100 : status === 'possible' ? 40 : status === 'songOnly' ? 20 : 0);
  return { ...reference, status, matches, conflicts, score };
}
export function summarizeComparisons(references: LiveReferenceComparison[]): Pick<LiveProviderCheck, 'status' | 'references'> {
  const relevant = references.filter(reference => reference.status !== 'noMatch').sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 5);
  if (!relevant.length) return { status: 'noMatch', references: [] };
  const top = relevant[0];
  const tied = relevant.filter(reference => reference.score === top.score && ['strong', 'possible'].includes(reference.status));
  const distinctEvents = new Set(tied.filter(reference => reference.kind === 'event').map(reference => JSON.stringify([reference.date, reference.venue, reference.city, reference.id])));
  return { status: distinctEvents.size > 1 ? 'ambiguous' : top.status, references: relevant };
}
export function referenceFacts(check: LiveProviderCheck, provider: string, claimedSong?: string): LiveEvidenceFact[] {
  if (!['strong', 'possible', 'songOnly', 'conflict', 'ambiguous'].includes(check.status)) return [];
  const selected = check.references.filter(reference => reference.score === check.references[0]?.score).slice(0, 3);
  return selected.flatMap(reference => {
    const fields: Partial<Record<LiveEvidenceField, string>> = { song: reference.matches.includes('song') ? reference.songs?.filter(song => claimedSong && normalizeLiveEvidence(song) === normalizeLiveEvidence(claimedSong)).join(' / ') : undefined };
    if (reference.status !== 'songOnly') Object.assign(fields, { date: reference.date, venue: reference.venue, city: reference.city, event: reference.event ?? reference.title });
    return Object.entries(fields).filter((entry): entry is [LiveEvidenceField, string] => !!entry[1]).map(([field, value]) => ({ field, value, source: provider, url: reference.url, basis: 'reference' as const }));
  });
}
