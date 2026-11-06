// Runs only against the isolated native lab and its synthetic music-video fixture.
import { readFile, writeFile, stat, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
const base='http://host.docker.internal:18096';
const credentials=JSON.parse(await readFile('/poc/.lab/credentials.json','utf8'));
let token;
async function request(route,body,auth=token){return fetch(base+route,{method:body===undefined?'GET':'POST',headers:{...(auth===''?{}:{Authorization:`MediaBrowser Client="MTV Enrichment Lab", Device="Synthetic fixture", DeviceId="mtv-enrichment-lab", Version="0.1.4"${auth?`, Token="${auth}"`:''}`}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});}
async function api(route,body){const response=await request(route,body);if(!response.ok)throw Error(`${route.split('?')[0]}: HTTP ${response.status}: ${(await response.text()).slice(0,300)}`);const text=await response.text();return text?JSON.parse(text):null;}
let checks=0;function check(condition,message){if(!condition)throw Error(message);checks++;console.log('PASS '+message);}
const publicInfo=await api('/System/Info/Public');check(publicInfo.Id===credentials.serverId,'isolated server identity');
const session=await api('/Users/AuthenticateByName',{Username:credentials.username,Pw:credentials.password});token=session.AccessToken;
const plugin='c9298ca5-50d5-4be6-8771-eae3b2bb8b86';const configRoute=`/Plugins/${plugin}/Configuration`;const oldConfig=await api(configRoute);
const roots=await api('/Library/VirtualFolders');const music=roots.find(row=>row.Name==='MTV Overlay Lab');
const videos=(await api(`/Users/${session.User.Id}/Items?ParentId=${music.ItemId}&Recursive=true&IncludeItemTypes=MusicVideo&Fields=Path,MediaSources&Limit=20`)).Items;
const fixture=videos.find(row=>path.win32.basename(row.Path)==='MTV Native Index Control.mp4');check(!!fixture,'synthetic fixture selected');
const local=file=>'/poc/.lab/media/'+path.win32.basename(file);
const mediaPath=local(fixture.Path);const mediaBefore=await readFile(mediaPath);const mediaStat=await stat(mediaPath);
const others=await Promise.all(videos.filter(row=>row.Id!==fixture.Id).map(async row=>{const file=row.MediaSources[0].MediaStreams.find(stream=>stream.Path?.endsWith('.mtv-info.eng.ass')).Path;return [local(file),await readFile(local(file))];}));
const route=`/MtvOverlay/Metadata/${fixture.Id}`;const read=()=>api(`${route}?libraryId=${music.ItemId}`);
try{
 await api(configRoute,{...oldConfig,Enabled:true,LibraryIds:[music.ItemId],IntroSeconds:6,OutroSeconds:6});
 const capabilities=await api('/MtvOverlay/Metadata/Capabilities');check(capabilities.MetadataEnrichment===true,'metadata capability exposed');
 check([401,403].includes((await request('/MtvOverlay/Metadata/Capabilities',undefined,'')).status),'anonymous metadata API denied');
 const viewerName='enrichment-viewer-'+randomUUID().slice(0,8);const viewer=await api('/Users/New',{Name:viewerName});const password=randomUUID();
 await api(`/Users/${viewer.Id}/Password`,{NewPw:password,ResetPassword:false});const viewerSession=await api('/Users/AuthenticateByName',{Username:viewerName,Pw:password});
 check((await request(`${route}?libraryId=${music.ItemId}`,undefined,viewerSession.AccessToken)).status===403,'ordinary user metadata API denied');
 await api(`/Users/${viewer.Id}/Policy`,{...viewer.Policy,IsDisabled:true});
 check((await request(`${route}?libraryId=${randomUUID()}`)).status===409,'unselected library denied');
 const movieRoot=roots.find(row=>row.Name==='MTV Negative Movies');const movie=(await api(`/Users/${session.User.Id}/Items?ParentId=${movieRoot.ItemId}&Recursive=true&IncludeItemTypes=Movie&Limit=1`)).Items[0];
 check((await request(`/MtvOverlay/Metadata/${movie.Id}?libraryId=${music.ItemId}`)).status===409,'movie metadata excluded');
 const before=await read();const itemBefore=await api(`/Users/${session.User.Id}/Items/${fixture.Id}`);
 const body={LibraryId:music.ItemId,RequestId:randomUUID(),ExpectedFingerprint:before.Fingerprint,Facts:{album:'Enrichment Album',albumYear:1997,recordLabel:'Fixture Label',directors:['Enrichment Director']},Corrections:['album','albumYear','recordLabel','directors'],Provenance:JSON.stringify({provider:'synthetic lab',verified:true})};
 const after=await api(route,body);check(after.Facts.album==='Enrichment Album'&&after.Facts.albumYear===1997&&after.Facts.recordLabel==='Fixture Label'&&after.Facts.directors.includes('Enrichment Director'),'metadata and explicit album year read back');
 check(after.OverlayValid,'targeted track verified');
 const itemAfter=await api(`/Users/${session.User.Id}/Items/${fixture.Id}`);check(itemBefore.ProductionYear===itemAfter.ProductionYear,'video year preserved');
 const track=itemAfter.MediaSources[0].MediaStreams.find(stream=>stream.Path?.endsWith('.mtv-info.eng.ass')).Path;
 const text=await readFile(local(track),'utf8');check(text.includes('Enrichment Album - 1997')&&text.includes('Fixture Label')&&text.includes('Enrichment Director')&&text.includes('[Fonts]'),'targeted MTV block contains enriched facts and embedded font');
 check((await api(route,body)).Fingerprint===after.Fingerprint,'exact request replay is idempotent');
 check((await request(route,{...body,RequestId:randomUUID(),ExpectedFingerprint:'stale'})).status===409,'stale conditional write denied');
 const nfoPath=local(fixture.Path).replace(/\.[^.]+$/,'.nfo');const nfo=await readFile(nfoPath);const ownTrack=await readFile(local(track));
 try{
  await writeFile(nfoPath,Buffer.concat([nfo,Buffer.from('\n<!-- concurrent user edit -->')]));
  check((await request(route,{...body,RequestId:randomUUID(),ExpectedFingerprint:after.Fingerprint})).status===409,'concurrent NFO edit denied');
  check((await readFile(nfoPath,'utf8')).includes('concurrent user edit'),'concurrent NFO bytes retained');
 }finally{await writeFile(nfoPath,nfo);}
 try{
  await writeFile(local(track),Buffer.concat([ownTrack,Buffer.from('\n; user edit')]));const edited=await read();
  check((await request(route,{...body,RequestId:randomUUID(),ExpectedFingerprint:edited.Fingerprint,Facts:{recordLabel:'Must be refused'}})).status===409,'edited owned track blocks metadata write');
  check((await read()).Facts.recordLabel==='Fixture Label','failed overlay guard preserves metadata');
 }finally{await writeFile(local(track),ownTrack);}
 // Remove only the synthetic fixture's registration through a normal refresh,
 // then restore identical ASS bytes. Hash validity alone must not close replay.
 const held=local(track)+'.held-for-registration-test';
 await rename(local(track),held);
 try{
  await api(`/Items/${fixture.Id}/Refresh?MetadataRefreshMode=FullRefresh&ImageRefreshMode=None&ReplaceAllMetadata=false&ReplaceAllImages=false`,{});
  let absent=false;
  for(let n=0;n<30;n++){
   const item=await api(`/Users/${session.User.Id}/Items/${fixture.Id}`);
   if(!item.MediaSources?.[0]?.MediaStreams?.some(stream=>stream.Path?.endsWith('.mtv-info.eng.ass'))){absent=true;break;}
   await new Promise(resolve=>setTimeout(resolve,1000));
  }
  check(absent,'synthetic owned stream registration removed for replay regression');
 }finally{await rename(held,local(track));}
 const unregistered=await read();
 check(unregistered.Fingerprint===after.Fingerprint,'registration-only loss preserves metadata fingerprint');
 check(!unregistered.OverlayValid,'valid ASS bytes without registered stream are incomplete');
 check((await request(route,body)).status===409,'completed request replay rejects missing stream registration');
 const recovered=await api(route,{...body,RequestId:randomUUID(),ExpectedFingerprint:unregistered.Fingerprint,Facts:{},Corrections:[]});
 check(recovered.OverlayValid,'fresh targeted request restores owned stream registration');
 check(Buffer.compare(await readFile(mediaPath),mediaBefore)===0&&(await stat(mediaPath)).mtimeMs===mediaStat.mtimeMs,'original video bytes and modification time unchanged');
 for(const [file,bytes] of others)check(Buffer.compare(await readFile(file),bytes)===0,'other music-video tracks unchanged by targeted refresh');
 await writeFile('/artifacts/enrichment-lab-report.json',JSON.stringify({serverVersion:publicInfo.Version,checks,productionModified:false,sourceHash:createHash('sha256').update(mediaBefore).digest('hex')},null,2));
}finally{await api(configRoute,oldConfig);}
