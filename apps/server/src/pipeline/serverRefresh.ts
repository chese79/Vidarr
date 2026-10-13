import type { LibraryConnector } from '@prisma/client';
import { prisma, logActivity } from '../db/client.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';

const timers = new Map<number, ReturnType<typeof setTimeout>>();
const running = new Map<number, Promise<void>>();
const lastAttempt = new Map<number, number>();

// Imports persist awaitingServerScanAt before notifying. The five-minute
// reconciliation job recovers notifications lost during shutdown or outages.
export function requestServerRefresh(connectorId: number): void {
  if (timers.has(connectorId)) return;
  const timer = setTimeout(() => {
    timers.delete(connectorId);
    void prisma.libraryConnector.findUnique({ where: { id: connectorId } })
      .then(connector => connector?.enabled && connector.videoLibraryId ? refreshServerLibrary(connector) : undefined)
      .catch(error => logActivity('warn', 'media-server-refresh', error).catch(() => {}));
  }, Math.max(5_000, (lastAttempt.get(connectorId) ?? 0) + 30_000 - Date.now()));
  timer.unref();
  timers.set(connectorId, timer);
}

export function refreshServerLibrary(connector: LibraryConnector): Promise<void> {
  const timer = timers.get(connector.id);
  if (timer) { clearTimeout(timer); timers.delete(connector.id); }
  const existing = running.get(connector.id);
  if (existing) return existing;
  lastAttempt.set(connector.id, Date.now());
  const task = Promise.resolve().then(() => getLibraryConnectorProvider(connector.type).refreshVideoLibrary?.(connector))
    .finally(() => { running.delete(connector.id); });
  running.set(connector.id, task);
  return task;
}
