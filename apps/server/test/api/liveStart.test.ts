import { beforeAll, beforeEach, afterAll, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db/client.js';
import { authHeaders, TEST_API_KEY } from '../support/http.js';
import { resetDb, ensureSettings, createArtist, createRootFolder, createQuality, createQualityProfile } from '../support/db.js';
import { prepareLiveStartingInventory } from '../../src/live/startingInventory.js';
import { fetchImageSafely } from '../../src/pipeline/safeImageFetch.js';
vi.mock('../../src/pipeline/safeImageFetch.js',()=>({fetchImageSafely:vi.fn().mockResolvedValue(null)}));

vi.mock('../../src/providers/metadata/musicbrainz.js', async original => ({ ...await original<typeof import('../../src/providers/metadata/musicbrainz.js')>(), getMusicBrainzLiveReferences: vi.fn().mockResolvedValue([]), getMusicBrainzLiveEventReferences: vi.fn().mockResolvedValue([]) }));
let app: Awaited<ReturnType<typeof buildApp>>, artistId: number;
beforeAll(async()=>{app=await buildApp();await app.ready();});
afterAll(async()=>app.close());
beforeEach(async()=>{
  await resetDb();await ensureSettings({apiKey:TEST_API_KEY});
  artistId=(await createArtist((await createRootFolder()).id,(await createQualityProfile((await createQuality()).id)).id)).id;
  await prisma.artist.update({where:{id:artistId},data:{musicbrainzArtistId:'cc2c9c3c-b7bc-4b8b-84d8-4fbd8779e493',musicbrainzMatchStatus:'confirmed'}});
});
const url=(path='')=>`/api/v1/live/artists/${artistId}/start${path}`;
async function item(){return prisma.liveDiscoveryItem.create({data:{artistId,kind:'video',provider:'youtube',externalId:'Ri7-vnrJD3k',title:'Live video',url:'https://www.youtube.com/watch?v=Ri7-vnrJD3k'}});}
it('authenticates discovery reads and mutations',async()=>{
 expect((await app.inject(url())).statusCode).toBe(401);
 expect((await app.inject({method:'POST',url:`/api/v1/live/artists/${artistId}/prepare`,payload:{}})).statusCode).toBe(401);
});
it('authenticates matching, confirmation and thumbnails and validates artist scoping',async()=>{
 const row=await item();
 for(const action of ['match','confirm-grab']) expect((await app.inject({method:'POST',url:url(`/${row.id}/${action}`),payload:{}})).statusCode).toBe(401);
 expect((await app.inject(url(`/${row.id}/thumbnail`))).statusCode).toBe(401);
 expect((await app.inject({url:`/api/v1/live/artists/${artistId+1}/start/${row.id}/thumbnail`,headers:authHeaders()})).statusCode).toBe(404);
 expect(fetchImageSafely).not.toHaveBeenCalled();
 expect((await app.inject({url:url(`/${row.id}/thumbnail`),headers:authHeaders()})).statusCode).toBe(404);
 expect(fetchImageSafely).toHaveBeenCalledWith('https://i.ytimg.com/vi/Ri7-vnrJD3k/hqdefault.jpg');
 expect((await app.inject({method:'POST',url:url(`/${row.id}/match`),headers:authHeaders(),payload:{provider:'arbitrary'}})).statusCode).toBe(400);
 expect((await app.inject({method:'POST',url:url(`/${row.id}/confirm-grab`),headers:authHeaders(),payload:{videoVerified:false}})).statusCode).toBe(400);
});
it('pages and scopes discoveries without invoking a provider',async()=>{
 await item(); await prepareLiveStartingInventory(artistId);
 const response=await app.inject({url:url(),headers:authHeaders()});
 expect(response.statusCode).toBe(200);expect(response.json().total).toBe(1);expect(response.json().items[0].artistId).toBe(artistId);
 expect((await app.inject({url:url('?limit=5000'),headers:authHeaders()})).statusCode).toBe(400);
});
it('hides dismissed suggestions without deleting data or allowing cross-artist promotion',async()=>{
 const row=await item();
 expect((await app.inject({method:'POST',url:`/api/v1/live/artists/${artistId+1}/start/${row.id}/open`,headers:authHeaders(),payload:{}})).statusCode).toBe(409);
 await app.inject({method:'PATCH',url:url(`/${row.id}`),headers:authHeaders(),payload:{dismissed:true}});
 expect((await app.inject({url:url(),headers:authHeaders()})).json().items).toEqual([]);
 expect(await prisma.liveDiscoveryItem.count()).toBe(1);
 expect(await prisma.recording.count()).toBe(0);
});
it('filters before counting and paging while preserving artist, kind and dismissal boundaries',async()=>{
 await item();
 await prisma.liveDiscoveryItem.createMany({data:[
  {artistId,kind:'video',provider:'youtube',externalId:'concert-1',title:'Royal Hall Concert first',url:'https://example.test/1'},
  {artistId,kind:'video',provider:'youtube',externalId:'concert-2',title:'Royal Hall Concert second',url:'https://example.test/2'},
  {artistId,kind:'video',provider:'youtube',externalId:'dismissed',title:'Royal Hall Concert dismissed',url:'https://example.test/3',dismissed:true},
  {artistId,kind:'reference',provider:'musicbrainz',externalId:'reference',title:'Royal Hall Concert reference',url:'https://example.test/4'},
 ]});
 const response=await app.inject({url:url('?kind=video&search=ROYAL%20HALL&limit=1&offset=1'),headers:authHeaders()});
 expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({total:2,offset:1,limit:1});
 expect(response.json().items.map((row:{title:string})=>row.title)).toEqual(['Royal Hall Concert second']);
 expect((await app.inject({url:url('?search=not-found'),headers:authHeaders()})).json().total).toBe(0);
 expect((await app.inject({url:url('?search='+ 'a'.repeat(201)),headers:authHeaders()})).statusCode).toBe(400);
 expect(await prisma.livePerformance.count()).toBe(0);expect(await prisma.downloadQueueItem.count()).toBe(0);
});
it('persists global enablement, omits mutable capability input and blocks preparation when disabled',async()=>{
 const save=await app.inject({method:'PUT',url:'/api/v1/config',headers:authHeaders(),payload:{liveEnabled:false,liveAvailable:false}});
 expect(save.json()).toMatchObject({liveEnabled:false,liveAvailable:true});
 expect((await app.inject({method:'POST',url:`/api/v1/live/artists/${artistId}/prepare`,headers:authHeaders(),payload:{}})).statusCode).toBe(409);
 expect((await app.inject({method:'POST',url:`/api/v1/live/artists/${artistId}/discover`,headers:authHeaders(),payload:{}})).statusCode).toBe(409);
});
it('removes rejected recordings from both artist suggestions and the root starting list',async()=>{
 const row=await item();
 const opened=await app.inject({method:'POST',url:url(`/${row.id}/open`),headers:authHeaders(),payload:{}});
 expect(opened.statusCode).toBe(200);
 await prisma.recording.update({where:{id:opened.json().recordingId},data:{reviewStatus:'rejected'}});
 expect((await app.inject({url:url(),headers:authHeaders()})).json().total).toBe(0);
 expect((await app.inject({url:'/api/v1/live/start',headers:authHeaders()})).json().items).toEqual([]);
 expect(await prisma.liveDiscoveryItem.count()).toBe(1);
});
