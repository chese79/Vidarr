import { prisma, logActivity } from '../db/client.js';
import { DAY, liveConfiguration } from './policy.js';
import { discoverSetlists } from './setlist.js';
import { MonitoringInput, monitoringWhere } from './discovery.js';

// Metadata pages have their own accounting (10/rule/day, 1,000/provider/day) and 24h response cache.
export async function runLiveMetadataMonitoring() {
  const { row } = await liveConfiguration();
  if (!row?.setlistApiKey || row.setlistPaused || row.providerRetryAt && row.providerRetryAt > new Date()) return 'setlist.fm history is paused or awaiting configuration';
  const turns = await prisma.$queryRaw<Array<{ id: number }>>`SELECT r.id FROM LiveMonitoringRule r
    LEFT JOIN LiveSearchJournal j ON j.key = 'metadata-cursor:' || r.id
    WHERE r.state = 'active' AND r.performanceId IS NULL
    ORDER BY COALESCE(j.lastSearchAt, 0) ASC, r.id ASC LIMIT 20`;
  const rules = await prisma.liveMonitoringRule.findMany({ where: { id: { in: turns.map(turn => turn.id) } } });
  let pages = 0;
  for (const rule of rules) {
    const input = MonitoringInput.parse(JSON.parse(rule.filters)), key = `metadata-cursor:${rule.id}`;
    const journal = await prisma.liveSearchJournal.findUnique({ where: { key } });
    await prisma.liveSearchJournal.upsert({ where: { key }, create: { key, provider: 'metadata-cursor', lastSearchAt: new Date(), expiresAt: new Date(Date.now() + 365 * DAY) }, update: { lastSearchAt: new Date() } });
    const initialYear = input.from ? Number(input.to?.slice(0, 4) ?? new Date().getFullYear()) : undefined;
    const state = journal?.payload ? JSON.parse(journal.payload) as { year?: number; page: number; refreshAfter?: string } : {
      year: initialYear, page: 1,
    };
    // With no lower bound, page the complete history and apply the upper date
    // locally. Do not issue thousands of empty, year-by-year requests. Repair
    // cursors left at the upper year by earlier releases as well.
    if (!input.from && state.year !== undefined) { delete state.year; state.page = 1; delete state.refreshAfter; }
    if (state.refreshAfter && new Date(state.refreshAfter) > new Date()) continue;
    try {
      const result = await discoverSetlists(rule.artistId, state.page, undefined, { year: state.year, tour: rule.tour ?? undefined, from: input.from, to: input.to, ruleId: rule.id });
      pages++;
      if (result.hasMore) state.page++;
      else if (state.year && input.from && state.year > Number(input.from.slice(0, 4))) { state.year--; state.page = 1; }
      else { state.page = 1; state.year = initialYear; state.refreshAfter = new Date(Date.now() + DAY).toISOString(); }
      await prisma.liveSearchJournal.upsert({ where: { key }, create: { key, provider: 'metadata-cursor', payload: JSON.stringify(state), expiresAt: new Date(Date.now() + 365 * DAY) }, update: { payload: JSON.stringify(state), expiresAt: new Date(Date.now() + 365 * DAY) } });
      await prisma.livePerformance.updateMany({ where: monitoringWhere(input), data: { monitored: true } });
    } catch (error) { await logActivity('warn', `live-metadata-rule:${rule.id}`, error); }
  }
  return `${pages} bounded scoped event-history pages loaded`;
}
