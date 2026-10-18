import { z } from 'zod';
import { prisma } from '../db/client.js';

const checks = z.object({ file: z.boolean().default(true), motion: z.boolean().default(true) });
export const LivePolicy = z.object({
  globalDailyBudget: z.number().int().min(1).max(10000).default(500),
  discoveryRetentionDays: z.number().int().min(1).max(3650).default(90),
  journalRetentionDays: z.number().int().min(90).max(3650).default(365),
  full: checks.default({}), song: checks.default({}),
  fullRootFolderId: z.number().int().positive().nullable().default(null),
  songRootFolderId: z.number().int().positive().nullable().default(null),
  fullConnectorId: z.number().int().positive().nullable().default(null),
  songConnectorId: z.number().int().positive().nullable().default(null),
  fullLibraryId: z.string().trim().min(1).max(100).nullable().default(null),
  songLibraryId: z.string().trim().min(1).max(100).nullable().default(null),
  qualityOrder: z.array(z.enum(['coverage', 'audio', 'visual', 'resolution'])).length(4)
    .refine(values => new Set(values).size === 4).default(['coverage', 'audio', 'visual', 'resolution']),
  preferredOrigin: z.enum(['unknown', 'professional', 'audience']).default('unknown'),
  cleanupRedundantRecordings: z.boolean().default(false),
}).strict();
export type LivePolicy = z.infer<typeof LivePolicy>;
export async function liveConfiguration() {
  const row = await prisma.liveConfiguration.findUnique({ where: { id: 1 } });
  return { row, policy: LivePolicy.parse(JSON.parse(row?.policy ?? '{}')) };
}
export class LiveError extends Error { constructor(message: string, readonly statusCode = 409) { super(message); } }
export const DAY = 86400_000;
export function emptyDelay(count: number): number { return [1, 7, 30, 90][Math.min(3, Math.max(0, count - 1))] * DAY; }
export function directVideoUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new LiveError('Enter a valid YouTube or Vimeo video URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new LiveError('Choose a public HTTPS YouTube or Vimeo video URL');
  if (['youtube.com', 'www.youtube.com', 'music.youtube.com'].includes(url.hostname)) {
    const id = url.searchParams.get('v');
    if (url.pathname === '/watch' && id && /^[\w-]{11}$/.test(id)) return `https://www.youtube.com/watch?v=${id}`;
  }
  if (url.hostname === 'youtu.be' && /^\/[\w-]{11}$/.test(url.pathname)) return `https://www.youtube.com/watch?v=${url.pathname.slice(1)}`;
  if (['vimeo.com', 'www.vimeo.com'].includes(url.hostname) && /^\/\d+$/.test(url.pathname)) return `https://vimeo.com${url.pathname}`;
  throw new LiveError('Choose a single public YouTube or Vimeo video, rather than a channel or arbitrary URL');
}
export function directVideoIdentity(value: string) {
  const url = directVideoUrl(value), parsed = new URL(url);
  return { url, provider: parsed.hostname.includes('vimeo') ? 'vimeo' : 'youtube', externalId: parsed.hostname.includes('vimeo') ? parsed.pathname.slice(1) : parsed.searchParams.get('v')! };
}
