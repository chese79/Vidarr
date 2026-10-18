import { prisma } from '../db/client.js';
import { searchYoutube } from '../providers/youtube/ytdlp.js';
import { searchIndexer } from '../providers/indexer/torznab.js';
import { redactMessage } from '../security/redact.js';
import { DAY, emptyDelay, LiveError, liveConfiguration } from './policy.js';
import { z } from 'zod';
import { PerformanceDate, LiveSetting, RecordingCoverage } from '@vidarr/shared-types';
import { enqueueRecording } from './acquisition.js';
import { verifiedImprovement } from './evidence.js';

export const MonitoringInput = z.object({ artistId: z.number().int().positive(), performanceId: z.number().int().positive().nullable().default(null),
  tour: z.string().trim().max(200).nullable().default(null), from: PerformanceDate.optional(),
  to: PerformanceDate.optional(), settings: z.array(LiveSetting).max(5).default([]),
  styles: z.array(z.enum(['acoustic', 'electric', 'mixed', 'unknown'])).max(4).default([]),
  origins: z.array(z.enum(['professional', 'audience', 'unknown'])).max(3).default([]),
  sources: z.array(z.enum(['youtube', 'indexer'])).min(1).max(2).default(['youtube', 'indexer']),
  coverage: z.array(RecordingCoverage).max(5).default([]), dailyBudget: z.number().int().min(1).max(500).default(50),
}).strict().refine(value => !value.from || !value.to || value.from <= value.to, 'End date must follow start date');
export type MonitoringInput = z.infer<typeof MonitoringInput>;
export function monitoringWhere(input: MonitoringInput) {
  return { removedAt: null, artistId: input.artistId, id: input.performanceId ?? undefined, ignored: false,
    tour: input.tour ?? undefined, ...(input.settings.length ? { setting: { in: input.settings } } : {}),
    ...(input.styles.length ? { AND: [{ OR: [{ style: { in: input.styles } }, { songs: { some: { style: { in: input.styles } } } }] }] } : {}),
    ...(input.from || input.to ? { performanceDate: { gte: input.from, lte: input.to ? `${input.to}\uffff` : undefined } } : {}),
    ...(input.coverage.length || input.origins.length ? { OR: [{ recordings: { none: {} } }, { recordings: { some: { recording: {
      claimedCoverage: input.coverage.length ? { in: input.coverage } : undefined, origin: input.origins.length ? { in: input.origins } : undefined,
    } } } }] } : {}) };
}
export async function previewMonitoring(input: MonitoringInput) {
  const where = monitoringWhere(input);
  const [performances, knownRecordings, indexers, shared] = await prisma.$transaction([
    prisma.livePerformance.count({ where }), prisma.recording.count({ where: { performances: { some: { performance: where } }, identityVerified: true, videoVerified: true } }),
    prisma.indexer.count({ where: { enabled: true } }), prisma.livePerformance.count({ where: { ...where, monitored: true } }),
  ]);
  const requests = performances * ((input.sources.includes('youtube') ? 1 : 0) + (input.sources.includes('indexer') ? indexers : 0)), { policy } = await liveConfiguration();
  const budget = Math.min(input.dailyBudget, policy.globalDailyBudget);
  return { performances, knownRecordings, shared, estimatedSearches: { min: requests, max: requests * 3 },
    estimatedDays: { min: Math.ceil(requests / budget), max: Math.ceil(requests * 3 / budget) },
    metadataLookups: 'Separate from video searches; event history loads one page at a time',
    explanation: 'One YouTube request plus each enabled indexer per performance. Additional pages and new events increase work; cached and overlapping searches reuse results. Estimates exclude unknown event history.' };
}

// Both counters are claimed in the same SQLite transaction before sending a request.
export async function reserveSearch(ruleId: number | undefined, now = new Date()): Promise<boolean> {
  const { policy } = await liveConfiguration();
  return prisma.$transaction(async tx => {
    const day = now.toISOString().slice(0, 10), globalKey = `global:${day}`;
    await tx.liveRequestBudget.upsert({ where: { key: globalKey }, create: { key: globalKey }, update: {} });
    if (!await tx.liveRequestBudget.updateMany({ where: { key: globalKey, used: { lt: policy.globalDailyBudget } }, data: { used: { increment: 1 } } }).then(value => value.count)) return false;
    if (ruleId) {
      const rule = await tx.liveMonitoringRule.findUniqueOrThrow({ where: { id: ruleId } });
      const key = `rule:${ruleId}:${day}`;
      await tx.liveRequestBudget.upsert({ where: { key }, create: { key }, update: {} });
      const claimed = await tx.liveRequestBudget.updateMany({ where: { key, used: { lt: rule.dailyBudget } }, data: { used: { increment: 1 } } });
      if (!claimed.count || rule.state !== 'active') {
        await tx.liveRequestBudget.update({ where: { key: globalKey }, data: { used: { decrement: 1 } } });
        return false;
      }
    }
    return true;
  });
}
let operation: Promise<unknown> = Promise.resolve();
export function discoverRecordings(performanceId: number, ruleId?: number, force = false): Promise<{ candidates: number; deferred: boolean; errors: string[] }> {
  // Serialize overlap checks with requests. Separate rules cannot spend budget on the same work concurrently.
  const result = operation.catch(() => {}).then(() => discover(performanceId, ruleId, force)); operation = result; return result;
}
async function discover(performanceId: number, ruleId?: number, force = false) {
  const performance = await prisma.livePerformance.findUniqueOrThrow({ where: { id: performanceId }, include: { artist: true } });
  if (performance.ignored) throw new LiveError('This performance is excluded from monitoring');
  if (await prisma.liveExclusion.count({ where: { fingerprint: `artistSet:${performance.artistId}:${performance.id}` } })) return { candidates: 0, deferred: false, errors: [] };
  const indexers = await prisma.indexer.findMany({ where: { enabled: true }, orderBy: { id: 'asc' } });
  const rule = ruleId ? await prisma.liveMonitoringRule.findUniqueOrThrow({ where: { id: ruleId } }) : null;
  const selectedSources = rule ? MonitoringInput.parse(JSON.parse(rule.filters)).sources : ['youtube', 'indexer'];
  const providers = [...(selectedSources.includes('youtube') ? ['youtube'] : []), ...(selectedSources.includes('indexer') ? indexers.map(value => `indexer:${value.id}`) : [])];
  const query = [performance.artist.name, performance.performanceDate, performance.venue, 'live'].filter(Boolean).join(' ');
  let candidates = 0, deferred = false; const errors: string[] = [];
  for (const provider of providers) {
    const key = `search:${performanceId}:${performance.revision}:${provider}`;
    const journal = await prisma.liveSearchJournal.findUnique({ where: { key } });
    if (!force && journal?.retryAt && journal.retryAt > new Date()) continue;
    if (!await reserveSearch(ruleId)) { deferred = true; break; }
    const now = new Date();
    try {
      const results = provider === 'youtube' ? (await searchYoutube(query)).map(value => ({ title: value.title, externalId: value.youtubeVideoId,
        url: `https://www.youtube.com/watch?v=${value.youtubeVideoId}`, payload: value }))
        : (await searchIndexer(indexers.find(value => provider === `indexer:${value.id}`)!, query)).map(value => ({ title: value.title, externalId: value.downloadUrl, url: value.downloadUrl, payload: value }));
      for (const result of results.slice(0, 100)) {
        if (await prisma.liveExclusion.count({ where: { fingerprint: `${provider}:${result.externalId}` } })) continue;
        await prisma.$transaction(async tx => {
          const existing = await tx.recordingSource.findUnique({ where: { provider_externalId: { provider, externalId: result.externalId } } });
          if (existing) return; // Same provider item is identity; a similar title is not.
          await tx.recording.create({ data: { title: result.title, evidenceUrl: result.url, evidence: JSON.stringify(result.payload),
            performances: { create: { performanceId } }, sources: { create: { provider, externalId: result.externalId, url: result.url, payload: JSON.stringify(result.payload) } } } });
          candidates++;
        });
      }
      const emptyCount = results.length ? 0 : (journal?.emptyCount ?? 0) + 1;
      const { policy } = await liveConfiguration();
      const data = { lastSearchAt: now, failures: 0, emptyCount, outcome: results.length ? 'candidates' : 'empty',
        retryAt: new Date(now.getTime() + (results.length ? DAY : emptyDelay(emptyCount))), expiresAt: new Date(now.getTime() + policy.journalRetentionDays * DAY) };
      await prisma.liveSearchJournal.upsert({ where: { key }, create: { key, provider, ...data }, update: data });
    } catch (error) {
      errors.push(`${provider}: ${redactMessage(error)}`);
      const failures = (journal?.failures ?? 0) + 1;
      const authFailed = /\b(?:401|403)\b|unauthori[sz]ed|invalid api.?key/i.test(redactMessage(error));
      const data = { failures, outcome: authFailed ? 'authenticationPaused' : 'error', lastSearchAt: now, retryAt: new Date(now.getTime() + (authFailed ? 365 * DAY : Math.min(DAY, 60000 * 2 ** Math.min(failures, 10)))), expiresAt: new Date(now.getTime() + 365 * DAY) };
      await prisma.liveSearchJournal.upsert({ where: { key }, create: { key, provider, ...data }, update: data });
    }
  }
  await prisma.livePerformance.update({ where: { id: performanceId }, data: { lastSearchAt: new Date() } });
  return { candidates, deferred, errors };
}
export async function runLiveMonitoring() {
  const rules = await prisma.liveMonitoringRule.findMany({ where: { state: 'active' }, orderBy: [{ lastRunAt: 'asc' }, { id: 'asc' }], take: 20 });
  let searched = 0;
  for (const rule of rules) {
    const input = MonitoringInput.parse({ ...JSON.parse(rule.filters), artistId: rule.artistId, performanceId: rule.performanceId, tour: rule.tour, dailyBudget: rule.dailyBudget });
    await prisma.liveMonitoringRule.update({ where: { id: rule.id }, data: { lastRunAt: new Date() } });
    await prisma.livePerformance.updateMany({ where: monitoringWhere(input), data: { monitored: true } });
    const entries = await prisma.livePerformance.findMany({ where: monitoringWhere(input), orderBy: [{ lastSearchAt: 'asc' }, { id: 'asc' }], take: 1 });
    for (const entry of entries) {
      await discoverRecordings(entry.id, rule.id); searched++;
      const recordings = await prisma.recording.findMany({ where: { identityVerified: true, videoVerified: true, reviewStatus: 'accepted', deletionState: null,
        ...(input.origins.length ? { origin: { in: input.origins } } : {}), ...(input.coverage.length ? { claimedCoverage: { in: input.coverage } } : {}),
        performances: { some: { performanceId: entry.id } } }, include: { sources: { where: { accepted: true, available: true } }, parts: { include: { serverCopies: true } },
        queueItems: { where: { OR: [{ status: { in: ['queued', 'downloading', 'importing', 'submissionUnknown'] } }, { status: 'failed', downloadedPath: { not: null } }] } } } });
      if (recordings.some(recording => recording.queueItems.length)) continue;
      const owned = recordings.filter(recording => recording.parts.some(part => part.available || part.serverCopies.some(copy => copy.available)));
      const candidates = recordings.filter(recording => !owned.some(item => item.id === recording.id) && recording.sources.some(source => !source.provider.startsWith('indexer:')));
      const { policy } = await liveConfiguration();
      const eligible = owned.length ? candidates.filter(candidate => owned.every(current => verifiedImprovement(candidate, current, policy.qualityOrder))) : candidates;
      const pinned = eligible.filter(candidate => candidate.preferred || candidate.pinned);
      let chosen = pinned.length === 1 ? pinned[0] : eligible.length === 1 ? eligible[0] : undefined;
      if (!chosen && !pinned.length && eligible.length > 1) {
        const best = eligible.find(candidate => eligible.every(other => other.id === candidate.id || verifiedImprovement(candidate, { ...other, pinned: false }, policy.qualityOrder)));
        if (best) chosen = best;
        else if (!owned.length && policy.preferredOrigin !== 'unknown') {
          const originChoices = eligible.filter(candidate => candidate.origin === policy.preferredOrigin);
          // Explicit origin preference resolves initial, otherwise unranked acquisition; it never proves an upgrade.
          if (originChoices.length === 1) chosen = originChoices[0];
        }
      }
      // Unknown comparisons and multiple unranked versions remain reviewable, rather than guessing quality.
      if (chosen && await prisma.liveMonitoringRule.count({ where: { id: rule.id, state: 'active' } })) {
        const source = chosen.sources.find(source => !source.provider.startsWith('indexer:'));
        const cooldown = await prisma.liveSearchJournal.findUnique({ where: { key: `acquisition:${chosen.id}` } });
        if (cooldown?.retryAt && cooldown.retryAt > new Date()) continue;
        if (source) try { await enqueueRecording(chosen.id, source.id); }
        catch (error) { await prisma.history.create({ data: { recordingId: chosen.id, eventType: 'liveAcquisitionDeferred', data: JSON.stringify({ error: redactMessage(error) }) } }); }
      }
    }
    await prisma.liveMonitoringRule.update({ where: { id: rule.id }, data: { lastRunAt: new Date() } });
  }
  return `${searched} bounded live discovery passes`;
}
