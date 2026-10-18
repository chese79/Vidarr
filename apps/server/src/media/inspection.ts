import { spawn } from 'node:child_process';
import path from 'node:path';
import { processDeadline, positiveTimeout } from '../pipeline/processDeadline.js';
import { withValidationWorker } from './validationWorker.js';
import { validationThreads } from '../pipeline/downloadTuning.js';

const FFMPEG_PATH = process.env.FFMPEG_PATH ?? 'ffmpeg';
// ffprobe ships alongside ffmpeg in every distribution vidarr documents
// (the Docker image's apt package, and Windows full-builds) — derive its path
// from FFMPEG_PATH rather than adding a third env var for the common case.
const FFPROBE_PATH =
  process.env.FFPROBE_PATH ??
  (FFMPEG_PATH === 'ffmpeg' ? 'ffprobe' : path.join(path.dirname(FFMPEG_PATH), 'ffprobe' + path.extname(FFMPEG_PATH)));

const MIN_VIDEO_DIMENSION = 64; // excludes embedded cover-art treated as a "video" stream

export class NotAVideoError extends Error {}

// Grabs occasionally turn out to be audio-only (an audio rip mislabeled as a
// music video, or a format selector falling back to an audio-only stream) —
// this actually inspects the file with ffprobe rather than trusting the
// source's own labeling, and rejects anything without a real video stream.
export async function assertHasVideoStream(filePath: string, minimumDimension = MIN_VIDEO_DIMENSION): Promise<void> {
  const args = [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=codec_type,width,height',
    '-of',
    'json',
    filePath,
  ];

  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(FFPROBE_PATH, args);
    processDeadline(child, positiveTimeout(process.env.PROBE_TIMEOUT_MS, 30_000), 'ffprobe', reject);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`ffprobe failed: ${stderr.trim() || code}`));
      else resolve(stdout);
    });
  });

  const parsed = JSON.parse(output || '{}');
  const stream = parsed.streams?.[0];
  if (!stream || stream.codec_type !== 'video') {
    throw new NotAVideoError('Downloaded file has no video stream — likely audio-only.');
  }
  if ((stream.width ?? 0) < minimumDimension || (stream.height ?? 0) < minimumDimension) {
    throw new NotAVideoError(
      `Video stream is only ${stream.width}x${stream.height} — likely embedded cover art, not a real video.`,
    );
  }
}

export async function getVideoProbe(filePath: string): Promise<{ duration: number; width: number; height: number }> {
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(FFPROBE_PATH, [
      '-v',
      'error',
      '-select_streams', 'v:0',
      '-show_entries',
      'format=duration:stream=width,height',
      '-of',
      'json',
      filePath,
    ]);
    processDeadline(child, positiveTimeout(process.env.PROBE_TIMEOUT_MS, 30_000), 'ffprobe', reject);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`ffprobe failed: ${stderr.trim() || code}`));
      else resolve(stdout);
    });
  });
  const probe = JSON.parse(output || '{}');
  return { duration: Number(probe.format?.duration ?? 0), width: Number(probe.streams?.[0]?.width ?? 0), height: Number(probe.streams?.[0]?.height ?? 0) };
}

const FREEZE_EVENT = /freeze_(start|duration):\s*([\d.]+)/g;
export const MAX_STATIC_FRACTION = 0.8; // >80% frozen ⇒ treat as a still image, not a real video

// The actual ffmpeg freezedetect invocation + frozen-fraction math, shared by
// assertHasMotion (the full-file, post-download check below) and Phase 3's
// bounded pre-download sample check (pipeline/youtubeValidation.ts) — one
// implementation of "how much of this file is a frozen still image" used by
// both callers instead of two copies of the same ffmpeg-invocation logic.
// Returns null (rather than 0) when duration can't be determined, so a
// caller can tell "couldn't check" apart from "checked, found no freezing."
export async function computeFrozenFraction(filePath: string, sampleSeconds?: number, startSeconds = 0): Promise<number | null> {
  return withValidationWorker(() => computeFrozenFractionOnce(filePath, sampleSeconds, startSeconds));
}

async function computeFrozenFractionOnce(filePath: string, sampleSeconds?: number, startSeconds = 0): Promise<number | null> {
  const probe = await getVideoProbe(filePath);
  const duration = sampleSeconds ? Math.min(Math.max(0, probe.duration - startSeconds), sampleSeconds) : probe.duration;
  if (!duration) return null;

  const stderr = await new Promise<string>((resolve, reject) => {
    const child = spawn(FFMPEG_PATH, [
      '-threads', String(validationThreads(probe.width, probe.height)),
      '-filter_threads', '1',
      ...(startSeconds ? ['-ss', String(startSeconds)] : []),
      '-i',
      filePath,
      ...(sampleSeconds ? ['-t', String(sampleSeconds)] : []),
      '-an',
      '-vf',
      'freezedetect=n=-60dB:d=2',
      '-f',
      'null',
      '-',
    ]);
    processDeadline(child, positiveTimeout(process.env.VALIDATION_TIMEOUT_MS, 15 * 60_000), 'Video validation', reject);
    let stderrBuf = '';
    child.stderr.on('data', (d) => (stderrBuf += d.toString()));
    child.on('error', reject);
    child.on('close', () => resolve(stderrBuf)); // freezedetect run "fails" null output by design; ignore exit code
  });

  // freezedetect only logs freeze_duration when a frozen span ENDS (motion
  // resumes). A span that's still frozen at EOF — the album-art case — never
  // gets a matching freeze_duration, so an unmatched freeze_start must be
  // closed out manually using the stream's total duration.
  let frozenSeconds = 0;
  let openFreezeStart: number | null = null;
  for (const match of stderr.matchAll(FREEZE_EVENT)) {
    const [, kind, value] = match;
    if (kind === 'start') {
      openFreezeStart = Number(value);
    } else {
      frozenSeconds += Number(value);
      openFreezeStart = null;
    }
  }
  if (openFreezeStart !== null) {
    frozenSeconds += duration - openFreezeStart;
  }

  return frozenSeconds / duration;
}

// A YouTube upload can be a real video-shaped file that's just album art held
// on screen for the whole song — passes the video-stream/dimension check above
// but has no actual motion. ffmpeg's freezedetect filter flags frozen spans;
// if they cover most of the runtime, this isn't a real music video.
export async function assertHasMotion(filePath: string, maximumStaticFraction = MAX_STATIC_FRACTION, sampleSeconds?: number): Promise<void> {
  const frozenFraction = await computeFrozenFraction(filePath, sampleSeconds);
  if (frozenFraction == null) return; // can't determine — don't block the import over this alone

  if (frozenFraction > maximumStaticFraction) {
    throw new NotAVideoError(
      `Video is static for ${Math.round(frozenFraction * 100)}% of its runtime — likely album art, not a real music video.`,
    );
  }
}

export async function assertVideoMedia(filePath: string, options?: { checkVideoFile: boolean; checkVideoMotion: boolean; minimumDimension: number; maximumStaticFraction: number }): Promise<void> {
  if (!options || options.checkVideoFile) await assertHasVideoStream(filePath, options?.minimumDimension);
  if (!options || options.checkVideoMotion) await assertHasMotion(filePath, options?.maximumStaticFraction);
}

// Optional deep inspection for long-form recordings. A header probe alone cannot establish integrity.
export async function assertFileIntegrity(filePath: string): Promise<void> {
  await withValidationWorker(() => new Promise<void>((resolve, reject) => {
    const child = spawn(FFMPEG_PATH, ['-v', 'error', '-xerror', '-threads', '2', '-filter_threads', '1', '-i', filePath,
      '-map', '0:v:0', '-map', '0:a?', '-f', 'null', '-']);
    processDeadline(child, positiveTimeout(process.env.LIVE_INTEGRITY_TIMEOUT_MS, 60 * 60000), 'Full-file integrity inspection', reject);
    let diagnostic = '';
    child.stderr.on('data', data => { diagnostic = (diagnostic + data.toString()).slice(-2000); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new NotAVideoError(`File decode failed; retained for recovery: ${diagnostic.trim() || code}`)));
  }));
}

// Optional deep motion scanning can be disabled without accepting a static-image audio upload.
export async function assertMovingVideoSamples(filePath: string): Promise<void> {
  const probe = await getVideoProbe(filePath);
  if (probe.duration <= 0) throw new NotAVideoError('Cannot establish moving-video eligibility without usable sample timing; retain for review');
  for (const fraction of (probe.duration < 10 ? [0] : [0.1, 0.5, 0.8])) {
    const frozen = await computeFrozenFraction(filePath, 20, probe.duration * fraction);
    if (frozen !== null && frozen <= MAX_STATIC_FRACTION) return;
  }
  throw new NotAVideoError('Distributed samples contain only static imagery; audio-only/static-image recordings are excluded');
}
