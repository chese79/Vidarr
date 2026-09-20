import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/client.js';
import { hashPassword, verifyPassword } from '../pipeline/password.js';
import { BOOTSTRAP_WINDOW_MS, isInstanceClaimable } from '../pipeline/auth.js';

const MIN_PASSWORD_LENGTH = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;

interface LoginAttempt {
  count: number;
  windowStartedAt: number;
}

function validateCredentials(body: { username?: string; password?: string } | undefined): string | null {
  if (typeof body?.username !== 'string' || !body.username.trim()) return 'Username is required.';
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
  const loginAttempts = new Map<string, LoginAttempt>();

  app.get('/api/v1/auth/login/status', async () => {
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const configured = Boolean(settings?.adminUsername && settings?.adminPasswordHash);
    const setupAllowed = !configured && isInstanceClaimable(settings);
    return { configured, setupAllowed };
  });

  app.post('/api/v1/auth/login', async (req, reply) => {
    const body = req.body as { username?: string; password?: string };
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (!settings?.adminUsername || !settings.adminPasswordHash || !settings.apiKey) {
      return reply.code(400).send({ error: 'Username/password login is not configured.' });
    }

    const attemptKey = req.ip;
    const now = Date.now();
    // Opportunistic sweep of every window that's already expired — this is
    // the only place entries are ever removed besides a successful login, so
    // without it an IP that fails once and never returns (bots/scanners
    // probing this route) would leave a permanent Map entry for the life of
    // the process. Cheap relative to the scrypt work this route already does
    // per request.
    for (const [key, entry] of loginAttempts) {
      if (now - entry.windowStartedAt >= LOGIN_WINDOW_MS) loginAttempts.delete(key);
    }
    const previous = loginAttempts.get(attemptKey);
    const attempt = !previous || now - previous.windowStartedAt >= LOGIN_WINDOW_MS
      ? { count: 0, windowStartedAt: now }
      : previous;
    if (attempt.count >= MAX_LOGIN_ATTEMPTS) {
      return reply.code(429).send({ error: 'Too many sign-in attempts. Try again later.' });
    }
    // Reserve the attempt before awaiting scrypt so parallel requests cannot
    // all pass the limit while the first password checks are still running.
    attempt.count += 1;
    loginAttempts.set(attemptKey, attempt);

    // Same generic error for a wrong username and a wrong password — telling
    // them apart would let an attacker enumerate whether a given username is
    // the configured one. That has to hold for response *timing* too, not
    // just the response body: `||` short-circuiting on the username check
    // would skip the scrypt-based verifyPassword call entirely for a wrong
    // username while still paying its cost for a wrong password, giving an
    // attacker a measurable way to tell the two apart even though the JSON
    // response is identical. Always run verifyPassword against the real
    // stored hash so both failure paths cost the same.
    const invalid = () => reply.code(401).send({ error: 'Invalid username or password.' });

    const usernameMatches = typeof body?.username === 'string' && body.username === settings.adminUsername;
    const suppliedPassword = typeof body?.password === 'string' ? body.password : '';
    const passwordMatches = await verifyPassword(suppliedPassword, settings.adminPasswordHash);
    if (!usernameMatches || !passwordMatches) {
      return invalid();
    }

    loginAttempts.delete(attemptKey);
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
    if (!isInstanceClaimable(settings)) {
      return reply.code(409).send({ error: 'Owner setup is no longer available. Sign in with the existing API key.' });
    }

    const cutoff = new Date(Date.now() - BOOTSTRAP_WINDOW_MS);
    const adminPasswordHash = await hashPassword(body.password!);
    const claimed = await prisma.settings.updateMany({
      where: {
        id: 1,
        apiKey: settings.apiKey,
        apiKeyGeneratedAt: { gte: cutoff },
        apiKeyFirstUsedAt: null,
        adminUsername: null,
        adminPasswordHash: null,
      },
      data: { adminUsername: body.username!.trim(), adminPasswordHash },
    });

    if (claimed.count !== 1) {
      return reply.code(409).send({ error: 'Owner setup is no longer available. Sign in instead.' });
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

    const adminPasswordHash = await hashPassword(body.password!);
    const settings = await prisma.settings.upsert({
      where: { id: 1 },
      update: { adminUsername: body.username!.trim(), adminPasswordHash },
      create: { id: 1, adminUsername: body.username!.trim(), adminPasswordHash },
    });
    loginAttempts.delete(req.ip);
    return { adminUsername: settings.adminUsername };
  });
}
