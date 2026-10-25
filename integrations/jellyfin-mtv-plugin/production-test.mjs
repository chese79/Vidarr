// Operator-only bounded production test. Run inside Vidarr; never export connector credentials.
import {prisma} from '/app/apps/server/dist/db/client.js';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const plugin='c9298ca5-50d5-4be6-8771-eae3b2bb8b86';
const action=process.argv[2];
if(!['enable-test','verify','disable'].includes(action))throw Error('Use enable-test, verify or disable');
if(action!=='verify'&&process.env.MTV_PRODUCTION_OVERLAY_TEST!=='1')throw Error('Explicit test flag required');
const baseline=JSON.parse(await readFile(process.argv[3],'utf8'));
const normalize=p=>path.win32.normalize(p).toLowerCase();
const compact=s=>s.replaceAll('-','').toLowerCase();
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try {
 const c=await prisma.libraryConnector.findFirst({where:{type:'jellyfin'}});
 if(c?.host!=='http://192.168.0.8:8096'||!c.authToken||c.userId!==baseline.userId)throw Error('Unexpected connector');
 async function api(route,body){const r=await fetch(c.host+route,{method:body===undefined?'GET':'POST',headers:{Authorization:`MediaBrowser Token="${c.authToken}"`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(route.split('?')[0]+' HTTP '+r.status);const t=await r.text();return t?JSON.parse(t):null;}
 async function preserved(){const info=await api('/System/Info');if(info.Id!==baseline.serverId||info.Version!=='12.3.0')throw Error('Server identity/version changed');const user=await api('/Users/'+c.userId);if(JSON.stringify(user.Configuration)!==JSON.stringify(baseline.userConfiguration))throw Error('User defaults differ from baseline');const roots=await api('/Library/VirtualFolders');for(const old of baseline.libraries)if(!roots.some(x=>x.ItemId===old.id&&JSON.stringify(x.Locations)===JSON.stringify(old.locations)))throw Error('Original library changed');const playlists=await api(`/Users/${c.userId}/Items?IncludeItemTypes=Playlist&Recursive=true&Limit=1000`);if(!baseline.playlistIds.every(id=>playlists.Items.some(x=>x.Id===id)))throw Error('Original playlist missing');return roots;}
 const roots=await preserved();
 const library=roots.find(x=>x.Name==='MTV Overlay Test');
 if(library?.ItemId!=='8269f15780c024f9921fd920be84a803'||library.Locations.length!==1||normalize(library.Locations[0])!==normalize(baseline.mediaPath))throw Error('Test library identity/path mismatch');
 async function items(){return(await api(`/Users/${c.userId}/Items?ParentId=${library.ItemId}&Recursive=true&IncludeItemTypes=MusicVideo&Fields=MediaSources,Path&Limit=10`)).Items;}
 const videos=await items();
 const names=['mtv test 1.mp4','mtv test 2.mp4','embedded ass diagnostic.mkv'];
 if(videos.length!==3||videos.some(x=>normalize(path.win32.dirname(x.Path))!==normalize(baseline.mediaPath)||!names.includes(path.win32.basename(x.Path).toLowerCase())))throw Error('Unexpected fixture inventory');
 let cfg=await api(`/Plugins/${plugin}/Configuration`);
 if(action==='disable'){await api(`/Plugins/${plugin}/Configuration`,{...cfg,Enabled:false});console.log(JSON.stringify({disabled:true,userDefaultsPreserved:true}));}
 else {
  if(action==='enable-test'){
   if((await api('/Sessions')).some(x=>x.NowPlayingItem))throw Error('Playback active; configuration deferred');
   if(cfg.Enabled||cfg.LibraryIds.length)throw Error('Existing plugin configuration requires review');
   cfg={...cfg,Enabled:false,LibraryIds:[library.ItemId],IntroSeconds:6,OutroSeconds:6,FontSize:28};
   await api(`/Plugins/${plugin}/Configuration`,cfg);
   await api('/MtvOverlay/Generate',{});
   let status;for(let i=0;i<120;i++){status=await api('/MtvOverlay/Status');if(!status.Running)break;await wait(500);}
   if(status.Running||status.Errors.length||status.Processed!==3)throw Error('Test generation did not complete cleanly');
   let indexed=false;for(let i=0;i<120;i++){if((await items()).every(x=>x.MediaSources?.[0]?.MediaStreams?.some(s=>s.Path?.endsWith('.mtv-info.eng.ass')))){indexed=true;break;}await wait(1000);}
   if(!indexed)throw Error('Generated test tracks not indexed');
   await api(`/Plugins/${plugin}/Configuration`,{...cfg,Enabled:true});
  }
  cfg=await api(`/Plugins/${plugin}/Configuration`);
  if(!cfg.Enabled||cfg.LibraryIds.length!==1||compact(cfg.LibraryIds[0])!==library.ItemId)throw Error('Activation must be limited to test library');
  const profile={Name:'MTV production plugin verification',MaxStreamingBitrate:20000000,DirectPlayProfiles:[{Container:'mp4,mkv',Type:'Video',VideoCodec:'h264',AudioCodec:'aac'}],TranscodingProfiles:[{Container:'ts',Type:'Video',VideoCodec:'h264',AudioCodec:'aac',Context:'Streaming',Protocol:'hls'}],SubtitleProfiles:['srt','vtt','ttml','sub'].map(Format=>({Format,Method:'External'}))};
  const results=[];
  for(const item of await items()){
   const owned=item.MediaSources[0].MediaStreams.find(s=>s.Path?.endsWith('.mtv-info.eng.ass'));
   const playback=(await api(`/Items/${item.Id}/PlaybackInfo`,{UserId:c.userId,MediaSourceId:item.Id,SubtitleStreamIndex:-1,EnableDirectPlay:true,EnableDirectStream:true,EnableTranscoding:true,DeviceProfile:profile})).MediaSources[0];
   if(!owned||playback.DefaultSubtitleStreamIndex!==owned.Index||!playback.TranscodingUrl?.includes('SubtitleMethod=Encode')||playback.SupportsDirectPlay)throw Error('Owned track automatic selection/burn-in offer failed');
   results.push({name:item.Name,automaticTrack:true,burnInOffered:true});
  }
  await preserved();
  console.log(JSON.stringify({serverVersion:'12.3.0',enabledLibrary:'MTV Overlay Test',results,originalLibrariesPreserved:true,originalPlaylistsPreserved:true,userDefaultsPreserved:true,physicalRokuVerified:false}));
 }
}finally{await prisma.$disconnect();}
