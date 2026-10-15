import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import { queueDirectVideo, grabFromIndexer, refreshQueue, resumeDownloadQueue } from '../src/pipeline/grab.js';
import { drainDownloadQueue } from '../src/pipeline/downloadDispatcher.js';
import { downloadDirectVideo } from '../src/providers/youtube/ytdlp.js';
import { getDownloadClientProvider } from '../src/providers/downloadclient/index.js';
import { assertIsRealMusicVideo } from '../src/pipeline/validateVideoFile.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resetDb, createRootFolder, createQuality, createQualityProfile, createArtist, createMusicVideo, createMusicVideoFile } from './support/db.js';

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
  vi.mocked(assertIsRealMusicVideo).mockReset().mockResolvedValue(undefined);
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
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await prisma.downloadQueueItem.deleteMany({ where: { sourceType: 'indexer' } });
  // Let every pending transfer terminate before the next test resets the database.
  await waitFor(async () => {
    transfers.forEach(t => t.reject(new Error('test cleanup')));
    await drainDownloadQueue();
    expect(await prisma.downloadQueueItem.count({ where: { status: { in: ['queued', 'downloading', 'importing'] } } })).toBe(0);
  });
});

it('overlaps three new transfers with processing and stops at six pipeline reservations', async () => {
  let release!: () => void;
  vi.mocked(assertIsRealMusicVideo).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  try {
    for (let i = 0; i < 7; i++) await queueDirectVideo((await addVideo(`Pipeline${i}`)).id);
    await waitFor(() => expect(transfers).toHaveLength(3));
    transfers.slice(0, 3).forEach((transfer, index) => transfer.resolve(`/tmp/pipeline-${index}.mp4`));
    await waitFor(() => expect(transfers).toHaveLength(6));
    await waitFor(() => expect(assertIsRealMusicVideo).toHaveBeenCalledTimes(1));
    transfers.slice(3, 6).forEach((transfer, index) => transfer.resolve(`/tmp/pipeline-${index + 3}.mp4`));
    await waitFor(async () => expect(await prisma.downloadQueueItem.count({ where: { status: 'importing' } })).toBe(6));
    await drainDownloadQueue();
    expect(transfers).toHaveLength(6);
    expect(await prisma.downloadQueueItem.count({ where: { phase: 'waitingValidation' } })).toBe(5);
    release();
    await waitFor(() => expect(transfers).toHaveLength(7));
  } finally { release?.(); }
});

it('pauses new transfers below the staging disk reserve, then resumes after space returns', async () => {
  const stat = vi.spyOn(fs, 'statfs').mockResolvedValue({ bavail: 0n, bsize: 4096n } as never);
  await queueDirectVideo((await addVideo('Disk reserve')).id);
  await drainDownloadQueue();
  expect(transfers).toHaveLength(0);
  stat.mockRestore();
  await drainDownloadQueue();
  await waitFor(() => expect(transfers).toHaveLength(1));
});

it('resumes a persisted staged file without another transfer', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vidarr-staged-resume-'));
  try {
    const source = path.join(directory, 'video.mp4'); await fs.writeFile(source, 'downloaded');
    const video = await addVideo('Staged resume');
    await prisma.downloadQueueItem.create({ data: { musicVideoId: video.id, sourceType: 'youtube', sourceRef: 'https://youtube.com/watch?v=staged',
      status: 'importing', phase: 'validating', downloadedPath: source, downloadedAt: new Date() } });
    await resumeDownloadQueue();
    await waitFor(async () => expect(await prisma.downloadQueueItem.count()).toBe(0));
    expect(downloadDirectVideo).not.toHaveBeenCalled();
    expect(assertIsRealMusicVideo).toHaveBeenCalledWith(source);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

it('recognizes an atomically committed import after restart without downloading or validating again', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vidarr-committed-resume-'));
  try {
    const file = path.join(directory, 'owned.mp4'); await fs.writeFile(file, 'imported');
    const video = await addVideo('Committed resume');
    await createMusicVideoFile(video.id, { path: file });
    await prisma.musicVideo.update({ where: { id: video.id }, data: { hasFile: true } });
    const item = await prisma.downloadQueueItem.create({ data: { musicVideoId: video.id, sourceType: 'youtube', sourceRef: 'https://youtube.com/watch?v=committed',
      status: 'importing', phase: 'importing', downloadedPath: path.join(directory, 'moved-source.mp4') } });
    await prisma.history.create({ data: { musicVideoId: video.id, eventType: 'downloadFolderImported', data: JSON.stringify({ path: file, queueId: item.id }) } });
    await resumeDownloadQueue();
    expect(await prisma.downloadQueueItem.count()).toBe(0);
    expect(downloadDirectVideo).not.toHaveBeenCalled();
    expect(assertIsRealMusicVideo).not.toHaveBeenCalled();
    expect(await fs.readFile(file, 'utf8')).toBe('imported');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
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

it('stages a completed external job for the shared processor and frees its transfer slot', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vidarr-external-pipeline-'));
  let release!: () => void;
  try {
    const source = path.join(directory, 'external.mp4'); await fs.writeFile(source, 'downloaded');
    await prisma.settings.create({ data: { id: 1, maxConcurrentDownloads: 1 } });
    const client = await prisma.downloadClient.create({ data: { name: 'Test', implementation: 'qBittorrent', host: 'localhost', port: 8080 } });
    vi.mocked(getDownloadClientProvider).mockReturnValue({ addDownload: vi.fn().mockResolvedValue({ externalRef: 'completed-handle' }),
      testConnection: vi.fn(), getStatus: vi.fn().mockResolvedValue({ status: 'completed', progress: 1, contentPath: source }) });
    vi.mocked(assertIsRealMusicVideo).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    await grabFromIndexer((await addVideo('External complete')).id, client.id, 'https://example.test/file', '1080p');
    await queueDirectVideo((await addVideo('Following direct')).id);
    expect((await refreshQueue()).staged).toBe(1);
    await waitFor(() => expect(transfers).toHaveLength(1));
    await waitFor(() => expect(assertIsRealMusicVideo).toHaveBeenCalledWith(source));
    expect(await prisma.downloadQueueItem.findFirst({ where: { sourceType: 'indexer' } })).toMatchObject({
      status: 'importing', phase: 'validating', downloadedPath: source,
    });
    release();
    await waitFor(async () => expect(await prisma.downloadQueueItem.count({ where: { sourceType: 'indexer' } })).toBe(0));
    expect(await fs.readFile(source, 'utf8')).toBe('downloaded');
  } finally { release?.(); await fs.rm(directory, { recursive: true, force: true }); }
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
