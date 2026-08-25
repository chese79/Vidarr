import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

// The recurring "log a caught error to ActivityLog" shape used throughout the
// pipeline — a shared helper so every call site doesn't repeat the same
// four-line prisma.activityLog.create block.
export async function logActivity(
  level: 'info' | 'warn' | 'error',
  source: string,
  err: unknown,
): Promise<void> {
  await prisma.activityLog.create({
    data: { level, source, message: err instanceof Error ? err.message : String(err) },
  });
}
