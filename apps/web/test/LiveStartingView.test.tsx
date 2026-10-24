// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import LiveStartingView from '../src/components/LiveStartingView';
import { api } from '../src/api/client';
let host: HTMLDivElement, root: Root, cache: QueryClient;
beforeEach(()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement('div');document.body.append(host);root=createRoot(host);cache=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 vi.spyOn(api.live,'read').mockImplementation(async path=>({enabled:true,total:1,artist:{liveDiscoveryStatus:'complete',videoInventoryStatus:'complete'},items:[{id:path.includes('kind=video')?1:2,kind:path.includes('kind=video')?'video':'reference',title:path.includes('kind=video')?'Adele at Largo':'Royal Albert Hall',url:'https://musicbrainz.org/'}]}) as never);
 vi.spyOn(api.live,'action').mockResolvedValue({queued:false});
});
afterEach(async()=>{await act(async()=>root.unmount());cache.clear();host.remove();vi.restoreAllMocks();});
async function mount(){await act(async()=>root.render(<QueryClientProvider client={cache}><MemoryRouter><LiveStartingView artistId={42}/></MemoryRouter></QueryClientProvider>));await act(async()=>{await new Promise(r=>setTimeout(r,30));});}
it('offers videos and a short reference list without requesting setlist.fm history',async()=>{
 await mount();expect(host.textContent).toContain('Videos found');expect(host.textContent).toContain('Suggested performances to search');expect(host.textContent).toContain('Adele at Largo');expect(host.textContent).toContain('Royal Albert Hall');
 expect(api.live.action).toHaveBeenCalledWith('artists/42/prepare',{refresh:false});
 expect(vi.mocked(api.live.action).mock.calls.some(([path])=>path.includes('discover'))).toBe(false);
});
it('dismisses only the chosen suggestion through the artist-scoped endpoint',async()=>{
 await mount();const button=[...host.querySelectorAll('button')].find(b=>b.textContent==='Dismiss suggestion')!;
 await act(async()=>button.click());
 expect(api.live.action).toHaveBeenCalledWith('artists/42/start/1',{dismissed:true},'PATCH');
});
it('does not prepare or contact providers when Live is disabled',async()=>{
 vi.mocked(api.live.read).mockResolvedValue({enabled:false,items:[],total:0,artist:{liveDiscoveryStatus:'pending'}} as never);
 await mount();expect(host.textContent).toContain('disabled or unavailable');expect(api.live.action).not.toHaveBeenCalled();
});
