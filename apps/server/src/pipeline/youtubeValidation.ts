import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { downloadSampleClip, getVideoMetadata, type YoutubeVideoMetadata } from '../providers/youtube/ytdlp.js';
import { computeFrozenFraction, MAX_STATIC_FRACTION } from './validateVideoFile.js';
import { normalizeTitle } from './normalize.js';

export type CandidateDecision = 'accept' | 'reject' | 'review';

export interface ClassificationResult {
  decision: CandidateDecision;
  reason: string;
}

const SAMPLE_DIR = process.env.STAGING_DIR ?? path.join(os.tmpdir(), 'vidarr-staging');

// Strong negative signals checked against metadata alone ("use provider
// metadata first" per the request doc) — these describe what KIND of
// content a candidate is, which a title/channel-similarity score (see
// youtubeMatch.ts) can't tell on its own. Any match rejects outright,
// regardless of how well the title otherwise matched the song.
const TOPIC_CHANNEL = /-\s*topic$/i;
const PROVIDED_TO_YOUTUBE = /^provided to youtube by/i;
const REJECT_TITLE_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\blyrics?\b/, label: 'lyric video' },
  { pattern: /\bkaraoke\b/, label: 'karaoke' },
  { pattern: /\bvisualizer\b/, label: 'visualizer' },
  { pattern: /\breaction\b/, label: 'reaction video' },
  { pattern: /\bcover\b/, label: 'cover' },
  { pattern: /\blive at\b|\bconcert\b/, label: 'live/concert footage' },
  { pattern: /\binstrumental\b/, label: 'instrumental' },
  { pattern: /\btrailer\b|\bteaser\b/, label: 'trailer/teaser' },
  { pattern: /\bbehind the scenes\b/, label: 'behind-the-scenes' },
];

// Metadata-only classification — no network/download beyond the metadata
// fetch the caller already did. 'review' means neither a strong positive
// nor negative signal fired; the caller decides whether to escalate to
// resolveReview() below or just hold it.
export function classifyCandidate(metadata: YoutubeVideoMetadata): ClassificationResult {
  if (TOPIC_CHANNEL.test(metadata.channel.trim())) {
    return {
      decision: 'reject',
      reason: `Uploaded by an auto-generated "Topic" channel (${metadata.channel}) — audio-only content, not an official video.`,
    };
  }
  if (PROVIDED_TO_YOUTUBE.test(metadata.description.trim())) {
    return {
      decision: 'reject',
      reason: 'Description starts with "Provided to YouTube by" — a label-ingested audio upload, not an official video.',
    };
  }

  const normalizedTitle = normalizeTitle(metadata.title);
  for (const { pattern, label } of REJECT_TITLE_PATTERNS) {
    if (pattern.test(normalizedTitle)) {
      return { decision: 'reject', reason: `Title matches a non-official-video pattern (${label}).` };
    }
  }

  if (metadata.channelIsVerified) {
    return { decision: 'accept', reason: 'Uploaded by a verified channel.' };
  }

  return { decision: 'review', reason: 'No strong positive or negative signal from title/channel/description alone.' };
}

// Only called for the 'review' tier. Downloads a short, low-quality sample
// clip (providers/youtube/ytdlp.ts's downloadSampleClip — "bounded
// sampled-frame/motion analysis," never the full file) and reuses the same
// freeze-fraction check the post-download import path applies to a full
// file (pipeline/validateVideoFile.ts), just against ~20 seconds. Always
// cleans up the sample, including on failure.
export async function resolveReview(youtubeVideoId: string): Promise<ClassificationResult> {
  await fs.mkdir(SAMPLE_DIR, { recursive: true });
  let samplePath: string | undefined;
  try {
    samplePath = await downloadSampleClip(youtubeVideoId, SAMPLE_DIR);
    const frozenFraction = await computeFrozenFraction(samplePath);
    if (frozenFraction == null) {
      return { decision: 'review', reason: 'Could not determine motion from the sample clip.' };
    }
    if (frozenFraction > MAX_STATIC_FRACTION) {
      return {
        decision: 'reject',
        reason: `Sample clip is static for ${Math.round(frozenFraction * 100)}% of its length — likely album art.`,
      };
    }
    return { decision: 'accept', reason: 'Sample clip shows real motion.' };
  } catch (err) {
    return { decision: 'review', reason: `Could not check the sample clip: ${(err as Error).message}` };
  } finally {
    if (samplePath) await fs.unlink(samplePath).catch(() => {});
  }
}

// Full orchestration for one already-chosen candidate: fetch its metadata,
// classify, and escalate to the bounded sample check only for the 'review'
// tier — the single entry point autoSearchAndGrab calls per candidate.
export async function validateCandidate(youtubeVideoId: string): Promise<ClassificationResult> {
  const metadata = await getVideoMetadata(youtubeVideoId);
  const classification = classifyCandidate(metadata);
  if (classification.decision !== 'review') return classification;
  return resolveReview(youtubeVideoId);
}
