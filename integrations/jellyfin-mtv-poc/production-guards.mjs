import path from 'node:path';
export const normalizePath=value=>path.win32.normalize(value).toLowerCase();
export function assertBaseline(baseline,info,user,libraries,mediaPath) {
  if(baseline.serverId!==info.Id||baseline.userId!==user.Id||normalizePath(baseline.mediaPath)!==normalizePath(mediaPath))throw new Error('Production identity/path changed since baseline');
  if(JSON.stringify(baseline.userConfiguration)!==JSON.stringify(user.Configuration))throw new Error('User preferences changed; review before proceeding');
  for(const old of baseline.libraries)if(!libraries.some(x=>x.ItemId===old.id&&JSON.stringify(x.Locations)===JSON.stringify(old.locations)))throw new Error('Original library changed; review before proceeding');
}
export function assertTestPath(library,mediaPath) {
  if(library&&(library.Locations?.length!==1||normalizePath(library.Locations[0])!==normalizePath(mediaPath)))throw new Error('Test library name collides with another path');
}
