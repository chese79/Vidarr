import { api, login, resource, lab } from './lab-api.mjs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
const user = await login();
await api(`/Users/${user.Id}/Configuration`,{...user.Configuration,SubtitleMode:'Always',SubtitleLanguagePreference:'eng'});
const found = await api('/Items?Recursive=true&IncludeItemTypes=MusicVideo&Fields=MediaSources,Path&Limit=10');
const items = found.Items.filter(x=>x.Path?.startsWith(path.join(lab,'media')));
if(items.length!==2)throw new Error(`Expected two isolated fixtures; found ${items.length}`);
const profile = {Name:'Roku-shaped subtitle probe (not a captured device profile)',MaxStreamingBitrate:20000000,
  DirectPlayProfiles:[{Container:'mp4',Type:'Video',VideoCodec:'h264',AudioCodec:'aac'}],
  TranscodingProfiles:[{Container:'ts',Type:'Video',VideoCodec:'h264',AudioCodec:'aac',Context:'Streaming',Protocol:'hls',MaxAudioChannels:'2',MinSegments:1}],
  SubtitleProfiles:['vtt','srt','ttml','sub'].map(Format=>({Format,Method:'External'}))};
const report = {server:(await api('/System/Info/Public')).Version,productionModified:false,physicalRokuVerified:false,profile:profile.Name,items:[]};
for(const [index,item] of items.entries()) {
  const media = item.MediaSources[0];
  const subtitle = media.MediaStreams.find(x=>x.Type==='Subtitle'&&x.Codec==='ass');
  if(!subtitle)throw new Error('Jellyfin did not discover the ASS sidecar');
  const request = {UserId:user.Id,MediaSourceId:media.Id,DeviceProfile:profile,EnableDirectPlay:true,EnableDirectStream:true,EnableTranscoding:true,MaxStreamingBitrate:20000000};
  const automatic = await api(`/Items/${item.Id}/PlaybackInfo`,request);
  const info = await api(`/Items/${item.Id}/PlaybackInfo`,{...request,SubtitleStreamIndex:subtitle.Index});
  const source = info.MediaSources[0];
  if(!source.TranscodingUrl || !/[?&]SubtitleMethod=Encode/i.test(source.TranscodingUrl))throw new Error('Jellyfin did not select subtitle burn-in');
  const response = await resource(source.TranscodingUrl);
  let manifest = await response.text();
  // Master playlists may point to a second playlist. Never write token-bearing URLs to evidence.
  let manifestUrl = new URL(source.TranscodingUrl,'http://127.0.0.1:18096');
  if(manifest.includes('#EXT-X-STREAM-INF')) {
    const child = manifest.split(/\r?\n/).find(x=>x&&!x.startsWith('#'));
    manifestUrl=new URL(child,manifestUrl); manifest=await (await resource(manifestUrl.href)).text();
  }
  const segments=manifest.split(/\r?\n/).filter(x=>x&&!x.startsWith('#'));
  if(!segments.length)throw new Error('Transcode returned no segments');
  for (let i=0;i<segments.length;i++) {
    const data = new Uint8Array(await (await resource(new URL(segments[i],manifestUrl).href)).arrayBuffer());
    await writeFile(path.join(lab,'evidence',`jellyfin-${index+1}-${i}.ts`),data);
  }
  report.items.push({id:item.Id,name:item.Name,subtitleCodec:subtitle.Codec,subtitleIndex:subtitle.Index,
    automaticSubtitleIndex:automatic.MediaSources[0].DefaultSubtitleStreamIndex ?? null,
    burnIn:true,segments:segments.length,transcodeReasons:source.TranscodingUrl.match(/[?&]TranscodeReasons=([^&]+)/i)?.[1] ?? null});
}
const playlists = await api(`/Users/${user.Id}/Items?IncludeItemTypes=Playlist&Recursive=true`);
let playlist = playlists.Items.find(x=>x.Name==='MTV Overlay POC');
if(!playlist)playlist=await api('/Playlists',{Name:'MTV Overlay POC',Ids:items.map(x=>x.Id),UserId:user.Id,MediaType:'Video'});
report.playlistId=playlist.Id;
await writeFile(path.join(lab,'evidence','playback-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
