import { recoverRecordingDeletions } from './live/deletion.js';
import './loadEnv.js';
import { buildApp } from './app.js';
import { ensureApiKey } from './pipeline/auth.js';
import { ensureDefaultData } from './pipeline/ensureDefaults.js';
import { startScheduler } from './scheduler/index.js';
import { prisma } from './db/client.js';
import { resumeDownloadQueue } from './pipeline/grab.js';
import { recoverInterruptedVideoDeletions } from './pipeline/deleteVideo.js';
import { resetQualifiedPlaybackContinuity } from './pipeline/qualifiedPlayback.js';

const app = await buildApp();

await ensureApiKey();
await ensureDefaultData();
// Source backfill and user actions write concurrently. WAL lets readers keep
// serving artist pages while a writer commits, avoiding rollback-journal
// lock timeouts during long discovery runs.
await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL');
await prisma.$queryRawUnsafe('PRAGMA busy_timeout=15000');
await resumeDownloadQueue();
await recoverInterruptedVideoDeletions();
await recoverRecordingDeletions();
await prisma.livePlaybackObservation.updateMany({ data: { playing: false } });
await resetQualifiedPlaybackContinuity();

const port = Number(process.env.PORT ?? 3434);
app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

await startScheduler();
