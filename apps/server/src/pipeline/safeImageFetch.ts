import net from 'node:net';
import { providerRequestSignal } from '../providers/library/util.js';

// A user-supplied Artist.posterUrl is fetched server-side and relayed to the
// browser (see api/artist.ts's image proxy) so a connector's credentials
// never have to reach the client. That means this fetch is reachable by
// anyone who can create/edit an artist (any authenticated user of this
// single-admin-key app), pointed at an arbitrary URL — an unhardened fetch()
// here is a real SSRF/resource-exhaustion vector, not just a theoretical one.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata (169.254.169.254)
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 0) return true; // "this network"
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  const firstGroupValue = parseInt(normalized.split(':')[0] || '0', 16);
  if (Number.isNaN(firstGroupValue)) return true;
  if (firstGroupValue >= 0xfc00 && firstGroupValue <= 0xfdff) return true; // fc00::/7, unique local
  if (firstGroupValue >= 0xfe80 && firstGroupValue <= 0xfebf) return true; // fe80::/10, link-local
  return false;
}

// Catches the realistic, low-effort SSRF payloads (loopback, RFC1918 ranges,
// link-local/cloud-metadata, "localhost") by inspecting the URL's host
// literally — no DNS lookup. A public hostname that itself *resolves* to an
// internal address (DNS rebinding) is NOT caught here: doing that properly
// means resolving once and pinning the connection to that address, which is
// disproportionate hardening for a single-admin-API-key self-hosted app.
// Combined with the timeout/size-cap/content-type checks below, this closes
// the gap that actually matters for this threat model.
function isPrivateOrReservedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost')) return true;
  const family = net.isIP(hostname);
  if (family === 4) return isPrivateIpv4(hostname);
  if (family === 6) return isPrivateIpv6(hostname);
  return false;
}

function parseSafeImageUrl(rawUrl: string): URL | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (isPrivateOrReservedHost(url.hostname)) return null;
  return url;
}

// A redirect response is followed manually (see below) so each hop gets the
// same private/reserved-host check as the original URL; this caps how many
// hops we'll chase so a malicious or misconfigured server can't force an
// unbounded (or infinite) redirect chain.
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// Fetches an arbitrary, user-supplied image URL under the same protections a
// connector-configured host already gets (timeout via providerRequestSignal)
// plus the extra hardening a fully external, untrusted URL needs: protocol
// and private-host rejection, a hard cap on how much of the body is ever
// buffered (checked as it streams in, not just via a spoofable
// Content-Length header), and a Content-Type check before treating the
// response as an image at all. Returns null for every failure mode rather
// than throwing — callers treat "couldn't get an image this way" as
// "try the next source," not an error.
//
// Redirects are followed manually, one hop at a time, instead of relying on
// fetch()'s default `redirect: 'follow'`: undici would chase a 3xx's
// Location header with zero revalidation, so a URL that itself passes the
// private-host check could still redirect to 127.0.0.1 or the cloud-metadata
// address and have that followed unchecked — a single-hop SSRF bypass of the
// entire blocklist above. Every redirect target is re-parsed and re-checked
// with the same parseSafeImageUrl() before it's ever fetched.
export async function fetchImageSafely(rawUrl: string): Promise<{ contentType: string; data: Buffer } | null> {
  let url = parseSafeImageUrl(rawUrl);
  if (!url) return null;

  let res: Response;
  for (let hop = 0; ; hop++) {
    if (hop > MAX_REDIRECTS) return null;

    try {
      res = await fetch(url, { redirect: 'manual', signal: providerRequestSignal() });
    } catch {
      return null;
    }

    if (!REDIRECT_STATUSES.has(res.status)) break;

    const location = res.headers.get('location');
    if (!location) return null;

    let nextUrl: URL;
    try {
      nextUrl = new URL(location, url);
    } catch {
      return null;
    }

    const validated = parseSafeImageUrl(nextUrl.href);
    if (!validated) return null;
    url = validated;
  }

  if (!res.ok || !res.body) return null;

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('image/')) return null;

  const declaredLength = Number(res.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_IMAGE_BYTES) return null;

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  return { contentType, data: Buffer.concat(chunks) };
}
