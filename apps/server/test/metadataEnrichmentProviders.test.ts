import { afterEach, describe, expect, it, vi } from 'vitest';
import { enrichmentAlbumEvidence, clearMusicBrainzCache } from '../src/providers/metadata/musicbrainz.js';
import { enrichmentVideoDirectors } from '../src/providers/metadata/imvdb.js';
const artist = '11111111-1111-4111-8111-111111111111';
const recording = '22222222-2222-4222-8222-222222222222';
const release = '33333333-3333-4333-8333-333333333333';
describe('enrichment MusicBrainz HTTP evidence', () => {
  afterEach(() => { clearMusicBrainzCache(); vi.unstubAllGlobals(); });
  function simulate(options: { wrongArtist?: boolean; missingTrack?: boolean; fail?: boolean } = {}) {
    return vi.fn(async (url: string) => {
      if (options.fail) return new Response('', { status: 503 });
      const credit = [{ artist: { id: options.wrongArtist ? 'other' : artist } }];
      const row = { id: recording, title: 'Tomorrow (US remix)', 'artist-credit': credit, releases: [{ id: release }] };
      const body = url.includes('/release/') ? { id: release, title: 'Your Arsenal', date: '1992-07-27', 'artist-credit': credit, 'label-info': [{ label: { name: 'Label' } }], media: [{ tracks: options.missingTrack ? [] : [{ recording: { id: recording } }] }] } : url.includes('/recording?') ? { recordings: [row] } : row;
      return new Response(JSON.stringify(body), { status: 200 });
    });
  }
  it('verifies explicit recording/release IDs against artist credit and track membership', async () => {
    const fetch = simulate(); vi.stubGlobal('fetch', fetch);
    const rows = await enrichmentAlbumEvidence(artist, 'Tomorrow', recording, release);
    expect(rows).toEqual([expect.objectContaining({ album: 'Your Arsenal', albumYear: 1992, recordLabel: 'Label', verified: true })]);
    expect(fetch.mock.calls[1][0]).toContain('labels+recordings+release-groups');
  });
  it('never substitutes a title-only match for a recording/version identity', async () => {
    vi.stubGlobal('fetch', simulate());
    expect(await enrichmentAlbumEvidence(artist, 'Tomorrow')).toEqual([]);
    expect((await enrichmentAlbumEvidence(artist, 'Tomorrow (US remix)'))[0].verified).toBe(false);
  });
  it('rejects a release that does not contain the recording', async () => {
    vi.stubGlobal('fetch', simulate({ missingTrack: true }));
    expect(await enrichmentAlbumEvidence(artist, 'Tomorrow', recording, release)).toEqual([]);
  });
  it('falls back from a version suffix only for explicitly unverified review suggestions', async () => {
    const original = simulate();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/release/')) return original(url);
      const query = new URL(url).searchParams.get('query') ?? '';
      return new Response(JSON.stringify({ recordings: query.includes('radio') ? [] : [{ id: recording, title: 'Tomorrow', 'artist-credit': [{ artist: { id: artist } }], releases: [{ id: release }] }] }), { status: 200 });
    }));
    const rows = await enrichmentAlbumEvidence(artist, 'Tomorrow (US remix radio edit)');
    expect(rows[0]).toMatchObject({ album: 'Your Arsenal', verified: false });
    expect(rows[0].reason).toContain('Version suffix omitted for search suggestions only');
  });
  it('keeps provider outages distinct from missing facts', async () => {
    vi.stubGlobal('fetch', simulate({ fail: true }));
    await expect(enrichmentAlbumEvidence(artist, 'Tomorrow', recording, release)).rejects.toThrow('503');
  });
  it('reuses a release response for different songs on the same album', async () => {
    const fetch = simulate(); vi.stubGlobal('fetch', fetch);
    const first = await enrichmentAlbumEvidence(artist, 'Tomorrow', recording, release);
    const second = await enrichmentAlbumEvidence(artist, 'Tomorrow again', recording, release);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(first[0].observedAt).toBe(second[0].observedAt);
  });
  it('keeps successful release evidence when another edition lookup fails', async () => {
    const otherRelease = '44444444-4444-4444-8444-444444444444';
    const original = simulate();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/recording?')) return new Response(JSON.stringify({ recordings: [{ id: recording, title: 'Tomorrow', 'artist-credit': [{ artist: { id: artist } }], releases: [{ id: release }, { id: otherRelease }] }] }));
      if (url.includes(otherRelease)) return new Response('', { status: 503 });
      return original(url);
    }));
    const errors: unknown[] = [];
    const rows = await enrichmentAlbumEvidence(artist, 'Tomorrow', undefined, undefined, error => errors.push(error));
    expect(rows).toHaveLength(1); expect(rows[0].releaseId).toBe(release); expect(errors).toHaveLength(1);
  });
  it('retains all IMVDb directors and the canonical source URL, checking exact video identity', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 1234, url: 'https://imvdb.com/video/artist/song', directors: [{ entity_name: 'First Director' }, { entity_name: 'Second Director' }] }), { status: 200 })));
    expect(await enrichmentVideoDirectors('fixture-key', '1234')).toEqual({ directors: ['First Director', 'Second Director'], url: 'https://imvdb.com/video/artist/song' });
    await expect(enrichmentVideoDirectors('fixture-key', '9999')).rejects.toThrow('different video');
  });
  it('does not repeat a failed release lookup shared by two candidate recordings', async () => {
    const otherRecording = '55555555-5555-4555-8555-555555555555';
    const fetch = vi.fn(async (url: string) => url.includes('/release/')
      ? new Response('', { status: 503 }) : new Response(JSON.stringify({ recordings: [recording, otherRecording].map(id => ({ id, title: 'Tomorrow', 'artist-credit': [{ artist: { id: artist } }], releases: [{ id: release }, { id: release }] })) })));
    vi.stubGlobal('fetch', fetch);
    const errors: unknown[] = [];
    expect(await enrichmentAlbumEvidence(artist, 'Tomorrow', undefined, undefined, error => errors.push(error))).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2); expect(errors).toHaveLength(1);
    await enrichmentAlbumEvidence(artist, 'Tomorrow', undefined, undefined, () => {});
    expect(fetch).toHaveBeenCalledTimes(3); // Failed lookups are retried on a later attempt.
  });
});
