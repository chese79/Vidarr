import { spawn } from 'node:child_process';
import path from 'node:path';

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
export async function assertHasVideoStream(filePath: string): Promise<void> {
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
  if ((stream.width ?? 0) < MIN_VIDEO_DIMENSION || (stream.height ?? 0) < MIN_VIDEO_DIMENSION) {
    throw new NotAVideoError(
      `Video stream is only ${stream.width}x${stream.height} — likely embedded cover art, not a real video.`,
    );
  }
}

async function getDurationSeconds(filePath: string): Promise<number> {
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(FFPROBE_PATH, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'json',
      filePath,
    ]);
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
  return Number(JSON.parse(output || '{}')?.format?.duration ?? 0);
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
export async function computeFrozenFraction(filePath: string): Promise<number | null> {
  const duration = await getDurationSeconds(filePath);
  if (!duration) return null;

  const stderr = await new Promise<string>((resolve, reject) => {
    const child = spawn(FFMPEG_PATH, [
      '-i',
      filePath,
      '-an',
      '-vf',
      'freezedetect=n=-60dB:d=2',
      '-f',
      'null',
      '-',
    ]);
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
export async function assertHasMotion(filePath: string): Promise<void> {
  const frozenFraction = await computeFrozenFraction(filePath);
  if (frozenFraction == null) return; // can't determine — don't block the import over this alone

  if (frozenFraction > MAX_STATIC_FRACTION) {
    throw new NotAVideoError(
      `Video is static for ${Math.round(frozenFraction * 100)}% of its runtime — likely album art, not a real music video.`,
    );
  }
}

export async function assertIsRealMusicVideo(filePath: string): Promise<void> {
  await assertHasVideoStream(filePath);
  await assertHasMotion(filePath);
}
