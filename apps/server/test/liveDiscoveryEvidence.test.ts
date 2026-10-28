import { beforeEach, expect, it, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import { resetDb, ensureSettings, createArtist, createRootFolder, createQuality, createQualityProfile } from './support/db.js';
import { queueCandidateMatches, runLiveCandidateMatching, matchLiveCandidate, discoveryEvidence, liveCandidateMatchingStatus } from '../src/live/discoveryEvidence.js';
import { getMusicBrainzLiveReferences, getMusicBrainzLiveEventReferences, searchLiveSongEvidence } from '../src/providers/metadata/musicbrainz.js';
import { readSetlistPage } from '../src/live/setlist.js';
import { saveLiveUpload } from '../src/live/startingInventory.js';
vi.mock('../src/providers/metadata/musicbrainz.js',()=>({getMusicBrainzLiveReferences:vi.fn(),getMusicBrainzLiveEventReferences:vi.fn(),searchLiveSongEvidence:vi.fn(),lookupLiveEventEvidence:vi.fn()}));
vi.mock('../src/live/setlist.js',()=>({readSetlistPage:vi.fn()}));
let artist: Awaited<ReturnType<typeof createArtist>>;
beforeEach(async()=>{
 await resetDb();await ensureSettings(); const created=await createArtist((await createRootFolder()).id,(await createQualityProfile((await createQuality()).id)).id,{name:'Adele'});
 artist=await prisma.artist.update({where:{id:created.id},data:{musicbrainzArtistId:'adele',musicbrainzMatchStatus:'confirmed'}});
 vi.mocked(getMusicBrainzLiveReferences).mockReset().mockResolvedValue([]);vi.mocked(getMusicBrainzLiveEventReferences).mockReset().mockResolvedValue([]);vi.mocked(searchLiveSongEvidence).mockReset().mockResolvedValue([]);
 vi.mocked(readSetlistPage).mockReset().mockResolvedValue({page:1,total:0,itemsPerPage:20,setlist:[]});
});
const item=()=>prisma.liveDiscoveryItem.create({data:{artistId:artist.id,provider:'youtube',externalId:'Ri7-vnrJD3k',kind:'video',title:'Adele - Hello (Live)',url:'https://www.youtube.com/watch?v=Ri7-vnrJD3k'}});
it('queues both providers on addition, preserves reports across rescans and never queues dismissed discoveries',async()=>{
 await saveLiveUpload(artist.id,{youtubeVideoId:'Ri7-vnrJD3k',title:'Adele - Hello (Live)',officialEvidence:[],discoveryOrigins:[]},'channel');
 const row=await prisma.liveDiscoveryItem.findFirstOrThrow();expect((await liveCandidateMatchingStatus()).pending).toBe(2);
 await matchLiveCandidate(artist.id,row.id,'musicbrainz');await queueCandidateMatches(row,artist.musicbrainzArtistId);
 expect((await liveCandidateMatchingStatus()).completed).toBe(1);
 await prisma.liveDiscoveryItem.update({where:{id:row.id},data:{dismissed:true}});
 await queueCandidateMatches({...row,id:999,dismissed:true},artist.musicbrainzArtistId);expect(await prisma.liveSearchJournal.count({where:{provider:'live-candidate:musicbrainz'}})).toBe(1);
});
it('check failures remain failures rather than no match, while provider reports and source claims remain independent',async()=>{
 const row=await item();await queueCandidateMatches(row,artist.musicbrainzArtistId);
 vi.mocked(readSetlistPage).mockRejectedValue(new Error('Configure the setlist.fm key'));
 expect(await matchLiveCandidate(artist.id,row.id,'setlist.fm')).toMatchObject({status:'unavailable'});
 await matchLiveCandidate(artist.id,row.id,'musicbrainz');
 const evidence=(await discoveryEvidence([row],artist)).get(row.id)!;
 expect(evidence.checks['setlist.fm'].status).toBe('unavailable');expect(evidence.checks.musicbrainz.status).toBe('noMatch');expect(evidence.facts.some(f=>f.field==='song'&&f.value==='Hello')).toBe(true);
 expect(await prisma.recording.count()).toBe(0);expect(await prisma.livePerformance.count()).toBe(0);expect(await prisma.downloadQueueItem.count()).toBe(0);
});
it('backfills in bounded batches, checkpoints the cursor and skips ignored rows on subsequent passes',async()=>{
 await prisma.liveDiscoveryItem.createMany({data:Array.from({length:55},(_,i)=>({artistId:artist.id,provider:'youtube',externalId:`id-${i}`,kind:'video',title:'Adele Live',url:`https://example.test/${i}`,dismissed:i===0}))});
 await runLiveCandidateMatching();const first=await prisma.liveSearchJournal.findUniqueOrThrow({where:{key:'live-candidate-match-backfill'}});
 expect((await liveCandidateMatchingStatus()).pending).toBe(95);expect(JSON.parse(first.payload!).cursor).toBeGreaterThan(0);
 await runLiveCandidateMatching();expect((await liveCandidateMatchingStatus()).pending).toBe(98);
 const checkpoint=await prisma.liveSearchJournal.findUniqueOrThrow({where:{key:first.key}});expect(JSON.parse(checkpoint.payload!).cursor).toBeGreaterThan(JSON.parse(first.payload!).cursor);
 expect(await prisma.recording.count()).toBe(0);expect(readSetlistPage).toHaveBeenCalled();
},30000);
it('does no backfill work while Live is disabled',async()=>{
 await item();await prisma.settings.update({where:{id:1},data:{liveEnabled:false}});await runLiveCandidateMatching();expect(await prisma.liveSearchJournal.count()).toBe(0);
});
