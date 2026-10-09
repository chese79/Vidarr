import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db/client.js';
import { resetDb, ensureSettings, createRootFolder, createQuality, createQualityProfile, createLibraryConnector } from '../support/db.js';
import { authHeaders, TEST_API_KEY } from '../support/http.js';
import { searchMusicBrainzArtists, lookupMusicBrainzArtist } from '../../src/providers/metadata/musicbrainz.js';
import { findPublicArtistSlug } from '../../src/providers/metadata/imvdb.js';
import { enrichConfirmedArtist } from '../../src/pipeline/artistIdentity.js';
import { collectArtistVideoInventory } from '../../src/pipeline/artistVideoInventory.js';

vi.mock('../../src/providers/metadata/musicbrainz.js', async (original) => ({ ...await original<object>(), searchMusicBrainzArtists: vi.fn(), lookupMusicBrainzArtist: vi.fn() }));
vi.mock('../../src/providers/metadata/imvdb.js', async (original) => ({ ...await original<object>(), findPublicArtistSlug: vi.fn() }));
vi.mock('../../src/pipeline/artistIdentity.js', async (original) => ({ ...await original<object>(), enrichConfirmedArtist: vi.fn() }));
vi.mock('../../src/pipeline/artistVideoInventory.js', () => ({ collectArtistVideoInventory: vi.fn() }));

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

  it('requires an explicit override before adding an unverified artist', async () => {
    const body = { name: 'Unknown Artist', rootFolderId, qualityProfileId };
    expect((await post('add-new', body)).statusCode).toBe(409);
    expect(await prisma.artist.count()).toBe(0);
    const added = await post('add-new', { ...body, allowUnverified: true });
    expect(added.statusCode).toBe(200);
    expect(added.json().artist.musicbrainzMatchStatus).toBe('unmatched');
    expect(collectArtistVideoInventory).not.toHaveBeenCalled();
  });

  it('validates a unique MusicBrainz match and collects its sources without enabling downloads', async () => {
    vi.mocked(searchMusicBrainzArtists).mockResolvedValue([metadata]);
    const added = await post('add-new', { name: metadata.name, rootFolderId, qualityProfileId });
    expect(added.json().validation.sources).toEqual(['MusicBrainz']);
    expect(added.json().artist).toMatchObject({ musicbrainzArtistId: metadata.id, monitored: false });
    await vi.waitFor(() => expect(collectArtistVideoInventory).toHaveBeenCalledTimes(1));
  });

  it('accepts an IMVDb-only name as an observation requiring MusicBrainz review', async () => {
    vi.mocked(findPublicArtistSlug).mockResolvedValue('example-artist');
    const added = await post('add-new', { name: metadata.name, rootFolderId, qualityProfileId });
    expect(added.json().validation.sources).toEqual(['IMVDb']);
    expect(added.json().artist).toMatchObject({ imvdbArtistId: 'example-artist', musicbrainzMatchStatus: 'unmatched' });
  });

  it('accepts Last.fm exact names but warns when providers fail or return other names', async () => {
    await prisma.recommendationProviderConfig.create({ data: { provider: 'lastfm', apiKey: 'test-key' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ artist: { name: metadata.name } }) }));
    expect((await post('validate-new', { name: metadata.name })).json().sources).toEqual(['Last.fm']);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ artist: { name: 'Other artist' } }) }));
    vi.mocked(searchMusicBrainzArtists).mockRejectedValue(new Error('offline'));
    const result = (await post('validate-new', { name: metadata.name })).json();
    expect(result.validated).toBe(false);
    expect(result.warnings).toContain('MusicBrainz could not be checked.');
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
