import {readFile,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
const base='http://host.docker.internal:18096',id='c9298ca5-50d5-4be6-8771-eae3b2bb8b86';
const credentials=JSON.parse(await readFile('/poc/.lab/credentials.json','utf8'));
const native=String.raw`C:\Users\Wigwam\Documents\Codex\Vidarr\integrations\jellyfin-mtv-poc\.lab`;
let token;
async function api(route,body,anonymous=false){const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Authorization:anonymous?'':`MediaBrowser Client="MTV Plugin Smoke", Device="Isolated lab", DeviceId="mtv-plugin-smoke", Version="0.1.0"${token?`, Token="${token}"`:''}`},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error(`${route.split('?')[0]} HTTP ${r.status}`);const t=await r.text();return t?JSON.parse(t):null;}
function check(condition,message){if(!condition)throw new Error(message);console.log('PASS '+message);}
const publicInfo=await api('/System/Info/Public');check(publicInfo.Id===credentials.serverId,'isolated lab identity matches');
const auth=await api('/Users/AuthenticateByName',{Username:credentials.username,Pw:credentials.password});token=auth.AccessToken;
const original=auth.User.Configuration;
const report={version:publicInfo.Version,productionModified:false,results:{}};
const sourceFiles=['MTV Test 1.mp4','MTV Test 2.mp4','MTV Test 1.eng.ass','MTV Test 2.eng.ass','MTV Native Index Control.mp4','MTV Native Index Control.eng.srt'];
const hashes=await Promise.all(sourceFiles.map(async f=>createHash('sha256').update(await readFile('/poc/.lab/media/'+f)).digest('hex')));
const profile={Name:'MTV plugin integration',MaxStreamingBitrate:20000000,DirectPlayProfiles:[{Container:'mp4,mkv',Type:'Video',VideoCodec:'h264',AudioCodec:'aac'}],TranscodingProfiles:[{Container:'ts',Type:'Video',VideoCodec:'h264',AudioCodec:'aac',Context:'Streaming',Protocol:'hls'}],SubtitleProfiles:['srt','vtt','ttml','sub'].map(Format=>({Format,Method:'External'}))};
const playback=item=>api(`/Items/${item.Id}/PlaybackInfo`,{UserId:auth.User.Id,MediaSourceId:item.Id,SubtitleStreamIndex:-1,EnableDirectPlay:true,EnableDirectStream:true,EnableTranscoding:true,DeviceProfile:profile});
async function items(root,type){return(await api(`/Users/${auth.User.Id}/Items?ParentId=${root}&Recursive=true&IncludeItemTypes=${type}&Fields=MediaSources,Path&Limit=10`)).Items;}
async function waitItems(root,type){for(let i=0;i<120;i++){const found=await items(root,type);if(found.length&&found.every(x=>x.MediaSources?.[0]?.MediaStreams?.length))return found;await new Promise(r=>setTimeout(r,1000));}throw new Error('Lab media scan did not finish: '+type);}
try{
 const anonymous=await fetch(base+'/MtvOverlay/Status');check([401,403].includes(anonymous.status),'plugin controls require authentication');
 const viewerName='mtv-viewer-'+randomUUID().slice(0,8),viewerPassword=randomUUID();
 const viewer=await api('/Users/New',{Name:viewerName});
 await api(`/Users/${viewer.Id}/Password`,{NewPw:viewerPassword,ResetPassword:false});
 const viewerSession=await api('/Users/AuthenticateByName',{Username:viewerName,Pw:viewerPassword});
 const forbidden=await fetch(base+'/MtvOverlay/Status',{headers:{Authorization:`MediaBrowser Token="${viewerSession.AccessToken}"`}});
 check(forbidden.status===403,'ordinary users cannot run plugin controls');
 await api(`/Users/${viewer.Id}/Policy`,{...viewer.Policy,IsDisabled:true});
 const plugins=await api('/Plugins');check(plugins.some(x=>x.Id?.replaceAll('-','')===id.replaceAll('-','')),'plugin is discovered');
 const pluginRecord=plugins.find(x=>x.Id?.replaceAll('-','')===id.replaceAll('-',''));const metadata=JSON.parse(await readFile('/plugin/meta.json','utf8'));check(pluginRecord.Version===metadata.version,'built plugin version is active');report.pluginVersion=pluginRecord.Version;
 let roots=await api('/Library/VirtualFolders');const music=roots.find(x=>x.Name==='MTV Overlay Lab');check(!!music,'isolated music-video library exists');
 for(const [name,type,folder] of [['MTV Negative Movies','movies','negative-movies'],['MTV Negative TV','tvshows','negative-tv']])if(!roots.some(x=>x.Name===name))await api(`/Library/VirtualFolders?name=${encodeURIComponent(name)}&collectionType=${type}&refreshLibrary=false`,{LibraryOptions:{PathInfos:[{Path:native+'\\'+folder}],EnableInternetProviders:false,EnableRealtimeMonitor:false,MetadataSavers:[]}});
 roots=await api('/Library/VirtualFolders');const movies=roots.find(x=>x.Name==='MTV Negative Movies'),tv=roots.find(x=>x.Name==='MTV Negative TV');
 for(const root of [movies,tv])await api(`/Items/${root.ItemId}/Refresh?Recursive=true&MetadataRefreshMode=Default&ImageRefreshMode=Default`,{});
 await api(`/Users/${auth.User.Id}/Configuration`,{...original,SubtitleMode:'None',SubtitleLanguagePreference:''});
 const configuration={Enabled:false,LibraryIds:[music.ItemId],IntroSeconds:6,OutroSeconds:6,FontSize:28};
 await api(`/Plugins/${id}/Configuration`,configuration);
 await api(`/Items/${music.ItemId}/Refresh?Recursive=true&MetadataRefreshMode=Default&ImageRefreshMode=None`,{});
 let fixtureCount=0;for(let i=0;i<120;i++){fixtureCount=(await items(music.ItemId,'MusicVideo')).length;if(fixtureCount>=3)break;await new Promise(r=>setTimeout(r,500));}
 check(fixtureCount>=3,'fresh native-index control fixture is scanned');
 const videos=await waitItems(music.ItemId,'MusicVideo');
 const before=(await playback(videos[0])).MediaSources[0];check(before.DefaultSubtitleStreamIndex==null||before.DefaultSubtitleStreamIndex<0,'disabled plugin preserves subtitle-off music-video playback');
 await api('/MtvOverlay/Generate',{});
 let status;for(let i=0;i<120;i++){status=await api('/MtvOverlay/Status');if(!status.Running)break;await new Promise(r=>setTimeout(r,500));}
 check(!status.Running&&status.Errors.length===0,'generation completes without errors');
 check(status.Processed===videos.length,'generation covers only selected music videos');
 let prepared;
 for(let i=0;i<120;i++){prepared=await items(music.ItemId,'MusicVideo');if(prepared.every(x=>x.MediaSources[0].MediaStreams.some(s=>s.IsExternal&&s.Path?.endsWith('.mtv-info.eng.ass'))))break;await new Promise(r=>setTimeout(r,1000));}
 check(prepared.every(x=>x.MediaSources[0].MediaStreams.some(s=>s.IsExternal&&s.Path?.endsWith('.mtv-info.eng.ass'))),'owned tracks are indexed');
 for(const originalVideo of videos){const now=prepared.find(x=>x.Id===originalVideo.Id).MediaSources[0].MediaStreams;for(const old of originalVideo.MediaSources[0].MediaStreams)check(now.some(x=>x.Index===old.Index&&x.Type===old.Type&&x.Codec===old.Codec&&x.Path===old.Path),'existing media stream identity and index preserved');}
 await api(`/Plugins/${id}/Configuration`,{...configuration,Enabled:true});
 for(const video of prepared){const owned=video.MediaSources[0].MediaStreams.find(s=>s.Path?.endsWith('.mtv-info.eng.ass'));const p=(await playback(video)).MediaSources[0];check(p.DefaultSubtitleStreamIndex===owned.Index,'music video automatically selects the owned info track');check(!p.SupportsDirectPlay&&p.TranscodingUrl?.includes('SubtitleMethod=Encode'),'music-video playback offers burn-in despite user subtitle mode None');}
 for(const [root,type] of [[movies,'Movie'],[tv,'Episode']]){const found=await waitItems(root.ItemId,type);const p=(await playback(found[0])).MediaSources[0];check(p.DefaultSubtitleStreamIndex==null||p.DefaultSubtitleStreamIndex<0,type+' remains subtitle-off');check(!p.TranscodingUrl?.includes('SubtitleMethod=Encode'),type+' receives no automatic overlay burn-in');report.results[type]='unchanged';}
 // Web omits both source ID and subtitle selection; exercise that distinct server path too.
 const webOwned=prepared[0].MediaSources[0].MediaStreams.find(s=>s.Path?.endsWith('.mtv-info.eng.ass'));
 const webPlayback=(await api(`/Items/${prepared[0].Id}/PlaybackInfo`,{UserId:auth.User.Id,IsPlayback:true,AutoOpenLiveStream:true,DeviceProfile:profile})).MediaSources[0];
 check(webPlayback.DefaultSubtitleStreamIndex===webOwned.Index,'Web-style omitted source ID automatically selects owned track');
 check(!webPlayback.SupportsDirectPlay&&webPlayback.TranscodingUrl?.includes('SubtitleMethod=Encode'),'Web-style omitted source ID offers burn-in when required');
 const current=await api(`/Users/${auth.User.Id}`);check(current.Configuration.SubtitleMode==='None'&&current.Configuration.SubtitleLanguagePreference==='','plugin does not change user subtitle defaults');
 await api(`/Plugins/${id}/Configuration`,configuration);const disabled=(await playback(prepared[0])).MediaSources[0];check(disabled.DefaultSubtitleStreamIndex==null||disabled.DefaultSubtitleStreamIndex<0,'disabling restores normal playback negotiation');
 const after=await Promise.all(sourceFiles.map(async f=>createHash('sha256').update(await readFile('/poc/.lab/media/'+f)).digest('hex')));check(JSON.stringify(after)===JSON.stringify(hashes),'original video and foreign ASS bytes preserved');
 report.results.musicVideo='automatic-owned-track';report.results.defaults='unchanged';report.results.sourceBytes='preserved';report.results.disable='normal-playback';
 await writeFile('/artifacts/lab-smoke-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await api(`/Users/${auth.User.Id}/Configuration`,original);try{const cfg=await api(`/Plugins/${id}/Configuration`);await api(`/Plugins/${id}/Configuration`,{...cfg,Enabled:false});}catch{} }
