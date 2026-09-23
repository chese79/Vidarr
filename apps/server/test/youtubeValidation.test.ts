import { describe, it, expect, vi, beforeEach } from 'vitest';
import { classifyCandidate } from '../src/pipeline/youtubeValidation.js';
import type { YoutubeVideoMetadata } from '../src/providers/youtube/ytdlp.js';

function metadata(overrides: Partial<YoutubeVideoMetadata> = {}): YoutubeVideoMetadata {
  return {
    title: 'Blinding Lights',
    channel: 'The Weeknd',
    description: 'Official music video.',
    channelIsVerified: false,
    ...overrides,
  };
}

describe('classifyCandidate', () => {
  it('rejects a "- Topic" auto-generated channel', () => {
    const result = classifyCandidate(metadata({ channel: 'The Weeknd - Topic' }));
    expect(result.decision).toBe('reject');
    expect(result.reason).toMatch(/topic/i);
  });

  it('rejects a "Provided to YouTube by" description (label-ingested audio)', () => {
    const result = classifyCandidate(metadata({ description: 'Provided to YouTube by Republic Records' }));
    expect(result.decision).toBe('reject');
    expect(result.reason).toMatch(/provided to youtube/i);
  });

  it('rejects a lyric video by title', () => {
    const result = classifyCandidate(metadata({ title: 'Blinding Lights (Lyrics)' }));
    expect(result.decision).toBe('reject');
  });

  it('rejects karaoke, visualizer, reaction, cover, live, instrumental, and trailer patterns', () => {
    const titles = [
      'Blinding Lights (Karaoke Version)',
      'Blinding Lights (Visualizer)',
      'Blinding Lights REACTION',
      'Blinding Lights (Cover by Someone)',
      'Blinding Lights Live at the Grammys',
      'Blinding Lights (Instrumental)',
      'Blinding Lights - Official Trailer',
    ];
    for (const title of titles) {
      expect(classifyCandidate(metadata({ title })).decision, title).toBe('reject');
    }
  });

  it('does not reject a title that merely contains a substring of a reject word inside another word', () => {
    // "cover" as a whole word rejects; a word merely containing similar
    // letters should not (word-boundary matching, not bare substring).
    const result = classifyCandidate(metadata({ title: 'Discovery' }));
    expect(result.decision).not.toBe('reject');
  });

  it('does not reject a real song title that happens to contain the bare word "cover"', () => {
    // Regression: a bare /\bcover\b/ against the fully-normalized title
    // (which strips all punctuation) previously rejected legitimate titles
    // like Bruce Springsteen's "Cover Me" indiscriminately from any fan-cover
    // upload. The cover check now only fires for actual fan-cover title
    // conventions (parenthesized/bracketed/dashed/qualified "cover"), not a
    // bare occurrence of the word.
    const result = classifyCandidate(metadata({ title: 'Cover Me' }));
    expect(result.decision).not.toBe('reject');
  });

  it('still rejects common fan-cover title conventions: parenthetical, dash-suffixed, and qualified', () => {
    const titles = [
      'Blinding Lights (Cover)',
      'Blinding Lights [Acoustic Cover]',
      'Blinding Lights - Cover',
      'Acoustic Cover of Blinding Lights',
      'Blinding Lights (Piano Cover)',
      'Blinding Lights - Cover Version',
    ];
    for (const title of titles) {
      expect(classifyCandidate(metadata({ title })).decision, title).toBe('reject');
    }
  });

  it('holds a verified channel for visual validation instead of accepting uploader status alone', () => {
    const result = classifyCandidate(metadata({ channelIsVerified: true }));
    expect(result.decision).toBe('review');
    expect(result.reason).toMatch(/visual validation/i);
  });

  it('an unverified channel with no negative signal lands in review, not accept or reject', () => {
    const result = classifyCandidate(metadata());
    expect(result.decision).toBe('review');
  });

  it('a reject pattern takes priority over channel verification', () => {
    const result = classifyCandidate(metadata({ channelIsVerified: true, title: 'Blinding Lights (Lyrics)' }));
    expect(result.decision).toBe('reject');
  });

  it('does not mistake a cover phrase in the canonical song title for a fan-cover marker', () => {
    const result = classifyCandidate(
      metadata({ title: 'The Strokes - Under Cover of Darkness (Official Video)' }),
      'Under Cover of Darkness',
    );
    expect(result.decision).not.toBe('reject');
  });

  it('still rejects a cover marker when the canonical title itself does not contain cover', () => {
    const result = classifyCandidate(metadata({ title: 'Blinding Lights - Acoustic Cover' }), 'Blinding Lights');
    expect(result.decision).toBe('reject');
  });
});

// resolveReview/validateCandidate orchestrate real downloads and ffmpeg
// invocations (providers/youtube/ytdlp.ts, pipeline/validateVideoFile.ts) —
// mocked here rather than exercised for real, consistent with this
// codebase's existing choice not to test validateVideoFile.ts's ffmpeg
// calls directly (no ffmpeg/yt-dlp binaries assumed present in this
// environment). This tests the orchestration logic itself: does it
// interpret a high frozen fraction as reject, clean up the sample file
// even on failure, and treat "couldn't determine" as review rather than a
// false accept/reject.
vi.mock('../src/providers/youtube/ytdlp.js', () => ({
  downloadSampleClip: vi.fn(),
  getVideoMetadata: vi.fn(),
}));
vi.mock('../src/pipeline/validateVideoFile.js', () => ({
  computeFrozenFraction: vi.fn(),
  MAX_STATIC_FRACTION: 0.8,
}));
// node:fs/promises is intentionally NOT mocked: resolveReview only ever
// mkdir's a real (harmless) temp directory and unlink's the mocked sample
// path, whose failure (the fake path doesn't really exist) is already
// swallowed by the source's own .catch(() => {}) — real fs calls here are
// simpler and more honest than fighting node:fs/promises' ESM mock shape.

describe('resolveReview', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects when the sample clip is mostly frozen', async () => {
    const ytdlp = await import('../src/providers/youtube/ytdlp.js');
    const validate = await import('../src/pipeline/validateVideoFile.js');
    vi.mocked(ytdlp.downloadSampleClip).mockResolvedValue('/tmp/sample.mp4');
    vi.mocked(validate.computeFrozenFraction).mockResolvedValue(0.95);

    const { resolveReview } = await import('../src/pipeline/youtubeValidation.js');
    const result = await resolveReview('abc123');
    expect(result.decision).toBe('reject');
  });

  it('accepts when the sample clip shows real motion', async () => {
    const ytdlp = await import('../src/providers/youtube/ytdlp.js');
    const validate = await import('../src/pipeline/validateVideoFile.js');
    vi.mocked(ytdlp.downloadSampleClip).mockResolvedValue('/tmp/sample.mp4');
    vi.mocked(validate.computeFrozenFraction).mockResolvedValue(0.1);

    const { resolveReview } = await import('../src/pipeline/youtubeValidation.js');
    const result = await resolveReview('abc123');
    expect(result.decision).toBe('accept');
  });

  it('stays at review (not a false accept/reject) when frozen fraction cannot be determined', async () => {
    const ytdlp = await import('../src/providers/youtube/ytdlp.js');
    const validate = await import('../src/pipeline/validateVideoFile.js');
    vi.mocked(ytdlp.downloadSampleClip).mockResolvedValue('/tmp/sample.mp4');
    vi.mocked(validate.computeFrozenFraction).mockResolvedValue(null);

    const { resolveReview } = await import('../src/pipeline/youtubeValidation.js');
    const result = await resolveReview('abc123');
    expect(result.decision).toBe('review');
  });

  it('falls back to review (never throws) when the sample download itself fails', async () => {
    const ytdlp = await import('../src/providers/youtube/ytdlp.js');
    vi.mocked(ytdlp.downloadSampleClip).mockRejectedValue(new Error('yt-dlp exploded'));

    const { resolveReview } = await import('../src/pipeline/youtubeValidation.js');
    const result = await resolveReview('abc123');
    expect(result.decision).toBe('review');
  });

});

describe('validateCandidate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the metadata-only classification without downloading a sample when it is conclusive', async () => {
    const ytdlp = await import('../src/providers/youtube/ytdlp.js');
    vi.mocked(ytdlp.getVideoMetadata).mockResolvedValue(metadata({ channel: 'Artist - Topic' }));

    const { validateCandidate } = await import('../src/pipeline/youtubeValidation.js');
    const result = await validateCandidate('abc123');
    expect(result.decision).toBe('reject');
    expect(vi.mocked(ytdlp.downloadSampleClip)).not.toHaveBeenCalled();
  });

  it('escalates to the bounded sample check only when metadata alone is inconclusive', async () => {
    const ytdlp = await import('../src/providers/youtube/ytdlp.js');
    const validate = await import('../src/pipeline/validateVideoFile.js');
    vi.mocked(ytdlp.getVideoMetadata).mockResolvedValue(metadata());
    vi.mocked(ytdlp.downloadSampleClip).mockResolvedValue('/tmp/sample.mp4');
    vi.mocked(validate.computeFrozenFraction).mockResolvedValue(0.1);

    const { validateCandidate } = await import('../src/pipeline/youtubeValidation.js');
    const result = await validateCandidate('abc123');
    expect(vi.mocked(ytdlp.downloadSampleClip)).toHaveBeenCalledWith('abc123', expect.any(String));
    expect(result.decision).toBe('accept');
  });

  it('runs the bounded motion check for a verified uploader too', async () => {
    const ytdlp = await import('../src/providers/youtube/ytdlp.js');
    const validate = await import('../src/pipeline/validateVideoFile.js');
    vi.mocked(ytdlp.getVideoMetadata).mockResolvedValue(metadata({ channelIsVerified: true }));
    vi.mocked(ytdlp.downloadSampleClip).mockResolvedValue('/tmp/sample.mp4');
    vi.mocked(validate.computeFrozenFraction).mockResolvedValue(0.95);

    const { validateCandidate } = await import('../src/pipeline/youtubeValidation.js');
    const result = await validateCandidate('verified-static-id', 'Blinding Lights');
    expect(vi.mocked(ytdlp.downloadSampleClip)).toHaveBeenCalledWith('verified-static-id', expect.any(String));
    expect(result.decision).toBe('reject');
  });
});
