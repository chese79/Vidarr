import { beforeEach, expect, it, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import { resetDb, ensureSettings, createArtist, createRootFolder, createQuality, createQualityProfile } from './support/db.js';
import { confirmAndGrabLiveDiscovery } from '../src/live/discoveryConfirm.js';
import { enqueueRecording } from '../src/live/acquisition.js';
import { candidateFingerprint, evidenceKey } from '../src/live/discoveryMatching.js';
vi.mock('../src/live/acquisition.js',()=>({enqueueRecording:vi.fn()}));
let artistId:number, rootId:number, itemId:number;
const input={identityConfirmed:true,videoVerified:true,sourceConfirmed:true};
beforeEach(async()=>{
 await resetDb();await ensureSettings();rootId=(await createRootFolder()).id;
 artistId=(await createArtist(rootId,(await createQualityProfile((await createQuality()).id)).id,{name:'Adele'})).id;
 await prisma.artist.update({where:{id:artistId},data:{musicbrainzArtistId:'adele',musicbrainzMatchStatus:'confirmed'}});
 itemId=(await prisma.liveDiscoveryItem.create({data:{artistId,kind:'video',provider:'youtube',externalId:'Ri7-vnrJD3k',title:'Adele - Hello (Live)',url:'https://www.youtube.com/watch?v=Ri7-vnrJD3k'}})).id;
 vi.mocked(enqueueRecording).mockReset().mockResolvedValue({id:123} as never);
});
it('requires explicit review attestations and configured destination before changing catalog state',async()=>{
 expect(()=>confirmAndGrabLiveDiscovery(artistId,itemId,{...input,videoVerified:false})).toThrow();
 await expect(confirmAndGrabLiveDiscovery(artistId,itemId,input)).rejects.toThrow('destination');
 expect(await prisma.recording.count()).toBe(0);expect(enqueueRecording).not.toHaveBeenCalled();
});
it('uses the established review and acquisition paths, keeps unknown event details and shares duplicate submissions',async()=>{
 await prisma.liveConfiguration.create({data:{policy:JSON.stringify({fullRootFolderId:rootId})}});
 const [a,b]=await Promise.all([confirmAndGrabLiveDiscovery(artistId,itemId,input),confirmAndGrabLiveDiscovery(artistId,itemId,input)]);
 expect(a).toEqual(b);expect(a).toMatchObject({status:'queued',queueId:123});expect(enqueueRecording).toHaveBeenCalledTimes(1);
 expect(await prisma.recording.findFirst()).toMatchObject({reviewStatus:'accepted',identityVerified:true,videoVerified:true,claimedCoverage:'unknown'});
 expect(await prisma.livePerformance.findFirst()).toMatchObject({performanceDate:null,venue:null});expect(await prisma.recordingSource.findFirst()).toMatchObject({accepted:true});
 expect(await prisma.history.count({where:{eventType:'liveIdentityReviewed'}})).toBe(1);
});
it('requires acknowledgement of ambiguous references and refuses ignored or mismatched uploads',async()=>{
 const row=await prisma.liveDiscoveryItem.findUniqueOrThrow({where:{id:itemId}});
 await prisma.liveSearchJournal.create({data:{key:evidenceKey(itemId,'musicbrainz'),provider:'live-candidate:musicbrainz',outcome:'liveMatchDone',expiresAt:new Date(Date.now()+86400000),payload:JSON.stringify({fingerprint:candidateFingerprint(row,'adele'),status:'ambiguous',references:[]})}});
 await expect(confirmAndGrabLiveDiscovery(artistId,itemId,input)).rejects.toThrow('acknowledge');
 await prisma.liveDiscoveryItem.update({where:{id:itemId},data:{dismissed:true}});await expect(confirmAndGrabLiveDiscovery(artistId,itemId,input)).rejects.toThrow('current Live');
 await prisma.liveDiscoveryItem.update({where:{id:itemId},data:{dismissed:false,url:'https://www.youtube.com/watch?v=abcdefghijk'}});await expect(confirmAndGrabLiveDiscovery(artistId,itemId,input)).rejects.toThrow('identity changed');
 expect(enqueueRecording).not.toHaveBeenCalled();expect(await prisma.recording.count()).toBe(0);
});
it('retains explicit review after an acquisition failure so retry does not create duplicate recordings',async()=>{
 await prisma.liveConfiguration.create({data:{policy:JSON.stringify({fullRootFolderId:rootId})}});vi.mocked(enqueueRecording).mockRejectedValueOnce(new Error('source unavailable'));
 await expect(confirmAndGrabLiveDiscovery(artistId,itemId,input)).rejects.toThrow('source unavailable');await confirmAndGrabLiveDiscovery(artistId,itemId,input);
 expect(await prisma.recording.count()).toBe(1);expect(await prisma.recordingSource.count()).toBe(1);
});
