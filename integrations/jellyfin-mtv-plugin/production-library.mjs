// Operator-only rollout to the explicitly authorized production Music Videos library.
// Run inside Vidarr; connector credentials never leave that container.
import {prisma} from '/app/apps/server/dist/db/client.js';
import {readFile,writeFile} from 'node:fs/promises';
const [action,baselineFile,stateFile]=process.argv.slice(2);
if(!['prepare','start','resume-index','status','activate','verify'].includes(action))throw Error('Use prepare, start, resume-index, status, activate or verify');
if(['start','resume-index','activate'].includes(action)&&process.env.MTV_PRODUCTION_LIBRARY!=='1')throw Error('Explicit rollout flag required');
const plugin='c9298ca5-50d5-4be6-8771-eae3b2bb8b86',real='e2c00f297a5f80af390f52f72e782147',test='8269f15780c024f9921fd920be84a803';
const baseline=JSON.parse(await readFile(baselineFile,'utf8'));
const compact=s=>s.replaceAll('-','').toLowerCase();
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
try{
 const c=await prisma.libraryConnector.findFirst({where:{type:'jellyfin'}});
 if(c?.host!=='http://192.168.0.8:8096'||c.userId!==baseline.userId)throw Error('Unexpected connector');
 async function api(route,body){const r=await fetch(c.host+route,{method:body===undefined?'GET':'POST',headers:{Authorization:`MediaBrowser Token="${c.authToken}"`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(route.split('?')[0]+' HTTP '+r.status);const t=await r.text();return t?JSON.parse(t):null;}
 async function preserved(){const info=await api('/System/Info');if(info.Id!==baseline.serverId||info.Version!=='12.3.0')throw Error('Server identity/version mismatch');const u=await api('/Users/'+c.userId);if(!same(u.Configuration,baseline.userConfiguration))throw Error('User configuration changed since baseline');const roots=await api('/Library/VirtualFolders');for(const old of baseline.libraries)if(!roots.some(x=>x.ItemId===old.id&&same(x.Locations,old.locations)))throw Error('Original library changed');const root=roots.find(x=>x.ItemId===real);if(root?.CollectionType!=='musicvideos'||root.Locations?.length!==1||root.Locations[0].toLowerCase()!==String.raw`d:\media\libraries\music videos`)throw Error('Unexpected real music-video scope');const ps=await api(`/Users/${c.userId}/Items?IncludeItemTypes=Playlist&Recursive=true&Limit=1000`);if(!baseline.playlistIds.every(id=>ps.Items.some(x=>x.Id===id)))throw Error('Original playlist missing');}
 async function inventory(){const all=[];for(const root of [real,test])for(let offset=0;;offset+=100){const page=await api(`/Users/${c.userId}/Items?ParentId=${root}&IncludeItemTypes=MusicVideo&Recursive=true&Fields=Path,MediaSources&StartIndex=${offset}&Limit=100`);all.push(...page.Items.map(x=>({...x,RolloutLibrary:root})));if(offset+page.Items.length>=page.TotalRecordCount)break;if(!page.Items.length)throw Error('Incomplete inventory');}return all;}
 const configRoute=`/Plugins/${plugin}/Configuration`;
 if(action==='status'){console.log(JSON.stringify(await api('/MtvOverlay/Status')));}
 else{
  await preserved();
  if(['resume-index','activate','verify'].includes(action)){const loaded=(await api('/Plugins')).find(x=>compact(x.Id)===compact(plugin));if(loaded?.Version!=='0.1.2.0'||loaded.Status!=='Active')throw Error('Verified indexing release 0.1.2.0 must be active');}
  let cfg=await api(configRoute);
  if(action==='prepare'){
   if(cfg.LibraryIds.length!==1||compact(cfg.LibraryIds[0])!==test)throw Error('Expected test-only scope');
   const items=await inventory();
   if(items.filter(x=>x.RolloutLibrary===real).length!==4269)throw Error('Inventory count changed; review rollout');
   const state={serverId:baseline.serverId,beforeConfiguration:cfg,items:items.map(x=>({Id:x.Id,Name:x.Name,Path:x.Path,RunTimeTicks:x.RunTimeTicks,RolloutLibrary:x.RolloutLibrary}))};
   await writeFile(stateFile,JSON.stringify(state,null,2),{flag:'wx'});
   console.log(JSON.stringify({snapshotSaved:true,total:items.length,real:4269,missingDuration:items.filter(x=>!x.RunTimeTicks).map(x=>x.Name)}));
  }else{
   const state=JSON.parse(await readFile(stateFile,'utf8'));
   if(state.serverId!==baseline.serverId)throw Error('Snapshot server mismatch');
   const desired={...state.beforeConfiguration,Enabled:false,LibraryIds:[test,real]};
   if(action==='start'||action==='resume-index'){
    if(!same(cfg,action==='start'?state.beforeConfiguration:desired))throw Error('Configuration changed after snapshot');
    if((await api('/Sessions')).some(x=>x.NowPlayingItem))throw Error('Playback active; generation deferred');
    if((await api('/MtvOverlay/Status')).Running)throw Error('Generation already running');
    await api(configRoute,desired);await api('/MtvOverlay/Generate',{});
    console.log(JSON.stringify({started:true,activation:false,total:state.items.length}));
   }else{
    const status=await api('/MtvOverlay/Status');
    const items=await inventory(),valid=items.filter(x=>x.RunTimeTicks>0),indexed=valid.filter(x=>x.MediaSources?.[0]?.MediaStreams?.some(s=>s.IsExternal&&s.Path?.endsWith('.mtv-info.eng.ass')));
    if(status.Running||status.Processed!==state.items.length||status.Created+status.Updated+status.Unchanged!==valid.length||indexed.length!==valid.length)throw Error(`Generation/indexing incomplete: ${JSON.stringify({status,indexed:indexed.length,expected:valid.length})}`);
    if(!same(items.map(x=>x.Id).sort(),state.items.map(x=>x.Id).sort()))throw Error('Inventory identity changed');
    if(action==='activate'){
     if(!same(cfg,desired))throw Error('Configuration changed during generation');
     await api(configRoute,{...desired,Enabled:true});cfg=await api(configRoute);
    }
    if(!cfg.Enabled||cfg.LibraryIds.length!==2||!cfg.LibraryIds.some(x=>compact(x)===real)||!cfg.LibraryIds.some(x=>compact(x)===test))throw Error('Unexpected enabled scope');
    const profile={Name:'MTV library rollout verification',MaxStreamingBitrate:20000000,DirectPlayProfiles:[{Container:'mp4,mkv',Type:'Video',VideoCodec:'h264',AudioCodec:'aac'}],TranscodingProfiles:[{Container:'ts',Type:'Video',VideoCodec:'h264',AudioCodec:'aac',Context:'Streaming',Protocol:'hls'}],SubtitleProfiles:[{Format:'srt',Method:'External'}]};
    for(const item of [valid[0],valid[Math.floor(valid.length/2)],valid.at(-1)])for(const source of [true,false]){
     const owned=item.MediaSources[0].MediaStreams.find(s=>s.Path?.endsWith('.mtv-info.eng.ass'));
     const playback=(await api(`/Items/${item.Id}/PlaybackInfo`,{UserId:c.userId,DeviceProfile:profile,...(source?{MediaSourceId:item.Id,SubtitleStreamIndex:-1}:{})})).MediaSources[0];
     if(playback.DefaultSubtitleStreamIndex!==owned.Index||!playback.TranscodingUrl?.includes('SubtitleMethod=Encode'))throw Error('Automatic selection/burn-in sample failed');
    }
    for(const [root,type] of [['f137a2dd21bbc1b99aa5c0f6bf02a805','Movie'],['a656b907eb3a73532e40e44b968d0225','Episode']]){
     const item=(await api(`/Users/${c.userId}/Items?ParentId=${root}&IncludeItemTypes=${type}&Recursive=true&Limit=1`)).Items[0];
     if(!item)throw Error(type+' negative control unavailable');
     const playback=(await api(`/Items/${item.Id}/PlaybackInfo`,{UserId:c.userId,DeviceProfile:profile,SubtitleStreamIndex:-1})).MediaSources[0];
     if(playback.DefaultSubtitleStreamIndex>=0||playback.TranscodingUrl?.includes('SubtitleMethod=Encode'))throw Error(type+' negative control received subtitle activation');
    }
    await preserved();
    console.log(JSON.stringify({enabledLibraries:['MTV Overlay Test','Music Videos'],realMusicVideos:4269,indexedReal:indexed.filter(x=>x.RolloutLibrary===real).length,generation:status,skipped:items.filter(x=>!x.RunTimeTicks).map(x=>({name:x.Name,reason:'No scanned duration'})),sampleNegotiation:'explicit and omitted source ID pass',movieEpisodeControls:'no automatic overlay',userDefaultsLibrariesPlaylists:'preserved'}));
   }
  }
 }
}finally{await prisma.$disconnect();}
