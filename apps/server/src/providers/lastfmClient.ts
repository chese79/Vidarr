import { createHash } from 'node:crypto';

const API = 'https://ws.audioscrobbler.com/2.0/';
export class LastFmError extends Error {
  constructor(readonly code: number | null, readonly retryable: boolean, message: string) {
    super(message);
  }
}

export function lastFmSignature(params: Record<string, string>, secret: string): string {
  const text = Object.keys(params).filter((key) => !['format', 'callback', 'api_sig'].includes(key))
    .sort().map((key) => key + params[key]).join('') + secret;
  return createHash('md5').update(text, 'utf8').digest('hex');
}

// Never propagate remote messages/bodies or fetch errors: they can contain
// credentials. Last.fm reports API errors inside HTTP 200 responses as well.
export async function lastFmCall(
  apiKey: string, secret: string, method: string, args: Record<string, string> = {},
): Promise<any> {
  const params = { ...args, api_key: apiKey, method };
  const body = new URLSearchParams({ ...params, api_sig: lastFmSignature(params, secret), format: 'json' });
  let res: Response;
  let data: any;
  try {
    res = await fetch(API, { method: 'POST', body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15_000) });
    data = await res.json();
  } catch {
    throw new LastFmError(null, true, 'Last.fm is unreachable or returned an unreadable response.');
  }
  if (data?.error != null) {
    const code = Number(data.error);
    const message = code === 9 ? 'Last.fm authorization expired. Link your account again.'
      : code === 14 ? 'Authorize Vidarr on Last.fm, then complete the link.'
      : code === 15 ? 'Last.fm linking expired. Start a new account link.'
      : code === 13 ? 'Last.fm rejected the signature. Check the API key and shared secret.'
      : `Last.fm rejected the request (code ${Number.isFinite(code) ? code : 'unknown'}).`;
    throw new LastFmError(code, [11, 16, 29].includes(code), message);
  }
  if (!res.ok) throw new LastFmError(null, res.status === 429 || res.status >= 500,
    `Last.fm request failed (HTTP ${res.status}).`);
  if (!data || typeof data !== 'object') throw new LastFmError(null, true, 'Last.fm returned an invalid response.');
  return data;
}
