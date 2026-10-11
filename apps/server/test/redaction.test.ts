import { beforeEach, expect, it } from 'vitest';
import { prisma, logActivity } from '../src/db/client.js';
import { redactDiagnostic, redactMessage, rememberSecrets } from '../src/security/redact.js';
import { resetDb, createRootFolder, createQuality, createQualityProfile, createArtist, createMusicVideo } from './support/db.js';

beforeEach(resetDb);

it('redacts known, encoded and URL credentials while preserving diagnostic structure', () => {
  rememberSecrets({ apiKey: 'example-secret/encoded', password: 'another-secret-value' });
  const raw = 'https://user:pass@example.test/api?apikey=abc&token=xyz example-secret%2Fencoded Bearer session-value';
  const redacted = redactMessage(raw);
  expect(redacted).not.toContain('user:pass'); expect(redacted).not.toContain('=abc');
  expect(redacted).not.toContain('=xyz'); expect(redacted).not.toContain('example-secret'); expect(redacted).not.toContain('session-value');
  expect(JSON.parse(redactDiagnostic(JSON.stringify({ error: raw, quality: '1080p', password: 'another-secret-value' })))).toMatchObject({ quality: '1080p', password: '[REDACTED]' });
});

it('sanitizes activity, history and persisted queue diagnostics centrally', async () => {
  await prisma.settings.create({ data: { id: 1, apiKey: 'known-private-key' } });
  const root = await createRootFolder();
  const profile = await createQualityProfile((await createQuality()).id);
  const artist = await createArtist(root.id, profile.id);
  const video = await createMusicVideo(artist.id);
  const error = 'Provider returned known-private-key from https://example.test?password=secret-value';
  await logActivity('warn', 'test', new Error(error));
  const history = await prisma.history.create({ data: { musicVideoId: video.id, eventType: 'downloadFailed', data: JSON.stringify({ error, quality: '1080p' }) } });
  const queue = await prisma.downloadQueueItem.create({ data: { musicVideoId: video.id, sourceType: 'youtube', sourceRef: 'video', status: 'failed', error } });
  const log = await prisma.activityLog.findFirstOrThrow();
  for (const diagnostic of [history.data!, queue.error!, log.message]) {
    expect(diagnostic).not.toContain('known-private-key'); expect(diagnostic).not.toContain('secret-value');
  }
  expect(JSON.parse(history.data!)).toMatchObject({ quality: '1080p' });
});
