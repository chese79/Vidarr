import { prisma } from '/app/apps/server/dist/db/client.js';
import { readFile,writeFile,access } from 'node:fs/promises';
import { snapshot,restore,testPreferences,fields } from './selection-preferences.mjs';
const statePath='/evidence/selection-test-state.json';
const flagPath='/evidence/restore-now';
const command=process.argv[2];
if(!['run','restore'].includes(command))throw new Error('Use run or restore');
const c=await prisma.libraryConnector.findFirst({where:{type:'jellyfin'}});
if(c?.host?.replace(/\/$/,'')!=='http://192.168.0.8:8096'||!c.userId||!c.authToken)throw new Error('Production connector identity mismatch');
async function api(route,body) {
  const r=await fetch(c.host+route,{method:body===undefined?'GET':'POST',headers:{Authorization:`MediaBrowser Token="${c.authToken}"`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error(`Jellyfin request returned HTTP ${r.status}`);
  const text=await r.text();return text?JSON.parse(text):null;
}
const emit=event=>console.log(JSON.stringify(event));
const save=state=>writeFile(statePath,JSON.stringify(state,null,2));
async function identity(state) {
  const server=await api('/System/Info');
  if(server.Id!==state.serverId||state.userId!==c.userId)throw new Error('Restore target identity mismatch');
  return api(`/Users/${c.userId}`);
}
async function restoreState(state) {
  const user=await identity(state);
  const configuration=restore(user.Configuration,state.original);
  await api(`/Users/${c.userId}/Configuration`,configuration);
  const check=await api(`/Users/${c.userId}`);
  for(const key of fields)if(state.original[key].present?check.Configuration[key]!==state.original[key].value:Object.hasOwn(check.Configuration,key))throw new Error('Restore verification failed');
  state.phase='restored';state.restoredAt=new Date().toISOString();await save(state);emit({phase:'restored',defaults:state.original});
}
let state;
try {
  if(command==='restore') {state=JSON.parse(await readFile(statePath,'utf8'));await restoreState(state);}
  else {
    const baseline=JSON.parse(await readFile('/audit/.lab/production-baseline.json','utf8'));
    const user=await identity({serverId:baseline.serverId,userId:baseline.userId});
    state={serverId:baseline.serverId,userId:baseline.userId,original:snapshot(user.Configuration),phase:'armed',startedAt:new Date().toISOString(),restoreAt:new Date(Date.now()+5*60000).toISOString()};
    // Save recovery material before the first mutation; refuse replacing an existing run.
    await writeFile(statePath,JSON.stringify(state,null,2),{flag:'wx'});
    try {
      await api(`/Users/${c.userId}/Configuration`,{...user.Configuration,...testPreferences});
      const check=await api(`/Users/${c.userId}`);
      if(fields.some(key=>check.Configuration[key]!==testPreferences[key]))throw new Error('Temporary defaults did not apply');
      state.phase='active';await save(state);emit({phase:'active',restoreAt:state.restoreAt});
      const profile={Name:'MTV automatic-selection test',DirectPlayProfiles:[{Container:'mp4,mkv',Type:'Video',VideoCodec:'h264',AudioCodec:'aac'}],TranscodingProfiles:[{Container:'ts',Type:'Video',VideoCodec:'h264',AudioCodec:'aac',Context:'Streaming',Protocol:'hls'}],SubtitleProfiles:['vtt','srt','ttml','sub'].map(Format=>({Format,Method:'External'}))};
      for(const id of ['23295dbc21f73eeb7e5425d332cb578e','b63dd6d2511244b41836d32fa6114f0e']) {
        const info=await api(`/Items/${id}/PlaybackInfo`,{UserId:c.userId,DeviceProfile:profile,EnableDirectPlay:true,EnableDirectStream:true,EnableTranscoding:true});
        const source=info.MediaSources[0];emit({phase:'preselection',itemId:id,index:source.DefaultSubtitleStreamIndex,direct:source.SupportsDirectPlay,burnInOffered:source.TranscodingUrl?.includes('SubtitleMethod=Encode')??false});
      }
      let previous;
      while(Date.now()<Date.parse(state.restoreAt)) {
        try{await access(flagPath);break;}catch(error){if(error.code!=='ENOENT')throw error;}
        const sessions=await api('/Sessions');
        const s=sessions.find(x=>x.Client==='Jellyfin Roku'&&x.UserId===c.userId);
        const observed={itemId:s?.NowPlayingItem?.Id??null,name:s?.NowPlayingItem?.Name??null,method:s?.PlayState?.PlayMethod??null,paused:s?.PlayState?.IsPaused??null,positionSeconds:(s?.PlayState?.PositionTicks??0)/10000000,videoCodec:s?.TranscodingInfo?.VideoCodec??null};
        const changed=JSON.stringify({...observed,positionSeconds:undefined});
        if(changed!==previous){emit({phase:'roku',...observed});previous=changed;}
        await new Promise(resolve=>setTimeout(resolve,2000));
      }
    } finally {await restoreState(state);}
  }
} catch(error) {emit({phase:'error',message:error.message,restoreRequired:state?.phase!=='restored'});process.exitCode=1;}
finally {await prisma.$disconnect();}
