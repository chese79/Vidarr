import type { FastifyInstance } from 'fastify';
import { PreviewYoutubePlaylistBodySchema, CommitYoutubePlaylistBodySchema } from '@vidarr/shared-types';
import { previewYoutubePlaylistImport, commitYoutubePlaylistImport } from '../pipeline/bulkImport.js';

export async function bulkImportRoutes(app: FastifyInstance) {
  app.post('/api/v1/bulkimport/youtube-playlist/preview', async (req, reply) => {
    const body = PreviewYoutubePlaylistBodySchema.parse(req.body);
    try {
      return await previewYoutubePlaylistImport(body.url);
    } catch (err) {
      reply.code(502);
      return { error: (err as Error).message };
    }
  });

  app.post('/api/v1/bulkimport/youtube-playlist/commit', async (req, reply) => {
    const body = CommitYoutubePlaylistBodySchema.parse(req.body);
    try {
      return await commitYoutubePlaylistImport(body.groups, body.rootFolderId, body.qualityProfileId);
    } catch (err) {
      reply.code(502);
      return { error: (err as Error).message };
    }
  });
}
