import type { LibraryConnector } from '@prisma/client';

export function baseUrl(host: string): string {
  return host.replace(/\/+$/, '');
}

// Plex and Jellyfin's HTTP APIs differ only in header name and error-message
// label — this factory captures that one difference so both providers share
// the actual fetch/error/204-handling logic instead of duplicating it.
export function createAuthedFetcher(providerLabel: string, tokenHeaderName: string) {
  function headers(config: LibraryConnector): Record<string, string> {
    return { Accept: 'application/json', [tokenHeaderName]: config.authToken ?? '' };
  }

  async function get(config: LibraryConnector, path: string): Promise<any> {
    const res = await fetch(`${baseUrl(config.host)}${path}`, { headers: headers(config) });
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
    });
    if (!res.ok) {
      throw new Error(`${providerLabel} request failed: ${res.status} ${res.statusText}`);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  return { get, send };
}
