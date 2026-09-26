import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../src/db/client.js';
import {
  resetDb,
  createRootFolder,
  createQuality,
  createQualityProfile,
  createArtist,
  createMusicVideo,
} from './support/db.js';

// autoSearchAndGrab's YouTube branch is tested here in isolation — the
// heuristic search (youtubeMatch.js) and the actual grab (grab.js) are
// mocked so this only exercises the new validation wiring: does a
// rejected/held candidate get recorded in History and skipped, without
// ever touching the real grab path.
vi.mock('../src/pipeline/youtubeMatch.js', () => ({
  findYoutubeMatch: vi.fn(),
}));
vi.mock('../src/pipeline/youtubeValidation.js', () => ({
  validateCandidate: vi.fn(),
}));
vi.mock('../src/pipeline/grab.js', () => ({
  grabYoutubeVideo: vi.fn(),
  grabFromIndexer: vi.fn(),
}));

describe('autoSearchAndGrab — YouTube candidate validation', () => {
  let rootFolderId: number;
  let qualityProfileId: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDb();
    rootFolderId = (await createRootFolder()).id;
    const quality = await createQuality({ name: 'YouTube', weight: 10 });
    const profile = await createQualityProfile(quality.id);
    qualityProfileId = profile.id;
    await prisma.qualityProfileItem.create({
      data: { qualityProfileId, qualityId: quality.id, allowed: true },
    });
  });

  it('reports an authoritative source ahead of an older verified source', async () => {
    const { grabYoutubeVideo } = await import('../src/pipeline/grab.js');
    vi.mocked(grabYoutubeVideo).mockResolvedValue({ path: '/media/x.mp4' } as never);
    const artist = await createArtist(rootFolderId, qualityProfileId);
    const video = await createMusicVideo(artist.id, { title: 'Song' });
    await prisma.acquisitionSource.createMany({ data: [
      { musicVideoId: video.id, provider: 'youtube', url: 'https://youtube.com/watch?v=older',
        authority: 'verified', confidence: 'confirmed', discoveryOrigin: 'youtube-search', accepted: true },
      { musicVideoId: video.id, provider: 'vimeo', url: 'https://vimeo.com/123',
        authority: 'authoritative', confidence: 'confirmed', discoveryOrigin: 'imvdb', accepted: true },
    ] });
    const { autoSearchAndGrab } = await import('../src/pipeline/autoSearch.js');
    const result = await autoSearchAndGrab(video.id);
    expect(result.grabbed).toBe(true);
    expect(result.reason).toContain('vimeo');
    expect(vi.mocked(grabYoutubeVideo)).toHaveBeenCalledWith(video.id);
  });

  it('does not grab, and records a History row, when validation rejects the candidate', async () => {
    const { findYoutubeMatch } = await import('../src/pipeline/youtubeMatch.js');
    const { validateCandidate } = await import('../src/pipeline/youtubeValidation.js');
    const { grabYoutubeVideo } = await import('../src/pipeline/grab.js');
    vi.mocked(findYoutubeMatch).mockResolvedValue({
      candidate: { youtubeVideoId: 'rejected-id', title: 'Blinding Lights (Lyrics)', channel: 'Some Channel' },
      tier: 'youtube',
    });
    vi.mocked(validateCandidate).mockResolvedValue({ decision: 'reject', reason: 'Title matches a lyric video pattern.' });

    const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'Test Artist' });
    const video = await createMusicVideo(artist.id, { title: 'Blinding Lights' });

    const { autoSearchAndGrab } = await import('../src/pipeline/autoSearch.js');
    const outcome = await autoSearchAndGrab(video.id);

    expect(outcome.grabbed).toBe(false);
    expect(vi.mocked(grabYoutubeVideo)).not.toHaveBeenCalled();

    const history = await prisma.history.findMany({ where: { musicVideoId: video.id } });
    expect(history).toHaveLength(1);
    expect(history[0].eventType).toBe('candidateRejected');
    const data = JSON.parse(history[0].data ?? '{}');
    expect(data).toMatchObject({ source: 'youtube', youtubeVideoId: 'rejected-id', reason: 'Title matches a lyric video pattern.' });
  });

  it('does not grab, and records a distinct History event, when validation holds the candidate for review', async () => {
    const { findYoutubeMatch } = await import('../src/pipeline/youtubeMatch.js');
    const { validateCandidate } = await import('../src/pipeline/youtubeValidation.js');
    const { grabYoutubeVideo } = await import('../src/pipeline/grab.js');
    vi.mocked(findYoutubeMatch).mockResolvedValue({
      candidate: { youtubeVideoId: 'ambiguous-id', title: 'Blinding Lights', channel: 'Some Channel' },
      tier: 'youtube',
    });
    vi.mocked(validateCandidate).mockResolvedValue({ decision: 'review', reason: 'Could not determine motion from the sample clip.' });

    const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'Test Artist' });
    const video = await createMusicVideo(artist.id, { title: 'Blinding Lights' });

    const { autoSearchAndGrab } = await import('../src/pipeline/autoSearch.js');
    const outcome = await autoSearchAndGrab(video.id);

    expect(outcome.grabbed).toBe(false);
    expect(vi.mocked(grabYoutubeVideo)).not.toHaveBeenCalled();

    const history = await prisma.history.findMany({ where: { musicVideoId: video.id } });
    expect(history).toHaveLength(1);
    expect(history[0].eventType).toBe('candidateHeldForReview');
  });

  it('grabs, with no History row, when validation accepts the candidate', async () => {
    const { findYoutubeMatch } = await import('../src/pipeline/youtubeMatch.js');
    const { validateCandidate } = await import('../src/pipeline/youtubeValidation.js');
    const { grabYoutubeVideo } = await import('../src/pipeline/grab.js');
    vi.mocked(findYoutubeMatch).mockResolvedValue({
      candidate: { youtubeVideoId: 'accepted-id', title: 'Blinding Lights', channel: 'The Weeknd' },
      tier: 'youtube',
    });
    vi.mocked(validateCandidate).mockResolvedValue({ decision: 'accept', reason: 'Uploaded by a verified channel.' });
    vi.mocked(grabYoutubeVideo).mockResolvedValue({ path: '/media/x.mp4' } as never);

    const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'Test Artist' });
    const video = await createMusicVideo(artist.id, { title: 'Blinding Lights' });

    const { autoSearchAndGrab } = await import('../src/pipeline/autoSearch.js');
    const outcome = await autoSearchAndGrab(video.id);

    expect(outcome.grabbed).toBe(true);
    expect(vi.mocked(grabYoutubeVideo)).toHaveBeenCalledWith(video.id);

    const history = await prisma.history.findMany({ where: { musicVideoId: video.id } });
    expect(history).toHaveLength(0);
  });

  it('validates a VEVO-tier match too, rather than accepting on tier alone', async () => {
    // isVevo (youtubeMatch.ts) is a bare channel-name substring check, not a
    // verified-channel or IMVDb signal — it must not bypass content-type
    // classification, so this confirms validateCandidate is actually called
    // and its verdict is honored even for a VEVO-tier candidate.
    const { findYoutubeMatch } = await import('../src/pipeline/youtubeMatch.js');
    const { validateCandidate } = await import('../src/pipeline/youtubeValidation.js');
    const { grabYoutubeVideo } = await import('../src/pipeline/grab.js');
    vi.mocked(findYoutubeMatch).mockResolvedValue({
      candidate: { youtubeVideoId: 'vevo-id', title: 'Blinding Lights', channel: 'TheWeekndVEVO' },
      tier: 'vevo',
    });
    vi.mocked(validateCandidate).mockResolvedValue({ decision: 'accept', reason: 'Uploaded by a verified channel.' });
    vi.mocked(grabYoutubeVideo).mockResolvedValue({ path: '/media/x.mp4' } as never);

    const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'Test Artist' });
    const video = await createMusicVideo(artist.id, { title: 'Blinding Lights' });

    const { autoSearchAndGrab } = await import('../src/pipeline/autoSearch.js');
    const outcome = await autoSearchAndGrab(video.id);

    expect(outcome.grabbed).toBe(true);
    expect(vi.mocked(validateCandidate)).toHaveBeenCalledWith('vevo-id', 'Blinding Lights');
  });

  it('rejects a VEVO-tier match whose title matches a reject pattern, same as any other tier', async () => {
    const { findYoutubeMatch } = await import('../src/pipeline/youtubeMatch.js');
    const { validateCandidate } = await import('../src/pipeline/youtubeValidation.js');
    const { grabYoutubeVideo } = await import('../src/pipeline/grab.js');
    vi.mocked(findYoutubeMatch).mockResolvedValue({
      candidate: { youtubeVideoId: 'vevo-lyric-id', title: 'Blinding Lights (Lyrics)', channel: 'TheWeekndVEVO' },
      tier: 'vevo',
    });
    vi.mocked(validateCandidate).mockResolvedValue({ decision: 'reject', reason: 'Title matches a lyric video pattern.' });

    const artist = await createArtist(rootFolderId, qualityProfileId, { name: 'Test Artist' });
    const video = await createMusicVideo(artist.id, { title: 'Blinding Lights' });

    const { autoSearchAndGrab } = await import('../src/pipeline/autoSearch.js');
    const outcome = await autoSearchAndGrab(video.id);

    expect(outcome.grabbed).toBe(false);
    expect(vi.mocked(grabYoutubeVideo)).not.toHaveBeenCalled();

    const history = await prisma.history.findMany({ where: { musicVideoId: video.id } });
    expect(history).toHaveLength(1);
    expect(history[0].eventType).toBe('candidateRejected');
  });
});
