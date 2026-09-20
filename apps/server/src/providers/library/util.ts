import type { LibraryConnector } from '@prisma/client';

export function baseUrl(host: string): string {
  const trimmed = host.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

const PROVIDER_TIMEOUT_MS = Number(process.env.PROVIDER_TIMEOUT_MS ?? 15_000);

export function providerRequestSignal(): AbortSignal {
  return AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
}

// Plex and Jellyfin's HTTP APIs differ only in header name and error-message
// label — this factory captures that one difference so both providers share
// the actual fetch/error/204-handling logic instead of duplicating it.
export function createAuthedFetcher(
  providerLabel: string,
  tokenHeaderName: string,
  formatToken: (token: string) => string = (token) => token,
) {
  function headers(config: LibraryConnector): Record<string, string> {
    return { Accept: 'application/json', [tokenHeaderName]: formatToken(config.authToken ?? '') };
  }

  async function get(config: LibraryConnector, path: string): Promise<any> {
    const res = await fetch(`${baseUrl(config.host)}${path}`, {
      headers: headers(config),
      signal: providerRequestSignal(),
    });
    if (!res.ok) {
      throw new Error(`${providerLabel} request failed: ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  async function send(config: LibraryConnector, method: string, path: string, body?: unknown): Promise<any> {
    const res = await fetch(`${baseUrl(config.host)}${path}`, {
      method,
      headers: body !== undefined ? { ...headers(config), 'Content-Type': 'application/json' } : headers(config),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: providerRequestSignal(),
    });
    if (!res.ok) {
      throw new Error(`${providerLabel} request failed: ${res.status} ${res.statusText}`);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  // For non-JSON responses (thumbnails) — same auth headers and timeout as
  // get/send, but returns a raw buffer and treats 404 as "no thumbnail"
  // rather than an error. Both Plex's and Jellyfin's fetchVideoThumbnail used
  // to hand-build this same header/404/error/Buffer sequence independently,
  // which meant the Jellyfin-12 MediaBrowser auth-scheme fix had to be
  // applied in two places by hand — sharing it here means there's only one
  // place left to change if either provider's auth format changes again.
  async function getBinary(
    config: LibraryConnector,
    path: string,
  ): Promise<{ contentType: string; data: Buffer } | null> {
    const res = await fetch(`${baseUrl(config.host)}${path}`, {
      headers: headers(config),
      signal: providerRequestSignal(),
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`${providerLabel} request failed: ${res.status} ${res.statusText}`);
    }
    return {
      contentType: res.headers.get('content-type') ?? 'image/jpeg',
      data: Buffer.from(await res.arrayBuffer()),
    };
  }

  return { get, send, getBinary };
}
