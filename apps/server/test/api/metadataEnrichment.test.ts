import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db/client.js';
import { automaticFacts, enrichAfterScan, enrichmentIdentityHint, proposeMetadata, runMetadataEnrichment, startMetadataEnrichment } from '../../src/pipeline/metadataEnrichment.js';
import { resetDb, ensureSettings, createLibraryConnector, createLibraryVideo } from '../support/db.js';
import { authHeaders, TEST_API_KEY } from '../support/http.js';
import type { EnrichmentSnapshot, EnrichmentEvidence } from '@vidarr/shared-types';

const snapshot = (extra: Partial<EnrichmentSnapshot> = {}): EnrichmentSnapshot => ({ ItemId: 'video-1', LibraryId: 'videos-1', Path: '/media/video.mp4', Facts: { artist: 'Artist', title: 'Song' }, ProviderIds: {}, Locked: false, LockedFields: [], NfoHash: 'nfo', NfoValid: true, Fingerprint: 'before', OverlayValid: true, ...extra });
const evidence = (facts: EnrichmentEvidence['facts'], verified = true): EnrichmentEvidence => ({ facts, verified, source: 'test', url: 'https://musicbrainz.org/release/test', entityId: 'test', observedAt: '2026-11-04T00:00:00Z', reason: 'fixture' });
describe('metadata field safety', () => {
  it('uses filename hints for uploader metadata while retaining the version for review', () => {
    const artist = { id: 8, name: 'Morrissey', musicbrainzArtistId: 'artist-id' };
    expect(enrichmentIdentityHint({ title: 'Morrissey - Tomorrow', artistName: 'officialmorrissey', path: 'D:\\media\\Morrissey - Tomorrow (US remix radio edit).mp4' }, [artist])).toEqual({ artist, title: 'Tomorrow (US remix radio edit)', source: 'filename' });
    expect(enrichmentIdentityHint({ title: 'Morrissey - Tomorrow', artistName: 'uploader' }, [artist, { ...artist, id: 9 }])).toBeNull();
  });
  it('fills unique missing facts and preserves populated identity', () => {
    expect(automaticFacts(snapshot(), [evidence({ artist: 'Other', album: 'Album', albumYear: 1992 })])).toEqual({ album: 'Album', albumYear: 1992 });
  });
  it('leaves uncertain and conflicting facts for review', () => {
    expect(automaticFacts(snapshot(), [evidence({ album: 'A' }), evidence({ album: 'B' }), evidence({ directors: ['Guess'] }, false)])).toEqual({});
  });
  it('never mixes a label/year into an ambiguous album package or applies empty credits', () => {
    expect(automaticFacts(snapshot(), [evidence({ album: 'A', albumYear: 1992, recordLabel: 'Label' }), evidence({ album: 'B', albumYear: 1992, recordLabel: 'Label' }), evidence({ directors: [] })])).toEqual({});
  });
  it('preserves locked fields, locked items and malformed NFOs', () => {
    expect(automaticFacts(snapshot({ LockedFields: ['Studios'] }), [evidence({ recordLabel: 'Label' })])).toEqual({});
    expect(automaticFacts(snapshot({ Locked: true }), [evidence({ album: 'Album' })])).toEqual({});
    expect(automaticFacts(snapshot({ NfoValid: false }), [evidence({ album: 'Album' })])).toEqual({});
    expect(automaticFacts(snapshot(), [evidence({ albumYear: 2004 })])).toEqual({});
  });
});
describe('durable enrichment workflow', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let connectorId: number;
  let serverId: string;
  let state: EnrichmentSnapshot;
  let sent: any[];
  beforeAll(async () => { app = await buildApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(async () => {
    await resetDb(); await ensureSettings({ apiKey: TEST_API_KEY });
    const connector = await createLibraryConnector(); connectorId = connector.id;
    await prisma.libraryConnector.update({ where: { id: connectorId }, data: { videoLibraryId: 'videos-1', authToken: 'private-test-token' } });
    await createLibraryVideo(connectorId, { externalId: 'video-1', title: 'Song', artistName: 'Artist' });
    serverId = 'server-1'; state = snapshot({ LocalAlbum: { Name: 'Album', Year: 1992, RecordLabel: 'Label' } }); sent = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      let body: unknown;
      if (url.endsWith('/Capabilities')) body = { MetadataEnrichment: true, Enabled: true, TimingEnabled: true, LibraryIds: ['videos-1'] };
      else if (url.endsWith('/System/Info')) body = { Id: serverId };
      else if (url.endsWith('/MtvOverlay/Libraries')) body = [{ Id: 'videos-1' }];
      else if (options?.method === 'POST') { const patch = JSON.parse(String(options.body)); sent.push(patch); state = { ...state, Facts: { ...state.Facts, ...patch.Facts }, Fingerprint: 'after', OverlayValid: true }; body = state; }
      else body = state;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
  });
  it('requires Vidarr authentication and rejects invalid controls', async () => {
    expect((await app.inject('/api/v1/metadata-enrichment')).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/v1/metadata-enrichment', headers: authHeaders(), payload: { connectorId: -1 } })).statusCode).toBe(400);
  });
  it('queues after a scan, prevents overlap, fills and verifies missing album metadata', async () => {
    await enrichAfterScan(connectorId);
    const run = await startMetadataEnrichment(connectorId);
    expect(await prisma.metadataEnrichmentRun.count()).toBe(1);
    await runMetadataEnrichment();
    expect(sent).toHaveLength(1);
    expect(sent[0].Facts).toEqual({ album: 'Album', albumYear: 1992, recordLabel: 'Label' });
    expect(sent[0].Corrections).toEqual([]);
    const item = await prisma.metadataEnrichmentItem.findFirstOrThrow();
    expect(item.changed).toBe(true); expect(item.status).toBe('review');
    expect((await prisma.metadataEnrichmentRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('completed');
    // Rewind simulates a crash between item completion and cursor checkpoint.
    await prisma.metadataEnrichmentRun.update({ where: { id: run.id }, data: { cursor: 0, status: 'running' } });
    await runMetadataEnrichment(); expect(sent).toHaveLength(1);
  });
  it('pauses and resumes without processing while paused', async () => {
    const run = await startMetadataEnrichment(connectorId);
    await app.inject({ method: 'POST', url: `/api/v1/metadata-enrichment/${run.id}/control`, headers: authHeaders(), payload: { action: 'pause' } });
    await runMetadataEnrichment(); expect(sent).toHaveLength(0);
    await app.inject({ method: 'POST', url: `/api/v1/metadata-enrichment/${run.id}/control`, headers: authHeaders(), payload: { action: 'resume' } });
    await runMetadataEnrichment(); expect(sent).toHaveLength(1);
  });
  it('retains a follow-up scan while a batch is paused and does not bypass pause', async () => {
    const run = await startMetadataEnrichment(connectorId);
    await prisma.metadataEnrichmentRun.update({ where: { id: run.id }, data: { status: 'paused' } });
    await enrichAfterScan(connectorId); await enrichAfterScan(connectorId);
    expect(await prisma.metadataEnrichmentRun.count({ where: { status: 'queued' } })).toBe(1);
    await runMetadataEnrichment(); expect(sent).toHaveLength(0);
    await prisma.metadataEnrichmentRun.update({ where: { id: run.id }, data: { status: 'cancelled' } });
    await runMetadataEnrichment(); expect(sent).toHaveLength(1);
  });
  it('preserves target scope and exposes an actionable pause when the server changes', async () => {
    const run = await startMetadataEnrichment(connectorId); serverId = 'different-server';
    await runMetadataEnrichment(); expect(sent).toHaveLength(0);
    expect((await prisma.metadataEnrichmentRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('paused');
  });
  it('retains exact proposal and request ID across failed publication and retry', async () => {
    const run = await startMetadataEnrichment(connectorId);
    const original = globalThis.fetch;
    let failed = false;
    vi.stubGlobal('fetch', vi.fn(async (url: any, options: any) => {
      if (options?.method === 'POST' && !failed) { failed = true; sent.push(JSON.parse(options.body)); throw new Error('Simulated connection loss'); }
      return original(url, options);
    }));
    await runMetadataEnrichment();
    expect((await prisma.metadataEnrichmentItem.findFirstOrThrow()).status).toBe('failed');
    await app.inject({ method: 'POST', url: `/api/v1/metadata-enrichment/${run.id}/control`, headers: authHeaders(), payload: { action: 'retry' } });
    await runMetadataEnrichment(); expect(sent).toHaveLength(2); expect(sent[0]).toEqual(sent[1]);
  });
  it('pages evidence and never returns connector credentials', async () => {
    const run = await startMetadataEnrichment(connectorId); await runMetadataEnrichment();
    const response = await app.inject({ url: `/api/v1/metadata-enrichment/${run.id}/items?page=1&search=Song`, headers: authHeaders() });
    expect(response.statusCode).toBe(200); expect(response.json().total).toBe(1);
    expect(response.json().items[0].proposal.evidence[0].source).toBe('Jellyfin album');
    expect(response.body).not.toContain('authToken');
  });
  it('pulls MusicBrainz suggestions for an unconfirmed uploader video without accepting identity or album facts', async () => {
    const artist = '11111111-1111-4111-8111-111111111111', recording = '22222222-2222-4222-8222-222222222222', release = '33333333-3333-4333-8333-333333333333';
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: any, options: any) => {
      if (!String(url).startsWith('https://musicbrainz.org/')) return original(url, options);
      const credit = [{ artist: { id: artist } }];
      const body = String(url).includes('/artist?') ? { artists: [{ id: artist, name: 'Morrissey', aliases: [] }] }
        : String(url).includes('/release/') ? { id: release, title: 'Your Arsenal', date: '1992', 'artist-credit': credit, media: [{ tracks: [{ recording: { id: recording } }] }] }
          : { recordings: [{ id: recording, title: 'Tomorrow', 'artist-credit': credit, releases: [{ id: release }] }] };
      return new Response(JSON.stringify(body), { status: 200 });
    }));
    const video = await prisma.libraryVideo.update({ where: { connectorId_externalId: { connectorId, externalId: 'video-1' } }, data: { title: 'Morrissey - Tomorrow', artistName: 'officialmorrissey', path: 'D:\\media\\Morrissey - Tomorrow (US remix radio edit).mp4' } });
    const before = snapshot({ Facts: { artist: 'officialmorrissey', title: 'Morrissey - Tomorrow' } });
    const proposal = await proposeMetadata(video, before);
    expect(proposal.evidence.some(row => row.source === 'MusicBrainz artist suggestion')).toBe(true);
    const index = proposal.evidence.findIndex(row => row.facts.album === 'Your Arsenal');
    expect(index).toBeGreaterThanOrEqual(0);
    expect(proposal.evidence[index]).toMatchObject({ verified: false, requiresArtistReview: true });
    expect(proposal.automatic).toEqual({}); expect(await prisma.artist.count()).toBe(0);
    const run = await startMetadataEnrichment(connectorId);
    const item = await prisma.metadataEnrichmentItem.create({ data: { runId: run.id, libraryVideoId: video.id, externalId: video.externalId, title: video.title, artistName: video.artistName, beforeJson: JSON.stringify(before), proposalJson: JSON.stringify(proposal), status: 'review' } });
    const response = await app.inject({ method: 'POST', url: `/api/v1/metadata-enrichment/items/${item.id}/apply`, headers: authHeaders(), payload: { evidenceIndex: index, fields: ['album', 'albumYear'], corrections: false } });
    expect(response.statusCode).toBe(409); expect(response.json().error).toContain('Artist Review'); expect(sent).toHaveLength(0);
  });
});
