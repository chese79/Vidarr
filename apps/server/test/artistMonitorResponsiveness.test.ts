import {beforeEach,expect,it,vi} from 'vitest';
import {buildApp} from '../src/app.js';
import {prisma} from '../src/db/client.js';
import {refreshArtistMetadata} from '../src/pipeline/metadataRefresh.js';
import {resetDb,createRootFolder,createQuality,createQualityProfile,createArtist,ensureSettings} from './support/db.js';
import {authHeaders,TEST_API_KEY} from './support/http.js';
vi.mock('../src/pipeline/metadataRefresh.js',async original=>({...await original<typeof import('../src/pipeline/metadataRefresh.js')>(),refreshArtistMetadata:vi.fn()}));
vi.mock('../src/pipeline/localVideoReview.js',async original=>({...await original<typeof import('../src/pipeline/localVideoReview.js')>(),scanLocalVideoCandidates:vi.fn().mockResolvedValue(undefined)}));
vi.mock('../src/live/startingInventory.js',async original=>({...await original<typeof import('../src/live/startingInventory.js')>(),prepareLiveStartingInventory:vi.fn().mockResolvedValue(undefined)}));
beforeEach(resetDb);
it('acknowledges monitoring while a provider is blocked, then persists its failure for retry',async()=>{
 await ensureSettings({apiKey:TEST_API_KEY});const root=await createRootFolder();const profile=await createQualityProfile((await createQuality()).id);
 const artist=await createArtist(root.id,profile.id,{monitored:false});
 await prisma.artist.update({where:{id:artist.id},data:{musicbrainzMatchStatus:'confirmed',musicbrainzArtistId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',imvdbArtistId:'test-artist'}});
 let reject!:(error:Error)=>void;const gate=new Promise<never>((_yes,no)=>reject=no);vi.mocked(refreshArtistMetadata).mockReturnValue(gate);
 const app=await buildApp();await app.ready();let response:Awaited<ReturnType<typeof app.inject>>|undefined;
 const request=app.inject({method:'PUT',url:`/api/v1/artist/${artist.id}`,headers:authHeaders(),payload:{monitored:true}}).then(value=>{response=value;});
 try{
  await vi.waitFor(()=>expect(response).toBeDefined(),{timeout:5000});
  expect(response!.statusCode).toBe(200);expect(response!.json()).toMatchObject({monitored:true,sourceCollectionQueued:true});
  await vi.waitFor(()=>expect(refreshArtistMetadata).toHaveBeenCalledWith(artist.id));
  expect((await prisma.artist.findUniqueOrThrow({where:{id:artist.id}})).videoInventoryStatus).toBe('running');
 }finally{reject(Error('Provider offline'));await request;}
 await vi.waitFor(async()=>expect(await prisma.artist.findUniqueOrThrow({where:{id:artist.id}})).toMatchObject({monitored:true,videoInventoryStatus:'partial',videoInventoryError:expect.stringContaining('Provider offline')}));
 await vi.waitFor(async()=>expect(await prisma.activityLog.findFirst({where:{source:{startsWith:`artist-video-inventory:${artist.id}:`},message:{startsWith:'Collection partial; retry scheduled:'}}})).not.toBeNull());
 await app.close();
});
