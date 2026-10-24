import { afterEach, expect, it, vi } from 'vitest';
import { getMusicBrainzLiveReferences, getMusicBrainzLiveEventReferences } from '../src/providers/metadata/musicbrainz.js';
const mbid = 'cc2c9c3c-b7bc-4b8b-84d8-4fbd8779e493';
afterEach(()=>vi.unstubAllGlobals());
it('uses bounded official Live release groups and direct performer events, without audio-discography/event-history traversal',async()=>{
 const get=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({'release-groups':[
  {id:'live',title:'Royal Albert Hall','primary-type':'Album','secondary-types':['Live'],'first-release-date':'2011-11-25','artist-credit':[{artist:{id:mbid}}]},
  {id:'audio',title:'Studio album','secondary-types':[],'artist-credit':[{artist:{id:mbid}}]},
  {id:'other',title:'Another performer','secondary-types':['Live'],'artist-credit':[{artist:{id:'other'}}]},
 ]}),{status:200})).mockResolvedValueOnce(new Response(JSON.stringify({id:mbid,relations:[
  {type:'main performer',event:{id:'event',name:'BRIT Awards 2016','life-span':{begin:'2016-02-24'}}},
  {type:'presenter',event:{id:'presenter',name:'Not a performance'}},
 ]}),{status:200}));
 vi.stubGlobal('fetch',get);
 expect(await getMusicBrainzLiveReferences(mbid)).toEqual([expect.objectContaining({id:'live',rank:100,releaseDate:'2011-11-25'})]);
 expect(await getMusicBrainzLiveEventReferences(mbid)).toEqual([expect.objectContaining({id:'event',rank:75})]);
 expect(get).toHaveBeenCalledTimes(2);
 expect(get.mock.calls[0][0]).toContain('release-group-status=website-default');
 expect(get.mock.calls[0][0]).toContain('limit=100');
 expect(get.mock.calls[1][0]).toContain('inc=event-rels');
 expect(get.mock.calls.every(([url])=>String(url).startsWith('https://musicbrainz.org/'))).toBe(true);
});
