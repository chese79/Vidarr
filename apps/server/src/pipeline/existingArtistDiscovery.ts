import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma, logActivity } from '../db/client.js';
import { collectArtistVideoInventory } from './artistVideoInventory.js';
import { redactMessage } from '../security/redact.js';

const KEY = 'existing-artist-source-discovery';
const State = z.object({ runId: z.string(), artistIds: z.array(z.number().int().positive()).max(100000), cursor: z.number().int().min(0),
  status: z.enum(['running', 'complete', 'partial']), startedAt: z.string(), completedAt: z.string().nullable().default(null),
  currentArtist: z.string().nullable().default(null), failures: z.array(z.object({ artistId: z.number(), error: z.string() })).default([]) });
type State = z.infer<typeof State>;
const expiresAt = () => new Date(Date.now() + 10 * 365 * 86400_000);
const view = (state: State | null) => state ? { runId: state.runId, status: state.status, total: state.artistIds.length,
  attempted: state.cursor, remaining: Math.max(0, state.artistIds.length - state.cursor), failed: state.failures.length,
  currentArtist: state.currentArtist, startedAt: state.startedAt, completedAt: state.completedAt } : { status: 'idle', total: 0, attempted: 0, remaining: 0, failed: 0, currentArtist: null };

export async function existingArtistDiscoveryStatus() {
  const row = await prisma.liveSearchJournal.findUnique({ where: { key: KEY } });
  return view(row?.payload ? State.parse(JSON.parse(row.payload)) : null);
}

// Explicit operator action only. Snapshot confirmed identities; never add observations
// needing artist review, or expand a running batch when another artist arrives.
export async function startExistingArtistDiscovery() {
  return prisma.$transaction(async tx => {
    const row = await tx.liveSearchJournal.findUnique({ where: { key: KEY } });
    const previous = row?.payload ? State.parse(JSON.parse(row.payload)) : null;
    if (previous?.status === 'running') return view(previous);
    const artists = await tx.artist.findMany({ where: { musicbrainzMatchStatus: 'confirmed', musicbrainzArtistId: { not: null } }, select: { id: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    const state: State = { runId: randomUUID(), artistIds: artists.map(artist => artist.id), cursor: 0,
      status: artists.length ? 'running' : 'complete', startedAt: new Date().toISOString(), currentArtist: null, completedAt: artists.length ? null : new Date().toISOString(), failures: [] };
    const data = { provider: 'artist-source-refresh', payload: JSON.stringify(state), expiresAt: expiresAt(), outcome: state.status, lastSearchAt: new Date() };
    await tx.liveSearchJournal.upsert({ where: { key: KEY }, create: { key: KEY, ...data }, update: data });
    return view(state);
  });
}

let active: Promise<string> | undefined;
let pending = false;
export const existingArtistDiscoveryPending = () => pending;
export function runExistingArtistDiscovery(): Promise<string> {
  if (active) return active;
  active = runNext().finally(() => { active = undefined; }); return active;
}
async function runNext() {
  pending = false;
  const row = await prisma.liveSearchJournal.findUnique({ where: { key: KEY } });
  if (!row?.payload) return 'No existing-artist collection requested';
  const state = State.parse(JSON.parse(row.payload));
  if (state.status !== 'running') return `${state.cursor}/${state.artistIds.length} artists checked; ${state.failures.length} require retry`;
  const artistId = state.artistIds[state.cursor];
  if (!artistId) return 'No artists remain';
  const artist = await prisma.artist.findUnique({ where: { id: artistId }, select: { name: true, musicbrainzMatchStatus: true, musicbrainzArtistId: true } });
  state.currentArtist = artist?.name ?? `Artist ${artistId}`;
  await prisma.liveSearchJournal.update({ where: { key: KEY }, data: { payload: JSON.stringify(state), lastSearchAt: new Date(), expiresAt: expiresAt() } });
  try {
    if (!artist?.musicbrainzArtistId || artist.musicbrainzMatchStatus !== 'confirmed') throw new Error('Artist identity was removed or changed; review before retry');
    // Metadata/source discovery only: no IMVDb expansion, local-file traversal,
    // missing-video search, monitoring changes or download submission.
    const result = await collectArtistVideoInventory(artistId, { refreshImvdb: false, scanLocal: false, enrichIdentity: true });
    const live = await prisma.artist.findUnique({ where: { id: artistId }, select: { liveDiscoveryError: true } });
    const errors = [...result.errors, ...(live?.liveDiscoveryError ? [live.liveDiscoveryError] : [])];
    if (errors.length) throw new Error(errors.join('; '));
  } catch (error) {
    state.failures.push({ artistId, error: redactMessage(error).slice(0, 2000) });
    await logActivity('warn', `existing-artist-discovery:${artistId}`, error);
  }
  // Advance after the attempt. A restart before this checkpoint safely repeats
  // the same artist through idempotent source collection, rather than skipping it.
  state.cursor++; state.currentArtist = null;
  if (state.cursor === state.artistIds.length) { state.status = state.failures.length ? 'partial' : 'complete'; state.completedAt = new Date().toISOString(); }
  await prisma.liveSearchJournal.update({ where: { key: KEY }, data: { payload: JSON.stringify(state), outcome: state.status, lastSearchAt: new Date(), expiresAt: expiresAt() } });
  pending = state.status === 'running';
  return `${state.cursor}/${state.artistIds.length} existing artists checked; ${state.failures.length} require retry; ${state.artistIds.length - state.cursor} remaining`;
}
