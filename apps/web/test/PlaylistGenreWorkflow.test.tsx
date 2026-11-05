// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PlaylistsPage from '../src/pages/PlaylistsPage';
import { CatalogModeContext } from '../src/components/CatalogMode';
import { ButtonFeedback } from '../src/components/ButtonFeedback';
import { api } from '../src/api/client';
import type { CatalogMode } from '../src/catalogMode';

let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  vi.spyOn(api.playlists,'list').mockResolvedValue([]);
  vi.spyOn(api.libraryConnectors,'list').mockResolvedValue([{id:4,name:'JF',type:'jellyfin',enabled:true,videoLibraryId:'music'}] as never);
  vi.spyOn(api.settings,'get').mockResolvedValue({defaultPlaybackConnectorId:4} as never);
  vi.spyOn(api.artists,'list').mockResolvedValue([]);
  vi.spyOn(api.musicVideos,'list').mockResolvedValue([]);
  vi.spyOn(api.genres,'stats').mockResolvedValue({genres:[{name:'electronic',isOther:false,subgenres:[{name:'trip hop'}]}]} as never);
  vi.spyOn(api.playlists,'push');
});
afterEach(async()=>{await act(async()=>root.unmount());client.clear();host.remove();vi.restoreAllMocks();});
async function flush(){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});}
function Screen({initial}:{initial:CatalogMode}){
  const [mode,setMode]=useState(initial);
  return <CatalogModeContext.Provider value={{mode,setMode}}><ButtonFeedback client={client}><PlaylistsPage /></ButtonFeedback></CatalogModeContext.Provider>;
}
async function mount(mode:CatalogMode='musicVideos',url='/playlists'){
  await act(async()=>root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[url]}><Screen initial={mode}/></MemoryRouter></QueryClientProvider>));await flush();
}
function button(text:string){return [...host.querySelectorAll('button')].find(b=>b.textContent===text)!;}

it('switches from Live to a usable music-video generator without submitting a playlist',async()=>{
  const generate=vi.spyOn(api.playlists,'generate');
  await mount('live');
  expect(button('Generate music-video playlist').disabled).toBe(false);
  await act(async()=>button('Generate music-video playlist').click());await flush();
  expect(host.querySelector('#playlist-generator')).not.toBeNull();
  expect(host.querySelector<HTMLButtonElement>('button[form="playlist-generator"]')?.disabled).toBe(false);
  expect(generate).not.toHaveBeenCalled();
});

it('explains playlists hidden by the media filter and offers to show them',async()=>{
  vi.mocked(api.playlists.list).mockResolvedValue([{id:1,name:'Existing',kind:'static',sortMode:'artist_title',targetConnectorId:null,syncs:[],items:[{id:1,musicVideoId:2,musicVideo:{title:'Video',artist:{name:'Artist'}}}]}] as never);
  await mount('live');
  expect(host.textContent).toContain('hidden by the current media filter');
  await act(async()=>button('Show all playlists').click());await flush();
  expect(host.textContent).toContain('Existing');
  expect(host.textContent).not.toContain('hidden by the current media filter');
});

it('prefills a genre link and reports server-side automatic publication from Generate',async()=>{
  let resolve!: (value:never)=>void;
  const generate=vi.spyOn(api.playlists,'generate').mockImplementation(()=>new Promise(r=>{resolve=r;}));
  await mount('musicVideos','/playlists?genre=electronic');
  expect((host.querySelector('[aria-label="Genre"]') as HTMLInputElement).value).toBe('electronic');
  expect(host.querySelector('datalist[id$="-genres"]')?.textContent).not.toContain('undefined');
  expect(host.querySelector('option[value="electronic"]')).not.toBeNull();
  expect(host.querySelector('option[value="trip hop"]')).not.toBeNull();
  await act(async()=>button('Generate playlist').click());await flush();
  expect(generate).toHaveBeenCalledWith(expect.objectContaining({filters:{genre:'electronic'},targetConnectorId:4,maxVideos:20}));
  expect(host.textContent).toContain('finding matching videos and publishing');
  await act(async()=>resolve({playlistId:7,matchedCount:3,publication:{connectorId:4,status:'success',remotePlaylistId:'remote',matchedCount:3,unmatchedTitles:[]}} as never));await flush();
  expect(host.textContent).toContain('Published 3 video(s) to the playback library.');
  expect(api.playlists.push).not.toHaveBeenCalled();
});

it('reports saved membership and publication failure without claiming the player was updated',async()=>{
  vi.spyOn(api.playlists,'generate').mockResolvedValue({playlistId:7,matchedCount:3,publication:{connectorId:4,status:'failed',remotePlaylistId:null,matchedCount:0,unmatchedTitles:[],error:'Player offline'}} as never);
  await mount();await act(async()=>button('Generate playlist').click());await flush();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Saved in Vidarr, but publication failed: Player offline');
  expect(host.textContent).toContain('Use Push to retry this saved playlist');
  expect(api.playlists.push).not.toHaveBeenCalled();
});

it('shows a generation failure as an alert and allows retry',async()=>{
  vi.spyOn(api.playlists,'generate').mockRejectedValue(new Error('Playback library unavailable'));
  await mount();await act(async()=>button('Generate playlist').click());await flush();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Playback library unavailable');
  expect(host.querySelector<HTMLButtonElement>('button[form="playlist-generator"]')?.disabled).toBe(false);
});
