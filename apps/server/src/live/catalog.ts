import { prisma } from '../db/client.js';
import { LiveError } from './policy.js';
import { ACTIVE_DOWNLOAD_STATUSES } from '../media/lifecycle.js';
import { SetlistPage } from './setlist.js';

export async function reviewExternalCorrection(id: number, revision: number, action: 'keepUserDetails' | 'applyReferenceMetadata') {
  return prisma.$transaction(async tx => {
    const row = await tx.livePerformance.findUniqueOrThrow({ where: { id } });
    if (row.revision !== revision || !row.correctionPayload) throw new LiveError('Correction changed; reload before reviewing it');
    const source = SetlistPage.parse({ page: 1, total: 1, itemsPerPage: 1, setlist: [JSON.parse(row.correctionPayload)] }).setlist[0];
    const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(source.eventDate);
    if (!match) throw new LiveError('Reference supplied an invalid event date');
    const data = action === 'applyReferenceMetadata' ? { performanceDate: `${match[3]}-${match[2]}-${match[1]}`,
      venue: source.venue.name, venueExternalId: source.venue.id, city: source.venue.city?.name, country: source.venue.city?.country?.code, tour: source.tour?.name ?? null } : {};
    const updated = await tx.livePerformance.updateMany({ where: { id, revision }, data: { ...data, sourceVersion: source.versionId,
      sourcePayload: JSON.stringify(source), correctionPayload: null, userEdited: true, referenceComplete: false, identityStatus: 'reviewedReference', revision: { increment: 1 } } });
    if (!updated.count) throw new LiveError('Performance changed; reload before reviewing');
    // Song identities/coverage remain intact. Changed source order is evidence for separate occurrence review.
    await tx.history.create({ data: { eventType: 'liveReferenceReviewed', data: JSON.stringify({ performanceId: id, action, previous: row.sourcePayload, current: source }) } });
    return { ok: true };
  });
}
export async function removePerformance(id: number, confirmed: boolean) {
  if (!confirmed) throw new LiveError('Confirm removal of this performance catalog entry');
  return prisma.$transaction(async tx => {
    const row = await tx.livePerformance.findUniqueOrThrow({ where: { id }, include: { recordings: true } });
    const recordingIds = row.recordings.map(link => link.recordingId);
    if (await tx.recordingPart.count({ where: { recordingId: { in: recordingIds }, recording: { OR: [{ deletionState: null }, { deletionState: { not: 'deleted' } }] }, OR: [{ available: true }, { serverCopies: { some: { available: true } } }] } })
      || await tx.downloadQueueItem.count({ where: { recordingId: { in: recordingIds }, status: { in: [...ACTIVE_DOWNLOAD_STATUSES] } } })) throw new LiveError('Remove or reassign owned recordings and resolve active downloads before removing a performance');
    if (await tx.recordingPerformance.count({ where: { performanceId: id, recording: { deletionState: null, reviewStatus: { not: 'rejected' } } } })) throw new LiveError('Reassign or remove linked recording candidates before removing their performance');
    // Removal from catalog is reversible; song, credit and indefinite viewing identities remain intact.
    await tx.liveMonitoringRule.updateMany({ where: { performanceId: id }, data: { state: 'cancelled' } });
    await tx.livePerformance.update({ where: { id }, data: { removedAt: new Date(), ignored: true, monitored: false, userEdited: true } });
    return { ok: true };
  });
}
