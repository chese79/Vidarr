import type { FastifyInstance } from 'fastify';
import { previewYoutubePlaylistImport, commitYoutubePlaylistImport } from '../pipeline/bulkImport.js';
import type { ImportArtistGroup } from '../pipeline/bulkImport.js';

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
      groups: ImportArtistGroup[];
      rootFolderId: number;
      qualityProfileId: number;
    };
    try {
      return await commitYoutubePlaylistImport(body.groups, body.rootFolderId, body.qualityProfileId);
    } catch (err) {
      reply.code(502);
      return { error: (err as Error).message };
    }
  });
}
