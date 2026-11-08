import { PrismaClient, type Prisma } from '@prisma/client';
import { sqliteRuntimeUrl } from './sqlite.js';
import { rememberSecrets, redactDiagnostic, redactMessage } from '../security/redact.js';
import { AsyncLocalStorage } from 'node:async_hooks';

const foregroundReads = new AsyncLocalStorage<() => boolean>();
export function withForegroundReads<T>(work: () => T, active: () => boolean = () => true): T {
  return foregroundReads.run(active, work);
}

export const prisma = new PrismaClient(process.env.DATABASE_URL ? {
  datasources: { db: { url: sqliteRuntimeUrl(process.env.DATABASE_URL) } },
} : undefined);
// WAL permits committed reads during a writer transaction. Keep writes serialized,
// but do not put authentication and page reads behind the background write queue.
export const readPrisma = new PrismaClient(process.env.DATABASE_URL ? {
  datasources: { db: { url: sqliteRuntimeUrl(process.env.DATABASE_URL, 2) } },
} : undefined);
const readActions = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy']);
const credentialModels = new Set(['Settings', 'LibraryConnector', 'RecommendationProviderConfig', 'DownloadClient', 'Indexer', 'LastFmAccount', 'LiveConfiguration']);
const sanitizeQuery: Prisma.Middleware = async (params, next) => {
  if (credentialModels.has(params.model ?? '')) rememberSecrets(params.args?.data);
  const sanitize = (data: Record<string, unknown> | undefined) => {
    if (!data) return;
    for (const key of ['error', 'lastError', 'lastPushError', 'videoInventoryError', 'deletionError']) {
      if (typeof data[key] === 'string') data[key] = redactMessage(data[key]);
    }
    if (params.model === 'ActivityLog' && typeof data.message === 'string') data.message = redactMessage(data.message);
    if (params.model === 'History' && typeof data.data === 'string') data.data = redactDiagnostic(data.data);
  };
  const data = params.args?.data;
  if (Array.isArray(data)) data.forEach(sanitize); else sanitize(data);
  sanitize(params.args?.create); sanitize(params.args?.update);
  const result = await next(params);
  if (credentialModels.has(params.model ?? '')) rememberSecrets(result);
  return result;
};
prisma.$use(sanitizeQuery);
readPrisma.$use(sanitizeQuery);
prisma.$use(async (params, next) => {
  // Both interactive and array transactions must retain their original connection
  // and read their own uncommitted writes. Never reroute raw SQL or mutations.
  if (foregroundReads.getStore()?.() && !params.runInTransaction && params.model && readActions.has(params.action)) {
    const key = params.model[0].toLowerCase() + params.model.slice(1);
    const delegate = (readPrisma as unknown as Record<string, Record<string, (args: unknown) => Promise<unknown>>>)[key];
    return delegate[params.action](params.args);
  }
  return next(params);
});

// The recurring "log a caught error to ActivityLog" shape used throughout the
// pipeline — a shared helper so every call site doesn't repeat the same
// four-line prisma.activityLog.create block.
export async function logActivity(
  level: 'info' | 'warn' | 'error',
  source: string,
  err: unknown,
): Promise<void> {
  await prisma.activityLog.create({
    data: { level, source, message: redactMessage(err) },
  });
}
