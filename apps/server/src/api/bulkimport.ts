import type { FastifyInstance } from 'fastify';
import { previewYoutubePlaylistImport, commitYoutubePlaylistImport } from '../pipeline/bulkImport.js';
import type { ImportSelection } from '../pipeline/bulkImport.js';

export async function bulkImportRoutes(app: FastifyInstance) {
  app.post('/api/v1/bulkimport/youtube-playlist/preview', async (req, reply) => {
    const body = req.body as { url: string };
    try {
      return await previewYoutubePlaylistImport(body.url);
    } catch (err) {
      reply.code(502);
      return { error: (err as Error).message };
    }
  });

  app.post('/api/v1/bulkimport/youtube-playlist/commit', async (req, reply) => {
    const body = req.body as {
      selections: ImportSelection[];
      rootFolderId: number;
      qualityProfileId: number;
    };
    try {
      return await commitYoutubePlaylistImport(body.selections, body.rootFolderId, body.qualityProfileId);
    } catch (err) {
      reply.code(502);
      return { error: (err as Error).message };
    }
  });
}
