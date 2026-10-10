import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db/client.js';
import { resetDb, ensureSettings, createRootFolder, createQuality, createQualityProfile, createLibraryConnector, createArtist, createMusicVideo, createLibraryVideo } from '../support/db.js';
import { authHeaders, TEST_API_KEY } from '../support/http.js';
import { searchMusicBrainzArtists, lookupMusicBrainzArtist } from '../../src/providers/metadata/musicbrainz.js';
import { findPublicArtistSlug } from '../../src/providers/metadata/imvdb.js';
import { enrichConfirmedArtist } from '../../src/pipeline/artistIdentity.js';
import { collectArtistVideoInventory } from '../../src/pipeline/artistVideoInventory.js';
import { autoSearchAndGrab } from '../../src/pipeline/autoSearch.js';

vi.mock('../../src/providers/metadata/musicbrainz.js', async (original) => ({ ...await original<object>(), searchMusicBrainzArtists: vi.fn(), lookupMusicBrainzArtist: vi.fn() }));
vi.mock('../../src/providers/metadata/imvdb.js', async (original) => ({ ...await original<object>(), findPublicArtistSlug: vi.fn() }));
vi.mock('../../src/pipeline/artistIdentity.js', async (original) => ({ ...await original<object>(), enrichConfirmedArtist: vi.fn() }));
vi.mock('../../src/pipeline/artistVideoInventory.js', () => ({ collectArtistVideoInventory: vi.fn() }));
vi.mock('../../src/pipeline/autoSearch.js', async (original) => ({ ...await original<object>(), autoSearchAndGrab: vi.fn() }));

describe('Discover artist addition and validation', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let rootFolderId: number;
  let qualityProfileId: number;
  const metadata = { id: '00000000-0000-4000-8000-000000000123', name: 'Example Artist', sortName: 'Example Artist', type: 'Group', country: 'US', disambiguation: null, genres: [], aliases: [] };
  beforeAll(async () => { app = await buildApp(); await app.ready(); });
  afterAll(async () => app.close());
  beforeEach(async () => {
    vi.clearAllMocks(); vi.unstubAllGlobals();
    await resetDb(); await ensureSettings({ apiKey: TEST_API_KEY });
    rootFolderId = (await createRootFolder()).id;
    qualityProfileId = (await createQualityProfile((await createQuality()).id)).id;
    vi.mocked(searchMusicBrainzArtists).mockResolvedValue([]);
    vi.mocked(lookupMusicBrainzArtist).mockResolvedValue(metadata);
    vi.mocked(findPublicArtistSlug).mockResolvedValue(null);
    vi.mocked(enrichConfirmedArtist).mockResolvedValue(metadata);
    vi.mocked(collectArtistVideoInventory).mockResolvedValue({ official: 0, approvedOther: 0, pendingYoutube: 0, pendingLocal: 0, errors: [] });
  });
  const post = (path: string, payload: object) => app.inject({ method: 'POST', url: `/api/v1/artist/${path}`, headers: authHeaders(), payload });

  it('confirms genres and monitors the full collected catalog while skipping owned, pending and active videos', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId, { monitored: false });
    await prisma.artist.update({ where: { id: artist.id }, data: { musicbrainzArtistId: metadata.id, musicbrainzMatchStatus: 'confirmed' } });
    const wanted = await createMusicVideo(artist.id, { title: 'Wanted', monitored: false, ignored: true });
    await createMusicVideo(artist.id, { title: 'Owned', hasFile: true });
    const serverOwned = await createMusicVideo(artist.id, { title: 'Server owned' });
    await createLibraryVideo((await createLibraryConnector()).id, { musicVideoId: serverOwned.id });
    const pending = await createMusicVideo(artist.id, { title: 'Pending' });
    await prisma.musicVideo.update({ where: { id: pending.id }, data: { awaitingServerScanAt: new Date() } });
    const inventory = await createMusicVideo(artist.id, { title: 'Inventory' });
    await prisma.musicVideo.update({ where: { id: inventory.id }, data: { catalogKind: 'inventory' } });
    const active = await createMusicVideo(artist.id, { title: 'Active' });
    await prisma.downloadQueueItem.create({ data: { musicVideoId: active.id, sourceType: 'youtube', sourceRef: 'test', status: 'queued' } });
    let collectedId = 0;
    vi.mocked(collectArtistVideoInventory).mockImplementationOnce(async () => {
      collectedId = (await createMusicVideo(artist.id, { title: 'Collected', monitored: false })).id;
      return { official: 1, approvedOther: 0, pendingYoutube: 0, pendingLocal: 0, errors: ['One source unavailable'] };
    });
    vi.mocked(autoSearchAndGrab).mockImplementation(async (musicVideoId) => ({ musicVideoId, grabbed: true, reason: 'Submitted' }));
    const response = await post(`${artist.id}/confirm-genres-download-all`, { genres: ['rock', 'pop'] });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ monitoredCount: 7, searchedCount: 2, grabbed: 2, skipped: 0, sourceErrors: ['One source unavailable'] });
    expect(vi.mocked(autoSearchAndGrab).mock.calls.map(([id]) => id)).toEqual([wanted.id, collectedId]);
    expect(await prisma.artist.findUnique({ where: { id: artist.id } })).toMatchObject({ monitored: true });
    expect(await prisma.musicVideo.count({ where: { artistId: artist.id, monitored: false } })).toBe(0);
    expect(await prisma.musicVideo.findUnique({ where: { id: wanted.id } })).toMatchObject({ ignored: false });
    expect((await prisma.artistGenre.findMany({ where: { artistId: artist.id, source: 'user' } })).map((g) => g.name).sort()).toEqual(['pop', 'rock']);
  });

  it('continues after source and download failures and keeps failed videos monitored for retry', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId, { monitored: false });
    await prisma.artist.update({ where: { id: artist.id }, data: { musicbrainzArtistId: metadata.id, musicbrainzMatchStatus: 'confirmed' } });
    const first = await createMusicVideo(artist.id, { title: 'First', monitored: false });
    await createMusicVideo(artist.id, { title: 'Second', monitored: false });
    vi.mocked(collectArtistVideoInventory).mockRejectedValueOnce(new Error('offline'));
    vi.mocked(autoSearchAndGrab).mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(async (musicVideoId) => ({ musicVideoId, grabbed: true, reason: 'Submitted' }));
    const response = await post(`${artist.id}/confirm-genres-download-all`, { genres: ['rock'] });
    expect(response.json()).toMatchObject({ grabbed: 1, skipped: 1, failures: [{ musicVideoId: first.id }], sourceErrors: ['Source collection failed; using the existing catalog.'] });
    expect(await prisma.musicVideo.count({ where: { artistId: artist.id, monitored: true } })).toBe(2);
  });

  it('rejects unconfirmed artists and empty genre selection before changing monitoring', async () => {
    const artist = await createArtist(rootFolderId, qualityProfileId, { monitored: false });
    expect((await post(`${artist.id}/confirm-genres-download-all`, { genres: ['rock'] })).statusCode).toBe(409);
    expect((await post(`${artist.id}/confirm-genres-download-all`, { genres: [] })).statusCode).toBe(400);
    expect(collectArtistVideoInventory).not.toHaveBeenCalled();
    expect(autoSearchAndGrab).not.toHaveBeenCalled();
    expect(await prisma.artist.findUnique({ where: { id: artist.id } })).toMatchObject({ monitored: false });
  });

  it('returns MusicBrainz identities and reuses an existing artist when added twice', async () => {
    vi.mocked(searchMusicBrainzArtists).mockResolvedValue([metadata]);
    const search = await app.inject({ method: 'GET', url: '/api/v1/artist/musicbrainz/search?q=Example', headers: authHeaders() });
    expect(search.json()[0].id).toBe(metadata.id);
    const body = { musicbrainzArtistId: metadata.id, rootFolderId, qualityProfileId };
    const first = await post('musicbrainz/add', body);
    expect(first.statusCode).toBe(200);
    await vi.waitFor(() => expect(collectArtistVideoInventory).toHaveBeenCalledTimes(1));
    const second = await post('musicbrainz/add', body);
    await vi.waitFor(() => expect(collectArtistVideoInventory).toHaveBeenCalledTimes(2));
    expect(second.json().id).toBe(first.json().id);
    expect(await prisma.artist.count()).toBe(1);
    expect(second.json().monitored).toBe(false);
  });

  it('rejects unverified artists even when an old client requests a manual override', async () => {
    const body = { name: 'Unknown Artist', rootFolderId, qualityProfileId };
    expect((await post('add-new', body)).statusCode).toBe(409);
    expect(await prisma.artist.count()).toBe(0);
    const added = await post('add-new', { ...body, allowUnverified: true });
    expect(added.statusCode).toBe(409);
    expect(await prisma.artist.count()).toBe(0);
    expect(collectArtistVideoInventory).not.toHaveBeenCalled();
  });

  it('validates a unique MusicBrainz match and collects its sources without enabling downloads', async () => {
    vi.mocked(searchMusicBrainzArtists).mockResolvedValue([metadata]);
    const added = await post('add-new', { name: metadata.name, rootFolderId, qualityProfileId });
    expect(added.json().validation.sources).toEqual(['MusicBrainz']);
    expect(added.json().artist).toMatchObject({ musicbrainzArtistId: metadata.id, monitored: false });
    await vi.waitFor(() => expect(collectArtistVideoInventory).toHaveBeenCalledTimes(1));
  });

  it('does not use IMVDb to validate a new artist', async () => {
    vi.mocked(findPublicArtistSlug).mockResolvedValue('example-artist');
    const added = await post('add-new', { name: metadata.name, rootFolderId, qualityProfileId });
    expect(added.statusCode).toBe(409);
    expect(findPublicArtistSlug).not.toHaveBeenCalled();
    expect(await prisma.artist.count()).toBe(0);
  });

  it('does not fall back to Last.fm when MusicBrainz fails', async () => {
    await prisma.recommendationProviderConfig.create({ data: { provider: 'lastfm', apiKey: 'test-key' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ artist: { name: metadata.name } }) }));
    vi.mocked(searchMusicBrainzArtists).mockRejectedValue(new Error('offline'));
    const result = (await post('validate-new', { name: metadata.name })).json();
    expect(result.validated).toBe(false);
    expect(result.warnings).toContain('MusicBrainz could not be checked. Try again later.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requires identity selection for ambiguous MusicBrainz names and accepts a unique alias', async () => {
    vi.mocked(searchMusicBrainzArtists).mockResolvedValue([metadata, { ...metadata, id: '00000000-0000-4000-8000-000000000124' }]);
    expect((await post('add-new', { name: metadata.name, rootFolderId, qualityProfileId })).statusCode).toBe(409);
    vi.mocked(searchMusicBrainzArtists).mockResolvedValue([{ ...metadata, aliases: ['Alias Name'] }]);
    expect((await post('validate-new', { name: 'Alias Name' })).json()).toMatchObject({ validated: true, musicbrainzArtistId: metadata.id });
  });

  it('persists only usable default playback libraries', async () => {
    const connector = await createLibraryConnector();
    await prisma.libraryConnector.update({ where: { id: connector.id }, data: { videoLibraryId: 'videos' } });
    const put = (id: number) => app.inject({ method: 'PUT', url: '/api/v1/config', headers: authHeaders(), payload: { defaultPlaybackConnectorId: id } });
    expect((await put(connector.id)).json().defaultPlaybackConnectorId).toBe(connector.id);
    await prisma.libraryConnector.update({ where: { id: connector.id }, data: { enabled: false } });
    expect((await put(connector.id)).statusCode).toBe(400);
  });
});
