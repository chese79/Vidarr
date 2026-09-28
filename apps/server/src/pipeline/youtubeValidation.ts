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
  { pattern: /\blive at\b|\bconcert\b/, label: 'live/concert footage' },
  { pattern: /\bofficial\s+video\s+ac\s*dc\s+live\b|\blive\s+(?:stuttgart|19\d\d|20\d\d)\b|\bplaza de toros\b/, label: 'live performance' },
  { pattern: /\bfrom\b.{0,60}\blive\b|\blive\b.{0,30}\b(?:tour|album|dvd)\b/, label: 'live performance' },
  { pattern: /\blive\s+(?:performance|session|version|song|(?:music\s+)?video)\b|\bperformance\s+live\b/, label: 'live performance' },
  { pattern: /\binterview\b|\bpress conference\b|\bq\s+a\b/, label: 'interview' },
  { pattern: /\bpodcast\b|\bepisode\s+\d+\b/, label: 'podcast episode' },
  { pattern: /\bmaking of\b|\bstory of\b|\bidea behind\b/, label: 'behind-the-song feature' },
  { pattern: /\bofficial audio\b|\baudio only\b|\bart track\b/, label: 'audio upload' },
  { pattern: /\binstrumental\b/, label: 'instrumental' },
  { pattern: /\btrailer\b|\bteaser\b/, label: 'trailer/teaser' },
  { pattern: /\bbehind the scenes\b/, label: 'behind-the-scenes' },
];

export function excludedMusicVideoTitleReason(title: string): string | null {
  const normalized = normalizeTitle(title);
  const match = REJECT_TITLE_PATTERNS.find(({ pattern }) => pattern.test(normalized));
  return match ? `Title indicates ${match.label}, not a song music video.` : null;
}

// A bare /\bcover\b/ against the fully-normalized title (normalizeTitle
// strips ALL punctuation to spaces) rejected legitimate official videos
// whose actual title contains the word, e.g. "Cover Me" — indistinguishable
// from a fan-cover tag once parentheses/dashes are gone. Fan covers are
// conventionally labeled with "cover" set off from the song title itself
// (parenthesized/bracketed, after a dash, or qualified as "acoustic cover"/
// "cover of X"/"cover version") — that punctuation is exactly the signal
// normalizeTitle destroys, so this checks the original (only case-folded)
// title instead of the normalized one, specifically for this pattern.
const COVER_PATTERN =
  /\([^)]*\bcover\b[^)]*\)|\[[^\]]*\bcover\b[^\]]*\]|[-–—][^\n]*\bcover\b|\bcover\s+(?:of|version)\b|\b(?:acoustic|piano|guitar|vocal|drum|instrumental|male|female|full|fan)\s+cover\b/;

// Metadata-only classification — no network/download beyond the metadata
// fetch the caller already did. 'review' means neither a strong positive
// nor negative signal fired; the caller decides whether to escalate to
// resolveReview() below or just hold it.
export function classifyCandidate(metadata: YoutubeVideoMetadata, expectedTitle?: string): ClassificationResult {
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

  const expectedContainsCover = expectedTitle != null && /\bcover\b/.test(normalizeTitle(expectedTitle));
  if (!expectedContainsCover && COVER_PATTERN.test(metadata.title.toLowerCase())) {
    return { decision: 'reject', reason: 'Title matches a non-official-video pattern (cover).' };
  }

  const normalizedTitle = normalizeTitle(metadata.title);
  for (const { pattern, label } of REJECT_TITLE_PATTERNS) {
    if (pattern.test(normalizedTitle)) {
      return { decision: 'reject', reason: `Title matches a non-official-video pattern (${label}).` };
    }
  }

  if (metadata.channelIsVerified) {
    return {
      decision: 'review',
      reason: 'Verified uploader is a strong positive signal, but visual validation is still required.',
    };
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
export async function validateCandidate(youtubeVideoId: string, expectedTitle?: string): Promise<ClassificationResult> {
  const metadata = await getVideoMetadata(youtubeVideoId);
  const classification = classifyCandidate(metadata, expectedTitle);
  if (classification.decision !== 'review') return classification;
  // Motion alone also describes interviews and live footage. Only a title
  // explicitly identifying a song music video may pass automatic validation;
  // other moving uploads wait for a person in Video Review.
  if (!/\bofficial\s+(?:music\s+)?video\b/i.test(metadata.title)) {
    return { decision: 'review', reason: 'Upload is not explicitly identified as an official song music video.' };
  }
  if (expectedTitle && !normalizeTitle(metadata.title).includes(normalizeTitle(expectedTitle))) {
    return { decision: 'review', reason: 'Upload title does not identify the expected song.' };
  }
  return resolveReview(youtubeVideoId);
}
