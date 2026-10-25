import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const lab = path.join(path.dirname(fileURLToPath(import.meta.url)),'.lab');
export const base = 'http://127.0.0.1:18096';
let token;
export async function api(route, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base+route,{method,headers:{'Content-Type':'application/json',Authorization:`MediaBrowser Client="MTV Lab", Device="Isolated test", DeviceId="mtv-overlay-lab", Version="0.1.0"${token ? `, Token="${token}"` : ''}`},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error(`${method} ${route.split('?')[0]} returned HTTP ${response.status}`);
  const text = await response.text(); return text ? JSON.parse(text) : null;
}
export async function login() {
  const credentials = JSON.parse(await readFile(path.join(lab,'credentials.json'),'utf8'));
  const info = await api('/System/Info/Public');
  if (credentials.serverId !== info.Id) throw new Error('Lab server identity changed; refusing to send credentials');
  const session = await api('/Users/AuthenticateByName',{Username:credentials.username,Pw:credentials.password});
  token = session.AccessToken; return session.User;
}
export async function resource(relative) {
  const url = new URL(relative,base);
  if (url.origin !== base) throw new Error('Lab media requests must stay on the isolated server');
  const response = await fetch(url,{headers:{Authorization:`MediaBrowser Token="${token}"`},signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw new Error(`Lab media returned HTTP ${response.status}`);
  return response;
}
export async function setup() {
  const info = await api('/System/Info/Public');
  if (!info.StartupWizardCompleted) {
    let credentials;
    try { credentials = JSON.parse(await readFile(path.join(lab,'credentials.json'),'utf8')); }
    catch(error) { if(error.code!=='ENOENT')throw error; }
    if(credentials && credentials.serverId !== info.Id)throw new Error('Lab server identity changed');
    if(!credentials) {
      credentials = {serverId:info.Id,username:'mtv-lab',password:randomBytes(24).toString('base64url')};
      await writeFile(path.join(lab,'credentials.json'),JSON.stringify(credentials),{flag:'wx',mode:0o600});
    }
    await api('/Startup/Configuration',{ServerName:'MTV Overlay Lab',UICulture:'en-US',MetadataCountryCode:'US',PreferredMetadataLanguage:'en'});
    await api('/Startup/User',{Name:credentials.username,Password:credentials.password});
    await login(); await api('/Startup/Complete',{});
  } else await login();
  const folders = await api('/Library/VirtualFolders');
  if (!folders.some(x=>x.Name==='MTV Overlay Lab')) await api('/Library/VirtualFolders?name=MTV%20Overlay%20Lab&collectionType=musicvideos&refreshLibrary=true',{LibraryOptions:{PathInfos:[{Path:path.join(lab,'media')}],EnableRealtimeMonitor:false,EnableInternetProviders:false,EnableAutomaticSeriesGrouping:false,MetadataSavers:[]}});
  console.log(JSON.stringify({labReady:true,version:info.Version,url:'http://192.168.0.8:18096',credentialsFile:'.lab/credentials.json',productionModified:false}));
}
if (process.argv[2]==='setup') await setup();
