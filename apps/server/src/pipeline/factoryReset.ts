import { randomBytes } from 'node:crypto';
import { prisma } from '../db/client.js';

// The actual reset logic for the recovery scenario documented in README.md
// ("Recovering a lost API key"): locked out of the web UI, nothing saved,
// nothing configured. Wipes every way to get in — the API key itself, the
// admin username/password, and Google Sign-On config — then generates a
// fresh API key and re-arms the one-time bootstrap-reveal screen (by
// clearing apiKeyFirstUsedAt), exactly as if this were a brand-new install.
//
// Deliberately just a plain function, not an HTTP route: see
// src/scripts/factoryReset.ts for the CLI entrypoint that gates this behind
// an explicit --yes flag and requires container/host shell access to run at
// all — the same trust level already needed to edit the database by hand.
// An HTTP route reachable with no credentials would let anyone who can reach
// vidarr over the network seize admin access, which defeats the entire point
// of the key gate.
export async function factoryReset(): Promise<string> {
  const apiKey = randomBytes(32).toString('hex');
  const generatedAt = new Date();

  await prisma.settings.upsert({
    where: { id: 1 },
    update: {
      apiKey,
      apiKeyGeneratedAt: generatedAt,
      apiKeyFirstUsedAt: null,
      adminUsername: null,
      adminPasswordHash: null,
      googleClientId: null,
      googleClientSecret: null,
      googleAllowedEmail: null,
    },
    create: { id: 1, apiKey, apiKeyGeneratedAt: generatedAt },
  });

  return apiKey;
}
