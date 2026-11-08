// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
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
