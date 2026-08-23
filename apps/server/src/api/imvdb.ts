import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/client.js';
import { searchArtists, getArtistVideos } from '../providers/metadata/imvdb.js';

async function requireApiKey(reply: any): Promise<string | null> {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings?.imvdbApiKey) {
    reply.code(428).send({ error: 'IMVDb API key is not configured. Add it in Settings.' });
    return null;
  }
  return settings.imvdbApiKey;
}

export async function imvdbRoutes(app: FastifyInstance) {
  app.get('/api/v1/imvdb/search-artists', async (req, reply) => {
    const apiKey = await requireApiKey(reply);
    if (!apiKey) return;
    const q = (req.query as { q?: string }).q ?? '';
    if (!q.trim()) return [];
    return searchArtists(apiKey, q);
  });

  app.get('/api/v1/imvdb/artist/:slug/videos', async (req, reply) => {
    const apiKey = await requireApiKey(reply);
    if (!apiKey) return;
    const slug = (req.params as { slug: string }).slug;
    const name = (req.query as { name?: string }).name ?? slug;
    return getArtistVideos(apiKey, slug, name);
  });
}
