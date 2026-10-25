import { api, login, lab } from './lab-api.mjs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
const user=await login();
const original=user.Configuration;
const items=await api('/Items?Recursive=true&IncludeItemTypes=MusicVideo&Fields=MediaSources,Path&Limit=10');
const item=items.Items.find(x=>x.Path?.startsWith(path.join(lab,'media')));
if(!item)throw new Error('Isolated fixture not found');
try {
  await api(`/Users/${user.Id}/Configuration`,{...original,SubtitleMode:'None'});
  const info=await api(`/Items/${item.Id}/PlaybackInfo`,{UserId:user.Id,MediaSourceId:item.MediaSources[0].Id,EnableDirectPlay:true,EnableDirectStream:true,EnableTranscoding:true,
    DeviceProfile:{Name:'Subtitle-off control',DirectPlayProfiles:[{Container:'mp4',Type:'Video',VideoCodec:'h264',AudioCodec:'aac'}],TranscodingProfiles:[{Container:'ts',Type:'Video',VideoCodec:'h264',AudioCodec:'aac',Context:'Streaming',Protocol:'hls'}],SubtitleProfiles:[{Format:'srt',Method:'External'}]}});
  const source=info.MediaSources[0];
  const report={subtitleMode:'None',automaticSubtitleIndex:source.DefaultSubtitleStreamIndex??null,supportsDirectPlay:source.SupportsDirectPlay,
    selectionRequired:true,automaticActivationWithSubtitlesOff:false,pluginOverrideVerified:false};
  if(report.automaticSubtitleIndex!==null && report.automaticSubtitleIndex>=0)throw new Error('Unexpected subtitle selection in off-mode control');
  await writeFile(path.join(lab,'evidence','selection-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {await api(`/Users/${user.Id}/Configuration`,original);}
