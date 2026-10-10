import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { UpdateSettingsSchema } from '@vidarr/shared-types';
import { prisma } from '../db/client.js';
import { wakeDownloadQueue } from '../pipeline/downloadDispatcher.js';
import { MAX_COOKIE_BYTES, youtubeCookiesConfigured, saveYoutubeCookies, removeYoutubeCookies } from '../providers/youtube/cookies.js';

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/v1/config/youtube-cookies', async () => ({ configured: await youtubeCookiesConfigured() }));
  app.put('/api/v1/config/youtube-cookies', { bodyLimit: MAX_COOKIE_BYTES * 2 }, async (req, reply) => {
    const body = req.body as { cookies?: unknown } | null;
    if (typeof body?.cookies !== 'string') return reply.code(400).send({ error: 'A cookie file is required' });
    try { await saveYoutubeCookies(body.cookies); }
    catch (error) {
      if (!(error as NodeJS.ErrnoException).code) return reply.code(400).send({ error: (error as Error).message });
      throw error;
    }
    return { configured: true };
  });
  app.delete('/api/v1/config/youtube-cookies', async () => {
    await removeYoutubeCookies();
    return { configured: false };
  });
  app.get('/api/v1/config', async () => {
    return serializeSettings(await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }));
  });

  app.put('/api/v1/config', async (req, reply) => {
    const body = UpdateSettingsSchema.parse(req.body);
    if (body.defaultPlaybackConnectorId != null) {
      const connector = await prisma.libraryConnector.findUnique({ where: { id: body.defaultPlaybackConnectorId } });
      if (!connector?.enabled || !connector.videoLibraryId || !['plex', 'jellyfin'].includes(connector.type)) {
        return reply.code(400).send({ error: 'Select an enabled Plex or Jellyfin video library' });
      }
    }
    const settings = await prisma.settings.upsert({
      where: { id: 1 },
      update: body,
      create: { id: 1, ...body },
    });
    if (body.maxConcurrentDownloads != null) wakeDownloadQueue();
    return serializeSettings(settings);
  });

  // Rotates vidarr's own API key. You have to already be authenticated to
  // call this (every /api/v1/* route requires the current key — see
  // main.ts's onRequest hook), so this is self-service rotation, not a
  // bootstrap mechanism. The new key is only ever generated server-side.
  app.post('/api/v1/config/regenerate-api-key', async () => {
    const apiKey = randomBytes(32).toString('hex');
    return serializeSettings(await prisma.settings.upsert({
      where: { id: 1 },
      update: { apiKey },
      create: { id: 1, apiKey },
    }));
  });
}

function serializeSettings<
  T extends {
    imvdbApiKey: string | null;
    googleClientSecret: string | null;
    adminPasswordHash: string | null;
  },
>(settings: T) {
  const { imvdbApiKey, googleClientSecret, adminPasswordHash: _adminPasswordHash, ...safe } = settings;
  return {
    ...safe,
    imvdbApiKey: null,
    googleClientSecret: null,
    adminPasswordHash: null,
    hasImvdbApiKey: Boolean(imvdbApiKey),
    hasGoogleClientSecret: Boolean(googleClientSecret),
  };
}
