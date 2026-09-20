import type { FastifyInstance } from 'fastify';
import { CreateDownloadClientSchema, UpdateDownloadClientSchema } from '@vidarr/shared-types';
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

  // Same reasoning as libraryconnector.ts's PUT route: fixing a wrong
  // host/port/credential previously meant deleting the row and losing its
  // priority/category settings. implementation is intentionally not
  // editable here — switching qBittorrent/SABnzbd changes which credential
  // fields even apply, which is a "remove and re-add" decision, not an edit.
  app.put('/api/v1/downloadclient/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const body = UpdateDownloadClientSchema.parse(req.body);
    return redactDownloadClient(
      await prisma.downloadClient.update({
        where: { id },
        data: {
          ...(body.name !== undefined && { name: body.name }),
          ...(body.host !== undefined && { host: body.host }),
          ...(body.port !== undefined && { port: body.port }),
          ...(body.username !== undefined && { username: body.username }),
          ...(body.password !== undefined && { password: body.password }),
          ...(body.apiKey !== undefined && { apiKey: body.apiKey }),
          ...(body.category !== undefined && { category: body.category }),
          ...(body.enabled !== undefined && { enabled: body.enabled }),
        },
      }),
    );
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

// Matches the has<Field> convention used by redactIndexer/serializeConnector
// elsewhere, rather than dropping the fields with no signal at all — the
// Edit form needs to know a credential is already set without ever seeing
// its value, e.g. to show "leave blank to keep current" correctly.
function redactDownloadClient<T extends { password: string | null; apiKey: string | null }>(client: T) {
  const { password, apiKey, ...safe } = client;
  return { ...safe, password: null, apiKey: null, hasPassword: Boolean(password), hasApiKey: Boolean(apiKey) };
}
