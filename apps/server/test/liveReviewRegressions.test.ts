import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import { resetDb, ensureSettings, createArtist, createRootFolder, createQuality, createQualityProfile, createMusicVideo } from './support/db.js';
import { reconcileRecordingDelivery, auditLocalRecordingAvailability } from '../src/live/delivery.js';
import { storageIdentity } from '../src/media/storageIdentity.js';
import { deleteMusicVideo } from '../src/pipeline/deleteVideo.js';
import { createHash } from 'node:crypto';
import { getLibraryConnectorProvider } from '../src/providers/library/index.js';
import { generatePlaylistFromFilters } from '../src/pipeline/playlistGenerator.js';
import { discoverRecordings, runLiveMonitoring, MonitoringInput } from '../src/live/discovery.js';
import { searchYoutube } from '../src/providers/youtube/ytdlp.js';
import { classifyExistingVideo, returnToMusicVideos } from '../src/live/reclassification.js';
import { importRecordingDownload } from '../src/live/acquisition.js';
import { registerExistingRecordingFile } from '../src/live/localImport.js';
import { scheduleRecordingDeletion, processRecordingDeletions } from '../src/live/deletion.js';
import { runLiveMetadataMonitoring } from '../src/live/metadataMonitoring.js';
import { pollLivePlayback } from '../src/live/playback.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
vi.mock('../src/providers/library/index.js', () => ({getLibraryConnectorProvider:vi.fn()}));
vi.mock('../src/providers/youtube/ytdlp.js', () => ({searchYoutube:vi.fn().mockResolvedValue([])}));
vi.mock('../src/pipeline/downloadDispatcher.js', () => ({wakeDownloadQueue:vi.fn()}));
vi.mock('../src/media/inspection.js', () => ({ assertHasMotion: vi.fn().mockResolvedValue(undefined), assertHasVideoStream: vi.fn().mockResolvedValue(undefined), assertMovingVideoSamples:vi.fn().mockResolvedValue(undefined), assertFileIntegrity:vi.fn().mockResolvedValue(undefined), getVideoProbe:vi.fn().mockResolvedValue({duration:100,width:1280,height:720}) }));
let rootId:number, artistId:number, eventId:number, connectorId:number, folder:string;
beforeEach(async () => {
 await resetDb(); await ensureSettings(); vi.clearAllMocks();
 folder=await fs.mkdtemp(path.join(os.tmpdir(),'vidarr-review-'));
 rootId=(await createRootFolder({path:folder})).id;
 artistId=(await createArtist(rootId,(await createQualityProfile((await createQuality()).id)).id)).id;
 await prisma.artist.update({where:{id:artistId},data:{musicbrainzMatchStatus:'confirmed',musicbrainzArtistId:'00000000-0000-4000-8000-000000000001'}});
 eventId=(await prisma.livePerformance.create({data:{artistId,title:'Show'}})).id;
 connectorId=(await prisma.libraryConnector.create({data:{name:'JF',type:'jellyfin',host:'http://fixture',videoLibraryId:'live'}})).id;
 await prisma.liveConfiguration.create({data:{policy:JSON.stringify({fullConnectorId:connectorId,fullLibraryId:'live',fullRootFolderId:rootId})}});
});
afterEach(async()=>fs.rm(folder,{recursive:true,force:true}));
async function recording() {return prisma.recording.create({data:{title:'Capture',reviewStatus:'accepted',identityVerified:true,videoVerified:true,performances:{create:{performanceId:eventId,identityVerified:true}}}});}
it('restores a returning server-only recording after confirmed absence',async()=>{
 const row=await recording(); const part=await prisma.recordingPart.create({data:{recordingId:row.id,position:1,available:false}});
 const copy=await prisma.recordingServerCopy.create({data:{partId:part.id,connectorId,libraryId:'live',externalId:'returned',expectedPath:'/server/show.mp4'}});
 const fetchVideos=vi.fn().mockResolvedValue([]); vi.mocked(getLibraryConnectorProvider).mockReturnValue({fetchVideos,listSections:vi.fn().mockResolvedValue([{id:'live',type:'musicvideos'}])} as any);
 await reconcileRecordingDelivery(); expect((await prisma.recordingServerCopy.findUniqueOrThrow({where:{id:copy.id}})).available).toBe(false);
 fetchVideos.mockResolvedValue([{externalId:'returned',path:'/server/show.mp4'}]); await reconcileRecordingDelivery();
 expect((await prisma.recordingServerCopy.findUniqueOrThrow({where:{id:copy.id}})).available).toBe(true);
});
it('does not starve the 101st pending delivery behind 100 unmatched parts',async()=>{
 const row=await recording(); await prisma.recordingPart.createMany({data:Array.from({length:101},(_,i)=>({recordingId:row.id,position:i+1,rootFolderId:rootId,path:`${folder}/part-${i+1}.mp4`,available:true,durationSeconds:100}))});
 vi.mocked(getLibraryConnectorProvider).mockReturnValue({fetchVideos:vi.fn().mockResolvedValue([{externalId:'last',path:'/server/part-101.mp4',durationSeconds:100}]),listSections:vi.fn().mockResolvedValue([{id:'live',type:'musicvideos'}])} as any);
 await reconcileRecordingDelivery(); await reconcileRecordingDelivery(); expect(await prisma.recordingServerCopy.count()).toBe(1);
});
it('keeps reclassified concerts out of newly generated music-video playlists',async()=>{
 const video=await createMusicVideo(artistId,{hasFile:true}); const file=path.join(folder,'concert.mp4'); await fs.writeFile(file,'fixture');
 await prisma.musicVideoFile.create({data:{musicVideoId:video.id,path:file,sizeBytes:7n,originalFilename:'concert.mp4'}});
 await prisma.musicVideo.update({where:{id:video.id},data:{isLiveConcert:true}}); await classifyExistingVideo(video.id,eventId,true);
 const list=await generatePlaylistFromFilters('Music videos',{},'all');
 expect(await prisma.playlistItem.count({where:{playlistId:list.playlistId,musicVideoId:video.id}})).toBe(0);
});
it('obeys disabling the exclude-deleted setting for live discovery',async()=>{
 await prisma.settings.update({where:{id:1},data:{excludeDeletedVideosFromScans:false}});
 await prisma.liveExclusion.create({data:{artistId,scope:'artistSet',fingerprint:`artistSet:${artistId}:${eventId}`}});
 await discoverRecordings(eventId,undefined,true); expect(searchYoutube).toHaveBeenCalledTimes(1);
 await prisma.settings.update({where:{id:1},data:{excludeDeletedVideosFromScans:true}});
 await discoverRecordings(eventId,undefined,true); expect(searchYoutube).toHaveBeenCalledTimes(1);
 expect(await prisma.liveExclusion.count()).toBe(1);
});
it('does not automatically download YouTube for an indexer-only monitoring rule',async()=>{
 const row=await recording(); await prisma.recordingSource.create({data:{recordingId:row.id,provider:'youtube',externalId:'abcdefghijk',url:'https://www.youtube.com/watch?v=abcdefghijk',accepted:true}});
 const rule=await prisma.liveMonitoringRule.create({data:{artistId,filters:JSON.stringify(MonitoringInput.parse({artistId,sources:['indexer']}))}});
 await runLiveMonitoring(); expect(await prisma.downloadQueueItem.count()).toBe(0);
 await prisma.liveMonitoringRule.update({where:{id:rule.id},data:{filters:JSON.stringify(MonitoringInput.parse({artistId,sources:['youtube']}))}});
 await runLiveMonitoring(); expect((await prisma.downloadQueueItem.findFirstOrThrow()).sourceType).toBe('youtube');
});
it('can download part one after reclassifying a file-less catalog entry',async()=>{
 const video=await createMusicVideo(artistId); await prisma.musicVideo.update({where:{id:video.id},data:{isLiveConcert:true}});
 const row=await classifyExistingVideo(video.id,eventId,true), file=path.join(folder,'incoming.mp4'); await fs.writeFile(file,'fixture');
 await prisma.settings.update({where:{id:1},data:{minFreeSpaceMb:0}});
 const item=await prisma.downloadQueueItem.create({data:{recordingId:row.id,rootFolderId:rootId,sourceType:'youtube',sourceRef:'https://www.youtube.com/watch?v=abcdefghijk',status:'importing',downloadedPath:file}});
 await expect(importRecordingDownload(item)).resolves.toBeDefined();
 await prisma.downloadQueueItem.delete({where:{id:item.id}});
 await returnToMusicVideos(row.id,true);
 expect((await prisma.musicVideo.findUniqueOrThrow({where:{id:video.id}})).hasFile).toBe(true);
});
it('protects another recording owning the same physical file through an equivalent path',async()=>{
 const first=await recording(), second=await recording(), file=`${folder}/shared.mp4`;
 await fs.writeFile(file,'retained');
 await registerExistingRecordingFile(first.id,rootId,file);
 await expect(registerExistingRecordingFile(second.id,rootId,`${folder}/./shared.mp4`)).rejects.toThrow('physical file');
 // Simulate an alias saved by an older release after deletion was scheduled.
 await scheduleRecordingDeletion(first.id,true);
 const other=await prisma.recordingPart.create({data:{recordingId:second.id,position:1,rootFolderId:rootId,path:`${folder}/./shared.mp4`,available:true}});
 await processRecordingDeletions(new Date(Date.now()+6*60000));
 expect((await prisma.recording.findUniqueOrThrow({where:{id:first.id}})).deletionState).toBe('failed');
 expect((await prisma.recordingPart.findUniqueOrThrow({where:{id:other.id}})).available).toBe(true);
 expect(await fs.stat(file).then(()=>true,()=>false)).toBe(true);
});
it('pages complete history with an upper date bound and repairs old upper-year cursors',async()=>{
 await prisma.liveConfiguration.update({where:{id:1},data:{setlistApiKey:'fixture-key'}});
 const rule=await prisma.liveMonitoringRule.create({data:{artistId,filters:JSON.stringify(MonitoringInput.parse({artistId,to:'2025'}))}});
 await prisma.liveSearchJournal.create({data:{key:`metadata-cursor:${rule.id}`,provider:'metadata-cursor',payload:JSON.stringify({year:2025,page:1,refreshAfter:'2099-01-01'}),expiresAt:new Date('2099-01-01')}});
 const item=(id:string,date:string)=>({id,versionId:'v1',eventDate:date,artist:{mbid:'00000000-0000-4000-8000-000000000001',name:'Artist'},venue:{name:'Hall'},sets:{set:[]}});
 const fetcher=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({page:1,total:2,itemsPerPage:20,setlist:[item('older','01-01-2024'),item('newer','01-01-2026')]}),{status:200}));
 vi.stubGlobal('fetch',fetcher);
 try {
  await runLiveMetadataMonitoring();
  const journal=await prisma.liveSearchJournal.findUniqueOrThrow({where:{key:`metadata-cursor:${rule.id}`}});
  expect(JSON.parse(journal.payload!).year).toBeUndefined();
  expect(fetcher.mock.calls[0][0]).not.toContain('year=');
  expect(await prisma.livePerformance.count({where:{setlistFmId:'older'}})).toBe(1);
  expect(await prisma.livePerformance.count({where:{setlistFmId:'newer'}})).toBe(0);
 } finally {vi.unstubAllGlobals();}
});
it('breaks playback continuity after a failed session poll',async()=>{
 const row=await recording(); const part=await prisma.recordingPart.create({data:{recordingId:row.id,position:1,available:false,durationSeconds:100,serverCopies:{create:{connectorId,libraryId:'live',externalId:'playing',expectedPath:'/server/playing.mp4'}}}});
 const session={sessionId:'device',userId:'viewer',externalId:'playing',positionSeconds:0,durationSeconds:100,playing:true};
 const fetchPlaybackSessions=vi.fn().mockResolvedValueOnce([session]).mockResolvedValueOnce([{...session,positionSeconds:15}]).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([{...session,positionSeconds:45}]).mockResolvedValueOnce([{...session,positionSeconds:60}]);
 vi.mocked(getLibraryConnectorProvider).mockReturnValue({fetchPlaybackSessions} as any);
 vi.useFakeTimers({toFake:['Date']});
 try {
  vi.setSystemTime(new Date('2026-10-18T00:00:00Z')); await pollLivePlayback();
  vi.setSystemTime(new Date('2026-10-18T00:00:15Z')); await pollLivePlayback();
  vi.setSystemTime(new Date('2026-10-18T00:00:30Z')); await pollLivePlayback();
  vi.setSystemTime(new Date('2026-10-18T00:00:45Z')); await pollLivePlayback();
  expect((await prisma.liveViewing.findFirstOrThrow()).watchedSeconds).toBe(15);
  vi.setSystemTime(new Date('2026-10-18T00:01:00Z')); await pollLivePlayback();
  expect((await prisma.liveViewing.findFirstOrThrow()).watchedSeconds).toBe(30);
 } finally {vi.useRealTimers();}
});
it('protects music-video ownership against aliases in either deletion direction',async()=>{
 const row=await recording(), video=await createMusicVideo(artistId,{hasFile:true}), file=`${folder}/shared-mv.mp4`;
 await fs.writeFile(file,'retained');
 await prisma.musicVideoFile.create({data:{musicVideoId:video.id,path:file,sizeBytes:8n,originalFilename:'shared-mv.mp4'}});
 await expect(registerExistingRecordingFile(row.id,rootId,`${folder}/./shared-mv.mp4`)).rejects.toThrow('physical file');
 await prisma.recordingPart.create({data:{recordingId:row.id,position:1,rootFolderId:rootId,path:`${folder}/./shared-mv.mp4`,available:true}});
 await expect(deleteMusicVideo(video.id,true)).rejects.toThrow('physical file');
 await expect(scheduleRecordingDeletion(row.id,true)).rejects.toThrow('physical file');
 expect(await fs.readFile(file,'utf8')).toBe('retained');
});
it('honors the exclusion toggle when registering an exact previously deleted file',async()=>{
 const row=await recording(), file=`${folder}/excluded.mp4`; await fs.writeFile(file,'fixture');
 const sha=createHash('sha256').update('fixture').digest('hex');
 await prisma.liveExclusion.create({data:{artistId,scope:'recording',fingerprint:`sha256:${sha}`}});
 await prisma.settings.update({where:{id:1},data:{excludeDeletedVideosFromScans:true}});
 await expect(registerExistingRecordingFile(row.id,rootId,file)).rejects.toThrow('excluded');
 await prisma.settings.update({where:{id:1},data:{excludeDeletedVideosFromScans:false}});
 const part=await registerExistingRecordingFile(row.id,rootId,file);
 expect(part.path).toBe(await fs.realpath(file)); expect(await prisma.liveExclusion.count()).toBe(1);
});
it('checks local losses beyond the first 500 available parts',async()=>{
 const row=await recording(), identity=await storageIdentity(folder,true);
 const files=Array.from({length:500},(_,i)=>`${folder}/retained-${i}.mp4`);
 await Promise.all(files.map(file=>fs.writeFile(file,'fixture')));
 await prisma.recordingPart.createMany({data:[...files,`${folder}/missing.mp4`].map((file,i)=>({recordingId:row.id,position:i+1,rootFolderId:rootId,path:file,storageIdentity:identity,available:true}))});
 await auditLocalRecordingAvailability();
 expect(await prisma.recordingPart.count({where:{recordingId:row.id,available:false}})).toBe(1);
 expect(await prisma.recordingPart.count({where:{recordingId:row.id,available:true}})).toBe(500);
});
