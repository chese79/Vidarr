import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/client.js';
import { hashPassword, verifyPassword } from '../pipeline/password.js';

const MIN_PASSWORD_LENGTH = 8;

function validateCredentials(body: { username?: string; password?: string }): string | null {
  if (typeof body.username !== 'string' || !body.username.trim()) return 'Username is required.';
  if (typeof body.password !== 'string' || body.password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

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

  // One-time owner setup. This is deliberately unauthenticated because a new
  // install has no usable browser credential yet. The conditional update is
  // the security boundary: only an unclaimed instance can create its owner,
  // and concurrent attempts cannot overwrite the account after one succeeds.
  app.post('/api/v1/auth/setup', async (req, reply) => {
    const body = req.body as { username?: string; password?: string };
    const validationError = validateCredentials(body);
    if (validationError) return reply.code(400).send({ error: validationError });

    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (!settings?.apiKey) {
      return reply.code(503).send({ error: 'Vidarr is still initializing. Please try again.' });
    }

    const adminPasswordHash = hashPassword(body.password!);
    const claimed = await prisma.settings.updateMany({
      where: {
        id: 1,
        OR: [{ adminUsername: null }, { adminPasswordHash: null }],
      },
      data: { adminUsername: body.username!.trim(), adminPasswordHash },
    });

    if (claimed.count !== 1) {
      return reply.code(409).send({ error: 'Owner account is already configured. Sign in instead.' });
    }

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
    const validationError = validateCredentials(body);
    if (validationError) return reply.code(400).send({ error: validationError });

    const adminPasswordHash = hashPassword(body.password!);
    const settings = await prisma.settings.upsert({
      where: { id: 1 },
      update: { adminUsername: body.username!.trim(), adminPasswordHash },
      create: { id: 1, adminUsername: body.username!.trim(), adminPasswordHash },
    });
    return { adminUsername: settings.adminUsername };
  });
}
