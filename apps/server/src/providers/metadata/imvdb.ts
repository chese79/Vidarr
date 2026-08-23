const API_BASE = 'https://imvdb.com/api/v1';

export interface ImvdbArtist {
  slug: string;
  name: string;
}

export interface ImvdbVideoCandidate {
  imvdbVideoId: string;
  title: string;
  year: number | null;
  thumbnailUrl: string | null;
}

// IMVDb's nginx rejects requests with no/non-browser User-Agent with a bare 400
// (no JSON body), regardless of a valid API key — a real, observed quirk, not
// documented. A descriptive UA (not literally impersonating a browser) avoids it.
const USER_AGENT = 'vidarr/0.1.0 (self-hosted music video manager)';

const RETRYABLE_STATUS = new Set([502, 503, 504]);
const MAX_ATTEMPTS = 3;

// IMVDb's own backend is observed to intermittently 502 on otherwise-identical
// requests (~1 in 3 in testing) — a real reliability issue on their end, not
// ours. Retry a couple of times with a short backoff before giving up.
async function imvdbGet(apiKey: string, path: string): Promise<any> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { 'IMVDB-APP-KEY': apiKey, Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
    if (res.ok) return res.json();
    lastError = new Error(`IMVDb request failed: ${res.status} ${res.statusText}`);
    if (!RETRYABLE_STATUS.has(res.status) || attempt === MAX_ATTEMPTS) break;
    await new Promise((r) => setTimeout(r, 500 * attempt));
  }
  throw lastError;
}

function toCandidate(v: any): ImvdbVideoCandidate {
  return {
    imvdbVideoId: String(v.id),
    title: v.song_title as string,
    year: v.year ?? null,
    thumbnailUrl: v.image?.b ?? v.image?.l ?? null,
  };
}

// IMVDb has no dedicated "search artists by name" endpoint, only search/videos.
// We search videos matching the query and dedupe the artists across results —
// the same workaround other IMVDb API clients use.
export async function searchArtists(apiKey: string, query: string): Promise<ImvdbArtist[]> {
  const body = await imvdbGet(apiKey, `/search/videos?q=${encodeURIComponent(query)}&per_page=50`);
  const results: any[] = body?.results ?? [];
  const bySlug = new Map<string, ImvdbArtist>();
  for (const video of results) {
    for (const artist of video.artists ?? []) {
      if (!bySlug.has(artist.slug)) {
        bySlug.set(artist.slug, { slug: artist.slug, name: artist.name });
      }
    }
  }
  return [...bySlug.values()];
}

const MAX_VIDEO_SEARCH_PAGES = 4; // up to 200 results — IMVDb has no "videos by artist" endpoint

// IMVDb's GET /entity/{slug}?method=slug — the documented way to resolve an
// artist's numeric id from a slug — returns a bare 500 on IMVDb's own server
// (confirmed independently: https://github.com/Cosmitar/imvdb-client source
// carries the same finding). The `artists[]` entries in video search results
// never carry a numeric id either, only name+slug. So there is no reliable way
// to obtain a numeric IMVDb artist id from a name/slug search at all — we use
// the slug itself as vidarr's `imvdbArtistId`, and build an artist's video
// catalog by paginating video search filtered to matching artist slug, rather
// than via a (broken) "videos for this artist id" call.
export async function getArtistVideos(
  apiKey: string,
  artistSlug: string,
  artistName: string,
): Promise<ImvdbVideoCandidate[]> {
  const videos: ImvdbVideoCandidate[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= MAX_VIDEO_SEARCH_PAGES; page++) {
    const body = await imvdbGet(
      apiKey,
      `/search/videos?q=${encodeURIComponent(artistName)}&per_page=50&page=${page}`,
    );
    const results: any[] = body?.results ?? [];
    for (const video of results) {
      const matches = (video.artists ?? []).some((a: any) => a.slug === artistSlug);
      if (matches && !seen.has(String(video.id))) {
        seen.add(String(video.id));
        videos.push(toCandidate(video));
      }
    }
    if (page >= (body?.total_pages ?? 1)) break;
  }

  return videos;
}
