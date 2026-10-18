import { spawn } from 'node:child_process';
import path from 'node:path';
import { cookieSnapshot } from './cookies.js';
import { processDeadline, positiveTimeout } from '../../pipeline/processDeadline.js';
import { fragmentConcurrency } from '../../pipeline/downloadTuning.js';
import type { DownloadTelemetry, DownloadTimings } from '../../pipeline/downloadTimings.js';

// Configurable so the binary doesn't have to be on PATH — matches Sonarr/Radarr's
// own "path to external tool" settings pattern. Defaults assume PATH (true in the
// Docker image, which bundles both).
const YTDLP_PATH = process.env.YTDLP_PATH ?? 'yt-dlp';
const FFMPEG_PATH = process.env.FFMPEG_PATH ?? 'ffmpeg';

export interface YoutubeVideoListing {
  youtubeVideoId: string;
  title: string;
  sourcePublishedAt: Date | null;
}

export function parseYoutubePublishedFeed(xml: string): Map<string, Date> {
  const dates = new Map<string, Date>();
  for (const match of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const id = /<yt:videoId>([^<]+)<\/yt:videoId>/i.exec(match[1])?.[1];
    const published = /<published>([^<]+)<\/published>/i.exec(match[1])?.[1];
    if (!id || !published) continue;
    const date = new Date(published);
    if (!Number.isNaN(date.getTime())) dates.set(id, date);
  }
  return dates;
}

async function recentChannelPublishedDates(sourceUrl: string): Promise<Map<string, Date>> {
  try {
    const channelId = /^\/channel\/([^/]+)\/?$/i.exec(new URL(sourceUrl).pathname)?.[1];
    if (!channelId) return new Map();
    const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`,
      { signal: AbortSignal.timeout(5_000) });
    return response.ok ? parseYoutubePublishedFeed(await response.text()) : new Map();
  } catch { return new Map(); }
}

export function channelVideosUrl(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl);
    if (!['www.youtube.com', 'youtube.com', 'music.youtube.com', 'm.youtube.com'].includes(url.hostname)) return sourceUrl;
    if (!/^\/(?:channel\/[^/]+|user\/[^/]+|c\/[^/]+|@[^/]+)\/?$/i.test(url.pathname)) return sourceUrl;
    url.hostname = 'www.youtube.com';
    url.pathname = `${url.pathname.replace(/\/$/, '')}/videos`;
    url.search = '';
    return url.toString();
  } catch { return sourceUrl; }
}

const PROGRESS_LINE = /\[download\]\s+(\d+(?:\.\d+)?)%/;

export function progressLines(onProgress?: (fraction: number) => void, onLine?: (line: string) => void) {
  let pending = '';
  return (chunk: string, final = false) => {
    pending += chunk;
    const lines = pending.split(/[\r\n]/);
    pending = final ? '' : lines.pop() ?? '';
    for (const line of lines) {
      onLine?.(line);
      const match = PROGRESS_LINE.exec(line);
      if (match) onProgress?.(Math.max(0, Math.min(1, Number(match[1]) / 100)));
    }
    // Diagnostics need not be held indefinitely when a provider omits newlines.
    if (pending.length > 64_000) pending = pending.slice(-1024);
  };
}

export function downloadTelemetry(onEvent?: (event: DownloadTelemetry) => void, clock = () => performance.now()) {
  const start = clock();
  let transfer: number | undefined, merge: number | undefined;
  const timings: DownloadTimings = {};
  onEvent?.({ phase: 'extracting' });
  return {
    line(line: string) {
      if (line === '__VIDARR_TRANSFER__' && transfer === undefined) {
        transfer = clock(); timings.extractionMs = Math.round(transfer - start);
        onEvent?.({ phase: 'transferring' });
      }
      if (line === '__VIDARR_MERGE__' && merge === undefined) {
        merge = clock();
        if (transfer !== undefined) timings.transferMs = Math.round(merge - transfer);
        onEvent?.({ phase: 'merging' });
      }
      const speed = /VIDARR_SPEED=([\d.eE+-]+)/.exec(line);
      if (speed && Number.isFinite(Number(speed[1])) && Number(speed[1]) > 0) timings.recentBytesPerSecond = Math.round(Number(speed[1]));
    },
    finish() {
      const end = clock();
      timings.acquisitionMs = Math.round(end - start);
      if (merge !== undefined) timings.mergeMs = Math.round(end - merge);
      else if (transfer !== undefined) timings.transferMs = Math.round(end - transfer);
      onEvent?.({ timings });
      return timings;
    },
  };
}

function directDownloadOptions(): string[] {
  return ['--concurrent-fragments', String(fragmentConcurrency()),
    '--print', 'before_dl:__VIDARR_TRANSFER__', '--print', 'post_process:__VIDARR_MERGE__',
    '--progress-template', 'download:[download] %(progress._percent_str)s VIDARR_SPEED=%(progress.speed)s'];
}

function ytDlpFailure(stderr: string, code: number): string {
  const lines = stderr.split('\n').map(line => line.trim()).filter(Boolean);
  const errors = lines.filter(line => /^ERROR:/i.test(line));
  return (errors.length ? errors : lines).slice(-5).join(' ') || String(code);
}

async function runYtDlp(
  args: string[],
  onProgress?: (fraction: number) => void,
  onTelemetry?: (event: DownloadTelemetry) => void,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const cookies = await cookieSnapshot(args);
  try { return await new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
    // Use the same supported Node runtime as Vidarr, including on native installs.
    const child = spawn(YTDLP_PATH, ['--js-runtimes', `node:${process.execPath}`,
      ...(cookies ? ['--cookies', cookies.path] : []), ...args]);
    processDeadline(child, args.includes('--merge-output-format')
      ? positiveTimeout(process.env.DOWNLOAD_TIMEOUT_MS, 30 * 60_000)
      : positiveTimeout(process.env.EXTRACTOR_TIMEOUT_MS, 10 * 60_000), 'yt-dlp', reject);
    let stdout = '';
    let stderr = '';
    const telemetry = onTelemetry ? downloadTelemetry(onTelemetry) : undefined;
    const stdoutProgress = progressLines(onProgress, telemetry?.line);
    const stderrProgress = progressLines(onProgress, telemetry?.line);
    child.stdout.on('data', (d) => {
      const chunk = d.toString();
      stdout += chunk;
      stdoutProgress(chunk);
    });
    child.stderr.on('data', (d) => { const chunk = d.toString(); stderr += chunk; stderrProgress(chunk); });
    child.on('error', reject);
    child.on('close', (code) => { stdoutProgress('', true); stderrProgress('', true); telemetry?.finish(); resolve({ stdout, stderr, code: code ?? -1 }); });
  }); } finally { await cookies?.cleanup(); }
}

export async function listChannelVideos(sourceUrl: string): Promise<YoutubeVideoListing[]> {
  const { stdout, stderr, code } = await runYtDlp(['--flat-playlist', '--dump-json', channelVideosUrl(sourceUrl)]);
  if (code !== 0) {
    if (channelHasNoVideosTab(stderr)) return [];
    throw new Error(`yt-dlp listing failed: ${ytDlpFailure(stderr, code)}`);
  }
  const publishedDates = await recentChannelPublishedDates(sourceUrl);
  return stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
    .map((entry) => ({ youtubeVideoId: String(entry.id), title: entry.title as string,
      sourcePublishedAt: publishedDates.get(String(entry.id)) ?? null }));
}

export function channelHasNoVideosTab(stderr: string): boolean {
  return /this channel does not have a videos tab/i.test(stderr);
}

export interface YoutubeSearchCandidate {
  youtubeVideoId: string;
  title: string;
  channel: string;
}

// A playlist (unlike a single artist's channel/playlist source, see
// listChannelVideos) can span many different artists/channels — bulk-import
// needs the per-video channel to guess which artist each video belongs to.
// Confirmed live: a channel's "Videos" listing doesn't populate the
// per-entry channel/uploader fields at all (only playlist_channel/
// playlist_uploader, which describe the listing itself) — a genuine curated
// playlist does populate channel/uploader per entry instead. Falling back
// through both pairs covers both shapes.
export async function listPlaylistVideos(url: string): Promise<YoutubeSearchCandidate[]> {
  const { stdout, stderr, code } = await runYtDlp(['--flat-playlist', '--dump-json', url]);
  if (code !== 0) {
    throw new Error(`yt-dlp playlist listing failed: ${ytDlpFailure(stderr, code)}`);
  }
  return stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
    .map((entry) => ({
      youtubeVideoId: String(entry.id),
      title: entry.title as string,
      channel: (entry.channel || entry.uploader || entry.playlist_channel || entry.playlist_uploader || '') as string,
    }));
}

const SEARCH_RESULT_COUNT = 8;

export async function searchYoutube(query: string): Promise<YoutubeSearchCandidate[]> {
  const { stdout, stderr, code } = await runYtDlp([
    '--flat-playlist',
    '--dump-json',
    `ytsearch${SEARCH_RESULT_COUNT}:${query}`,
  ]);
  if (code !== 0) {
    throw new Error(`yt-dlp search failed: ${ytDlpFailure(stderr, code)}`);
  }
  return stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
    .map((entry) => ({
      youtubeVideoId: String(entry.id),
      title: entry.title as string,
      channel: (entry.channel || entry.uploader || '') as string,
    }));
}

export interface YoutubeVideoMetadata {
  title: string;
  channel: string;
  description: string;
  channelIsVerified: boolean;
  isLivePerformance?: boolean;
}

// Source observations only. Upload/release dates and source chapters are never performance/coverage proof.
export async function getDirectVideoMetadata(url: string) {
  const { stdout, stderr, code } = await runYtDlp(['--dump-single-json', '--no-playlist', '--skip-download', url]);
  if (code !== 0) throw new Error(`yt-dlp metadata fetch failed: ${ytDlpFailure(stderr, code)}`);
  const data = JSON.parse(stdout);
  return { title: String(data.title ?? ''), channel: String(data.channel ?? data.uploader ?? ''), description: String(data.description ?? '').slice(0, 30000),
    creditedArtists: Array.isArray(data.artists) ? data.artists.filter((value: unknown): value is string => typeof value === 'string').slice(0, 100) : [],
    uploadDate: typeof data.upload_date === 'string' ? data.upload_date : null, releaseDate: typeof data.release_date === 'string' ? data.release_date : null,
    durationSeconds: Number.isFinite(data.duration) && data.duration > 0 ? Number(data.duration) : null,
    chapters: (Array.isArray(data.chapters) ? data.chapters : []).slice(0, 500).filter((chapter: any) => Number.isFinite(chapter.start_time) && Number.isFinite(chapter.end_time) && chapter.end_time > chapter.start_time)
      .map((chapter: any) => ({ title: String(chapter.title ?? ''), startSeconds: Number(chapter.start_time), endSeconds: Number(chapter.end_time) })),
    sourceHasVideo: (data.formats ?? []).some((format: any) => format.vcodec && format.vcodec !== 'none'),
    currentlyLive: data.is_live === true,
  };
}

// A single-video metadata fetch — no download, no --flat-playlist (which
// omits description/verification entirely). Deliberately only called once,
// on an already-chosen top candidate, not once per search result: cheap
// relative to a download, but not free, so it isn't run across all 8.
export async function getVideoMetadata(youtubeVideoId: string): Promise<YoutubeVideoMetadata> {
  const url = `https://www.youtube.com/watch?v=${youtubeVideoId}`;
  const { stdout, stderr, code } = await runYtDlp(['--dump-json', '--skip-download', url]);
  if (code !== 0) {
    throw new Error(`yt-dlp metadata fetch failed: ${ytDlpFailure(stderr, code)}`);
  }
  const entry = JSON.parse(stdout.trim().split('\n')[0] || '{}');
  return {
    title: (entry.title ?? '') as string,
    channel: (entry.channel || entry.uploader || '') as string,
    description: (entry.description ?? '') as string,
    // Only present in newer yt-dlp versions — absence must never itself
    // count as a negative signal (handled by the caller, not defaulted to
    // false-as-"unverified" here, to keep that judgment call in one place).
    channelIsVerified: Boolean(entry.channel_is_verified),
    isLivePerformance: Boolean(entry.is_live || entry.was_live || entry.live_status === 'post_live'),
  };
}

// Motion needs video only. Modern YouTube uploads often have no combined
// video/audio format; requiring one prevented otherwise valid sample checks.
const SAMPLE_CLIP_FORMAT = 'worstvideo[height>=64]/worst[height>=64]';
const SAMPLE_CLIP_SECONDS = 20;

// Downloads only the first ~20 seconds at the lowest available quality —
// "bounded sampled-frame/motion analysis" per the request doc, used to
// validate a candidate BEFORE committing to the real, full-quality download
// that grabYoutubeVideo does. Caller is responsible for deleting the result.
export async function downloadSampleClip(youtubeVideoId: string, destDir: string): Promise<string> {
  const url = `https://www.youtube.com/watch?v=${youtubeVideoId}`;
  const args = [
    '-f',
    SAMPLE_CLIP_FORMAT,
    '--download-sections',
    `*0-${SAMPLE_CLIP_SECONDS}`,
    '--force-keyframes-at-cuts',
    '--merge-output-format',
    'mp4',
    '-P',
    destDir,
    '-o',
    '%(id)s.sample.%(ext)s',
    '--print',
    'after_move:filepath',
  ];
  const sampleFfmpegPath = process.env.SAMPLE_FFMPEG_PATH ?? FFMPEG_PATH;
  if (sampleFfmpegPath !== 'ffmpeg') {
    args.push('--ffmpeg-location', path.dirname(sampleFfmpegPath));
  }
  args.push(url);
  const { stdout, stderr, code } = await runYtDlp(args);
  if (code !== 0) {
    throw new Error(`yt-dlp sample download failed: ${ytDlpFailure(stderr, code)}`);
  }
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const filepath = lines[lines.length - 1];
  if (!filepath) throw new Error('yt-dlp did not report a sample clip path');
  return filepath;
}

const DEFAULT_FORMAT = 'bestvideo[height<=1080]+bestaudio/best';

export async function downloadVideo(
  youtubeVideoId: string,
  destDir: string,
  formatSelector: string = DEFAULT_FORMAT,
  onProgress?: (fraction: number) => void,
  onTelemetry?: (event: DownloadTelemetry) => void,
): Promise<string> {
  const url = `https://www.youtube.com/watch?v=${youtubeVideoId}`;
  const args = [
    '-f',
    formatSelector,
    '--merge-output-format',
    'mp4',
    '--newline', // one progress update per line — needed since stdout is piped, not a TTY
    '--progress', // --print otherwise suppresses download progress
    '-P',
    destDir,
    '-o',
    '%(id)s.%(ext)s',
    '--print',
    'after_move:filepath',
  ];
  // Only override ffmpeg's location when explicitly configured — otherwise let
  // yt-dlp find it on PATH itself (the default, and how the Docker image works).
  if (FFMPEG_PATH !== 'ffmpeg') {
    args.push('--ffmpeg-location', path.dirname(FFMPEG_PATH));
  }
  args.push(...directDownloadOptions(), url);
  const { stdout, stderr, code } = await runYtDlp(args, onProgress, onTelemetry);
  if (code !== 0) {
    throw new Error(`yt-dlp download failed: ${ytDlpFailure(stderr, code)}`);
  }
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const filepath = lines[lines.length - 1];
  if (!filepath) throw new Error('yt-dlp did not report an output file path');
  return filepath;
}

// Provider-neutral direct-source transfer. yt-dlp supports both YouTube and
// Vimeo (plus other URL-based providers); catalog code supplies the exact
// authoritative URL instead of forcing every source through a YouTube id.
export async function downloadDirectVideo(
  url: string,
  destDir: string,
  formatSelector: string = DEFAULT_FORMAT,
  onProgress?: (fraction: number) => void,
  onTelemetry?: (event: DownloadTelemetry) => void,
): Promise<string> {
  const args = [
    '-f', formatSelector,
    '--merge-output-format', 'mp4',
    '--newline',
    '--progress',
    '-P', destDir,
    '-o', '%(id)s.%(ext)s',
    '--print', 'after_move:filepath',
  ];
  if (FFMPEG_PATH !== 'ffmpeg') args.push('--ffmpeg-location', path.dirname(FFMPEG_PATH));
  args.push(...directDownloadOptions(), url);
  const { stdout, stderr, code } = await runYtDlp(args, onProgress, onTelemetry);
  if (code !== 0) throw new Error(`yt-dlp download failed: ${ytDlpFailure(stderr, code)}`);
  const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  const filepath = lines[lines.length - 1];
  if (!filepath) throw new Error('yt-dlp did not report an output file path');
  return filepath;
}
