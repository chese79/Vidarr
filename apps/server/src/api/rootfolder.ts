import type { FastifyInstance } from 'fastify';
import { CreateRootFolderSchema } from '@vidarr/shared-types';
import { prisma } from '../db/client.js';
import { InvalidRootFolderPathError, normalizeRootFolderPath } from '../pipeline/rootFolderPath.js';

export async function rootFolderRoutes(app: FastifyInstance) {
  app.get('/api/v1/rootfolder', async () => {
    return prisma.rootFolder.findMany();
  });

  app.post('/api/v1/rootfolder', async (req, reply) => {
    const body = CreateRootFolderSchema.parse(req.body);
    try {
      body.path = normalizeRootFolderPath(body.path);
    } catch (err) {
      if (err instanceof InvalidRootFolderPathError) return reply.code(400).send({ error: err.message });
      throw err;
    }
    const created = await prisma.rootFolder.create({ data: body });
    reply.code(201);
    return created;
  });

  app.put('/api/v1/rootfolder/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = CreateRootFolderSchema.partial().parse(req.body);
    if (body.path !== undefined) {
      try {
        body.path = normalizeRootFolderPath(body.path);
      } catch (err) {
        if (err instanceof InvalidRootFolderPathError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    }
    return prisma.rootFolder.update({ where: { id }, data: body });
  });

  app.delete('/api/v1/rootfolder/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    await prisma.rootFolder.delete({ where: { id } });
    reply.code(204);
  });
}
