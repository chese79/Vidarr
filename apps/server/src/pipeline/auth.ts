import { randomBytes } from 'node:crypto';
import { prisma } from '../db/client.js';

export const BOOTSTRAP_WINDOW_MS = 30 * 60 * 1000;

export interface ClaimableSettings {
  apiKey: string | null;
  apiKeyGeneratedAt: Date | null;
  apiKeyFirstUsedAt: Date | null;
  adminUsername: string | null;
  adminPasswordHash: string | null;
}

// True exactly while a fresh install can still be "claimed" — either by
// revealing the bootstrap API key (api/setup.ts) or by creating the owner
// account directly (api/localAuth.ts's POST /auth/setup). These used to be
// two independently-maintained checks: the bootstrap-key route only ever
// looked at apiKeyFirstUsedAt, so completing owner setup did NOT close it —
// an owner could be claimed via /auth/setup, and for the rest of the
// 30-minute window the raw API key was still handed out to anyone hitting
// the unauthenticated bootstrap-key endpoint, bypassing the new owner
// password entirely. Sharing one predicate means claiming ownership either
// way immediately closes both routes, with no way for them to drift apart
// again.
export function isInstanceClaimable(settings: ClaimableSettings | null): boolean {
  return Boolean(
    settings?.apiKey &&
      settings.apiKeyGeneratedAt &&
      !settings.apiKeyFirstUsedAt &&
      !settings.adminUsername &&
      !settings.adminPasswordHash &&
      Date.now() - settings.apiKeyGeneratedAt.getTime() <= BOOTSTRAP_WINDOW_MS,
  );
}

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
