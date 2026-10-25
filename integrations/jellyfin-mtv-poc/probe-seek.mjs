import { api, login, resource, lab } from './lab-api.mjs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
const user=await login();
const found=await api('/Items?Recursive=true&IncludeItemTypes=MusicVideo&Fields=MediaSources,Path&Limit=10');
const item=found.Items.find(x=>x.Path?.startsWith(path.join(lab,'media')));
if(!item)throw new Error('Isolated fixture not found');
const source=item.MediaSources[0], subtitle=source.MediaStreams.find(x=>x.Type==='Subtitle'&&x.Codec==='ass');
const info=await api(`/Items/${item.Id}/PlaybackInfo`,{UserId:user.Id,MediaSourceId:source.Id,SubtitleStreamIndex:subtitle.Index,StartTimeTicks:200000000,
  DeviceProfile:{Name:'MTV late-seek probe',MaxStreamingBitrate:20000000,TranscodingProfiles:[{Container:'ts',Type:'Video',VideoCodec:'h264',AudioCodec:'aac',Context:'Streaming',Protocol:'hls',MaxAudioChannels:'2'}],SubtitleProfiles:[{Format:'ass',Method:'Encode'}]},EnableDirectPlay:false,EnableDirectStream:false,EnableTranscoding:true});
let url=new URL(info.MediaSources[0].TranscodingUrl,'http://127.0.0.1:18096');
let manifest=await (await resource(url.href)).text();
if(manifest.includes('#EXT-X-STREAM-INF')) {url=new URL(manifest.split(/\r?\n/).find(x=>x&&!x.startsWith('#')),url);manifest=await(await resource(url.href)).text();}
const segments=manifest.split(/\r?\n/).filter(x=>x&&!x.startsWith('#'));
const late=segments.find(x=>/\/6\.ts(?:\?|$)/.test(x));
if(!late)throw new Error('Could not identify the 18–21 second HLS segment');
const segmentUrl=new URL(late,url);
// Request only the late segment: the server must handle the jump without downloading the intro.
const bytes=new Uint8Array(await (await resource(segmentUrl.href)).arrayBuffer());
await writeFile(path.join(lab,'evidence','seek-18s.ts'),bytes);
const report={seekRequestSeconds:20,requestedSegmentStartSeconds:18,bytes:bytes.length,physicalRokuVerified:false};
await writeFile(path.join(lab,'evidence','seek-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
