import { randomBytes } from 'node:crypto';
import { prisma } from '../db/client.js';

// Generated once, on first boot, and persisted — every subsequent start
// reuses the same key rather than rotating it out from under the user.
// There's no way to view an already-generated key through the API itself
// (every /api/v1/* route requires it, so that would be circular) — it's
// printed here on first generation, same bootstrap approach Sonarr/Radarr
// use with their own config.xml-stored key. After that, it's viewable/
// rotatable from Settings once you're already authenticated.
export async function ensureApiKey(): Promise<string> {
  const existing = await prisma.settings.findUnique({ where: { id: 1 } });
  if (existing?.apiKey) return existing.apiKey;

  const apiKey = randomBytes(32).toString('hex');
  await prisma.settings.upsert({
    where: { id: 1 },
    update: { apiKey },
    create: { id: 1, apiKey },
  });

  // eslint-disable-next-line no-console
  console.log(
    `\n[vidarr] Generated a new API key (required on every request — see Settings once logged in to view/rotate it):\n\n    ${apiKey}\n`,
  );

  return apiKey;
}
