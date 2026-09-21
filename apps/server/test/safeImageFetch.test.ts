import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchImageSafely } from '../src/pipeline/safeImageFetch.js';

// fetchImageSafely() validates the *original* URL against a private/reserved
// -host blocklist, then fetches it. These tests exist because that
// validation is worthless on its own if a 3xx redirect from an otherwise
// -legitimate host can be followed unvalidated straight into loopback or the
// cloud-metadata address (a classic SSRF-via-open-redirect) — see the "why"
// comment above fetchImageSafely() in safeImageFetch.ts. Each test stubs the
// global `fetch` so no real network or real private infrastructure is ever
// touched; a real local server bound to 127.0.0.1 can't stand in for the
// *origin* here because 127.0.0.1 is itself one of the addresses the very
// first validation pass (before any redirect exists) must reject, so no real
// listener could ever be reached as the "legitimate initial host" without
// weakening the code under test.
describe('fetchImageSafely redirect handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not follow a redirect to a loopback address (127.0.0.1)', async () => {
    const mockFetch = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { Location: 'http://127.0.0.1:9999/internal-secret' },
    }));
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchImageSafely('http://example.com/poster.jpg');

    expect(result).toBeNull();
    // The private redirect target must never be requested at all.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does not follow a redirect to the cloud metadata address (169.254.169.254)', async () => {
    const mockFetch = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { Location: 'http://169.254.169.254/latest/meta-data/' },
    }));
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchImageSafely('http://example.com/poster.jpg');

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('still follows a redirect that resolves to another legitimate public URL', async () => {
    const imageBytes = Buffer.from('not-really-a-jpeg-but-good-enough');
    const requestedUrls: string[] = [];
    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      requestedUrls.push(url);
      if (url === 'http://example.com/poster.jpg') {
        return new Response(null, {
          status: 302,
          headers: { Location: 'http://cdn.example.com/final-poster.jpg' },
        });
      }
      if (url === 'http://cdn.example.com/final-poster.jpg') {
        return new Response(imageBytes, {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        });
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchImageSafely('http://example.com/poster.jpg');

    expect(result).not.toBeNull();
    expect(result?.contentType).toBe('image/jpeg');
    expect(result?.data.equals(imageBytes)).toBe(true);
    expect(requestedUrls).toEqual(['http://example.com/poster.jpg', 'http://cdn.example.com/final-poster.jpg']);
  });

  it('gives up and returns null instead of looping forever on a long redirect chain', async () => {
    let calls = 0;
    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      calls++;
      const url = input.toString();
      const hop = Number(url.match(/\/hop(\d+)$/)?.[1] ?? '0');
      // Always redirects to the next hop — an unbounded chain if the hop cap
      // didn't exist.
      return new Response(null, {
        status: 302,
        headers: { Location: `http://example.com/hop${hop + 1}` },
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchImageSafely('http://example.com/hop0');

    expect(result).toBeNull();
    // Bounded well below the 100 hops the mock was willing to serve — proves
    // the hop cap actually stopped the loop rather than it exhausting the
    // mock's own logic or hanging.
    expect(calls).toBeLessThan(20);
  });

  it('fails closed (returns null) when a redirect status has no Location header', async () => {
    const mockFetch = vi.fn(async () => new Response(null, { status: 302 }));
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchImageSafely('http://example.com/poster.jpg');

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
