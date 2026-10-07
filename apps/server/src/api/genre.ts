import type { FastifyInstance } from 'fastify';
import { UpdateArtistGenresSchema, GenreStatsQuerySchema } from '@vidarr/shared-types';
import { prisma } from '../db/client.js';
import {
  getArtistGenreView,
  getGenreStats,
  refreshArtistGenres,
  setUserGenres,
} from '../pipeline/artistGenres.js';

export async function genreRoutes(app: FastifyInstance) {
  async function requireArtist(id: number) {
    return prisma.artist.findUnique({ where: { id }, select: { id: true } });
  }

  // The editor's data: genres in force (with how common each is in the library),
  // every source's candidates, and suggested alternatives.
  app.get('/api/v1/artist/:id/genres', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!await requireArtist(id)) return reply.code(404).send({ error: 'Artist not found' });
    return getArtistGenreView(id);
  });

  // Replace the user's explicit genres. An empty list reverts to automatic.
  app.put('/api/v1/artist/:id/genres', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!await requireArtist(id)) return reply.code(404).send({ error: 'Artist not found' });
    const body = UpdateArtistGenresSchema.parse(req.body);
    await setUserGenres(id, body.genres);
    return getArtistGenreView(id);
  });

  // Re-fetch candidates from MusicBrainz and Last.fm. Never removes an existing
  // user edit, and a source that fails or returns nothing keeps its stored rows.
  app.post('/api/v1/artist/:id/genres/refresh', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!await requireArtist(id)) return reply.code(404).send({ error: 'Artist not found' });
    const outcome = await refreshArtistGenres(id);
    return { ...outcome, view: await getArtistGenreView(id) };
  });

  // Counts and percentages of Library artists per genre and sub-genre, plus
  // hints about where consolidating would remove clutter.
  app.get('/api/v1/genres/stats', async (req) => {
    const query = GenreStatsQuerySchema.parse(req.query);
    return getGenreStats(query.smallThreshold);
  });
}
