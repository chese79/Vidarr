// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import LibraryPage from '../src/pages/LibraryPage';
import { api } from '../src/api/client';

it('loads genre filters without downloading every artist and falls back after a genre failure', async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
  client.setQueryData(['rootFolders'],[]);client.setQueryData(['qualityProfiles'],[]);
  client.setQueryData(['genreStats',1],{totalArtists:1,artistsWithGenre:1,genres:[{name:'rock',isOther:false,subgenres:[]}]});
  client.setQueryData(['artistSummary','','',null,null,null,false,'','','',1,true],{items:[],total:0,availableLetters:[]});
  const list=vi.spyOn(api.artists,'list').mockResolvedValue([]);
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  try {
    await act(async()=>{root.render(<QueryClientProvider client={client}><MemoryRouter><LibraryPage /></MemoryRouter></QueryClientProvider>);});
    expect(host.querySelector('option[value="rock"]')).not.toBeNull();expect(list).not.toHaveBeenCalled();
    await act(async()=>{client.getQueryCache().find({queryKey:['genreStats',1]})!.setState({status:'error',error:Error('Unavailable')});});
    await vi.waitFor(()=>expect(list).toHaveBeenCalledOnce());
  }finally{await act(async()=>root.unmount());client.clear();host.remove();vi.restoreAllMocks();}
});

it('shows the acknowledged monitor flag without waiting for the summary refetch', async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
 for(const key of ['rootFolders','qualityProfiles'])client.setQueryData([key],[]);
 client.setQueryData(['genreStats',1],{totalArtists:1,artistsWithGenre:0,genres:[]});
 const artist={id:1,name:'Example',monitored:false,musicbrainzMatchStatus:'confirmed',videoInventoryStatus:'complete',hasImage:false,knownVideoCount:1,availableVideoCount:0,missingVideoCount:1,monitoredVideoCount:0,unmatchedVideoCount:0,downloadingVideoCount:0};
 const page={items:[artist],total:1,page:1,pageSize:25,availableLetters:['E']};
 client.setQueryData(['artistSummary','','',null,null,null,false,'','','',1,true],page);
 let finish!:(value:typeof page)=>void;
 vi.spyOn(api.artists,'summary').mockImplementation(()=>new Promise(resolve=>finish=resolve));
 vi.spyOn(api.artists,'update').mockResolvedValue({id:1,monitored:true,videoInventoryStatus:'pending',sourceCollectionQueued:true} as Awaited<ReturnType<typeof api.artists.update>>);
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(<QueryClientProvider client={client}><MemoryRouter><LibraryPage/></MemoryRouter></QueryClientProvider>));
  await act(async()=>{(host.querySelector('input[aria-label="Monitored — Example"]') as HTMLInputElement).click();});
  await vi.waitFor(()=>expect(client.getMutationCache().getAll().at(-1)?.state.status).toBe('success'));
  expect((host.querySelector('input[aria-label="Monitored — Example"]') as HTMLInputElement).checked).toBe(true);
  expect(api.artists.summary).toHaveBeenCalled();
 }finally{await act(async()=>{finish?.(page);root.unmount();});client.clear();host.remove();vi.restoreAllMocks();}
});

it('aborts an obsolete filter request when the query changes',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
 for(const key of ['rootFolders','qualityProfiles'])client.setQueryData([key],[]);
 client.setQueryData(['genreStats',1],{totalArtists:0,artistsWithGenre:0,genres:[]});
 const signals:AbortSignal[]=[];
 vi.spyOn(api.artists,'summary').mockImplementation((_options,signal)=>{signals.push(signal!);return new Promise(()=>{});});
 function Screen(){const navigate=useNavigate();return <><button onClick={()=>navigate('/?q=Second')}>Change filter</button><LibraryPage/></>;}
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/?q=First']}><Screen/></MemoryRouter></QueryClientProvider>));
  expect(signals).toHaveLength(1);
  await act(async()=>{host.querySelector('button')!.click();});
  expect(signals).toHaveLength(2);expect(signals[0].aborted).toBe(true);expect(signals[1].aborted).toBe(false);
 }finally{await act(async()=>root.unmount());client.clear();host.remove();vi.restoreAllMocks();}
});
