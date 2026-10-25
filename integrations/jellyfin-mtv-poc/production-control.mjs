// Operator-only production fixture deployment. Credentials remain inside Vidarr's container.
import { prisma } from '/app/apps/server/dist/db/client.js';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertBaseline,assertTestPath,normalizePath } from './production-guards.mjs';
const action=process.argv[2];
if(!['inspect','deploy','verify','probe','diagnostic','probe-embedded'].includes(action))throw new Error('Use inspect, deploy, verify, probe, diagnostic or probe-embedded');
const config=await prisma.libraryConnector.findFirst({where:{type:'jellyfin'}});
if(config?.host?.replace(/\/$/,'')!=='http://192.168.0.8:8096'||!config.authToken||!config.userId)throw new Error('Expected production connector not found');
const name='MTV Overlay Test';
const mediaPath=String.raw`C:\Users\Wigwam\Documents\Codex\Vidarr\integrations\jellyfin-mtv-poc\.lab\production-media`;
const headers={Authorization:`MediaBrowser Token="${config.authToken}"`,'Content-Type':'application/json'};
async function api(route,body) {
  const r=await fetch(config.host+route,{headers,method:body===undefined?'GET':'POST',body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw new Error(`${body===undefined?'GET':'POST'} ${route.split('?')[0]} returned HTTP ${r.status}`);
  const text=await r.text();return text?JSON.parse(text):null;
}
try {
  const info=await api('/System/Info');
  const user=await api(`/Users/${config.userId}`);
  const libraries=await api('/Library/VirtualFolders');
  if(action==='inspect') {
    const playlists=await api(`/Users/${user.Id}/Items?IncludeItemTypes=Playlist&Recursive=true&Limit=1000`);
    console.log(JSON.stringify({serverId:info.Id,version:info.Version,userId:user.Id,userConfiguration:user.Configuration,
      libraries:libraries.map(x=>({id:x.ItemId,name:x.Name,locations:x.Locations})),playlistIds:playlists.Items.map(x=>x.Id),mediaPath}));
  } else {
    const baseline=JSON.parse(await readFile(fileURLToPath(new URL('./.lab/production-baseline.json',import.meta.url)),'utf8'));
    assertBaseline(baseline,info,user,libraries,mediaPath);
    const originalPlaylists=await api(`/Users/${user.Id}/Items?IncludeItemTypes=Playlist&Recursive=true&Limit=1000`);
    if(!baseline.playlistIds.every(id=>originalPlaylists.Items.some(x=>x.Id===id)))throw new Error('Original playlist is missing; review before proceeding');
    let library=libraries.find(x=>x.Name===name);
    assertTestPath(library,mediaPath);
    if(!library&&action==='deploy') {
      if(process.env.MTV_PRODUCTION_OVERLAY_TEST!=='1')throw new Error('Explicit deployment flag required');
      await api(`/Library/VirtualFolders?name=${encodeURIComponent(name)}&collectionType=musicvideos&refreshLibrary=false`,{LibraryOptions:{PathInfos:[{Path:mediaPath}],EnableRealtimeMonitor:false,EnableInternetProviders:false,MetadataSavers:[]}});
      library=(await api('/Library/VirtualFolders')).find(x=>x.Name===name);
      if(library?.ItemId)await api(`/Items/${library.ItemId}/Refresh?Recursive=true&MetadataRefreshMode=Default&ImageRefreshMode=Default&ReplaceAllMetadata=false&ReplaceAllImages=false`,{});
    }
    if(!library?.ItemId)throw new Error('Test library was not created');
    const body=await api(`/Users/${user.Id}/Items?ParentId=${library.ItemId}&Recursive=true&IncludeItemTypes=MusicVideo&Fields=MediaSources,Path&Limit=10`);
    const scoped=body.Items.filter(x=>x.Path&&normalizePath(path.win32.dirname(x.Path))===normalizePath(mediaPath));
    const allowed=['mtv test 1.mp4','mtv test 2.mp4','embedded ass diagnostic.mkv'];
    if(scoped.some(x=>!allowed.includes(path.win32.basename(x.Path).toLowerCase())))throw new Error('Unexpected media in the test library');
    const diagnostic=scoped.find(x=>path.win32.basename(x.Path).toLowerCase()==='embedded ass diagnostic.mkv');
    const items=scoped.filter(x=>x!==diagnostic).sort((a,b)=>a.Name.localeCompare(b.Name));
    let playlistId=null;
    if(items.length===2) {
      for(const item of items)if(!item.MediaSources?.[0]?.MediaStreams?.some(x=>x.Type==='Subtitle'&&x.Codec==='ass'))throw new Error('Test ASS track not yet discovered');
      const ps=await api(`/Users/${user.Id}/Items?IncludeItemTypes=Playlist&Recursive=true&SearchTerm=${encodeURIComponent(name)}&Limit=100`);
      const playlist=ps.Items.find(x=>x.Name===name);
      if(playlist){
        const contents=await api(`/Playlists/${playlist.Id}/Items?UserId=${user.Id}`);
        if(JSON.stringify(contents.Items.map(x=>x.Id))!==JSON.stringify(items.map(x=>x.Id)))throw new Error('Test playlist name collides with other content');
        playlistId=playlist.Id;
      } else if(action==='deploy') {
        if(process.env.MTV_PRODUCTION_OVERLAY_TEST!=='1')throw new Error('Explicit deployment flag required');
        playlistId=(await api('/Playlists',{Name:name,Ids:items.map(x=>x.Id),UserId:user.Id,MediaType:'Video'})).Id;
      }
    }
    console.log(JSON.stringify({serverVersion:info.Version,libraryId:library.ItemId,name,items:items.map(x=>({id:x.Id,name:x.Name,
      subtitleIndex:x.MediaSources[0].MediaStreams.find(x=>x.Type==='Subtitle'&&x.Codec==='ass')?.Index})),playlistId,scanning:items.length<2,
      originalLibrariesPreserved:true,originalPlaylistsPreserved:true,userPreferencesPreserved:true,subtitleMode:user.Configuration?.SubtitleMode,pluginInstalled:false}));
    if(action==='diagnostic') {
      if(process.env.MTV_PRODUCTION_OVERLAY_TEST!=='1')throw new Error('Explicit deployment flag required');
      if(!diagnostic?.MediaSources?.[0]?.MediaStreams?.some(x=>x.Type==='Subtitle'&&x.Codec==='ass'&&x.Index===2)) {
        await api(`/Items/${library.ItemId}/Refresh?Recursive=true&MetadataRefreshMode=Default&ImageRefreshMode=Default&ReplaceAllMetadata=false&ReplaceAllImages=false`,{});
        console.log(JSON.stringify({diagnosticScanning:true}));
      } else {
        const label='MTV Embedded ASS Test';
        const ps=await api(`/Users/${user.Id}/Items?IncludeItemTypes=Playlist&Recursive=true&SearchTerm=${encodeURIComponent(label)}&Limit=100`);
        let pl=ps.Items.find(x=>x.Name===label);
        if(pl){const content=await api(`/Playlists/${pl.Id}/Items?UserId=${user.Id}`);if(content.Items.length!==1||content.Items[0].Id!==diagnostic.Id)throw new Error('Diagnostic playlist name collision');}
        else pl=await api('/Playlists',{Name:label,Ids:[diagnostic.Id],UserId:user.Id,MediaType:'Video'});
        console.log(JSON.stringify({diagnosticReady:true,name:label,itemId:diagnostic.Id,playlistId:pl.Id,subtitleIndex:2,videoReencoded:false,physicalRokuVerified:false}));
      }
    }
    if(action==='probe'||action==='probe-embedded') {
      if(items.length!==2)throw new Error('Both test clips must be scanned before probing');
      const item=action==='probe-embedded'?diagnostic:items[0];
      if(!item?.MediaSources?.[0])throw new Error('Requested diagnostic is not ready');
      const source=item.MediaSources[0];
      const subtitle=source.MediaStreams.find(x=>x.Type==='Subtitle'&&x.Codec==='ass');
      const info=await api(`/Items/${item.Id}/PlaybackInfo`,{UserId:user.Id,MediaSourceId:source.Id,SubtitleStreamIndex:subtitle.Index,EnableDirectPlay:true,EnableDirectStream:true,EnableTranscoding:true,
        DeviceProfile:{Name:'MTV production subtitle test',MaxStreamingBitrate:20000000,DirectPlayProfiles:[{Container:'mp4,mkv',Type:'Video',VideoCodec:'h264',AudioCodec:'aac'}],
          TranscodingProfiles:[{Container:'ts',Type:'Video',VideoCodec:'h264',AudioCodec:'aac',Context:'Streaming',Protocol:'hls',MaxAudioChannels:'2'}],
          SubtitleProfiles:['vtt','srt','ttml','sub'].map(Format=>({Format,Method:'External'}))}});
      const playback=info.MediaSources[0];
      if(!playback.TranscodingUrl||!/[?&]SubtitleMethod=Encode/i.test(playback.TranscodingUrl))throw new Error('Production did not offer subtitle burn-in');
      async function media(relative) {
        const url=new URL(relative,config.host);
        if(url.origin!==new URL(config.host).origin)throw new Error('Media URL leaves the verified server');
        const response=await fetch(url,{headers,signal:AbortSignal.timeout(60000)});
        if(!response.ok)throw new Error(`Production media returned HTTP ${response.status}`);
        return response;
      }
      let url=new URL(playback.TranscodingUrl,config.host),manifest=await(await media(url)).text();
      if(manifest.includes('#EXT-X-STREAM-INF')){url=new URL(manifest.split(/\r?\n/).find(x=>x&&!x.startsWith('#')),url);manifest=await(await media(url)).text();}
      const segment=manifest.split(/\r?\n/).find(x=>x&&!x.startsWith('#'));
      if(!segment)throw new Error('Production returned no HLS segments');
      const bytes=new Uint8Array(await(await media(new URL(segment,url))).arrayBuffer());
      await writeFile(action==='probe-embedded'?'/evidence/production-embedded-intro.ts':'/evidence/production-intro.ts',bytes);
      console.log(JSON.stringify({productionBurnInVerified:true,bytes:bytes.length,subtitleIndex:subtitle.Index,rokuPlaybackVerified:false,userPreferencesChanged:false}));
    }
  }
} finally {await prisma.$disconnect();}
