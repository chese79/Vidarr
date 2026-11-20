import { FairRequestQueue } from './requestScheduling.js';

const requests = new FairRequestQueue(1_100);
let cooldownUntil = 0;
let failures = 0;
let lastStatus = '503 Service Unavailable';
export class MusicBrainzUnavailable extends Error {
  constructor(public retryAt: Date, detail: string) {
    super(`MusicBrainz request failed: ${detail}; retry after ${retryAt.toISOString()}`);
  }
}
export const musicBrainzRetryAt = () => cooldownUntil > Date.now() ? new Date(cooldownUntil) : null;
// Cache reset is also used to isolate provider fixtures between tests.
export function resetMusicBrainzTransport() { cooldownUntil = 0; failures = 0; }

function unavailable(detail: string, retryAfter?: string | null): never {
  const seconds = retryAfter?.trim() && /^\d+(?:\.\d+)?$/.test(retryAfter.trim()) ? Number(retryAfter) : NaN;
  const supplied = Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(retryAfter ?? '');
  cooldownUntil = Math.max(Date.now() + Math.min(900_000, 30_000 * 2 ** Math.min(failures++, 5)), Number.isFinite(supplied) ? supplied : 0);
  lastStatus = detail;
  throw new MusicBrainzUnavailable(new Date(cooldownUntil), detail);
}

// All Vidarr MusicBrainz consumers share this serial lane and outage cooldown.
// Deferral is durable at the enrichment item, rather than sleeping in its writer.
export function musicBrainzRequest(path: string): Promise<any> {
  return requests.enqueue(async () => {
    const retryAt = musicBrainzRetryAt();
    if (retryAt) throw new MusicBrainzUnavailable(retryAt, lastStatus);
    let response: Response;
    try {
      response = await fetch(`https://musicbrainz.org/ws/2${path}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'Vidarr/0.1 (https://github.com/chese79/Vidarr)' },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      if (error instanceof TypeError || (error as Error)?.name === 'TimeoutError' || (error as Error)?.name === 'AbortError') unavailable('temporary network failure');
      throw error;
    }
    if (!response.ok) {
      await response.body?.cancel();
      if ([429, 500, 502, 503, 504].includes(response.status)) unavailable(`${response.status} ${response.statusText}`, response.headers.get('Retry-After'));
      throw new Error(`MusicBrainz request failed: ${response.status} ${response.statusText}`);
    }
    const body = await response.json();
    failures = 0;
    return body;
  });
}
