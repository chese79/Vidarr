import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:dgram', () => ({
  default: { createSocket: vi.fn() },
}));

import dgram from 'node:dgram';
import { discoverPlexServers, discoverJellyfinServers } from '../src/pipeline/discovery.js';

// Real UDP broadcast/multicast isn't available (or reliable) in a test/CI
// sandbox, so node:dgram is mocked with a fake socket whose 'message' event
// is fired manually — exercising the actual response-parsing logic for each
// protocol without depending on a real Plex/Jellyfin server existing on
// whatever network the tests happen to run on.
class FakeSocket extends EventEmitter {
  bind(cb?: () => void) {
    cb?.();
  }
  setMulticastTTL() {}
  setBroadcast() {}
  send() {}
  close() {}
}

// Short enough to keep the suite fast, long enough that the synchronous
// 'message' emit below always lands before the real setTimeout fires.
const TEST_TIMEOUT_MS = 30;

describe('discoverPlexServers', () => {
  let socket: FakeSocket;

  beforeEach(() => {
    socket = new FakeSocket();
    vi.mocked(dgram.createSocket).mockReturnValue(socket as unknown as dgram.Socket);
  });

  it('parses a real GDM-shaped response into a host/name pair', async () => {
    const resultPromise = discoverPlexServers(TEST_TIMEOUT_MS);
    socket.emit(
      'message',
      Buffer.from(
        'HTTP/1.0 200 OK\r\nContent-Type: plex/media-server\r\nName: myfirstplexserver\r\nPort: 32400\r\nResource-Identifier: abc123\r\n',
      ),
      { address: '10.10.10.100' },
    );
    expect(await resultPromise).toEqual([{ host: 'http://10.10.10.100:32400', name: 'myfirstplexserver' }]);
  });

  it('ignores a response whose status line is not 200 OK', async () => {
    const resultPromise = discoverPlexServers(TEST_TIMEOUT_MS);
    socket.emit('message', Buffer.from('HTTP/1.0 404 Not Found\r\nName: bogus\r\n'), { address: '10.10.10.100' });
    expect(await resultPromise).toEqual([]);
  });

  it('dedupes multiple responses from the same server by Resource-Identifier', async () => {
    const resultPromise = discoverPlexServers(TEST_TIMEOUT_MS);
    const msg = Buffer.from('HTTP/1.0 200 OK\r\nName: myserver\r\nPort: 32400\r\nResource-Identifier: same-id\r\n');
    socket.emit('message', msg, { address: '10.10.10.100' });
    socket.emit('message', msg, { address: '10.10.10.100' });
    expect(await resultPromise).toHaveLength(1);
  });

  it('falls back to the source IP for name and port 32400 when headers are missing', async () => {
    const resultPromise = discoverPlexServers(TEST_TIMEOUT_MS);
    socket.emit('message', Buffer.from('HTTP/1.0 200 OK\r\n'), { address: '10.10.10.100' });
    expect(await resultPromise).toEqual([{ host: 'http://10.10.10.100:32400', name: '10.10.10.100' }]);
  });

  it('resolves with an empty array (not a rejection) if the socket errors', async () => {
    const resultPromise = discoverPlexServers(TEST_TIMEOUT_MS);
    socket.emit('error', new Error('network unreachable'));
    await expect(resultPromise).resolves.toEqual([]);
  });
});

describe('discoverJellyfinServers', () => {
  let socket: FakeSocket;

  beforeEach(() => {
    socket = new FakeSocket();
    vi.mocked(dgram.createSocket).mockReturnValue(socket as unknown as dgram.Socket);
  });

  it('parses a real Jellyfin discovery JSON response', async () => {
    const resultPromise = discoverJellyfinServers(TEST_TIMEOUT_MS);
    socket.emit(
      'message',
      Buffer.from(JSON.stringify({ Address: 'http://192.168.1.50:8096', Id: 'srv-1', Name: 'My Jellyfin' })),
    );
    expect(await resultPromise).toEqual([{ host: 'http://192.168.1.50:8096', name: 'My Jellyfin' }]);
  });

  it('ignores a malformed (non-JSON) response instead of throwing', async () => {
    const resultPromise = discoverJellyfinServers(TEST_TIMEOUT_MS);
    socket.emit('message', Buffer.from('not json at all'));
    expect(await resultPromise).toEqual([]);
  });

  it('ignores a JSON response missing the Address field', async () => {
    const resultPromise = discoverJellyfinServers(TEST_TIMEOUT_MS);
    socket.emit('message', Buffer.from(JSON.stringify({ Id: 'srv-1', Name: 'No Address' })));
    expect(await resultPromise).toEqual([]);
  });

  it('dedupes multiple responses from the same server by Id', async () => {
    const resultPromise = discoverJellyfinServers(TEST_TIMEOUT_MS);
    const msg = Buffer.from(JSON.stringify({ Address: 'http://192.168.1.50:8096', Id: 'srv-1', Name: 'Jellyfin' }));
    socket.emit('message', msg);
    socket.emit('message', msg);
    expect(await resultPromise).toHaveLength(1);
  });
});
