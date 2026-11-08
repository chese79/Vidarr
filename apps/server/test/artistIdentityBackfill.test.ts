import { beforeEach, expect, it, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import { backfillArtistIdentitySuggestions } from '../src/pipeline/artistIdentityBackfill.js';
import { autoConfirmStoredArtistIdentity, discoverArtistIdentityCandidates } from '../src/pipeline/artistIdentity.js';
import { createArtist, createRootFolder, createQuality, createQualityProfile, resetDb } from './support/db.js';
vi.mock('../src/pipeline/artistIdentity.js', () => ({ autoConfirmStoredArtistIdentity: vi.fn().mockResolvedValue(false), discoverArtistIdentityCandidates: vi.fn().mockResolvedValue([]) }));
beforeEach(async () => { await resetDb(); vi.mocked(autoConfirmStoredArtistIdentity).mockReset().mockResolvedValue(false); vi.mocked(discoverArtistIdentityCandidates).mockReset().mockResolvedValue([]); });
it('bounds discovery, reconsiders ambiguous artists and cools failed attempts while advancing', async () => {
  const root = await createRootFolder();
  const profile = await createQualityProfile((await createQuality()).id);
  const artists = [];
  for (let i = 0; i < 5; i++) artists.push(await createArtist(root.id, profile.id, { name: `Artist ${i}` }));
  await prisma.artist.update({ where: { id: artists[3].id }, data: { musicbrainzMatchStatus: 'ambiguous' } });
  await prisma.artist.update({ where: { id: artists[4].id }, data: { musicbrainzMatchStatus: 'confirmed', musicbrainzArtistId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
  vi.mocked(discoverArtistIdentityCandidates).mockRejectedValueOnce(new Error('provider unavailable'));
  expect(await backfillArtistIdentitySuggestions(2)).toContain('2 observations checked');
  expect((await prisma.artist.findUniqueOrThrow({ where: { id: artists[0].id } })).musicbrainzMatchStatus).toBe('failed');
  expect(await backfillArtistIdentitySuggestions(2)).toContain('2 observations checked');
  expect(vi.mocked(discoverArtistIdentityCandidates).mock.calls.map(call => call[0])).toEqual(artists.slice(0, 4).map(a => a.id));
  expect(await backfillArtistIdentitySuggestions()).toContain('0 observations checked');
});

it('accepts saved 82% proposals immediately and cools a failed acceptance without another search', async () => {
  const root=await createRootFolder(); const profile=await createQualityProfile((await createQuality()).id);
  const artist=await createArtist(root.id,profile.id,{name:'Saved Artist'});
  await prisma.artist.update({where:{id:artist.id},data:{musicbrainzMatchStatus:'ambiguous',musicbrainzRefreshedAt:new Date()}});
  await prisma.musicBrainzArtistCandidate.create({data:{artistId:artist.id,musicbrainzArtistId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Saved Artist',score:0.82,evidence:'{}'}});
  vi.mocked(autoConfirmStoredArtistIdentity).mockImplementationOnce(async id=>{
    await prisma.artist.update({where:{id},data:{musicbrainzMatchEvidence:JSON.stringify({autoConfirmationAttemptedAt:new Date().toISOString()})}});
    throw Error('Provider unavailable');
  });
  expect(await backfillArtistIdentitySuggestions()).toContain('1 observations checked');
  expect(autoConfirmStoredArtistIdentity).toHaveBeenCalledWith(artist.id);
  expect(discoverArtistIdentityCandidates).not.toHaveBeenCalled();
  expect(await backfillArtistIdentitySuggestions()).toContain('0 observations checked');
});

it('prioritizes an already scored proposal over older unsearched observations', async () => {
  const root=await createRootFolder();const profile=await createQualityProfile((await createQuality()).id);
  await createArtist(root.id,profile.id,{name:'Older unsearched artist'});
  const saved=await createArtist(root.id,profile.id,{name:'Ready artist'});
  await prisma.artist.update({where:{id:saved.id},data:{musicbrainzMatchStatus:'suggested',musicbrainzRefreshedAt:new Date()}});
  await prisma.musicBrainzArtistCandidate.create({data:{artistId:saved.id,musicbrainzArtistId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Ready artist',score:0.82,evidence:'{}'}});
  vi.mocked(autoConfirmStoredArtistIdentity).mockResolvedValueOnce(true);
  await backfillArtistIdentitySuggestions(1);
  expect(autoConfirmStoredArtistIdentity).toHaveBeenCalledWith(saved.id);expect(discoverArtistIdentityCandidates).not.toHaveBeenCalled();
});
