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
 await mount();
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Review candidate')!.click());
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Dismiss suggestion')!.click());
 expect(api.live.action).toHaveBeenCalledWith('artists/42/start/1',{dismissed:true},'PATCH');
});
it('uses compact expandable review rows without promoting candidates when expanded',async()=>{
 await mount();
 expect(host.querySelectorAll('.artist-row')).toHaveLength(2);
 expect(host.querySelector('[role="region"]')).toBeNull();
 expect(host.textContent).toContain('1 video candidates');expect(host.textContent).toContain('Needs review');
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Review candidate')!.click());
 await act(async()=>{await new Promise(r=>setTimeout(r,300));});
 expect(host.querySelector('[aria-label="Review Adele at Largo"]')).not.toBeNull();
 expect(host.querySelector('a')?.textContent).toBe('Inspect source video');
 expect(vi.mocked(api.live.action).mock.calls.some(([path])=>path.endsWith('/open'))).toBe(false);
 await act(async()=>(host.querySelector('button[aria-controls="live-candidate-1"][aria-expanded="true"]') as HTMLButtonElement).click());
 expect(host.querySelector('[role="region"]')).toBeNull();
});
it('pages candidates in bounded groups and searches server-side after resetting the page',async()=>{
 vi.mocked(api.live.read).mockResolvedValue({enabled:true,total:26,artist:{liveDiscoveryStatus:'complete',videoInventoryStatus:'complete'},items:[]} as never);
 await mount();
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Explore more suggestions')!.click());
 expect(vi.mocked(api.live.read).mock.calls.some(([path])=>path.includes('kind=video&offset=25&limit=25'))).toBe(true);
 const input=host.querySelector('[aria-label="Search Live discovery candidates"]') as HTMLInputElement;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Royal Hall');input.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>{await new Promise(r=>setTimeout(r,300));});
 expect(vi.mocked(api.live.read).mock.calls.some(([path])=>path.includes('kind=video&offset=0&limit=25&search=Royal+Hall'))).toBe(true);
 expect(vi.mocked(api.live.action).mock.calls).toEqual([['artists/42/prepare',{refresh:false}]]);
});
it('reports a failed read as an error rather than an empty collection and permits retry',async()=>{
 vi.mocked(api.live.read).mockRejectedValue(new Error('offline'));
 await mount();
 expect(host.textContent).toContain('Could not load video candidates');
 expect(host.textContent).not.toContain('No live upload candidates found yet');
 expect([...host.querySelectorAll('button')].some(b=>b.textContent==='Retry candidates')).toBe(true);
});
it('does not prepare or contact providers when Live is disabled',async()=>{
 vi.mocked(api.live.read).mockResolvedValue({enabled:false,items:[],total:0,artist:{liveDiscoveryStatus:'pending'}} as never);
 await mount();expect(host.textContent).toContain('disabled or unavailable');expect(api.live.action).not.toHaveBeenCalled();
});
