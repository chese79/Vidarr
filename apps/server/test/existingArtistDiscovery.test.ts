import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import { resetDb, ensureSettings, createArtist, createRootFolder, createQuality, createQualityProfile } from './support/db.js';
import { collectArtistVideoInventory } from '../src/pipeline/artistVideoInventory.js';
import { startExistingArtistDiscovery, runExistingArtistDiscovery, existingArtistDiscoveryStatus, existingArtistDiscoveryPending } from '../src/pipeline/existingArtistDiscovery.js';
vi.mock('../src/pipeline/artistVideoInventory.js',()=>({collectArtistVideoInventory:vi.fn()}));
let firstId:number,secondId:number;
beforeEach(async()=>{
 await resetDb();await ensureSettings();
 const root=await createRootFolder(),profile=await createQualityProfile((await createQuality()).id);
 const a=await createArtist(root.id,profile.id,{name:'Adele'}),b=await createArtist(root.id,profile.id,{name:'Queen'});
 firstId=a.id;secondId=b.id;
 for(const [id,mbid] of [[a.id,'cc2c9c3c-b7bc-4b8b-84d8-4fbd8779e493'],[b.id,'0383dadf-2a4e-4d10-a46a-e9e041da8eb3']] as const)await prisma.artist.update({where:{id},data:{musicbrainzArtistId:mbid,musicbrainzMatchStatus:'confirmed'}});
 await createArtist(root.id,profile.id,{name:'Unconfirmed'});
 vi.mocked(collectArtistVideoInventory).mockReset().mockResolvedValue({official:0,approvedOther:0,pendingYoutube:0,pendingLocal:0,errors:[]});
});
afterEach(()=>vi.unstubAllGlobals());
it('does nothing before an explicit request and snapshots only confirmed artists',async()=>{
 expect(await existingArtistDiscoveryStatus()).toMatchObject({status:'idle',total:0});
 await runExistingArtistDiscovery();expect(collectArtistVideoInventory).not.toHaveBeenCalled();
 const state=await startExistingArtistDiscovery();expect(state).toMatchObject({status:'running',total:2,attempted:0});
 expect((await startExistingArtistDiscovery()).runId).toBe(state.runId);
});
it('collects metadata only, checkpoints each artist and completes without searching setlist.fm or queuing downloads',async()=>{
 const request=vi.fn();vi.stubGlobal('fetch',request);
 await startExistingArtistDiscovery();await runExistingArtistDiscovery();
 expect(collectArtistVideoInventory).toHaveBeenCalledWith(firstId,{refreshImvdb:false,scanLocal:false,enrichIdentity:true});
 expect(await existingArtistDiscoveryStatus()).toMatchObject({status:'running',attempted:1,remaining:1});expect(existingArtistDiscoveryPending()).toBe(true);
 await runExistingArtistDiscovery();expect(collectArtistVideoInventory).toHaveBeenLastCalledWith(secondId,expect.anything());
 expect(await existingArtistDiscoveryStatus()).toMatchObject({status:'complete',attempted:2,remaining:0,failed:0});
 expect(request).not.toHaveBeenCalled();expect(await prisma.downloadQueueItem.count()).toBe(0);
});
it('continues after provider failures and retains actionable failure state',async()=>{
 vi.mocked(collectArtistVideoInventory).mockResolvedValueOnce({official:0,approvedOther:0,pendingYoutube:0,pendingLocal:0,errors:['YouTube unavailable']});
 await startExistingArtistDiscovery();await runExistingArtistDiscovery();await runExistingArtistDiscovery();
 expect(await existingArtistDiscoveryStatus()).toMatchObject({status:'partial',attempted:2,failed:1,remaining:0});
 const journal=await prisma.liveSearchJournal.findUniqueOrThrow({where:{key:'existing-artist-source-discovery'}});
 expect(JSON.parse(journal.payload!).failures[0]).toMatchObject({artistId:firstId,error:'YouTube unavailable'});
});
it('retains the cursor until work finishes and shares concurrent execution',async()=>{
 let complete!:(value:any)=>void;
 vi.mocked(collectArtistVideoInventory).mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
 await startExistingArtistDiscovery();const run=runExistingArtistDiscovery();expect(runExistingArtistDiscovery()).toBe(run);
 for(let i=0;i<100&&!complete;i++)await new Promise(resolve=>setTimeout(resolve,5));
 expect(await existingArtistDiscoveryStatus()).toMatchObject({attempted:0,currentArtist:'Adele'});
 complete({official:0,approvedOther:0,pendingYoutube:0,pendingLocal:0,errors:[]});await run;
 expect(await existingArtistDiscoveryStatus()).toMatchObject({attempted:1,remaining:1});
});
