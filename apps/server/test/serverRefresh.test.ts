import { afterEach, expect, it, vi } from 'vitest';
import { requestServerRefresh, refreshServerLibrary } from '../src/pipeline/serverRefresh.js';
import { getLibraryConnectorProvider } from '../src/providers/library/index.js';
import { prisma } from '../src/db/client.js';
import type { LibraryConnector } from '@prisma/client';

vi.mock('../src/db/client.js', () => ({ prisma: { libraryConnector: { findUnique: vi.fn() } }, logActivity: vi.fn() }));
vi.mock('../src/providers/library/index.js', () => ({ getLibraryConnectorProvider: vi.fn() }));
afterEach(() => vi.useRealTimers());

it('coalesces burst imports and shares in-flight refresh with reconciliation', async () => {
  vi.useFakeTimers();
  const connector = { id: 9001, type: 'Jellyfin', enabled: true, videoLibraryId: 'videos' } as LibraryConnector;
  vi.mocked(prisma.libraryConnector.findUnique).mockResolvedValue(connector);
  let release!: () => void;
  const refresh = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
  vi.mocked(getLibraryConnectorProvider).mockReturnValue({ refreshVideoLibrary: refresh } as ReturnType<typeof getLibraryConnectorProvider>);
  requestServerRefresh(connector.id); requestServerRefresh(connector.id); requestServerRefresh(connector.id);
  expect(refresh).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(5000);
  expect(refresh).toHaveBeenCalledTimes(1);
  const reconciliation = refreshServerLibrary(connector);
  expect(refresh).toHaveBeenCalledTimes(1);
  release(); await reconciliation;
  requestServerRefresh(connector.id);
  await vi.advanceTimersByTimeAsync(5000);
  expect(refresh).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(25_000);
  expect(refresh).toHaveBeenCalledTimes(2);
  release(); await refreshServerLibrary(connector);
});
