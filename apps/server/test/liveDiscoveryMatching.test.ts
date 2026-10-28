import { expect, it } from 'vitest';
import { candidateFacts, compareLiveReference, referenceFacts, summarizeComparisons, validPerformanceDate } from '../src/live/discoveryMatching.js';
import type { LiveReferenceEvidence, LiveProviderCheck } from '@vidarr/shared-types';
const artist = { name: 'Adele', musicbrainzArtistId: 'adele' };
const facts = (title: string) => candidateFacts({ title, url: 'https://www.youtube.com/watch?v=Ri7-vnrJD3k' }, artist);
const ref: LiveReferenceEvidence = { id: 'event', title: 'Adele at Royal Hall', artistMbid: 'adele', kind: 'event', url: 'https://example.test/event', date: '2011-09-22', venue: 'Royal Hall', songs: ['Someone Like You'] };
it('extracts only title claims and never interprets an unrelated title year as a performance date', () => {
 expect(facts('Adele - Someone Like You (Live at Royal Hall 2011-09-22)')).toEqual(expect.arrayContaining([
  expect.objectContaining({field:'song',value:'Someone Like You',basis:'claim'}), expect.objectContaining({field:'venue',value:'Royal Hall'}), expect.objectContaining({field:'date',value:'2011-09-22'})]));
 expect(facts('Adele - 2008 Song')).not.toEqual(expect.arrayContaining([expect.objectContaining({field:'date'})]));
 expect(facts('Adele - Someone Like You live @ Royal Hall').find(f=>f.field==='song')?.value).toBe('Someone Like You');
 expect(validPerformanceDate('2011-02-29')).toBe(false); expect(validPerformanceDate('2012-02-29')).toBe(true);
});
it('requires exact date, venue and claimed song agreement for a strong event match', () => {
 const input=facts('Adele - Someone Like You (Live at Royal Hall 2011-09-22)');
 expect(compareLiveReference(input,'adele',ref).status).toBe('strong');
 expect(compareLiveReference(input,'adele',{...ref,date:'2011-09-23'})).toMatchObject({status:'conflict',conflicts:['date']});
 expect(compareLiveReference(input,'adele',{...ref,date:undefined}).status).toBe('possible');
 expect(compareLiveReference(input,'adele',{...ref,artistMbid:'someone-else'}).conflicts).toContain('artist');
});
it('keeps song agreement separate from capture identity and excludes event facts for song-only matches', () => {
 const compared=compareLiveReference(facts('Adele - Someone Like You (Live)'), 'adele', ref);
 expect(compared.status).toBe('songOnly');
 const check:LiveProviderCheck={status:'songOnly',references:[compared],fingerprint:'test',scope:'bounded',checkedAt:null};
 expect(referenceFacts(check,'setlist.fm','Someone Like You').map(f=>f.field)).toEqual(['song']);
 expect(compareLiveReference(facts('Adele - Different Song (Live)'), 'adele', ref).status).toBe('noMatch');
});
it('exposes equally plausible distinct events as ambiguous and retains multiple references', () => {
 const input=facts('Adele - Someone Like You (Live at Royal Hall 2011-09-22)');
 expect(summarizeComparisons([ref,{...ref,id:'second-event'}].map(r=>compareLiveReference(input,'adele',r)))).toMatchObject({status:'ambiguous',references:expect.any(Array)});
 expect(summarizeComparisons([])).toEqual({status:'noMatch',references:[]});
});
