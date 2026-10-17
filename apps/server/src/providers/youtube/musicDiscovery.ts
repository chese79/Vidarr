import { listChannelVideos, listPlaylistVideos, type YoutubeVideoListing } from './ytdlp.js';

export interface DiscoveredYoutubeVideo extends YoutubeVideoListing {
  channel?: string;
  officialEvidence: string[];
  discoveryOrigins: string[];
}
export interface YoutubeDiscovery { videos: DiscoveredYoutubeVideo[]; errors: string[] }
type ObjectData = Record<string, any>;
const OFFICIAL = /\bofficial\b/i;
export const hasOfficialKeyword = (value: string): boolean => OFFICIAL.test(value);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';

function* nodes(value: unknown): Generator<ObjectData> {
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value)) yield value as ObjectData;
  for (const child of Object.values(value)) yield* nodes(child);
}
function text(value: any): string {
  return typeof value === 'string' ? value : value?.simpleText ?? value?.runs?.map((r: any) => r.text ?? '').join('') ?? '';
}
// Parse data literals only. Never execute JavaScript returned by a provider.
function jsonAt(source: string, start: number): any {
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === '{' || c === '[') depth++;
    else if ((c === '}' || c === ']') && --depth === 0) return JSON.parse(source.slice(start, i + 1));
  }
  throw new Error('Incomplete YouTube Music data');
}
function decodeJsString(value: string): string {
  return value.replace(/\\(?:x([0-9a-fA-F]{2})|u([0-9a-fA-F]{4})|([\s\S]))/g, (_m, hex, unicode, c) => {
    if (hex || unicode) return String.fromCharCode(parseInt(hex ?? unicode, 16));
    return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' } as Record<string, string>)[c] ?? c;
  });
}
export function parseMusicPage(html: string): { data: unknown[]; clientVersion: string | null; client: ObjectData | null } {
  const data: unknown[] = [];
  for (const match of html.matchAll(/initialData\.push\(\{path:\s*'([^']+)',\s*params:\s*JSON\.parse\('(?:\\.|[^'\\])*'\),\s*data:\s*'((?:\\.|[^'\\])*)'/g)) {
    if (match[1].includes('browse')) data.push(JSON.parse(decodeJsString(match[2])));
  }
  for (const match of html.matchAll(/(?:var\s+)?ytInitialData\s*=\s*/g)) {
    try { data.push(jsonAt(html, match.index! + match[0].length)); } catch { /* another data literal may be usable */ }
  }
  let clientVersion: string | null = null;
  let client: ObjectData | null = null;
  for (const match of html.matchAll(/ytcfg\.set\(\s*/g)) {
    try {
      const config = jsonAt(html, match.index! + match[0].length);
      clientVersion = config.INNERTUBE_CLIENT_VERSION ?? config.INNERTUBE_CONTEXT?.client?.clientVersion ?? clientVersion;
      client = config.INNERTUBE_CONTEXT?.client ?? client;
    } catch { /* unrelated configuration */ }
  }
  if (!data.length) throw new Error('YouTube Music page could not be read; discovery is incomplete.');
  return { data, clientVersion, client: clientVersion ? { ...client, clientName: 'WEB_REMIX', clientVersion, hl: 'en', gl: 'US' } : null };
}

interface MusicItems {
  videos: { id: string; title: string; officialCategory?: string }[];
  playlists: { id: string; title: string }[];
  endpoints: { browseId: string; params?: string; officialCategory?: string }[];
  continuations: string[];
}
export function extractMusicItems(data: unknown, allItems = false, category?: string): MusicItems {
  const result: MusicItems = { videos: [], playlists: [], endpoints: [], continuations: [] };
  const collect = (body: unknown, inheritedCategory?: string) => {
    for (const n of nodes(body)) {
      for (const key of ['musicTwoRowItemRenderer', 'musicResponsiveListItemRenderer', 'videoRenderer']) {
        const item = n[key]; if (!item) continue;
        const title = text(item.title) || [...nodes(item.flexColumns)].map(c => text(c.musicResponsiveListItemFlexColumnRenderer?.text)).find(Boolean) || '';
        const browseId = item.navigationEndpoint?.browseEndpoint?.browseId;
        if (browseId?.startsWith('VL')) result.playlists.push({ id: browseId.slice(2), title });
        for (const endpoint of nodes(item)) {
          const id = endpoint.watchEndpoint?.videoId ?? item.videoId;
          if (id) result.videos.push({ id, title, officialCategory: inheritedCategory });
          const playlistId = endpoint.watchEndpoint?.playlistId;
          if (playlistId && /^(?:OLAK|PL)/.test(playlistId)) result.playlists.push({ id: playlistId, title: inheritedCategory ?? 'Videos' });
        }
      }
      const continuation = n.nextContinuationData?.continuation ?? n.continuationCommand?.token;
      if (continuation) result.continuations.push(continuation);
    }
  };
  if (allItems) collect(data, category);
  else for (const node of nodes(data)) for (const key of ['musicCarouselShelfRenderer', 'musicShelfRenderer']) {
    const shelf = node[key]; if (!shelf) continue;
    const title = text(shelf.title) || [...nodes(shelf.header)].map(n => text(n.title)).find(Boolean) || '';
    if (!/video|playlist.*by|created playlist/i.test(title) && !hasOfficialKeyword(title)) continue;
    collect(shelf, hasOfficialKeyword(title) ? title : undefined);
    for (const n of nodes(shelf.header)) {
      const ep = n.browseEndpoint;
      if (ep?.browseId) result.endpoints.push({ browseId: ep.browseId, ...(ep.params ? { params: ep.params } : {}), ...(hasOfficialKeyword(title) ? { officialCategory: title } : {}) });
    }
  }
  return result;
}

async function musicRequest(url: string, body?: unknown): Promise<Response> {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000),
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...(body ? { 'Content-Type': 'application/json', Origin: 'https://music.youtube.com', 'X-YouTube-Client-Name': '67', 'X-YouTube-Client-Version': (body as ObjectData).context.client.clientVersion } : {}) },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`YouTube Music request failed (${response.status}); discovery is incomplete.`);
  return response;
}

// Both standard and Music links traverse both surfaces before channel-ID deduplication.
// Keep partial results, but report incomplete traversal so collection schedules its normal retry.
export async function discoverYoutubeChannel(sourceUrl: string): Promise<YoutubeDiscovery> {
  const videos = new Map<string, DiscoveredYoutubeVideo>();
  const errors: string[] = [];
  function add(video: YoutubeVideoListing & { channel?: string }, origin: string, category?: string) {
    if (!/^[\w-]{11}$/.test(video.youtubeVideoId)) return;
    const existing = videos.get(video.youtubeVideoId);
    const evidence = [...(hasOfficialKeyword(video.title) ? ['title:official'] : []), ...(category && hasOfficialKeyword(category) ? [`category:${category}`] : [])];
    videos.set(video.youtubeVideoId, { ...video, title: video.title || existing?.title || '',
      sourcePublishedAt: video.sourcePublishedAt ?? existing?.sourcePublishedAt ?? null,
      officialEvidence: [...new Set([...(existing?.officialEvidence ?? []), ...evidence])],
      discoveryOrigins: [...new Set([...(existing?.discoveryOrigins ?? []), origin])],
    });
  }
  try { for (const video of await listChannelVideos(sourceUrl)) add(video, 'channel-uploads'); }
  catch (error) { errors.push((error as Error).message); }
  try {
    const url = new URL(sourceUrl);
    if (!['youtube.com', 'www.youtube.com', 'music.youtube.com', 'm.youtube.com'].includes(url.hostname)) throw new Error('Unsupported YouTube channel host');
    if (!/^\/(?:channel\/[^/]+|@[^/]+|c\/[^/]+|user\/[^/]+)\/?$/i.test(url.pathname)) return { videos: [...videos.values()], errors };
    url.hostname = 'music.youtube.com'; url.search = ''; url.hash = '';
    const page = parseMusicPage(await (await musicRequest(url.toString())).text());
    const playlists = new Map<string, string>();
    const endpoints: MusicItems['endpoints'] = [];
    function ingest(items: MusicItems, origin: string) {
      for (const v of items.videos) add({ youtubeVideoId: v.id, title: v.title, sourcePublishedAt: null }, origin, v.officialCategory);
      for (const p of items.playlists) if (/^[\w-]+$/.test(p.id)) {
        const existing = playlists.get(p.id);
        if (!existing || !hasOfficialKeyword(existing)) playlists.set(p.id, p.title || existing || '');
      }
      endpoints.push(...items.endpoints);
    }
    ingest(extractMusicItems(page.data), 'youtube-music:shelves');
    const visited = new Set<string>();
    for (const ep of endpoints) {
      try {
      if (ep.browseId.startsWith('VL')) { if (!playlists.has(ep.browseId.slice(2))) playlists.set(ep.browseId.slice(2), ep.officialCategory ?? 'Videos'); continue; }
      const key = JSON.stringify(ep); if (visited.has(key)) continue; visited.add(key);
      if (!page.clientVersion) throw new Error('YouTube Music View all client unavailable; discovery is incomplete.');
      let payload: unknown = { browseId: ep.browseId, ...(ep.params ? { params: ep.params } : {}) }; const tokens = new Set<string>();
      for (let count = 0; ; count++) {
        if (count >= 100) throw new Error('YouTube Music pagination limit reached; discovery is incomplete.');
        const response = await musicRequest('https://music.youtube.com/youtubei/v1/browse?prettyPrint=false', {
          context: { client: page.client }, ...(payload as ObjectData),
        });
        const items = extractMusicItems(await response.json(), true, ep.officialCategory);
        if (!items.videos.length && !items.playlists.length && !items.continuations.length) {
          throw new Error('YouTube Music View all returned no readable content; discovery is incomplete.');
        }
        ingest(items, 'youtube-music:view-all');
        const token = items.continuations[0];
        if (!token) break;
        if (tokens.has(token)) throw new Error('YouTube Music repeated a continuation; discovery is incomplete.');
        tokens.add(token); payload = { continuation: token };
      }
      } catch (error) { errors.push((error as Error).message); }
    }
    if (playlists.size > 100) errors.push('YouTube Music playlist limit reached; discovery is incomplete.');
    for (const [id, title] of [...playlists].slice(0, 100)) {
      try {
        for (const v of await listPlaylistVideos(`https://www.youtube.com/playlist?list=${id}`)) add({ ...v, sourcePublishedAt: null }, `youtube-music:playlist:${id}`, title);
      } catch (error) { errors.push((error as Error).message); }
    }
  } catch (error) { errors.push((error as Error).message); }
  return { videos: [...videos.values()], errors };
}
