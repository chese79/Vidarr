import { prisma } from '../db/client.js';
import { getDirectVideoMetadata } from '../providers/youtube/ytdlp.js';
import { directVideoUrl, DAY, LiveError } from './policy.js';

export async function inspectRecordingSource(id: number) {
  const source = await prisma.recordingSource.findUniqueOrThrow({ where: { id } });
  const url = directVideoUrl(source.url), key = `source-metadata:${id}`;
  const previous = await prisma.liveSearchJournal.findUnique({ where: { key } });
  const payload = JSON.parse(source.payload);
  if (previous?.retryAt && previous.retryAt > new Date() && payload.inspection) return payload.inspection;
  const day = new Date().toISOString().slice(0, 10), budgetKey = `metadata:direct:${day}`;
  const allowed = await prisma.$transaction(async tx => {
    await tx.liveRequestBudget.upsert({ where: { key: budgetKey }, create: { key: budgetKey }, update: {} });
    return tx.liveRequestBudget.updateMany({ where: { key: budgetKey, used: { lt: 1000 } }, data: { used: { increment: 1 } } }).then(value => value.count);
  });
  if (!allowed) throw new LiveError('Source metadata budget reached; try again in the next daily window');
  const inspection = await getDirectVideoMetadata(url);
  await prisma.$transaction(async tx => {
    await tx.recordingSource.update({ where: { id }, data: { payload: JSON.stringify({ ...payload, inspection }) } });
    if (JSON.stringify(payload.inspection) !== JSON.stringify(inspection)) await tx.livePerformance.updateMany({ where: { recordings: { some: { recordingId: source.recordingId } } }, data: { lastEvidenceAt: new Date() } });
    const data = { lastSearchAt: new Date(), retryAt: new Date(Date.now() + DAY), outcome: 'metadata', expiresAt: new Date(Date.now() + 365 * DAY) };
    await tx.liveSearchJournal.upsert({ where: { key }, create: { key, provider: source.provider, ...data }, update: data });
  });
  return inspection;
}
