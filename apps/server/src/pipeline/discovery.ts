import dgram from 'node:dgram';

export interface DiscoveredServer {
  host: string;
  name: string;
}

const DEFAULT_TIMEOUT_MS = 2000;

// Plex's GDM ("Good Day Mate") discovery protocol — verified against
// python-plexapi's reference implementation (plexapi/gdm.py) rather than
// guessed: send 'M-SEARCH * HTTP/1.0' to the multicast group
// 239.0.0.250:32414 with TTL 1 (local subnet only), then listen on the same
// socket for unicast replies. Each server replies with an HTTP-response-
// shaped text blob ("HTTP/1.0 200 OK" followed by colon-delimited headers),
// not JSON. Name/Port come from those headers; the host IP comes from the
// UDP packet's own source address, not the response's Host header (which is
// a *.plex.direct wildcard hostname, not a plain IP, and less reliable here).
export function discoverPlexServers(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<DiscoveredServer[]> {
  const found = new Map<string, DiscoveredServer>();
  const socket = dgram.createSocket('udp4');

  socket.on('message', (msg, rinfo) => {
    const text = msg.toString('utf8');
    const lines = text.split(/\r?\n/);
    if (!lines[0]?.includes('200 OK')) return;

    const headers: Record<string, string> = {};
    for (const line of lines.slice(1)) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }

    const port = headers['Port'] ?? '32400';
    const key = headers['Resource-Identifier'] ?? `${rinfo.address}:${port}`;
    found.set(key, { host: `http://${rinfo.address}:${port}`, name: headers['Name'] ?? rinfo.address });
  });
  // A broadcast/multicast send can fail on some host/container network
  // setups (no multicast route, etc.) — that just means "found nothing,"
  // not a reason to reject the request that triggered discovery.
  socket.on('error', () => {});

  return new Promise((resolve) => {
    socket.bind(() => {
      socket.setMulticastTTL(1);
      socket.send('M-SEARCH * HTTP/1.0', 32414, '239.0.0.250');
    });
    setTimeout(() => {
      socket.close();
      resolve([...found.values()]);
    }, timeoutMs);
  });
}

// Jellyfin's own documented UDP auto-discovery: broadcast the literal string
// "who is JellyfinServer?" to 255.255.255.255:7359; each server on the LAN
// replies with a JSON object — {Address, Id, Name}. Address is already a
// full base URL (e.g. "http://192.168.1.50:8096"), unlike Plex's response.
export function discoverJellyfinServers(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<DiscoveredServer[]> {
  const found = new Map<string, DiscoveredServer>();
  const socket = dgram.createSocket('udp4');

  socket.on('message', (msg) => {
    let parsed: { Address?: string; Id?: string; Name?: string };
    try {
      parsed = JSON.parse(msg.toString('utf8'));
    } catch {
      return;
    }
    if (!parsed.Address) return;
    const key = parsed.Id ?? parsed.Address;
    found.set(key, { host: parsed.Address, name: parsed.Name ?? parsed.Address });
  });
  socket.on('error', () => {});

  return new Promise((resolve) => {
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send('who is JellyfinServer?', 7359, '255.255.255.255');
    });
    setTimeout(() => {
      socket.close();
      resolve([...found.values()]);
    }, timeoutMs);
  });
}
