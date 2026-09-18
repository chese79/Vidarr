import type { FastifyInstance } from 'fastify';
import { CreateDownloadClientSchema } from '@vidarr/shared-types';
import { prisma } from '../db/client.js';
import { getDownloadClientProvider } from '../providers/downloadclient/index.js';

export async function downloadClientRoutes(app: FastifyInstance) {
  app.get('/api/v1/downloadclient', async () => {
    return (await prisma.downloadClient.findMany()).map(redactDownloadClient);
  });

  app.post('/api/v1/downloadclient', async (req, reply) => {
    const body = CreateDownloadClientSchema.parse(req.body);
    const created = await prisma.downloadClient.create({
      data: {
        name: body.name,
        implementation: body.implementation,
        host: body.host,
        port: body.port,
        username: body.username ?? null,
        password: body.password ?? null,
        apiKey: body.apiKey ?? null,
        category: body.category ?? 'vidarr',
        enabled: body.enabled,
      },
    });
    reply.code(201);
    return redactDownloadClient(created);
  });

  app.delete('/api/v1/downloadclient/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    await prisma.downloadClient.delete({ where: { id } });
    reply.code(204);
  });

  app.post('/api/v1/downloadclient/:id/test', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const client = await prisma.downloadClient.findUnique({ where: { id } });
    if (!client) return reply.code(404).send({ error: 'Download client not found' });
    return getDownloadClientProvider(client.implementation).testConnection(client);
  });
}

function redactDownloadClient<T extends { password: string | null; apiKey: string | null }>(client: T) {
  const { password: _password, apiKey: _apiKey, ...safe } = client;
  return safe;
}
