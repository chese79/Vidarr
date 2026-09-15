import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/client.js';
import { hashPassword, verifyPassword } from '../pipeline/password.js';

const MIN_PASSWORD_LENGTH = 8;

// Same relationship to apiKey as Google Sign-On (see api/googleAuth.ts): a
// successful username/password login just hands the browser vidarr's real,
// existing apiKey. Unlike Google's flow, there's no redirect leg — the
// frontend POSTs credentials directly and gets the key back in the response
// body, so no exchange-token indirection is needed here.
export async function localAuthRoutes(app: FastifyInstance) {
  app.get('/api/v1/auth/login/status', async () => {
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    return { configured: Boolean(settings?.adminUsername && settings?.adminPasswordHash) };
  });

  app.post('/api/v1/auth/login', async (req, reply) => {
    const body = req.body as { username?: string; password?: string };
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (!settings?.adminUsername || !settings.adminPasswordHash || !settings.apiKey) {
      return reply.code(400).send({ error: 'Username/password login is not configured.' });
    }

    // Same generic error for a wrong username and a wrong password — telling
    // them apart would let an attacker enumerate whether a given username is
    // the configured one.
    const invalid = () => reply.code(401).send({ error: 'Invalid username or password.' });

    if (typeof body.username !== 'string' || typeof body.password !== 'string') return invalid();
    if (body.username !== settings.adminUsername) return invalid();
    if (!verifyPassword(body.password, settings.adminPasswordHash)) return invalid();

    return { apiKey: settings.apiKey };
  });

  // Sets/changes the single admin login. Requires the existing apiKey (this
  // route is deliberately NOT in app.ts's UNAUTHENTICATED_PATHS) — otherwise
  // anyone reaching this endpoint unauthenticated could set their own
  // username/password and log in as the admin. Only ever accepts a plaintext
  // password here so it can be hashed server-side; the hash itself is never
  // client-settable (see UpdateSettingsSchema, which omits adminPasswordHash).
  app.post('/api/v1/auth/login/credentials', async (req, reply) => {
    const body = req.body as { username?: string; password?: string };
    if (typeof body.username !== 'string' || !body.username.trim()) {
      return reply.code(400).send({ error: 'Username is required.' });
    }
    if (typeof body.password !== 'string' || body.password.length < MIN_PASSWORD_LENGTH) {
      return reply.code(400).send({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
    }

    const adminPasswordHash = hashPassword(body.password);
    const settings = await prisma.settings.upsert({
      where: { id: 1 },
      update: { adminUsername: body.username, adminPasswordHash },
      create: { id: 1, adminUsername: body.username, adminPasswordHash },
    });
    return { adminUsername: settings.adminUsername };
  });
}
