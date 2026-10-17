import { PrismaClient } from '@prisma/client';
import { sqliteRuntimeUrl } from './sqlite.js';
import { rememberSecrets, redactDiagnostic, redactMessage } from '../security/redact.js';

export const prisma = new PrismaClient(process.env.DATABASE_URL ? {
  datasources: { db: { url: sqliteRuntimeUrl(process.env.DATABASE_URL) } },
} : undefined);
const credentialModels = new Set(['Settings', 'LibraryConnector', 'RecommendationProviderConfig', 'DownloadClient', 'Indexer', 'LastFmAccount']);
prisma.$use(async (params, next) => {
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
