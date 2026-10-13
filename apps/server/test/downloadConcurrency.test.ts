import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import { queueDirectVideo, grabFromIndexer, refreshQueue, resumeDownloadQueue } from '../src/pipeline/grab.js';
import { drainDownloadQueue } from '../src/pipeline/downloadDispatcher.js';
import { downloadDirectVideo } from '../src/providers/youtube/ytdlp.js';
import { getDownloadClientProvider } from '../src/providers/downloadclient/index.js';
import { resetDb, createRootFolder, createQuality, createQualityProfile, createArtist, createMusicVideo } from './support/db.js';

vi.mock('../src/providers/youtube/ytdlp.js', () => ({ downloadDirectVideo: vi.fn() }));
vi.mock('../src/providers/downloadclient/index.js', () => ({ getDownloadClientProvider: vi.fn() }));
vi.mock('../src/pipeline/validateVideoFile.js', () => ({ assertIsRealMusicVideo: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/pipeline/import.js', () => ({ importDownloadedFile: vi.fn().mockResolvedValue({ path: '/tmp/imported.mp4', sizeBytes: 1n }) }));

vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 });
const waitFor = (callback: () => unknown) => vi.waitFor(callback, { timeout: 10_000 });

const transfers: Array<{ resolve: (path: string) => void; reject: (err: Error) => void }> = [];
let artistId: number;
beforeEach(async () => {
  vi.clearAllMocks(); transfers.length = 0;
  await resetDb();
  const root = await createRootFolder();
  const profile = await createQualityProfile((await createQuality()).id);
  artistId = (await createArtist(root.id, profile.id)).id;
  vi.mocked(downloadDirectVideo).mockImplementation((_url, _dir, _format, progress) => {
    progress?.(0.25);
    return new Promise((resolve, reject) => transfers.push({ resolve, reject }));
  });
});

afterEach(async () => {
  await prisma.downloadQueueItem.deleteMany({ where: { sourceType: 'indexer' } });
  // Let every pending transfer terminate before the next test resets the database.
  await waitFor(async () => {
    transfers.forEach(t => t.reject(new Error('test cleanup')));
    await drainDownloadQueue();
    expect(await prisma.downloadQueueItem.count({ where: { status: { in: ['queued', 'downloading'] } } })).toBe(0);
  });
});

async function addVideo(name: string) {
  return createMusicVideo(artistId, { title: name, normalizedTitle: name.toLowerCase(), youtubeVideoId: name });
}

it('starts only three concurrent transfers, reports progress, and advances FIFO after completion or failure', async () => {
  for (let i = 0; i < 5; i++) await queueDirectVideo((await addVideo(`Song${i}`)).id);
  await waitFor(() => expect(transfers).toHaveLength(3));
  await waitFor(async () => expect(await prisma.downloadQueueItem.count({ where: { status: 'downloading', progress: 0.25 } })).toBe(3));
  expect(await prisma.downloadQueueItem.count({ where: { status: 'queued' } })).toBe(2);
  const snapshot = await refreshQueue();
  expect(snapshot.pending).toBe(5);
  expect(snapshot.queueCounts).toMatchObject({ queued: 2, downloading: 3, importing: 0 });
  transfers[0].resolve('/tmp/nonexistent-test-download.mp4');
  await waitFor(() => expect(transfers).toHaveLength(4));
  expect(vi.mocked(downloadDirectVideo).mock.calls[3][0]).toContain('Song3');
  transfers[1].reject(new Error('Private video'));
  await waitFor(() => expect(transfers).toHaveLength(5));
  expect(vi.mocked(downloadDirectVideo).mock.calls[4][0]).toContain('Song4');
  expect((await prisma.downloadQueueItem.findFirstOrThrow({ where: { status: 'failed' } })).error).toBe('Private video');
  expect(await prisma.downloadQueueItem.count({ where: { status: 'downloading' } })).toBe(3);
});

it('honors a lower configured limit and prevents duplicate waiting jobs', async () => {
  await prisma.settings.create({ data: { id: 1, maxConcurrentDownloads: 1 } });
  await queueDirectVideo((await addVideo('First')).id);
  const second = await addVideo('Second');
  await queueDirectVideo(second.id);
  await drainDownloadQueue();
  await expect(queueDirectVideo(second.id)).rejects.toThrow('active download');
  await waitFor(() => expect(transfers).toHaveLength(1));
  expect(await prisma.downloadQueueItem.count({ where: { status: 'queued' } })).toBe(1);
  await prisma.settings.update({ where: { id: 1 }, data: { maxConcurrentDownloads: 2 } });
  await drainDownloadQueue();
  await waitFor(() => expect(transfers).toHaveLength(2));
});

it('shares slots with external jobs and resumes waiting transfers after an external failure', async () => {
  await prisma.settings.create({ data: { id: 1, maxConcurrentDownloads: 1 } });
  const client = await prisma.downloadClient.create({ data: { name: 'Test', implementation: 'qBittorrent', host: 'localhost', port: 8080 } });
  const addDownload = vi.fn().mockResolvedValue({ externalRef: 'existing-handle' });
  vi.mocked(getDownloadClientProvider).mockReturnValue({ addDownload, testConnection: vi.fn(),
    getStatus: vi.fn().mockResolvedValue({ status: 'failed', progress: 0, error: 'failed' }) });
  await grabFromIndexer((await addVideo('External')).id, client.id, 'https://example.test/file', '1080p');
  await queueDirectVideo((await addVideo('Direct')).id);
  await drainDownloadQueue();
  expect(transfers).toHaveLength(0);
  await refreshQueue();
  await waitFor(() => expect(transfers).toHaveLength(1));
  expect(addDownload).toHaveBeenCalledTimes(1);
});

it('lets active transfers finish when the limit is lowered before starting the next queued video', async () => {
  await prisma.settings.create({ data: { id: 1, maxConcurrentDownloads: 3 } });
  for (let i = 0; i < 4; i++) await queueDirectVideo((await addVideo(`Lower${i}`)).id);
  await waitFor(() => expect(transfers).toHaveLength(3));
  await prisma.settings.update({ where: { id: 1 }, data: { maxConcurrentDownloads: 1 } });
  transfers[0].resolve('/tmp/nonexistent-test-download.mp4');
  await waitFor(async () => expect(await prisma.downloadQueueItem.count({ where: { status: 'downloading' } })).toBe(2));
  await drainDownloadQueue(); expect(transfers).toHaveLength(3);
  transfers[1].resolve('/tmp/nonexistent-test-download.mp4');
  await waitFor(async () => expect(await prisma.downloadQueueItem.count({ where: { status: 'downloading' } })).toBe(1));
  await drainDownloadQueue(); expect(transfers).toHaveLength(3);
  transfers[2].resolve('/tmp/nonexistent-test-download.mp4');
  await waitFor(() => expect(transfers).toHaveLength(4));
});

it('resumes interrupted direct transfers while preserving external and uncertain handles', async () => {
  await prisma.settings.create({ data: { id: 1, maxConcurrentDownloads: 3 } });
  const direct = await addVideo('Interrupted');
  await prisma.downloadQueueItem.create({ data: { musicVideoId: direct.id, sourceType: 'youtube', sourceRef: 'https://youtube.com/watch?v=Interrupted', status: 'downloading', progress: 0.6 } });
  for (const status of ['downloading', 'submissionUnknown']) {
    await prisma.downloadQueueItem.create({ data: { musicVideoId: (await addVideo(status)).id,
      sourceType: 'indexer', sourceRef: `handle-${status}`, status } });
  }
  await resumeDownloadQueue();
  await waitFor(() => expect(transfers).toHaveLength(1));
  expect((await prisma.downloadQueueItem.findMany({ where: { sourceType: 'indexer' }, orderBy: { id: 'asc' } })).map(row => row.sourceRef))
    .toEqual(['handle-downloading', 'handle-submissionUnknown']);
});
