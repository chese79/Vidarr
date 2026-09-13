import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import { ensureApiKey } from '../src/pipeline/auth.js';
import { resetDb } from './support/db.js';

describe('ensureApiKey', () => {
  beforeEach(async () => {
    await resetDb();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('generates and persists a random key when none exists yet', async () => {
    const key = await ensureApiKey();

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    const stored = await prisma.settings.findUnique({ where: { id: 1 } });
    expect(stored?.apiKey).toBe(key);
  });

  it('is idempotent — a second call reuses the persisted key instead of rotating it', async () => {
    const first = await ensureApiKey();
    const second = await ensureApiKey();

    expect(second).toBe(first);
    const stored = await prisma.settings.findUnique({ where: { id: 1 } });
    expect(stored?.apiKey).toBe(first);
  });

  it('returns an already-configured key untouched rather than regenerating it', async () => {
    await prisma.settings.upsert({
      where: { id: 1 },
      update: { apiKey: 'pre-existing-key' },
      create: { id: 1, apiKey: 'pre-existing-key' },
    });

    const key = await ensureApiKey();
    expect(key).toBe('pre-existing-key');
  });

  it('generates two different keys across two separate fresh installs', async () => {
    const first = await ensureApiKey();
    await resetDb();
    const second = await ensureApiKey();
    expect(second).not.toBe(first);
  });
});
