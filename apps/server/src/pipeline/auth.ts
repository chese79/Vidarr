import { randomBytes } from 'node:crypto';
import { prisma } from '../db/client.js';

// Generated once, on first boot, and persisted — every subsequent start
// reuses the same key rather than rotating it out from under the user.
// Printed here on first generation (same bootstrap approach Sonarr/Radarr use
// with their own config.xml-stored key) and also revealable once, over HTTP,
// through GET /api/v1/setup/bootstrap-key — see api/setup.ts for the
// one-time-only, time-boxed logic that keeps that endpoint from being a
// standing unauthenticated secret-disclosure route. After first use, it's
// viewable/rotatable from Settings once already authenticated.
export async function ensureApiKey(): Promise<string> {
  const existing = await prisma.settings.findUnique({ where: { id: 1 } });
  if (existing?.apiKey) return existing.apiKey;

  const apiKey = randomBytes(32).toString('hex');
  const generatedAt = new Date();
  await prisma.settings.upsert({
    where: { id: 1 },
    update: { apiKey, apiKeyGeneratedAt: generatedAt, apiKeyFirstUsedAt: null },
    create: { id: 1, apiKey, apiKeyGeneratedAt: generatedAt },
  });

  // eslint-disable-next-line no-console
  console.log(
    `\n[vidarr] Generated a new API key (required on every request — see Settings once logged in to view/rotate it):\n\n    ${apiKey}\n`,
  );

  return apiKey;
}
