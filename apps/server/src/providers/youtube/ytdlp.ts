import { spawn } from 'node:child_process';
import path from 'node:path';

// Configurable so the binary doesn't have to be on PATH — matches Sonarr/Radarr's
// own "path to external tool" settings pattern. Defaults assume PATH (true in the
// Docker image, which bundles both).
const YTDLP_PATH = process.env.YTDLP_PATH ?? 'yt-dlp';
const FFMPEG_PATH = process.env.FFMPEG_PATH ?? 'ffmpeg';

export interface YoutubeVideoListing {
  youtubeVideoId: string;
  title: string;
}

const PROGRESS_LINE = /\[download\]\s+(\d+(?:\.\d+)?)%/;

function runYtDlp(
  args: string[],
  onProgress?: (fraction: number) => void,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP_PATH, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      const chunk = d.toString();
      stdout += chunk;
      if (onProgress) {
        const match = PROGRESS_LINE.exec(chunk);
        if (match) onProgress(Number(match[1]) / 100);
      }
    });
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? -1 }));
  });
}

export async function listChannelVideos(sourceUrl: string): Promise<YoutubeVideoListing[]> {
  const { stdout, stderr, code } = await runYtDlp(['--flat-playlist', '--dump-json', sourceUrl]);
  if (code !== 0) {
    throw new Error(`yt-dlp listing failed: ${stderr.split('\n').slice(-5).join(' ') || code}`);
  }
  return stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
    .map((entry) => ({ youtubeVideoId: String(entry.id), title: entry.title as string }));
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
    throw new Error(`yt-dlp playlist listing failed: ${stderr.split('\n').slice(-5).join(' ') || code}`);
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
    throw new Error(`yt-dlp search failed: ${stderr.split('\n').slice(-5).join(' ') || code}`);
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
}

// A single-video metadata fetch — no download, no --flat-playlist (which
// omits description/verification entirely). Deliberately only called once,
// on an already-chosen top candidate, not once per search result: cheap
// relative to a download, but not free, so it isn't run across all 8.
export async function getVideoMetadata(youtubeVideoId: string): Promise<YoutubeVideoMetadata> {
  const url = `https://www.youtube.com/watch?v=${youtubeVideoId}`;
  const { stdout, stderr, code } = await runYtDlp(['--dump-json', '--skip-download', url]);
  if (code !== 0) {
    throw new Error(`yt-dlp metadata fetch failed: ${stderr.split('\n').slice(-5).join(' ') || code}`);
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
  };
}

const SAMPLE_CLIP_FORMAT = 'worst[height>=64]';
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
  if (FFMPEG_PATH !== 'ffmpeg') {
    args.push('--ffmpeg-location', path.dirname(FFMPEG_PATH));
  }
  args.push(url);
  const { stdout, stderr, code } = await runYtDlp(args);
  if (code !== 0) {
    throw new Error(`yt-dlp sample download failed: ${stderr.split('\n').slice(-5).join(' ') || code}`);
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
): Promise<string> {
  const url = `https://www.youtube.com/watch?v=${youtubeVideoId}`;
  const args = [
    '-f',
    formatSelector,
    '--merge-output-format',
    'mp4',
    '--newline', // one progress update per line — needed since stdout is piped, not a TTY
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
  args.push(url);
  const { stdout, stderr, code } = await runYtDlp(args, onProgress);
  if (code !== 0) {
    throw new Error(`yt-dlp download failed: ${stderr.split('\n').slice(-5).join(' ') || code}`);
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
): Promise<string> {
  const args = [
    '-f', formatSelector,
    '--merge-output-format', 'mp4',
    '--newline',
    '-P', destDir,
    '-o', '%(id)s.%(ext)s',
    '--print', 'after_move:filepath',
  ];
  if (FFMPEG_PATH !== 'ffmpeg') args.push('--ffmpeg-location', path.dirname(FFMPEG_PATH));
  args.push(url);
  const { stdout, stderr, code } = await runYtDlp(args, onProgress);
  if (code !== 0) throw new Error(`yt-dlp download failed: ${stderr.split('\n').slice(-5).join(' ') || code}`);
  const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  const filepath = lines[lines.length - 1];
  if (!filepath) throw new Error('yt-dlp did not report an output file path');
  return filepath;
}
